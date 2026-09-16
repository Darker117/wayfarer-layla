import { type Adventure, type Card, type RuntimeSnapshot, type Scenario, type Scripts, type Store, clone, isRecord, uid } from './domain';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Invalid backup: ${message}`); }
function stringFields(value: unknown, keys: string[]) { assert(isRecord(value), 'expected an object.'); for (const key of keys) assert(typeof value[key] === 'string', `${key} must be text.`); }
function validateScripts(s: unknown): asserts s is Scripts {
  stringFields(s, ['library', 'input', 'context', 'output', 'preset']);
  assert(isRecord(s) && typeof s.enabled === 'boolean', 'scripts.enabled must be true or false.');
  assert(['custom', 'inner-self', 'auto-cards'].includes(s.preset as string), 'unknown script preset.');
  for (const key of ['library', 'input', 'context', 'output']) assert((s[key] as string).length <= 2000000, 'script exceeds 2 MB.');
}
function validateCards(cards: unknown): asserts cards is Card[] {
  assert(Array.isArray(cards) && cards.length <= 3000, 'expected up to 3,000 cards.');
  const ids = new Set<string>();
  for (const c of cards) {
    assert(isRecord(c) && typeof c.uid === 'string' && !ids.has(c.uid), 'card IDs must be unique.'); ids.add(c.uid);
    assert(typeof c.enabled === 'boolean' && typeof c.pinned === 'boolean', 'invalid card controls.');
    stringFields(c.fields, ['keys', 'value']);
    for (const key of ['description', 'title', 'type']) assert(isRecord(c.fields) && (c.fields[key] === undefined || typeof c.fields[key] === 'string'), `card ${key} must be text.`);
  }
}
function validateSnapshot(s: unknown) {
  assert(isRecord(s) && isRecord(s.state) && typeof s.facts === 'string', 'invalid adventure state.'); validateCards(s.cards);
}
export function validateStore(parsed: unknown): Store {
  assert(isRecord(parsed) && parsed.version === 1, 'unsupported format/version.');
  assert(Array.isArray(parsed.scenarios) && Array.isArray(parsed.adventures), 'missing scenarios or adventures.');
  assert(parsed.scenarios.length <= 1000 && parsed.adventures.length <= 1000, 'too many worlds.');
  for (const collection of [parsed.scenarios, parsed.adventures]) {
    const ids = new Set<string>();
    for (const world of collection) {
      stringFields(world, ['id', 'title', 'description', 'genre', 'theme', 'opening', 'instructions', 'memory', 'authorsNote']);
      assert(isRecord(world) && !ids.has(world.id as string), 'world IDs must be unique.'); ids.add(world.id as string);
      assert(['forest', 'dusk', 'ocean', 'ember'].includes(world.theme as string), 'invalid theme.');
      assert(typeof world.updatedAt === 'number' && Number.isFinite(world.updatedAt), 'invalid timestamp.');
      validateCards(world.cards); validateScripts(world.scripts);
    }
  }
  for (const a of parsed.adventures) {
    validateSnapshot(a);
    stringFields(a, ['scenarioId']);
    assert(typeof a.archived === 'boolean' && typeof a.createdAt === 'number' && Array.isArray(a.turns), 'invalid adventure.');
    assert(a.turns.length <= 20000, 'adventure has too many turns.');
    for (const t of a.turns) {
      stringFields(t, ['id', 'mode', 'input', 'scriptInput', 'output']);
      assert(['do', 'say', 'story', 'continue'].includes(t.mode) && Array.isArray(t.logs) && t.logs.every((x: unknown) => typeof x === 'string') && Array.isArray(t.contextCards), 'invalid turn.');
      validateSnapshot(t.before); if (t.afterInput !== undefined) validateSnapshot(t.afterInput);
    }
    if (a.memoryBinding !== undefined) {
      stringFields(a.memoryBinding, ['characterId', 'characterName']);
      assert(isRecord(a.memoryBinding) && isRecord(a.memoryBinding.links) && Object.values(a.memoryBinding.links).every(x => Number.isInteger(x) && Number(x) > 0), 'invalid memory link.');
    }
  }
  assert(isRecord(parsed.settings) && Number.isInteger(parsed.settings.maxChars) && Number(parsed.settings.maxChars) >= 4000 && Number(parsed.settings.maxChars) <= 64000, 'context size must be 4,000–64,000 characters.');
  assert(Number(parsed.settings.fontSize) >= 14 && Number(parsed.settings.fontSize) <= 28, 'font size must be 14–28.');
  return parsed as unknown as Store;
}
export function backupJson(store: Store): string { return JSON.stringify({ format: 'wayfarer-backup', exportedAt: new Date().toISOString(), store }, null, 2); }
export function parseBackup(text: string): Store {
  if (new TextEncoder().encode(text).length > 50 * 1024 * 1024) throw new Error('Backup exceeds 50 MB.');
  let data: unknown; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The backup is not valid JSON.'); }
  assert(isRecord(data) && data.format === 'wayfarer-backup', 'choose a Wayfarer backup.');
  return validateStore(data.store);
}
export function mergeBackup(current: Store, imported: Store): Store {
  const result = clone(current), scenarioIds = new Map<string, string>();
  for (const s of imported.scenarios) { const id = uid(); scenarioIds.set(s.id, id); result.scenarios.push({ ...clone(s), id, title: s.title + ' (restored)' } as Scenario); }
  for (const a of imported.adventures) {
    const copy: Adventure = { ...clone(a), id: uid(), scenarioId: scenarioIds.get(a.scenarioId) ?? uid(), title: a.title + ' (restored)' };
    // Imported adventures never inherit authority to update another installation's memories.
    delete copy.memoryBinding; result.adventures.push(copy);
  }
  return result;
}
