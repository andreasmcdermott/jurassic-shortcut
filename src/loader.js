import { Workspace } from './data.js';

let nextRequestAt = 0;
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
async function pacedRequest(path, options) {
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    const delay = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Date.now() + delay + 350;
    await pause(delay, options.signal);
    try { return await api(path, options); }
    catch (error) {
      if (error.status !== 429 || attempt >= 2 || error.retryAfter > 30000) throw error;
      await pause(Math.max(1000, error.retryAfter || 2000), options.signal);
    }
  }
}

export async function api(path, { onCache, ...options } = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Fsn-Client': '1', ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    const retryAfter = response.headers.get('Retry-After');
    error.retryAfter = retryAfter && (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
    throw error;
  }
  const cacheState = response.headers.get('X-Fsn-Cache');
  if (cacheState) onCache?.({ state: cacheState, savedAt: Number(response.headers.get('X-Fsn-Cache-Saved-At')) || null });
  return data;
}

export class Loader {
  constructor(member, onChange, onStatus, onCache = () => {}, cache = null) {
    this.cache = cache;
    this.member = member; this.onCache = onCache; this.cachedEpics = new Set();
    this.ws = new Workspace(member.workspace2?.name || 'Shortcut workspace');
    this.onChange = onChange; this.onStatus = onStatus; this.stopped = false;
    this.inflight = new Map(); this.queue = []; this.active = 0; this.completed = 0; this.total = 0; this.failed = 0;
    this.controller = new AbortController();
  }
  async get(path) {
    const signal = this.controller.signal;
    const onCache = info => { if (!this.stopped) this.onCache(info); };
    if (!this.cache) return api(`shortcut/${path}`, { signal, onCache });
    const entry = await this.cache.read(`/${path}`);
    signal.throwIfAborted();
    if (entry) { onCache({ state: 'hit', savedAt: entry.savedAt }); return entry.data; }
    const generation = this.cache.generation;
    let data;
    try { data = await pacedRequest(`shortcut/${path}`, { signal, headers: { 'X-Fsn-Scope': this.cache.scope } }); }
    catch (error) {
      if (error.status === 401 || error.status === 409) { this.stop(); this.onStatus(error.message); }
      throw error;
    }
    signal.throwIfAborted();
    const savedAt = await this.cache.write(`/${path}`, data, generation);
    onCache({ state: this.cache.enabled ? 'miss' : 'unavailable', savedAt });
    return data;
  }
  clearCache() {
    return this.cache ? this.cache.clear() : api('cache', { method: 'DELETE' });
  }
  restore(entries) {
    const rank = path => path === '/objectives' ? 0 : path.startsWith('/epics/paginated?') ? 1 : path === '/workflows' ? 2 : path === '/members' ? 3 : /^\/epics\/\d+\/stories$/.test(path) ? 4 : path.startsWith('/search/stories') ? 5 : 6;
    const ordered = entries.filter(entry => typeof entry.path === 'string').sort((a, b) => rank(a.path) - rank(b.path) || a.savedAt - b.savedAt);
    for (const { path, data } of ordered) {
      if (path === '/objectives' && Array.isArray(data)) data.forEach(node => this.ws.upsert('objective', { ...node, loaded: true }));
      else if (path.startsWith('/epics/paginated?') && Array.isArray(data?.data)) data.data.forEach(node => this.ws.upsert('epic', node));
      else if (path === '/workflows' && Array.isArray(data)) data.forEach(w => w.states.forEach(s => this.ws.states.set(s.id, s)));
      else if (path === '/members' && Array.isArray(data)) data.forEach(m => this.ws.members.set(m.id, m.profile?.name || m.profile?.mention_name || 'Member'));
      else if (/^\/epics\/\d+\/stories$/.test(path) && Array.isArray(data)) {
        data.forEach(node => this.ws.upsert('story', node));
        const id = Number(path.split('/')[2]); this.cachedEpics.add(id);
        const epic = this.ws.get(`epic:${id}`); if (epic) epic.loaded = true;
      } else if (path.startsWith('/search/stories') && Array.isArray(data?.data)) data.data.forEach(node => this.ws.upsert('story', node));
      else if (/^\/stories\/\d+$/.test(path) && data?.id != null) {
        this.ws.upsert('story', { ...data, loaded: true });
        (data.tasks || []).forEach(task => this.ws.upsert('task', { ...task, story_id: data.id, updated_at: task.updated_at || data.updated_at, loaded: true }));
      }
    }
    this.emit();
  }
  async restoreCache() {
    try {
      const snapshot = this.cache ? await this.cache.snapshot() : await api('cache', { signal: this.controller.signal });
      if (this.stopped) return;
      this.restore(snapshot.entries || []);
      this.onCache({ state: snapshot.enabled ? 'restored' : 'unavailable', savedAt: snapshot.lastSavedAt });
    } catch { if (!this.stopped) this.onCache({ state: 'unavailable' }); }
  }
  emit() { if (!this.stopped) { this.ws.rebuild(); this.onChange(this.ws); } }
  async start() {
    try {
      this.onStatus('Restoring local workspace cache…');
      await this.restoreCache();
      if (this.stopped) return;
      this.onStatus('Reading objectives and epics; using saved data where available…');
      const results = await Promise.allSettled([
        this.get('objectives').then(items => { if (!this.stopped) { items.forEach(n => this.ws.upsert('objective', { ...n, loaded: true })); this.emit(); } }),
        this.loadEpics(),
        this.get('workflows').then(items => items.forEach(w => w.states.forEach(s => this.ws.states.set(s.id, s)))),
        this.get('members').then(items => items.forEach(m => this.ws.members.set(m.id, m.profile?.name || m.profile?.mention_name || 'Member'))),
      ]);
      if (this.stopped) return;
      const errors = results.filter(r => r.status === 'rejected');
      this.bootstrapErrors = errors.length;
      if (errors.length) this.onStatus(`Some workspace data could not load. ${errors[0].reason.message} Reconnect to retry workspace setup.`);
      this.emit();
      const epics = [...this.ws.nodes.values()].filter(n => n.kind === 'epic' && !n.archived && !n.loaded);
      this.queue = epics.map(n => n.key); this.total = this.queue.length;
      this.loadOrphans().finally(() => { if (!this.stopped && !this.active && !this.queue.length) this.reportProgress(); }); this.pump();
    } catch (error) { if (!this.stopped) this.onStatus(error.message); }
  }
  async loadEpics() {
    let page = 1;
    do {
      const result = await this.get(`epics/paginated?page=${page}`);
      if (this.stopped) return;
      result.data.forEach(n => this.ws.upsert('epic', { ...n, ...(this.cachedEpics.has(n.id) ? { loaded: true } : {}) })); this.emit();
      const next = result.next; if (next == null || next === false) break;
      const newPage = Number(next); if (!Number.isInteger(newPage) || newPage <= page) break;
      page = newPage;
    } while (!this.stopped);
  }
  async loadOrphans() {
    let next = null, count = 0;
    try {
      do {
        const result = await this.get(`search/stories${next ? `?next=${encodeURIComponent(next)}` : ''}`);
        if (this.stopped) return;
        result.data.forEach(n => this.ws.upsert('story', n)); count += result.data.length; this.emit();
        next = result.next;
        if (count >= 1000) {
          if (next || result.total > count) { this.orphanLimit = true; this.onStatus('Loaded 1,000 stories without an epic, the Shortcut search limit. Epic directories continue loading.'); }
          break;
        }
      } while (next && !this.stopped);
    } catch (error) { if (!this.stopped) { this.orphanError = true; this.onStatus(`Stories without an epic: ${error.message}`); } }
  }
  pump() {
    if (this.stopped) return;
    while (this.active < 2 && this.queue.length) {
      const key = this.queue.shift(); this.active++;
      this.hydrate(key).finally(() => {
        this.active--; this.completed++;
        if (!this.stopped) {
          this.reportProgress();
          this.pump();
        }
      });
    }
  }
  reportProgress() {
    this.onStatus(this.completed < this.total ? `Loading uncached epic directories ${this.completed}/${this.total} · ${this.ws.counts().story} stories available` : `Loaded ${this.ws.counts().story} stories. Tasks load when you select a story.${this.failed ? ` ${this.failed} directories need a retry.` : ''}${this.bootstrapErrors ? ' Workspace setup was incomplete; use Refresh to retry.' : ''}${this.orphanError ? ' Unassigned stories could not load; use Refresh to retry.' : ''}${this.orphanLimit ? ' Unassigned stories capped at 1,000.' : ''}`);
  }
  hydrate(key) {
    if (this.stopped) return Promise.resolve();
    const node = this.ws.get(key);
    if (!node || node.loaded || !['epic', 'story'].includes(node.kind)) return Promise.resolve();
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this.loadNode(node).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise); return promise;
  }
  async loadNode(node) {
    node.loading = true; node.loadError = null; this.onChange(this.ws);
    try {
      if (node.kind === 'epic') {
        const stories = await this.get(`epics/${node.id}/stories`);
        if (this.stopped) return;
        stories.forEach(n => this.ws.upsert('story', n));
        // upsert may have replaced this node during concurrent metadata loading.
        Object.assign(this.ws.get(node.key), { loaded: true, loading: false, loadError: null });
      } else {
        const story = await this.get(`stories/${node.id}`);
        if (this.stopped) return;
        this.ws.upsert('story', { ...story, loaded: true, loading: false, loadError: null });
        (story.tasks || []).forEach(task => this.ws.upsert('task', { ...task, story_id: story.id, updated_at: task.updated_at || story.updated_at, loaded: true }));
      }
      this.emit();
    } catch (error) {
      if (!this.stopped) { this.failed++; Object.assign(this.ws.get(node.key), { loading: false, loadError: error.message }); this.onChange(this.ws); this.onStatus(error.message); }
    }
  }
  stop() { this.stopped = true; this.queue = []; this.controller.abort(); }
}
