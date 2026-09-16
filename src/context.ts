import { type Adventure, type HistoryEntry, type Mode, type Settings, isRecord } from './domain';
import { relevantCards } from './cards';
import { narratorInstructions } from './narration';

export function actionText(mode: Mode, input: string): string {
  if (mode === 'continue') return '';
  if (mode === 'do') return `\n> You ${input.trim()}\n`;
  if (mode === 'say') return `\n> You say "${input.trim()}"\n`;
  return '\n' + input.trim() + '\n';
}
export function historyFor(a: Adventure): HistoryEntry[] {
  const history: HistoryEntry[] = [{ text: a.opening, rawText: a.opening, type: 'start' }];
  for (const turn of a.turns) {
    if (turn.scriptInput) history.push({ text: turn.scriptInput, rawText: actionText(turn.mode, turn.input), type: turn.mode === 'continue' ? 'story' : turn.mode });
    // Keep zero-width/script control outputs: upstream scripts use them as bookkeeping.
    if (turn.output) history.push({ text: turn.output, rawText: turn.output, type: 'continue' });
  }
  return history;
}
export function buildContext(a: Adventure, current: string, settings: Settings, recalledCardIds: string[] = []) {
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
    memoryText && `Plot Essentials:\n${memoryText}`,
    a.facts && `Adventure Memory:\n${a.facts}`,
    selected.length > 0 && `World Lore:\n${selected.map(c => `${c.fields.title || c.fields.keys}: ${c.fields.value}`).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');
  // Reserve space for recent action and author/front memory. Bound all sections, not just history.
  const prefix = sections.slice(0, Math.floor(settings.maxChars * 0.6)) + '\n\n';
  const suffix = frontMemory ? '\n' + frontMemory.slice(0, Math.floor(settings.maxChars * 0.08)) : '';
  const note = authorsNote ? `[Author's note: ${authorsNote.slice(0, Math.floor(settings.maxChars * 0.08))}]\n` : '';
  const old = history.map((h, i) => (i === history.length - 1 ? note : '') + h.text).join('\n');
  const header = 'Recent Story:\n';
  const space = Math.max(0, settings.maxChars - prefix.length - header.length - suffix.length);
  const text = prefix + header + (old + current).slice(-space) + suffix;
  return { text, memoryLength: prefix.length, selected: selected.map(c => c.uid), history };
}
