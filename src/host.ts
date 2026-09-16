import { LaylaSDK, type LaylaMemory } from '@layla-network/sdk';
import { type Adventure, clone } from './domain';
import type { Generate } from './engine';
import { NARRATION_RULES } from './narration';

declare global { interface Window { ReactNativeWebView?: { postMessage(message: string): void }; } }
export const hasNativeBridge = () => typeof window.ReactNativeWebView?.postMessage === 'function';
export let demoMode = false;
export const layla = new LaylaSDK();
export async function setupDevelopment() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === '1' && !hasNativeBridge()) {
    demoMode = true;
    const { installLaylaMock } = await import('@layla-network/sdk');
    installLaylaMock({ tokenDelayMs: 12, executionContext: { app_version: '7.4.0', character: null, session_id: null }, respond: messages => {
      const last = messages.at(-1)?.content ?? '';
      if (last.includes('WAYFARER_SCENARIO_JSON')) return JSON.stringify({ title: 'The Clockwork Garden', description: 'A garden that grows lost time.', genre: 'Fantasy', opening: 'The garden gate opens at the sound of your name. Beyond it, brass flowers turn toward a moon made of glass. A gardener with silver hands offers you a broken key. “We have been waiting,” she says.', memory: 'You have arrived at a mysterious clockwork garden.', authorsNote: 'Lyrical, curious, and gently mysterious.' });
      if (last.includes('WAYFARER_CARDS_JSON')) return JSON.stringify([{ title: 'The Gardener', keys: 'gardener,silver hands', value: 'The Gardener tends clockwork flowers and safeguards lost moments.', type: 'character', description: '' }]);
      return 'Finch raises the lantern, and its blue moths drift into the shape of a winding path. “That bell hasn’t rung in years,” he whispers. For the first time, his practiced smile falters.\n\nBetween the roots, a narrow door swings open. Warm air carries the scent of rain and fresh bread. Someone on the other side is humming a tune you almost remember.';
    } });
  }
}
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 15000, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) throw new DOMException('Cancelled', 'AbortError');
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fn(controller.signal); } finally { clearTimeout(timer); parent?.removeEventListener('abort', cancel); }
}
export const generate: Generate = async ({ context, scripted, onText, signal }) => {
  if (!hasNativeBridge()) throw new Error('Open Wayfarer inside Layla to generate with your loaded model. You can still create and edit worlds here.');
  const stream = layla.chat.completions.stream({ messages: [
    { role: 'system', content: scripted ? `Follow the task and formatting instructions in the supplied context. It may request narrative prose, structured character updates, or story-card entries. Complete the requested task faithfully. For narrative prose, apply these narrator rules:\n${NARRATION_RULES}\nFor structured character updates and story-card tasks, preserve the requested format.` : `You are the narrator of an interactive fictional adventure. Follow the supplied AI Instructions and continue from Recent Story. Return only the next passage of the story.\n${NARRATION_RULES}` },
    { role: 'user', content: context },
  ], signal });
  stream.on('content', (_delta, snapshot) => onText(snapshot));
  stream.on('error', () => {});
  return await stream.finalContent() ?? '';
};
export async function generateJson(prompt: string, onText: (text: string) => void, signal: AbortSignal): Promise<unknown> {
  const raw = await generate({ context: prompt, scripted: true, onText, signal });
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch { throw new Error('The model did not return valid JSON. The draft is shown below; you can edit it or generate again.'); }
}
export async function downloadJson(filename: string, text: string) {
  if (hasNativeBridge() && !demoMode) {
    const bytes = new TextEncoder().encode(text); let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const result = await withTimeout(signal => layla.utils.saveFile(filename, btoa(binary), true, { signal }), 30000);
    if (!result.success) throw new Error(result.message || 'Layla could not save the export.');
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function memoryProjections(a: Adventure) {
  const entries = a.cards.filter(c => c.enabled && c.fields.value.trim()).map(c => ({ key: c.uid, text: `${c.fields.title || c.fields.keys}: ${c.fields.value}` }));
  if (a.facts.trim()) entries.push({ key: 'adventure-facts', text: a.facts });
  return entries.map(e => ({ ...e, raw: `[Wayfarer:${a.id}:${e.key}]\n${e.text}` }));
}
export function ownedMemory(a: Adventure, memory: LaylaMemory): boolean {
  return !!a.memoryBinding && memory.character_id === a.memoryBinding.characterId && memory.session_id === `wayfarer-${a.id}` && memory.rawText.startsWith(`[Wayfarer:${a.id}:`);
}
export async function syncMemories(adventure: Adventure): Promise<{ adventure: Adventure; count: number }> {
  if (!adventure.memoryBinding) throw new Error('Choose a Layla character for memory storage first.');
  const a = clone(adventure), binding = a.memoryBinding!;
  const existing: LaylaMemory[] = [];
  // Character-scoped host results must be explicitly filtered by our session and ownership marker.
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await withTimeout(signal => layla.memories.list(binding.characterId, offset, 100, { signal }));
    existing.push(...page.filter(m => ownedMemory(a, m)));
    if (page.length < 100) break;
  }
  let count = 0;
  for (const entry of memoryProjections(a)) {
    const previous = existing.find(m => m.id === binding.links[entry.key] && m.rawText.startsWith(`[Wayfarer:${a.id}:${entry.key}]\n`));
    if (previous?.rawText === entry.raw) { count++; continue; }
    const saved = await withTimeout(signal => layla.memories.createOrUpdate([{ id: previous?.id ?? 0, character_id: binding.characterId, session_id: `wayfarer-${a.id}`, rawText: entry.raw, summary: entry.text, timestamp: Date.now(), knowledgeGraphJSON: null }], { signal }));
    const memory = saved.find(m => ownedMemory(a, m) && m.rawText === entry.raw);
    if (!memory || memory.id <= 0) throw new Error('Layla did not return a verifiable memory record. Private adventure data is still safe.');
    binding.links[entry.key] = memory.id; count++;
  }
  binding.lastSync = Date.now(); return { adventure: a, count };
}
export async function recallMemories(a: Adventure, parent?: AbortSignal): Promise<LaylaMemory[]> {
  if (!a.memoryBinding) return [];
  const candidates = await withTimeout(signal => layla.memories.getTopMemories(a.memoryBinding!.characterId, 100, { signal }), 15000, parent);
  const allowed = new Set(memoryProjections(a).map(p => p.raw));
  return candidates.filter(m => ownedMemory(a, m) && allowed.has(m.rawText));
}
