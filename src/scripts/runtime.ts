import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { type Card, type CardFields, type HistoryEntry, type JsonObject, type Scripts, clone, isRecord, uid } from '../domain';

export type Hook = 'input' | 'context' | 'output';
export interface HookRequest { hook: Hook; scripts: Scripts; text: string; state: JsonObject; cards: Card[]; history: HistoryEntry[]; info: { actionCount: number; characterNames: string[]; maxChars?: number; memoryLength?: number }; seed?: number }
export interface HookResult { text: string; stop: boolean; state: JsonObject; cards: Card[]; logs: string[] }
export type RunHook = (request: HookRequest, signal?: AbortSignal) => Promise<HookResult>;
const modulePromise = () => newQuickJSWASMModuleFromVariant(variant);
let module: ReturnType<typeof modulePromise> | undefined;

const globals = `
var state = __wfPayload.state, text = __wfPayload.text, storyCards = __wfPayload.storyCards;
var worldInfo = storyCards, history = __wfPayload.history, info = __wfPayload.info, stop = false;
var __wfLogs = [];
function log(...args) { if (__wfLogs.length < 100) __wfLogs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 2000)); }
var console = { log, warn: log, error: log, info: log, debug: log }, sandboxConsole = console;
function addStoryCard(keys, entry = '', type = 'custom', title = keys, description = '', options = {}) {
  if (typeof keys !== 'string' || typeof entry !== 'string') throw new TypeError('Story card keys and entry must be strings');
  if (storyCards.some(c => c.keys === keys)) return false;
  if (storyCards.length >= 3000) throw new Error('Story card limit reached');
  const card = {keys, entry, type, title, description};
  const index = storyCards.push(card) - 1;
  return options.returnCard ? card : index;
}
function removeStoryCard(index) { if (!Number.isInteger(index) || index < 0 || index >= storyCards.length) throw new Error('Invalid story card index'); storyCards.splice(index, 1); }
function updateStoryCard(index, keys, entry, type, title, description) { if (!storyCards[index]) throw new Error('Invalid story card index'); Object.assign(storyCards[index], {keys, entry, type}, title === undefined ? {} : {title}, description === undefined ? {} : {description}); }
var addWorldEntry = addStoryCard, removeWorldEntry = removeStoryCard, updateWorldEntry = updateStoryCard;
if (__wfPayload.seed !== undefined) { let seed = __wfPayload.seed >>> 0; Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296); }
`;

export async function runIsolated(request: HookRequest): Promise<HookResult> {
  const { scripts } = request;
  if (!scripts.enabled) return { text: request.text, stop: false, state: clone(request.state), cards: clone(request.cards), logs: [] };
  const code = scripts.library + '\n;\n' + (scripts[request.hook] || '({ text, stop });');
  if (code.length > 2000000) throw new Error('Script source exceeds the 2 MB limit.');
  const payload = JSON.stringify({ ...request, scripts: undefined, cards: undefined, storyCards: request.cards.map(c => ({ ...c.fields, entry: c.fields.value, id: c.fields.id ?? c.uid, _wfId: c.uid })) });
  if (payload.length > 10000000) throw new Error('Script input exceeds the 10 MB limit.');
  const quickjs = await (module ??= modulePromise());
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(48 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + 1500;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  function evaluate(code: string, name: string) {
    const result = vm.evalCode(code, name);
    if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(`${request.hook}: ${error?.message || JSON.stringify(error)}${error?.stack ? '\n' + String(error.stack).split('\n').slice(0, 8).join('\n') : ''}`); }
    return result.value;
  }
  try {
    evaluate(`var __wfPayload = ${payload};\n${globals}`, 'wayfarer-environment.js').dispose();
    const result = evaluate(code, `${request.hook}.js`);
    vm.setProp(vm.global, '__wfResult', result); result.dispose();
    const serialized = evaluate(`if (__wfResult && typeof __wfResult.then === 'function') throw new Error('Async hooks are not supported'); JSON.stringify({ text: (__wfResult && Object.prototype.hasOwnProperty.call(__wfResult, 'text')) ? __wfResult.text : text, stop: (__wfResult && __wfResult.stop === true) || stop === true || (__wfResult && __wfResult.text === 'stop'), state, storyCards, logs: __wfLogs })`, 'wayfarer-result.js');
    const json = vm.getString(serialized); serialized.dispose();
    if (json.length > 10000000) throw new Error('Script result exceeds the 10 MB limit.');
    const output = JSON.parse(json);
    if (!isRecord(output.state) || !Array.isArray(output.storyCards) || output.storyCards.length > 3000) throw new Error('Script returned invalid state or cards.');
    if (output.text != null && typeof output.text !== 'string') throw new Error('Script text must be a string.');
    const cards: Card[] = output.storyCards.map((raw: unknown) => {
      if (!isRecord(raw) || typeof raw.keys !== 'string' || typeof raw.entry !== 'string') throw new Error('Script created a card without string keys/entry.');
      if (raw.description !== undefined && typeof raw.description !== 'string') throw new Error('Script card notes must be a string.');
      for (const key of ['title', 'type']) if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Script card ${key} must be a string.`);
      const old = request.cards.find(c => c.uid === raw._wfId);
      const fields: JsonObject = { ...raw, value: raw.entry };
      delete fields._wfId;
      if (!old || !Object.hasOwn(old.fields, 'entry')) delete fields.entry;
      if (old && !Object.hasOwn(old.fields, 'id') && fields.id === old.uid) delete fields.id;
      return { uid: old?.uid ?? uid(), fields: fields as CardFields, enabled: old?.enabled ?? true, pinned: old?.pinned ?? false };
    });
    const ids = new Set<string>();
    for (const c of cards) { if (ids.has(c.uid)) c.uid = uid(); ids.add(c.uid); }
    return { text: output.text ?? '', stop: output.stop, state: output.state, cards, logs: output.logs };
  } catch (error) { throw new Error(`${request.hook}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { try { vm.dispose(); runtime.dispose(); } catch (error) { module = undefined; throw new Error(`${request.hook} sandbox cleanup: ${String(error)}`); } }
}
