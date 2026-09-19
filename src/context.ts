import { type Adventure, type HistoryEntry, type Mode, type Settings, isRecord } from './domain';
import { relevantCards } from './cards';
import { narratorInstructions } from './narration';

export function actionText(mode: Mode, input: string): string {
  if (mode === 'continue') return '';
  if (mode === 'do') return `\n> You ${input.trim()}\n`;
  if (mode === 'say') return `\n> You say "${input.trim()}"\n`;
  if (mode === 'think') return `\n> You think privately (not spoken or observable): ${input.trim()}\n`;
  return '\n' + input.trim() + '\n';
}
export function inputHistory(mode: Mode, input: string, text: string): HistoryEntry {
  return { text, rawText: actionText(mode, input), type: mode === 'continue' || mode === 'think' ? 'story' : mode, ...(mode === 'think' ? { sourceMode: 'think' as const, visibility: 'private' as const } : {}) };
}

/** Budget entries individually so truncation never strips a private thought's label. */
function recentHistory(entries: HistoryEntry[], budget: number): string {
  let result = '';
  for (let i = entries.length - 1; i >= 0 && budget > 0; i--) {
    const entry = entries[i], separator = result ? '\n' : '';
    const prefix = entry.visibility === 'private' ? '[Private player thought; not spoken or observable to NPCs]\n' : '';
    const suffix = entry.visibility === 'private' ? '\n[End private thought]' : '';
    const room = budget - prefix.length - suffix.length - separator.length;
    if (room <= 0) break;
    const text = entry.text.slice(-room);
    const part = prefix + text + suffix + separator;
    result = part + result; budget -= part.length;
    if (text.length < entry.text.length) break;
  }
  return result;
}
export function historyFor(a: Adventure): HistoryEntry[] {
  const history: HistoryEntry[] = [{ text: a.opening, rawText: a.opening, type: 'start' }];
  for (const turn of a.turns) {
    if (turn.scriptInput) history.push(inputHistory(turn.mode, turn.input, turn.scriptInput));
    // Keep zero-width/script control outputs: upstream scripts use them as bookkeeping.
    if (turn.output) history.push({ text: turn.output, rawText: turn.output, type: 'continue' });
  }
  return history;
}
export function buildContext(a: Adventure, current: string, settings: Settings, recalledCardIds: string[] = [], currentMode: Mode = 'story') {
  const history = historyFor(a);
  const recent = history.map(h => h.text).join('\n') + current;
  const ranked = [...a.cards].sort((x, y) => {
    const left = recalledCardIds.indexOf(x.uid), right = recalledCardIds.indexOf(y.uid);
    return (left < 0 ? 100000 : left) - (right < 0 ? 100000 : right);
  });
  const selected = relevantCards(ranked, recent.slice(-5000), Math.floor(settings.maxChars * 0.3));
  const memory = isRecord(a.state.memory) ? a.state.memory : {};
  const memoryText = typeof memory.context === 'string' && memory.context ? memory.context : a.memory;
  const authorsNote = typeof memory.authorsNote === 'string' && memory.authorsNote ? memory.authorsNote : a.authorsNote;
  const frontMemory = typeof memory.frontMemory === 'string' ? memory.frontMemory : '';
  const sections = [
    `AI Instructions:\n${narratorInstructions(a.instructions)}`,
    memoryText && `Plot Essentials:\n[Narrator reference, not shared NPC knowledge]\n${memoryText}`,
    a.facts && `Adventure Memory:\n[Narrator reference; retain sources, privacy and uncertainty]\n${a.facts}`,
    selected.length > 0 && `World Lore:\n[Narrator reference, not shared NPC knowledge]\n${selected.map(c => `${c.fields.title || c.fields.keys}: ${c.fields.value}`).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');
  // Reserve space for recent action and author/front memory. Bound all sections, not just history.
  const prefix = sections.slice(0, Math.floor(settings.maxChars * 0.6)) + '\n\n';
  const suffix = frontMemory ? '\n' + frontMemory.slice(0, Math.floor(settings.maxChars * 0.08)) : '';
  const note = authorsNote ? `[Author's note: ${authorsNote.slice(0, Math.floor(settings.maxChars * 0.08))}]\n` : '';
  const entries: HistoryEntry[] = history.flatMap((h, i) => i === history.length - 1 && note
    ? [{ text: note, rawText: note, type: 'story' as const }, h] : [h]);
  if (current) entries.push(inputHistory(currentMode, '', current));
  const header = 'Recent Story:\n';
  const space = Math.max(0, settings.maxChars - prefix.length - header.length - suffix.length);
  const text = prefix + header + recentHistory(entries, space) + suffix;
  return { text, memoryLength: prefix.length, selected: selected.map(c => c.uid), history };
}
