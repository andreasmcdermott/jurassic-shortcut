import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const zip = promisify(gzip), unzip = promisify(gunzip);
const hash = value => createHash('sha256').update(value).digest('hex');

export function cacheScope(member, token) {
  if (!member?.workspace2?.id || !member?.id) return null;
  // Separate permissions as well as workspaces. Neither token nor raw identity is written.
  return hash(JSON.stringify([member.workspace2.id, member.id, token]));
}

export class ResponseCache {
  constructor(directory) { this.directory = directory; this.tails = new Map(); this.generations = new Map(); }
  generation(scope) { return this.generations.get(scope) || 0; }
  folder(scope) {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid cache scope');
    return path.join(this.directory, scope);
  }
  serialize(scope, operation) {
    const pending = (this.tails.get(scope) || Promise.resolve()).then(operation);
    this.tails.set(scope, pending.catch(() => {}));
    return pending;
  }
  async decode(filename) {
    try {
      const entry = JSON.parse((await unzip(await readFile(filename))).toString('utf8'));
      if (entry.version !== 1 || typeof entry.path !== 'string' || !Number.isFinite(entry.savedAt) || !('data' in entry)) return null;
      if (path.basename(filename) !== `${hash(entry.path)}.json.gz`) return null;
      return entry;
    } catch { return null; }
  }
  async get(scope, target) {
    await this.tails.get(scope);
    return this.decode(path.join(this.folder(scope), `${hash(target)}.json.gz`));
  }
  set(scope, target, data, generation) {
    return this.serialize(scope, async () => {
      if (this.generation(scope) !== generation) return null;
      const folder = this.folder(scope);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const entry = { version: 1, path: target, savedAt: Date.now(), data };
      const filename = path.join(folder, `${hash(target)}.json.gz`);
      const temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, await zip(JSON.stringify(entry)), { mode: 0o600 });
        if (this.generation(scope) !== generation) return null;
        await rename(temporary, filename);
        return entry;
      } finally { await rm(temporary, { force: true }); }
    });
  }
  async snapshot(scope) {
    await this.tails.get(scope);
    const folder = this.folder(scope);
    let names;
    try { names = await readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const entries = [];
    // Bound decompression concurrency for large workspaces.
    const files = names.filter(name => /^[a-f0-9]{64}\.json\.gz$/.test(name));
    for (let i = 0; i < files.length; i += 16) {
      const batch = await Promise.all(files.slice(i, i + 16).map(name => this.decode(path.join(folder, name))));
      entries.push(...batch.filter(Boolean));
    }
    return entries;
  }
  clear(scope) {
    // Requests already in flight cannot repopulate the old snapshot after a refresh.
    this.generations.set(scope, this.generation(scope) + 1);
    return this.serialize(scope, () => rm(this.folder(scope), { recursive: true, force: true }));
  }
}
