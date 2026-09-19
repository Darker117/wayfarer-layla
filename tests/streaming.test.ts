import { describe, it, expect, vi } from 'vitest';
import { ChatCompletionStream } from '@layla-network/sdk';
import { readResponse } from '../src/streaming';
import { processTurn, type GenerateRequest } from '../src/engine';
import { newScenario, startAdventure, clone } from '../src/domain';
import { runIsolated } from '../src/scripts/runtime';
import { presetScripts } from '../src/scripts/presets';
import { importCards } from '../src/cards';

function harness() {
  const stream = new ChatCompletionStream('test-model');
  const abort = new AbortController();
  abort.signal.addEventListener('abort', () => stream.abort());
  const onText = vi.fn(), onThinking = vi.fn();
  const done = readResponse(stream, { signal: abort.signal, onText, onThinking });
  let msg = '';
  return { stream, abort, onText, onThinking, done,
    chunk(delta: string) { msg += delta; stream.accept({ event: 'on_message', data: { msg, delta } } as any); },
    end() { stream.accept({ event: 'on_message_end', data: null } as any); },
  };
}

describe('SDK answer and reasoning channels', () => {
  it('separates multiline thinking at every possible chunk boundary, including partial markers', async () => {
    const raw = '<think>PRIVATE plan\nsecond line</think>The gate opens.';
    for (let split = 1; split < raw.length; split++) {
      const h = harness();
      h.chunk(raw.slice(0, split));
      for (const [text] of h.onText.mock.calls) {
        expect(text).not.toMatch(/PRIVATE|second line|<\/?think|<$/);
      }
      h.chunk(raw.slice(split)); h.end();
      await expect(h.done).resolves.toBe('The gate opens.');
      expect(h.onThinking).toHaveBeenLastCalledWith('PRIVATE plan\nsecond line');
      expect(h.onText).toHaveBeenLastCalledWith('The gate opens.');
    }
  });
  it('streams one character at a time and handles multiple reasoning blocks', async () => {
    const h = harness();
    for (const char of '<think>First</think>A<think>Second</think>B') h.chunk(char);
    expect(h.onText).toHaveBeenLastCalledWith('AB');
    h.end(); await expect(h.done).resolves.toBe('AB');
    expect(h.onThinking).toHaveBeenLastCalledWith('FirstSecond');
  });
  it('keeps an unclosed thinking block out of the final answer', async () => {
    const h = harness(); h.chunk('<think>Unfinished private reasoning\nmore'); h.end();
    await expect(h.done).resolves.toBe('');
    expect(h.onThinking).toHaveBeenLastCalledWith('Unfinished private reasoning\nmore');
    expect(h.onText.mock.calls.flat().join('')).toBe('');
  });
  it('does not infer reasoning from ordinary prose or malformed non-protocol tags', async () => {
    const h = harness();
    h.chunk('“I think the <thinker> is home,” Finch says.'); h.end();
    await expect(h.done).resolves.toBe('“I think the <thinker> is home,” Finch says.');
    expect(h.onThinking.mock.calls.flat().join('')).toBe('');
  });
  it('withholds incomplete markers while pending and keeps them literal if the host finishes them incompletely', async () => {
    const h = harness(); h.chunk('The gate opens.<thi');
    expect(h.onText).toHaveBeenLastCalledWith('The gate opens.');
    h.end(); await expect(h.done).resolves.toBe('The gate opens.<thi');
    expect(h.onThinking.mock.calls.flat().join('')).toBe('');
  });
  it('returns clean JSON when the model reasons before a structured response', async () => {
    const h = harness(); h.chunk('<think>Choose a title.</think>{"title":"Moon Garden"}'); h.end();
    expect(JSON.parse(await h.done)).toEqual({ title: 'Moon Garden' });
  });
  it('ignores late chunks and terminal events after cancellation', async () => {
    const h = harness(); h.chunk('<think>Early</think>Partial');
    const rejection = expect(h.done).rejects.toThrow();
    h.abort.abort(); await rejection;
    const counts = [h.onText.mock.calls.length, h.onThinking.mock.calls.length];
    h.chunk('<think>Late</think>Must not reappear'); h.end();
    expect([h.onText.mock.calls.length, h.onThinking.mock.calls.length]).toEqual(counts);
  });
  it('reconciles with final fields and removes listeners even if completion has no incremental events', async () => {
    const h = harness();
    h.stream.accept({ event: 'on_message', data: { msg: '<think>Final reasoning</think>Final story', delta: '' } } as any);
    h.end(); await expect(h.done).resolves.toBe('Final story');
    expect(h.onThinking).toHaveBeenLastCalledWith('Final reasoning');
  });
});

describe('streaming turn transactions', () => {
  const base = () => ({ adventure: startAdventure(newScenario()), mode: 'do' as const, input: 'open the gate', settings: { maxChars: 12000, fontSize: 18 }, signal: new AbortController().signal, runHook: runIsolated, onText: vi.fn(), onThinking: vi.fn(), onStatus: vi.fn() });
  it('streams before completion, saves only the canonical answer, and retries without previous reasoning', async () => {
    const req = base(), before = clone(req.adventure);
    let finish!: (text: string) => void, callbacks!: GenerateRequest;
    const pending = processTurn({ ...req, generate: async r => { callbacks = r; r.onThinking?.('PRIVATE'); r.onText('The gate'); return new Promise(resolve => { finish = resolve; }); } });
    await vi.waitFor(() => expect(req.onText).toHaveBeenCalledWith('The gate'));
    expect(req.adventure).toEqual(before);
    finish('The gate opens.'); const next = await pending;
    expect(next.turns[0].output).toBe('The gate opens.');
    expect(JSON.stringify(next)).not.toContain('PRIVATE');
    callbacks.onText('LATE'); callbacks.onThinking?.('LATE');
    expect(req.onText).not.toHaveBeenCalledWith('LATE');
    const redo = await processTurn({ ...req, adventure: next, retry: true, generate: async r => { expect(r.context).not.toMatch(/PRIVATE|The gate opens/); return 'A different gate opens.'; } });
    expect(redo.turns).toHaveLength(1);
    expect(redo.turns[0].output).toBe('A different gate opens.');
  });
  it.each(['transform', 'suppress'] as const)('keeps both channels private until an Output hook can %s them', async mode => {
    const req = base(); req.adventure.scripts = { enabled: true, preset: 'custom', library: '', input: '', context: '', output: mode === 'transform' ? 'state.saved = true; ({text: "Canonical passage"})' : 'state.saved = true; ({text: "", stop: true})' };
    const next = await processTurn({ ...req, generate: async r => { r.onText('INTERNAL CARD TEXT'); r.onThinking?.('INTERNAL TASK REASONING'); return 'INTERNAL CARD TEXT'; } });
    expect(req.onText).not.toHaveBeenCalled(); expect(req.onThinking).not.toHaveBeenCalled();
    expect(next.turns[0].output).toBe(mode === 'transform' ? 'Canonical passage' : '');
    expect(next.state.saved).toBe(true);
    expect(JSON.stringify(next)).not.toContain('INTERNAL');
  });
  it('streams after Input/Context scripts when there is no Library or Output hook to alter the response', async () => {
    const req = base();
    req.adventure.scripts = { enabled: true, preset: 'custom', library: '', input: 'state.prepared = true; ({text})', context: '({text: text + "\\nUse vivid prose."})', output: '' };
    const next = await processTurn({ ...req, generate: async r => {
      expect(r.context).toContain('Use vivid prose.');
      r.onThinking?.('Consider the scene.'); r.onText('The gate opens.');
      expect(req.onText).toHaveBeenCalledWith('The gate opens.');
      expect(req.onThinking).toHaveBeenCalledWith('Consider the scene.');
      return 'The gate opens.';
    } });
    expect(next.turns[0].output).toBe('The gate opens.');
    expect(next.state.prepared).toBe(true);
    expect(JSON.stringify(next)).not.toContain('Consider the scene.');
  });
  it('rejects a cancelled generation even if it resolves and sends late callbacks', async () => {
    const req = base(), abort = new AbortController(), before = clone(req.adventure);
    await expect(processTurn({ ...req, signal: abort.signal, generate: async r => { abort.abort(); r.onText('LATE'); r.onThinking?.('PRIVATE LATE'); return 'Must not be committed'; } })).rejects.toThrow('Cancelled');
    expect(req.onText).not.toHaveBeenCalled(); expect(req.onThinking).not.toHaveBeenCalled();
    expect(req.adventure).toEqual(before);
  });
  it('runs the bundled Inner Self hooks without streaming NPC brain operations or their reasoning', async () => {
    const req = base();
    req.adventure.scripts = presetScripts('inner-self');
    req.adventure.opening = 'Leah meets you at the station.';
    req.adventure.cards = importCards('[{"title":"@Leah","keys":"Leah","value":"Leah is the stationmaster.","description":"ordinary private notes"}]').cards;
    // Continue avoids the preset's reduced thought probability for Do/Say/Story.
    const next = await processTurn({ ...req, mode: 'continue', input: '', runHook: r => runIsolated({ ...r, seed: 42 }), generate: async r => {
      const raw = '(protect_station = I must protect the station from strangers.)\n\nLeah holds the door open.';
      r.onThinking?.('PRIVATE planning'); r.onText(raw); return raw;
    } });
    expect(req.onText).not.toHaveBeenCalled(); expect(req.onThinking).not.toHaveBeenCalled();
    expect(next.turns[0].output).not.toContain('protect_station');
    expect(next.turns[0].output).toContain('Leah holds the door open.');
    expect(JSON.stringify(next)).not.toContain('PRIVATE planning');
    expect(next.cards.some(c => c.fields.description?.includes('I must protect the station'))).toBe(true);
  });
});
