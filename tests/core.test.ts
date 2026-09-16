import { describe, expect, it } from 'vitest';
import { importCards, exportCards, mergeCards, relevantCards } from '../src/cards';
import { clone, newScenario, startAdventure, undoTurn } from '../src/domain';
import { initialStore } from '../src/seeds';
import { buildContext } from '../src/context';
import { processTurn } from '../src/engine';
import { Repository } from '../src/storage';
import { backupJson, mergeBackup, parseBackup } from '../src/backup';
import { runIsolated, type HookRequest } from '../src/scripts/runtime';
import { presetScripts } from '../src/scripts/presets';
import { NARRATION_RULES, narratorInstructions } from '../src/narration';

describe('narrator guidance', () => {
  it('covers new, generated, and existing worlds without modifying their saved instructions', () => {
    expect(newScenario().instructions).toContain(NARRATION_RULES);
    const generated = narratorInstructions('Keep a playful tone.');
    expect(generated).toContain(NARRATION_RULES);
    expect(generated).toContain('Keep a playful tone.');
    expect(narratorInstructions(generated)).toBe(generated);
    const a = startAdventure(initialStore().scenarios[0]);
    a.instructions = 'An older world with only a style instruction.';
    const before = clone(a);
    const context = buildContext(a, '', { maxChars: 4000, fontSize: 18 }).text;
    expect(context).toContain(NARRATION_RULES);
    expect(context).toContain(a.instructions);
    expect(a).toEqual(before);
  });
});

describe('faithful cards', () => {
  const source = [{ title: 'NPC', keys: 'Leah,friend', value: 'Lore', description: '  {"mind":"secret"}\r\n\t ', type: 'character', useForCharacterCreation: false, useForCharacterCreator: true, custom: { flags: [1, 2] } }];
  it('round-trips exact notes, flags and unknown fields', () => expect(JSON.parse(exportCards(importCards(JSON.stringify(source)).cards))).toEqual(source));
  it('validates invalid entries and never drops different notes during deduplication', () => {
    const a = importCards(JSON.stringify([...source, { keys: 12, value: 'bad' }])); expect(a.errors).toHaveLength(1);
    const b = importCards(JSON.stringify([{ ...source[0], description: 'new mind' }]));
    expect(mergeCards(a.cards, b.cards, 'skip').cards).toHaveLength(2);
    expect(mergeCards(a.cards, a.cards, 'skip').skipped).toBe(1);
    expect(mergeCards(a.cards, b.cards, 'update').cards[0].fields.description).toBe('new mind');
  });
  it('does not expose notes to narrative context', () => {
    const a = startAdventure(initialStore().scenarios[0]); a.cards = importCards(JSON.stringify(source)).cards;
    const context = buildContext(a, 'Leah', { maxChars: 12000, fontSize: 18 });
    expect(context.text).toContain('Lore'); expect(context.text).not.toContain('secret');
    expect(relevantCards(a.cards, 'unrelated')).toHaveLength(0);
    expect(buildContext(a, 'x'.repeat(12000), { maxChars: 4000, fontSize: 18 }).text.length).toBeLessThanOrEqual(4000);
  });
});
describe('adventure transactions', () => {
  const signal = () => new AbortController().signal;
  it.each(['do', 'say', 'story', 'continue'] as const)('redo resends the original %s turn and preserves history on failure', async mode => {
    const a = startAdventure(initialStore().scenarios[0]);
    const contexts: string[] = [];
    const base = { adventure: a, mode: 'do' as const, input: 'open the gate', settings: { maxChars: 12000, fontSize: 18 }, signal: signal(), runHook: runIsolated, onText: () => {}, onStatus: () => {} };
    const previous = await processTurn({ ...base, generate: async () => 'The gate opens onto a meadow.' });
    const played = await processTurn({ ...base, adventure: previous, mode, input: mode === 'continue' ? '' : 'follow the silver bird', generate: async r => { contexts.push(r.context); return 'OLD ENDING TO REPLACE'; } });
    const copy = clone(played);
    const retry = { ...base, adventure: played, mode: 'say' as const, input: 'UNSENT DRAFT', retry: true };
    const redone = await processTurn({ ...retry, generate: async r => { contexts.push(r.context); return 'A fresh path unfolds.'; } });
    expect(contexts[1]).toBe(contexts[0]);
    expect(contexts[1]).toContain('The gate opens onto a meadow.');
    expect(contexts[1]).not.toContain('OLD ENDING TO REPLACE');
    expect(contexts[1]).not.toContain('UNSENT DRAFT');
    expect(redone.turns).toHaveLength(2);
    expect(redone.turns[0]).toEqual(previous.turns[0]);
    expect(redone.turns[1]).toMatchObject({ mode, input: played.turns[1].input, output: 'A fresh path unfolds.' });
    await expect(processTurn({ ...retry, generate: async () => { throw new Error('Model unavailable'); } })).rejects.toThrow('Model unavailable');
    const controller = new AbortController();
    await expect(processTurn({ ...retry, signal: controller.signal, generate: async () => { controller.abort(); return 'Partial'; } })).rejects.toThrow('Cancelled');
    expect(played).toEqual(copy);
  });
  it('isolates scenarios/adventures and restores script mutations on undo and retry', async () => {
    const s = newScenario(); s.opening = 'Start'; s.scripts = { enabled: true, preset: 'custom', library: '', input: 'state.inputCount = (state.inputCount || 0) + 1; ({text})', context: '({text})', output: 'state.count = (state.count || 0) + 1; addStoryCard("test", "entry", "item"); ({text: "Clean prose"})' };
    const a = startAdventure(s), other = startAdventure(s); let streamed = '';
    const base = { adventure: a, mode: 'do' as const, input: 'look', settings: { maxChars: 12000, fontSize: 18 }, signal: signal(), generate: async (r: any) => { r.onText('INTERNAL'); return 'INTERNAL'; }, runHook: runIsolated, onText: (s: string) => { streamed += s; }, onStatus: () => {} };
    const played = await processTurn(base); expect(played.state.count).toBe(1); expect(played.turns[0].output).toBe('Clean prose'); expect(streamed).toBe('');
    expect(s.cards).toHaveLength(0); expect(other.state.count).toBeUndefined();
    const retried = await processTurn({ ...base, adventure: played, retry: true }); expect(retried.state.count).toBe(1); expect(retried.state.inputCount).toBe(1); expect(retried.cards).toHaveLength(1);
    const undone = undoTurn(retried); expect(undone.state).toEqual(a.state); expect(undone.cards).toEqual(a.cards); expect(undone.turns).toHaveLength(0);
  });
  it('cancellation and errors never mutate the source adventure', async () => {
    const a = startAdventure(initialStore().scenarios[0]), copy = clone(a), controller = new AbortController();
    await expect(processTurn({ adventure: a, mode: 'continue', input: '', settings: { maxChars: 12000, fontSize: 18 }, signal: controller.signal, runHook: runIsolated, generate: async () => { controller.abort(); return 'partial'; }, onText: () => {}, onStatus: () => {} })).rejects.toThrow('Cancelled'); expect(a).toEqual(copy);
  });
  it('honors an empty context returned by a script', async () => {
    const a = startAdventure(initialStore().scenarios[0]);
    a.scripts = { enabled: true, preset: 'custom', library: '', input: '', context: '({text: ""})', output: '' };
    let context = 'unset';
    await processTurn({ adventure: a, mode: 'continue', input: '', settings: { maxChars: 12000, fontSize: 18 }, signal: signal(), runHook: runIsolated, generate: async r => { context = r.context; return 'A passage.'; }, onText: () => {}, onStatus: () => {} });
    expect(context).toBe('');
  });
  it('saves serial atomic snapshots and validates restored data', async () => {
    let raw: string | null = null;
    const repo = new Repository({ read: async () => raw, write: async json => { raw = json; } });
    const a = await repo.load(); a.adventures.push(startAdventure(a.scenarios[0]));
    await repo.save(a); expect((await repo.load()).adventures[0]).toEqual(a.adventures[0]);
    const b = parseBackup(backupJson(a)); const merged = mergeBackup(a, b); expect(merged.adventures).toHaveLength(2); expect(merged.adventures[0].id).not.toBe(merged.adventures[1].id);
    expect(() => parseBackup('{"format":"wayfarer-backup","store":{}}')).toThrow('Invalid backup');
  });
});
describe('isolated script environment', () => {
  const req = (script: string): HookRequest => ({ hook: 'context', scripts: { enabled: true, preset: 'custom', library: '', input: '', context: script, output: '' }, text: 'Recent Story:\nLeah enters the room.', state: { memory: {} }, cards: [], history: [{ text: 'Leah enters the room.', rawText: 'Leah enters the room.', type: 'start' }], info: { actionCount: 1, characterNames: ['You'], maxChars: 12000, memoryLength: 0 }, seed: 42 });
  it('exposes helpers and aliases without host/browser access', async () => {
    const result = await runIsolated(req('state.host = [typeof fetch, typeof window, typeof process, typeof ReactNativeWebView]; addWorldEntry("a","b","item"); worldInfo[0].description="exact\\n"; ({text,stop:true})'));
    expect(result.state.host).toEqual(['undefined', 'undefined', 'undefined', 'undefined']); expect(result.cards[0].fields.description).toBe('exact\n'); expect(result.stop).toBe(true);
  });
  it('bounds infinite loops', async () => { await expect(runIsolated(req('while(true) {}'))).rejects.toThrow(); }, 5000);
  it('rejects asynchronous hooks explicitly', async () => { await expect(runIsolated(req('Promise.resolve({text})'))).rejects.toThrow(/async|asynchronous|Promise/i); });
  it.each(['inner-self', 'auto-cards'] as const)('executes actual %s input/context/output sources', async preset => {
    const request = req(''); request.scripts = presetScripts(preset);
    request.cards = importCards(JSON.stringify([{ title: '@Leah', keys: 'Leah', value: 'Leah is a thoughtful navigator.', description: '' }])).cards;
    let current = { state: request.state, cards: request.cards };
    for (const hook of ['input', 'context', 'output'] as const) {
      const r = await runIsolated({ ...request, ...current, hook, text: hook === 'input' ? '\n> You greet Leah\n' : hook === 'context' ? 'AI Instructions:\nTell a story.\n\nRecent Story:\nLeah waits beside the door.\n> You greet Leah\n' : 'Leah smiles and opens the door.', info: hook === 'context' ? request.info : { actionCount: 1, characterNames: ['You'] } });
      current = r; expect(typeof r.text).toBe('string');
    }
    expect(current.cards.some(c => c.fields.title?.includes(preset === 'inner-self' ? 'Inner Self' : 'Auto-Cards'))).toBe(true);
  });
});
