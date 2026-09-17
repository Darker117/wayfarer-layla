import { describe, expect, it, vi } from 'vitest';
import { createNativePersistence, NativeDatabaseUnavailableError, Repository } from '../src/storage';
import { initialStore } from '../src/seeds';

const nativeError = () => new Error("Error processing Layla API message: Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: java.lang.NullPointerException: java.lang.NullPointerException");
const result = (rows: unknown[] = [], rowsAffected = 0) => ({ rows, rowsAffected, insertId: 0 }) as any;
const reads = (readResult: unknown) => vi.fn(async (query: string) => query.startsWith('SELECT') ? readResult : result([], 1)) as any;

describe('native library persistence', () => {
  it.each(['CREATE', 'SELECT'])('fails safely when native startup fails at %s and can load after host recovery', async stage => {
    const saved = JSON.stringify(initialStore());
    let unavailable = true;
    const executeSql = vi.fn(async (query: string) => {
      if (unavailable && query.startsWith(stage)) throw nativeError();
      return result(query.startsWith('SELECT') ? [{ payload: saved }] : []);
    });
    const repo = new Repository(createNativePersistence({ executeSql }));
    await expect(repo.load()).rejects.toBeInstanceOf(NativeDatabaseUnavailableError);
    expect(executeSql.mock.calls.some(([query]) => query.startsWith('INSERT'))).toBe(false);
    unavailable = false;
    await expect(repo.load()).resolves.toEqual(JSON.parse(saved));
    expect(executeSql.mock.calls.filter(([query]) => query.startsWith('CREATE'))).toHaveLength(2);
    expect(executeSql.mock.calls.some(([query]) => query.startsWith('INSERT'))).toBe(false);
  });

  it.each([null, {}, { rows: null }, result([{}]), result([{ payload: null }]), result([{ payload: 42 }]), result([{ payload: '{}' }]), result([{ payload: '' }]), result([{ payload: 'invalid JSON' }])])('never seeds over an invalid read result %#', async value => {
    const executeSql = reads(value);
    await expect(new Repository(createNativePersistence({ executeSql })).load()).rejects.toThrow();
    expect(executeSql.mock.calls.some(([query]: [string]) => query.startsWith('INSERT'))).toBe(false);
  });

  it('initializes a genuinely empty database and requires a confirmed save', async () => {
    const executeSql = reads(result());
    const store = await new Repository(createNativePersistence({ executeSql })).load();
    expect(store.scenarios.length).toBeGreaterThan(0);
    const inserts = executeSql.mock.calls.filter(([query]: [string]) => query.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(inserts[0][1][0])).toEqual(store);
  });

  it.each([undefined, null, 0, '1', 2, NaN])('rejects an unconfirmed write (%s)', async rowsAffected => {
    const executeSql = vi.fn(async (query: string) => query.startsWith('INSERT') ? { rows: [], rowsAffected, insertId: 0 } : result()) as any;
    await expect(createNativePersistence({ executeSql }).write('{}')).rejects.toThrow('did not confirm');
  });

  it('shares initialization while concurrent reads are waiting', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const saved = JSON.stringify(initialStore());
    const executeSql = vi.fn(async (query: string) => {
      if (query.startsWith('CREATE')) await pending;
      return result(query.startsWith('SELECT') ? [{ payload: saved }] : []);
    });
    const persistence = createNativePersistence({ executeSql });
    const a = persistence.read(), b = persistence.read();
    expect(executeSql).toHaveBeenCalledTimes(1);
    finish();
    await expect(Promise.all([a, b])).resolves.toEqual([saved, saved]);
  });

  it('never retries a failed write or reports it as saved', async () => {
    const error = nativeError();
    const executeSql = vi.fn(async (query: string) => {
      if (query.startsWith('INSERT')) throw error;
      return result();
    });
    const repo = new Repository(createNativePersistence({ executeSql }));
    await expect(repo.save(initialStore())).rejects.toMatchObject({ name: 'NativeDatabaseUnavailableError', cause: error });
    expect(executeSql.mock.calls.filter(([query]) => query.startsWith('INSERT'))).toHaveLength(1);
  });

  it('preserves SQL errors without mislabeling them as a broken connection', async () => {
    const error = new Error('database disk image is malformed');
    const executeSql = vi.fn().mockRejectedValue(error);
    await expect(new Repository(createNativePersistence({ executeSql })).load()).rejects.toBe(error);
    expect(executeSql).toHaveBeenCalledTimes(1);
  });
});
