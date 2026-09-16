import { narratorInstructions } from './narration';

export type Mode = 'do' | 'say' | 'story' | 'continue';
export type Theme = 'forest' | 'dusk' | 'ocean' | 'ember';
export type JsonObject = Record<string, unknown>;
export interface CardFields extends JsonObject {
  keys: string;
  value: string;
  title?: string;
  type?: string;
  description?: string;
  useForCharacterCreation?: boolean;
  useForCharacterCreator?: boolean;
}
export interface Card { uid: string; fields: CardFields; enabled: boolean; pinned: boolean }
export interface Scripts { enabled: boolean; preset: 'custom' | 'inner-self' | 'auto-cards'; library: string; input: string; context: string; output: string }
export interface World {
  title: string; description: string; genre: string; theme: Theme;
  opening: string; instructions: string; memory: string; authorsNote: string;
}
export interface Scenario extends World { id: string; updatedAt: number; cards: Card[]; scripts: Scripts }
export interface RuntimeSnapshot { cards: Card[]; state: JsonObject; facts: string; }
export interface Turn {
  id: string; mode: Mode; input: string; scriptInput: string; output: string; createdAt: number;
  before: RuntimeSnapshot; afterInput?: RuntimeSnapshot; logs: string[]; contextCards: string[];
  stopped?: boolean;
}
export interface MemoryBinding { characterId: string; characterName: string; links: Record<string, number>; lastSync?: number }
export interface Adventure extends World, RuntimeSnapshot {
  id: string; scenarioId: string; createdAt: number; updatedAt: number; scripts: Scripts;
  turns: Turn[]; archived: boolean; memoryBinding?: MemoryBinding;
}
export interface Settings { maxChars: number; fontSize: number }
export interface Store { version: 1; scenarios: Scenario[]; adventures: Adventure[]; settings: Settings }
export interface HistoryEntry { text: string; rawText: string; type: 'start' | 'continue' | 'do' | 'say' | 'story'; }
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const emptyScripts = (): Scripts => ({ enabled: false, preset: 'custom', library: '', input: '', context: '', output: '' });
export const newScenario = (): Scenario => ({ id: uid(), title: '', description: '', genre: 'Fantasy', theme: 'forest', opening: '', instructions: narratorInstructions('Tell an immersive, interactive story in second person and present tense. Give NPCs distinct motives. Write 1–3 vivid paragraphs.'), memory: '', authorsNote: '', cards: [], scripts: emptyScripts(), updatedAt: Date.now() });
export function startAdventure(s: Scenario): Adventure {
  return { ...clone(s), id: uid(), scenarioId: s.id, title: s.title, createdAt: Date.now(), updatedAt: Date.now(), turns: [], state: { memory: {} }, facts: '', archived: false };
}
export function snapshot(a: RuntimeSnapshot): RuntimeSnapshot { return clone({ cards: a.cards, state: a.state, facts: a.facts }); }
export function undoTurn(a: Adventure): Adventure {
  const last = a.turns.at(-1);
  if (!last) return a;
  return { ...clone(a), ...clone(last.before), turns: a.turns.slice(0, -1), updatedAt: Date.now() };
}
export const cardTitle = (c: Card) => c.fields.title || c.fields.keys || 'Untitled card';
export const isRecord = (x: unknown): x is JsonObject => !!x && typeof x === 'object' && !Array.isArray(x);
export const visibleText = (text: string) => text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
