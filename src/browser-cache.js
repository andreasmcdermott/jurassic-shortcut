const DATABASE = 'jurassic-shortcut-v1';

// Refresh changes the generation atomically with deletion. Late responses from
// another tab cannot repopulate the cleared cache.
export class BrowserCache {
  constructor(scope, { indexedDB = globalThis.indexedDB, name = DATABASE } = {}) {
    this.scope = scope;
    this.enabled = !!indexedDB;
    this.generation = null;
    this.ready = new Promise(resolve => {
      if (!indexedDB) return resolve(null);
      let request;
      try { request = indexedDB.open(name, 1); } catch { this.enabled = false; return resolve(null); }
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('scopes', { keyPath: 'scope' });
        db.createObjectStore('entries', { keyPath: ['scope', 'path'] }).createIndex('scope', 'scope');
      };
      request.onerror = request.onblocked = () => { this.enabled = false; resolve(null); };
      request.onsuccess = () => {
        const db = request.result;
        if (!this.enabled) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.enabled = false; };
        resolve(db);
      };
    });
  }

  async transaction(mode, action) {
    const db = await this.ready;
    if (!db || !this.enabled) return null;
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['scopes', 'entries'], mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Cache transaction failed.'));
        action(tx.objectStore('scopes'), tx.objectStore('entries'), value => { result = value; });
      });
    } catch { this.enabled = false; return null; }
  }

  async initialize() {
    if (this.generation) return;
    await this.transaction('readwrite', (scopes, _entries, done) => {
      const request = scopes.get(this.scope);
      request.onsuccess = () => {
        const record = request.result || { scope: this.scope, generation: crypto.randomUUID() };
        if (!request.result) scopes.put(record);
        this.generation = record.generation;
        done(true);
      };
    });
  }

  async snapshot() {
    await this.initialize();
    const entries = await this.transaction('readonly', (_scopes, entries, done) => {
      const request = entries.index('scope').getAll(this.scope);
      request.onsuccess = () => done(request.result.filter(e => e.generation === this.generation));
    }) || [];
    return { entries, enabled: this.enabled, lastSavedAt: entries.reduce((latest, e) => Math.max(latest, e.savedAt), 0) || null };
  }

  async read(path) {
    await this.initialize();
    return this.transaction('readonly', (_scopes, entries, done) => {
      const request = entries.get([this.scope, path]);
      request.onsuccess = () => done(request.result?.generation === this.generation ? request.result : null);
    });
  }

  async write(path, data, generation) {
    if (!generation) return null;
    return this.transaction('readwrite', (scopes, entries, done) => {
      const request = scopes.get(this.scope);
      request.onsuccess = () => {
        if (request.result?.generation !== generation) return done(null);
        const savedAt = Date.now();
        entries.put({ scope: this.scope, generation, path, data, savedAt });
        done(savedAt);
      };
    });
  }

  async clear() {
    const generation = crypto.randomUUID();
    const success = await this.transaction('readwrite', (scopes, entries, done) => {
      scopes.put({ scope: this.scope, generation });
      const cursor = entries.index('scope').openCursor(this.scope);
      cursor.onsuccess = () => {
        if (cursor.result) { cursor.result.delete(); cursor.result.continue(); }
      };
      done(true);
    });
    this.generation = generation;
    if (!success) throw new Error('Browser cache could not be cleared. Clear this site’s stored data in your browser and reconnect.');
  }
}
