import { describe, expect, it, vi, afterEach } from 'vitest';
import { actionText, buildContext, historyFor } from '../src/context';
import { clone, newScenario, startAdventure, undoTurn } from '../src/domain';
import { processTurn, type TurnRequest } from '../src/engine';
import { runIsolated } from '../src/scripts/runtime';
import { backupJson, parseBackup, mergeBackup } from '../src/backup';
import { initialStore } from '../src/seeds';
import { generate, generateJson, layla, memoryProjections, syncMemories } from '../src/host';
import { ChatCompletionStream } from '@layla-network/sdk';
import { KNOWLEDGE_RULES, PROSE_STYLE_RULES } from '../src/narration';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const request = (): TurnRequest => ({ adventure: startAdventure(newScenario()), mode: 'think', input: 'The key must be under the bridge.', settings: { maxChars: 12000, fontSize: 18 }, signal: new AbortController().signal, generate: async () => 'Finch watches the rain.', runHook: runIsolated, onText: () => {}, onStatus: () => {} });

describe('private player thoughts', () => {
  it('preserves private identity through transformed input, replay, Redo, undo and backup restore', async () => {
    const base = request();
    base.adventure.scripts = { enabled: true, preset: 'custom', library: '', input: 'state.inputs = (state.inputs || 0) + 1; ({text: "A transformed secret thought."})', context: 'state.current = history[history.length - 1]; ({text})', output: 'state.outputs = (state.outputs || 0) + 1; ({text})' };
    const contexts: string[] = [];
    base.generate = async r => { contexts.push(r.context); return 'Finch watches the rain.'; };
    const played = await processTurn(base), saved = clone(played);
    expect(played.turns[0]).toMatchObject({ mode: 'think', input: base.input, scriptInput: 'A transformed secret thought.' });
    expect(played.state.current).toMatchObject({ type: 'story', sourceMode: 'think', visibility: 'private', rawText: actionText('think', base.input) });
    expect(contexts[0]).toContain('[Private player thought; not spoken or observable to NPCs]\nA transformed secret thought.\n[End private thought]');
    expect(historyFor(played)[1]).toMatchObject({ type: 'story', sourceMode: 'think', visibility: 'private' });
    const retried = await processTurn({ ...base, adventure: played, mode: 'say', input: 'UNSENT', retry: true });
    expect(contexts[1]).toBe(contexts[0]);
    expect(retried.turns).toHaveLength(1);
    expect(retried.state.inputs).toBe(1); expect(retried.state.outputs).toBe(1);
    expect(retried.turns[0].mode).toBe('think');
    expect(undoTurn(retried).state).toEqual(base.adventure.state);
    expect(played).toEqual(saved);
    const store = initialStore(); store.adventures.push(retried);
    const restored = mergeBackup(initialStore(), parseBackup(backupJson(store))).adventures[0];
    expect(restored.turns[0]).toMatchObject({ mode: 'think', input: base.input });
    expect(buildContext(restored, actionText('say', 'I found the key.'), base.settings).text).toContain('[End private thought]');
    expect(buildContext(restored, actionText('say', 'I found the key.'), base.settings).text).toContain('You say "I found the key."');
  });

  it('retains balanced privacy labels when long thoughts exceed the context budget, current and replayed', async () => {
    const base = request(); base.input = 'silent plan '.repeat(950);
    base.settings.maxChars = 4000;
    base.generate = async r => {
      expect(r.context.length).toBeLessThanOrEqual(4000);
      const recent = r.context.split('Recent Story:\n')[1];
      expect(recent).toMatch(/^\[Private player thought;/);
      expect(recent).toContain('silent plan'); expect(recent).toMatch(/\[End private thought\]$/);
      return 'Rain falls.';
    };
    const played = await processTurn(base);
    const replay = buildContext(played, '\n> You wait\n', base.settings).text;
    expect(replay.length).toBeLessThanOrEqual(4000);
    expect(replay).toContain('[Private player thought;'); expect(replay).toContain('[End private thought]\nRain falls.');
    expect(replay).toContain('You wait');
  });

  it('never mirrors turn thoughts and preserves qualifiers in exact card/fact memory', async () => {
    const base = request(); base.input = 'PRIVATE PLAYER SECRET';
    const a = await processTurn(base);
    a.facts = 'Only Finch heard the rumor; its truth is unknown.';
    a.memoryBinding = { characterId: 'test', characterName: 'Test', links: {} };
    vi.spyOn(layla.memories, 'list').mockResolvedValue([]);
    const writes = vi.spyOn(layla.memories, 'createOrUpdate').mockImplementation(async entries => entries.map((e, i) => ({ ...e, id: 100 + i })));
    expect(JSON.stringify(memoryProjections(a))).not.toContain('PRIVATE PLAYER SECRET');
    await syncMemories(a);
    expect(writes.mock.calls[0][0][0].summary).toBe(a.facts);
    expect(JSON.stringify(writes.mock.calls)).not.toContain('PRIVATE PLAYER SECRET');
    const before = clone(a);
    const context = buildContext(a, '', base.settings).text;
    expect(context).toContain('[Narrator reference; retain sources, privacy and uncertainty]');
    expect(context).toContain(a.facts); expect(context).toContain(KNOWLEDGE_RULES);
    expect(a).toEqual(before);
  });

  it('keeps author guidance outside a private thought when a script suppresses the response', async () => {
    const base = request();
    base.adventure.authorsNote = 'STYLE GUIDANCE';
    base.adventure.scripts = { enabled: true, preset: 'custom', library: '', input: '', context: '', output: '({text: "", stop: true})' };
    const a = await processTurn(base);
    const recent = buildContext(a, '', base.settings).text.split('Recent Story:\n')[1];
    expect(recent).toContain("[Author's note: STYLE GUIDANCE]");
    expect(recent.indexOf('STYLE GUIDANCE')).toBeLessThan(recent.indexOf('[Private player thought;'));
  });
});

describe('instruction-only narrative preferences', () => {
  const mockStream = (answer: string) => {
    vi.stubGlobal('window', { ReactNativeWebView: { postMessage() {} } });
    return vi.spyOn(layla.chat.completions, 'stream').mockImplementation(() => {
      const s = new ChatCompletionStream('test');
      setTimeout(() => { s.accept({ event: 'on_message', data: { msg: answer, delta: answer } } as any); s.accept({ event: 'on_message_end', data: null } as any); }, 0);
      return s;
    });
  };
  it.each([false, true])('includes knowledge/style rules at the host boundary (scripted=%s) without an extra call', async scripted => {
    const stream = mockStream('A bell rings.');
    const onText = vi.fn();
    expect(await generate({ context: 'Original context with ozone left intact.', scripted, onText, signal: new AbortController().signal })).toBe('A bell rings.');
    expect(stream).toHaveBeenCalledTimes(1);
    const messages = stream.mock.calls[0][0].messages;
    expect(messages[0].content).toContain(KNOWLEDGE_RULES); expect(messages[0].content).toContain(PROSE_STYLE_RULES);
    expect(messages[1].content).toBe('Original context with ozone left intact.');
    expect(onText).toHaveBeenCalledWith('A bell rings.');
  });
  it.each(['WAYFARER_SCENARIO_JSON', 'WAYFARER_CARDS_JSON'])('guides %s prose without rewriting JSON or adding generation passes', async kind => {
    const data = kind.includes('SCENARIO') ? { title: 'A quiet harbor', opening: 'The tide turns.', instructions: 'Stay grounded.' } : [{ title: 'Finch', value: 'Only Finch knows the hiding place.', description: 'private' }];
    const stream = mockStream(JSON.stringify(data)), onText = vi.fn();
    expect(await generateJson(kind, onText, new AbortController().signal)).toEqual(data);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].messages[1].content).toContain(PROSE_STYLE_RULES);
    expect(stream.mock.calls[0][0].messages[1].content).toContain(KNOWLEDGE_RULES);
    expect(onText).toHaveBeenCalledWith(JSON.stringify(data));
  });
});
