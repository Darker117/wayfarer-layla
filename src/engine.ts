import { type Adventure, type Mode, type Settings, type Turn, clone, snapshot, uid } from './domain';
import { actionText, buildContext, historyFor } from './context';
import type { RunHook, Hook, HookRequest } from './scripts/runtime';

export interface GenerateRequest { context: string; scripted: boolean; onText: (text: string) => void; signal: AbortSignal }
export type Generate = (request: GenerateRequest) => Promise<string>;
export interface TurnRequest { adventure: Adventure; mode: Mode; input: string; settings: Settings; signal: AbortSignal; generate: Generate; runHook: RunHook; onText: (text: string) => void; onStatus: (text: string) => void; retry?: boolean; recalledCardIds?: string[] }

export async function processTurn(req: TurnRequest): Promise<Adventure> {
  const last = req.adventure.turns.at(-1);
  if (req.retry && !last) throw new Error('There is no turn to retry.');
  const a = clone(req.adventure);
  const before = req.retry ? clone(last!.before) : snapshot(a);
  const mode = req.retry ? last!.mode : req.mode;
  const input = req.retry ? last!.input : req.input;
  if (input.length > 12000) throw new Error('Keep each action under 12,000 characters.');
  if (mode !== 'continue' && !input.trim()) throw new Error('Write an action first.');
  if (req.retry) { a.turns.pop(); Object.assign(a, last!.afterInput ? clone(last!.afterInput) : before); }
  const logs: string[] = [];
  const history = historyFor(a);
  const check = () => { if (req.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  async function hook(hook: Hook, text: string, info: HookRequest['info']) {
    check();
    if (!a.scripts.enabled) return { text, stop: false };
    req.onStatus(`Running ${hook} script…`);
    const result = await req.runHook({ hook, scripts: a.scripts, state: a.state, cards: a.cards, text, history: clone(history), info }, req.signal);
    check(); a.state = result.state; a.cards = result.cards; logs.push(...result.logs.map(line => `[${hook}] ${line}`));
    return result;
  }
  let incoming = { text: req.retry ? last!.scriptInput : actionText(mode, input), stop: false };
  if (!req.retry || !last!.afterInput) incoming = await hook('input', incoming.text, { actionCount: history.length, characterNames: ['You'] });
  const afterInput = snapshot(a);
  if (incoming.text) history.push({ text: incoming.text, rawText: actionText(mode, input), type: mode === 'continue' ? 'story' : mode });
  let output = '', stopped = incoming.stop, selected: string[] = [];
  if (!stopped) {
    const built = buildContext(a, incoming.text, req.settings, req.recalledCardIds);
    selected = built.selected;
    const contextual = await hook('context', built.text, { actionCount: history.length, characterNames: ['You'], maxChars: req.settings.maxChars, memoryLength: built.memoryLength });
    stopped = contextual.stop;
    if (!stopped) {
      check(); req.onStatus(a.scripts.enabled ? 'Layla is writing · script output stays private until processed…' : 'Layla is writing…');
      const raw = await req.generate({ context: contextual.text.slice(-req.settings.maxChars), scripted: a.scripts.enabled, onText: a.scripts.enabled ? () => {} : req.onText, signal: req.signal });
      check();
      if (!raw.trim()) throw new Error('Layla returned an empty response. Check the loaded model and try again.');
      const final = await hook('output', raw, { actionCount: history.length, characterNames: ['You'] });
      stopped = final.stop; output = stopped ? '' : final.text;
    }
  }
  check();
  const turn: Turn = { id: uid(), mode, input, scriptInput: incoming.text, output, createdAt: Date.now(), before, afterInput, logs, contextCards: selected, stopped };
  a.turns.push(turn); a.updatedAt = Date.now(); return a;
}
