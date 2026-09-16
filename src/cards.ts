import { type Card, type CardFields, clone, isRecord, uid } from './domain';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export interface CardImport { cards: Card[]; errors: string[]; warnings: string[]; total: number }
export function importCards(source: string): CardImport {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('Card file is larger than 10 MB. Split it into smaller files.');
  let parsed: unknown;
  try { parsed = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { throw new Error('This file is not valid JSON. Export a story-card JSON array from AI Dungeon.'); }
  if (!Array.isArray(parsed)) throw new Error('Expected an array of story cards. Scenario and adventure backups use the Backup screen.');
  if (parsed.length > 3000) throw new Error('Import at most 3,000 cards at a time.');
  const result: CardImport = { cards: [], errors: [], warnings: [], total: parsed.length };
  parsed.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.keys !== 'string' || (typeof raw.value !== 'string' && typeof raw.entry !== 'string')) {
      result.errors.push(`Card ${i + 1}: keys and value (or entry) must be strings.`); return;
    }
    for (const key of ['description', 'title', 'type']) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') { result.errors.push(`Card ${i + 1}: ${key} must be a string.`); return; }
    }
    for (const key of ['useForCharacterCreation', 'useForCharacterCreator']) {
      if (raw[key] !== undefined && typeof raw[key] !== 'boolean') { result.errors.push(`Card ${i + 1}: ${key} must be true or false.`); return; }
    }
    const fields = clone(raw) as CardFields;
    if (typeof fields.value !== 'string') { fields.value = raw.entry as string; result.warnings.push(`Card ${i + 1}: mapped script entry to export value.`); }
    result.cards.push({ uid: uid(), fields, enabled: true, pinned: false });
  });
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export type MergeMode = 'keep' | 'skip' | 'update';
export function mergeCards(existing: Card[], incoming: Card[], mode: MergeMode) {
  const cards = clone(existing); let added = 0, updated = 0, skipped = 0;
  for (const card of incoming) {
    const exact = cards.findIndex(c => stable(c.fields) === stable(card.fields));
    const match = cards.findIndex(c => c.fields.keys === card.fields.keys && (c.fields.title ?? '') === (card.fields.title ?? ''));
    if (mode !== 'keep' && exact >= 0) { skipped++; continue; }
    if (mode === 'update' && match >= 0) { cards[match] = { ...cards[match], fields: clone(card.fields) }; updated++; }
    else { cards.push({ ...clone(card), uid: uid() }); added++; }
  }
  return { cards, added, updated, skipped };
}
export function exportCards(cards: Card[]): string { return JSON.stringify(cards.map(c => c.fields), null, 2); }
export const blankCard = (): Card => ({ uid: uid(), fields: { title: '', keys: '', value: '', type: 'character', description: '' }, enabled: true, pinned: false });

export function relevantCards(cards: Card[], text: string, budget = 5000): Card[] {
  const haystack = text.toLocaleLowerCase();
  const matches = cards.filter(c => c.enabled && (c.pinned || c.fields.keys.split(',').some(k => k.trim() && haystack.includes(k.trim().toLocaleLowerCase()))));
  matches.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  let size = 0;
  return matches.filter(c => { const n = c.fields.value.length + (c.fields.title?.length || 0) + 4; if (!c.fields.value || size + n > budget) return false; size += n; return true; });
}
