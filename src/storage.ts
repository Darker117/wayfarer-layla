import type { Store } from './domain';
import { validateStore } from './backup';
import { initialStore } from './seeds';
import { demoMode, hasNativeBridge, layla, withTimeout } from './host';

export interface Persistence { read(): Promise<string | null>; write(json: string): Promise<void> }
export class Repository {
  private queue: Promise<void> = Promise.resolve();
  constructor(private persistence: Persistence) {}
  async load(): Promise<Store> {
    const value = await this.persistence.read();
    if (value !== null) return validateStore(JSON.parse(value));
    const store = initialStore(); await this.save(store); return store;
  }
  save(store: Store): Promise<void> {
    const json = JSON.stringify(store);
    // One row = an atomic snapshot, including script state, cards, transcript and undo checkpoints.
    const operation = this.queue.catch(() => {}).then(() => this.persistence.write(json));
    this.queue = operation; return operation;
  }
}
export function createRepository(): { repository: Repository; kind: string } {
  if (hasNativeBridge() && !demoMode) {
    let ready = false;
    const initialize = async () => { if (!ready) { await withTimeout(signal => layla.db.executeSql('CREATE TABLE IF NOT EXISTS wayfarer_store (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)', [], { signal })); ready = true; } };
    return { kind: 'Layla private database', repository: new Repository({
      async read() { await initialize(); const result = await withTimeout(signal => layla.db.executeSql('SELECT payload FROM wayfarer_store WHERE id = 1', [], { signal })); return result.rows[0]?.payload ?? null; },
      async write(json) { await initialize(); const result = await withTimeout(signal => layla.db.executeSql('INSERT OR REPLACE INTO wayfarer_store (id, payload) VALUES (1, ?)', [json], { signal }), 30000); if (result.rowsAffected < 1) throw new Error('Layla did not confirm the save. Export a backup before closing.'); },
    }) };
  }
  return { kind: demoMode ? 'Browser demo storage' : 'Browser storage', repository: new Repository({ async read() { return localStorage.getItem(demoMode ? 'wayfarer-demo-v1' : 'wayfarer-v1'); }, async write(json) { localStorage.setItem(demoMode ? 'wayfarer-demo-v1' : 'wayfarer-v1', json); } }) };
}
