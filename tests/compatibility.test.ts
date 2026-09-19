import { it, expect } from 'vitest';
import { importCards } from '../src/cards';
import { presetScripts } from '../src/scripts/presets';
import { runIsolated, type HookRequest } from '../src/scripts/runtime';
import { newScenario, startAdventure, type Adventure, isRecord, undoTurn } from '../src/domain';
import { processTurn } from '../src/engine';

it('Inner Self applies a real NPC brain operation and removes the internal block from narration', async () => {
  const scripts = presetScripts('inner-self');
  const base: HookRequest = { hook: 'context', scripts, text: 'AI Instructions:\nContinue the story.\n\nRecent Story:\nLeah meets you at the station. She looks worried.\n', state: { memory: {} }, cards: importCards('[{"title":"@Leah","keys":"Leah","value":"Leah is the stationmaster.","description":"ordinary private notes"}]').cards, history: [{ text: 'Leah meets you at the station.', rawText: 'Leah meets you at the station.', type: 'start' }], info: { actionCount: 1, characterNames: ['You'], maxChars: 12000, memoryLength: 45 }, seed: 42 };
  const ctx = await runIsolated(base);
  expect(isRecord(ctx.state.InnerSelf) && ctx.state.InnerSelf.agent).toBe('Leah');
  const output = await runIsolated({ ...base, ...ctx, hook: 'output', info: { actionCount: 1, characterNames: ['You'] }, text: '(protect_station = I must protect the station from strangers.)\n\nLeah holds the door open.' });
  expect(output.text).toContain('Leah holds the door open.');
  expect(output.text).not.toContain('protect_station');
  const brain = output.cards.find(c => c.fields.keys.includes('"agent":"Leah"'));
  expect(brain?.fields.description).toContain('I must protect the station from strangers.');
  expect(output.cards.find(c => c.uid === base.cards[0].uid)?.fields.description).toBe('ordinary private notes');
});

it('Auto-Cards directs internal generation into a new card across real hooks', async () => {
  const s = newScenario(); s.opening = 'The captain introduces you to Leah at Meridian Station.'; s.scripts = presetScripts('auto-cards');
  let a: Adventure = startAdventure(s);
  const contexts: string[] = [];
  const run = async (mode: 'story' | 'continue', input: string) => {
    a = await processTurn({ adventure: a, mode, input, settings: { maxChars: 16000, fontSize: 18 }, runHook: runIsolated, signal: new AbortController().signal, onText: () => { throw new Error('Raw script text must not stream'); }, onThinking: () => { throw new Error('Script reasoning must not stream'); }, onStatus: () => {}, generate: async ({ context, onText, onThinking }) => {
      contexts.push(context);
      onText('Internal card draft'); onThinking?.('Internal card reasoning');
      return 'Leah is the stationmaster of Meridian Station and an expert pilot. Leah repairs ships and protects the station crew from wandering smugglers. Leah carries a brass key and knows every maintenance passage in the station. Leah learned engineering from her grandmother on a remote mining colony. Leah keeps careful records of all ships entering the docking bay. Leah believes every stranded traveler deserves a safe place to sleep. Leah has a dry sense of humor and rarely raises her voice in an argument. Leah tends a small garden of medicinal herbs near the central reactor. Leah maintains friendly ties with traders from the distant outer systems. Leah secretly hopes to restore the abandoned observatory above the station. Leah wears a dark blue uniform with silver patches from previous missions.';
    } });
  };
  await run('story', '/AC Leah');
  for (let i = 0; i < 8 && !a.cards.some(c => c.fields.title === 'Leah'); i++) await run('continue', '');
  expect(contexts.some(c => /informational entry for Leah|entry for Leah/i.test(c))).toBe(true);
  const card = a.cards.find(c => c.fields.title === 'Leah');
  expect(card?.fields.value).toContain('stationmaster');
  expect(card?.fields.description).toContain('updates');
  expect(a.turns.some(t => t.output.includes('Leah is the stationmaster'))).toBe(false);
  expect(undoTurn(a).turns.length).toBe(a.turns.length - 1);
});
