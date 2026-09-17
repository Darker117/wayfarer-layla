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

export class NativeDatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Layla’s database connection is unavailable. Force stop Layla in Android Settings → Apps → Layla, then reopen Wayfarer.', { cause });
    this.name = 'NativeDatabaseUnavailableError';
  }
}

function isNativeConnectionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NativeDatabase\./i.test(message) && /NullPointerException|already closed|closed database/i.test(message);
}

export function createNativePersistence(db: Pick<typeof layla.db, 'executeSql'> = layla.db): Persistence {
  let initialization: Promise<void> | undefined;
  const execute = async (query: string, params: unknown[] = [], timeout = 15000) => {
    try { return await withTimeout(signal => db.executeSql(query, params, { signal }), timeout); }
    catch (error) {
      if (isNativeConnectionFailure(error)) {
        initialization = undefined;
        // The SDK cannot reopen the host's native handle. Repeating SQL or
        // creating another SDK instance would reuse the same failed connection.
        throw new NativeDatabaseUnavailableError(error);
      }
      throw error;
    }
  };
  const initialize = () => {
    if (!initialization) {
      initialization = execute('CREATE TABLE IF NOT EXISTS wayfarer_store (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        .then(() => {}, error => { initialization = undefined; throw error; });
    }
    return initialization;
  };
  return {
    async read() {
      await initialize();
      const result = await execute('SELECT payload FROM wayfarer_store WHERE id = 1');
      // Only a successful, explicitly empty result means a new library.
      // Missing/null payloads must never seed over an existing saved row.
      if (!result || !Array.isArray(result.rows)) throw new Error('Layla returned an invalid library result. The library was not reset.');
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1 || typeof result.rows[0]?.payload !== 'string') {
        throw new Error('Layla returned an unreadable library record. The library was not reset.');
      }
      return result.rows[0].payload;
    },
    async write(json) {
      await initialize();
      const result = await execute('INSERT OR REPLACE INTO wayfarer_store (id, payload) VALUES (1, ?)', [json], 30000);
      if (!result || result.rowsAffected !== 1) throw new Error('Layla did not confirm the save. Export a backup before closing.');
    },
  };
}

export function createRepository(): { repository: Repository; kind: string } {
  if (hasNativeBridge() && !demoMode) {
    return { kind: 'Layla private database', repository: new Repository(createNativePersistence()) };
  }
  return { kind: demoMode ? 'Browser demo storage' : 'Browser storage', repository: new Repository({ async read() { return localStorage.getItem(demoMode ? 'wayfarer-demo-v1' : 'wayfarer-v1'); }, async write(json) { localStorage.setItem(demoMode ? 'wayfarer-demo-v1' : 'wayfarer-v1', json); } }) };
}
