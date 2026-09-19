import { test, expect, type Page } from '@playwright/test';
import { initialStore } from '../src/seeds';
import { startAdventure } from '../src/domain';

async function openStory(page: Page, script: 'off' | 'transform' | 'suppress' | 'context-only' = 'off', long = false) {
  const store = initialStore(), adventure = startAdventure(store.scenarios[0]);
  if (long) adventure.opening = (adventure.opening + '\n\n').repeat(5);
  if (script !== 'off') adventure.scripts = { enabled: true, preset: 'custom', library: '', input: '', context: '', output: script === 'transform' ? 'state.processed = true; ({text: "The edited passage is ready."})' : 'state.processed = true; ({text: "", stop: true})' };
  if (script === 'context-only') { adventure.scripts.context = 'state.prepared = true; ({text})'; adventure.scripts.output = ''; }
  store.adventures.push(adventure);
  await page.addInitScript(({ store }) => {
    const w = window as any;
    w.nativeStore = store; w.generations = []; w.cancelCount = 0;
    const send = (id: string, event: string, data: unknown) => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, event, data }) }));
    w.token = (i: number, delta: string) => { const g = w.generations[i]; g.msg += delta; send(g.id, 'on_message', { msg: g.msg, delta }); };
    w.finish = (i: number) => send(w.generations[i].id, 'on_message_end', { msg: w.generations[i].msg });
    w.fail = (i: number) => send(w.generations[i].id, 'on_error', { message: 'Test model interrupted' });
    w.ReactNativeWebView = { postMessage(raw: string) {
      const r = JSON.parse(raw);
      if (r.cmd.startsWith('send_message')) { w.generations.push({ id: r.id, msg: '', request: r.data }); return; }
      if (r.cmd === 'cancel') { w.cancelCount++; return; }
      if (r.cmd === 'get_execution_context') {
        queueMicrotask(() => send(r.id, 'on_get_execution_context_response', { app_version: '7.4.0', character: null, session_id: null })); return;
      }
      if (r.cmd === 'execute_sql') {
        const q = r.data.query;
        if (q.startsWith('INSERT')) w.nativeStore = JSON.parse(r.data.params[0]);
        queueMicrotask(() => send(r.id, 'on_execute_sql_response', { rows: q.startsWith('SELECT') ? [{ payload: JSON.stringify(w.nativeStore) }] : [], rowsAffected: q.startsWith('INSERT') ? 1 : 0, insertId: 1 }));
      }
    } };
  }, { store });
  await page.goto('/');
  await page.getByRole('button', { name: /The Lantern Hollow.*0 turns into your story/ }).click();
}
const token = (page: Page, text: string, i = 0) => page.evaluate(({ text, i }) => (window as any).token(i, text), { text, i });
const finish = (page: Page, i = 0) => page.evaluate(i => (window as any).finish(i), i);
const count = (page: Page, n: number) => expect.poll(() => page.evaluate(() => (window as any).generations.length)).toBe(n);

test('answer and collapsed thinking update live, toggle during generation, and remain separate through Redo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page);
  await page.getByLabel('Your action').fill('follow the silver bird');
  await page.getByRole('button', { name: 'Send action' }).click(); await count(page, 1);
  await token(page, '<thi');
  await expect(page.getByLabel('Live story response')).toHaveCount(0);
  await token(page, 'nk>PRIVATE first line\n');
  const show = page.getByRole('button', { name: /Show thinking/ });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('PRIVATE first line', { exact: false })).toHaveCount(0);
  await show.click();
  const reasoning = page.getByRole('region', { name: 'Thinking from your Layla model' });
  await expect(reasoning).toContainText('PRIVATE first line');
  await token(page, 'PRIVATE second line</thi');
  await expect(reasoning).toContainText('PRIVATE second line');
  await token(page, 'nk>The gate');
  await expect(page.getByLabel('Live story response')).toHaveText('The gate');
  await expect(page.getByRole('button', { name: 'Cancel generation' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).nativeStore.adventures[0].turns.length)).toBe(0);
  await token(page, ' opens beneath the moon.');
  await expect(page.getByLabel('Live story response')).toHaveText('The gate opens beneath the moon.');
  await page.getByRole('button', { name: /Hide thinking/ }).click();
  await expect(reasoning).toHaveCount(0);
  await token(page, ' A bell rings.');
  await expect(page.getByLabel('Live story response')).toBeInViewport();
  const answerBox = await page.getByLabel('Live story response').boundingBox();
  const composerBox = await page.locator('.composer-wrap').boundingBox();
  expect(answerBox!.y + answerBox!.height).toBeLessThan(composerBox!.y);
  await page.screenshot({ path: 'artifacts/live-answer-collapsed-390.png' });
  await show.click();
  await page.screenshot({ path: 'artifacts/live-thinking-expanded-390.png' });
  await finish(page);
  await expect(page.getByText('1 turns · Saved on this device', { exact: true })).toBeVisible();
  await expect(page.locator('.story-turn .prose')).toHaveText('The gate opens beneath the moon. A bell rings.');
  await expect(page.getByRole('button', { name: /Hide thinking/ })).toContainText('Finished');
  expect(await page.evaluate(() => JSON.stringify((window as any).nativeStore))).not.toContain('PRIVATE');
  await page.getByLabel('Your action').fill('my unsent draft');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await count(page, 2);
  await expect(page.getByRole('button', { name: /thinking/ })).toHaveCount(0);
  await token(page, '<think>PRIVATE new plan</think>A fresh path appears.', 1);
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await finish(page, 1);
  await expect(page.getByLabel('Your action')).toHaveValue('my unsent draft');
  const data = await page.evaluate(() => ({ saved: (window as any).nativeStore, request: (window as any).generations[1].request }));
  expect(data.saved.adventures[0].turns).toHaveLength(1);
  expect(data.saved.adventures[0].turns[0].output).toBe('A fresh path appears.');
  expect(JSON.stringify(data.request)).not.toMatch(/PRIVATE|The gate opens|my unsent draft/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(show).toHaveCount(0);
});

test('Stop clears partial channels, unlocks Back, and late chunks cannot contaminate the next generation', async ({ page }) => {
  await openStory(page);
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>PRIVATE cancelled</think>Partial old story');
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(page.getByRole('button', { name: 'Back to adventures' })).toBeEnabled({ timeout: 1000 });
  await expect(page.getByRole('button', { name: /thinking/ })).toHaveCount(0);
  await expect(page.getByLabel('Live story response')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue story' }).click();
  await token(page, '<think>PRIVATE late</think>LATE OLD ANSWER'); await finish(page);
  await count(page, 2);
  await token(page, 'Only the new answer.', 1);
  await expect(page.getByLabel('Live story response')).toHaveText('Only the new answer.');
  await expect(page.getByRole('button', { name: /thinking/ })).toHaveCount(0);
  await finish(page, 1);
  const data = await page.evaluate(() => ({ saved: (window as any).nativeStore, cancels: (window as any).cancelCount }));
  expect(data.cancels).toBe(1); expect(data.saved.adventures[0].turns).toHaveLength(1);
  expect(data.saved.adventures[0].turns[0].output).toBe('Only the new answer.');
});

test('thinking fits a narrow phone and lets the reader scroll back during updates', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openStory(page);
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>' + 'Consider the lantern and the waiting fox.\n'.repeat(35));
  await page.getByRole('button', { name: /Show thinking/ }).click();
  const thinking = page.getByRole('region', { name: 'Thinking from your Layla model' });
  const bodyBox = await thinking.boundingBox(), composerBox = await page.locator('.composer-wrap').boundingBox();
  expect(bodyBox!.y + bodyBox!.height).toBeLessThan(composerBox!.y);
  await thinking.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await token(page, 'Another detail arrives.');
  expect(await thinking.evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: /Hide thinking/ }).click();
  await token(page, '</think>Finch raises the lantern.');
  await finish(page);
  await expect(page.locator('.story-turn .prose')).toHaveText('Finch raises the lantern.');
});

test('a failed generation discards both channels and keeps the previous saved library', async ({ page }) => {
  await openStory(page);
  const before = await page.evaluate(() => (window as any).nativeStore);
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>PRIVATE failed</think>Partial failed answer');
  await page.evaluate(() => (window as any).fail(0));
  await expect(page.getByRole('alert')).toContainText('The turn wasn’t saved.');
  await expect(page.getByRole('button', { name: /thinking/ })).toHaveCount(0);
  await expect(page.getByLabel('Live story response')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).nativeStore)).toEqual(before);
});

for (const script of ['transform', 'suppress'] as const) test(`script ${script} keeps internal answer and reasoning hidden during generation`, async ({ page }) => {
  await openStory(page, script);
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>PRIVATE internal reasoning</think>INTERNAL NPC UPDATE');
  await expect(page.getByLabel('Live story response')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /thinking/ })).toHaveCount(0);
  await expect(page.getByText('Scripts can change or hide this response. The finished passage appears after processing.')).toBeVisible();
  expect(await page.evaluate(() => document.body.textContent)).not.toMatch(/PRIVATE|INTERNAL/);
  await finish(page);
  await expect(page.getByText('1 turns · Saved on this device', { exact: true })).toBeVisible();
  const a = await page.evaluate(() => (window as any).nativeStore.adventures[0]);
  expect(a.state.processed).toBe(true);
  expect(a.turns[0].output).toBe(script === 'transform' ? 'The edited passage is ready.' : '');
  expect(JSON.stringify(a)).not.toMatch(/PRIVATE|INTERNAL/);
});

for (const width of [320, 390, 1440]) test(`jump to latest stays visible while scrolling above the end and fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page, 'off', true);
  const jump = page.getByRole('button', { name: 'Jump to latest story' });
  await expect(jump).toBeVisible();
  const box = await jump.boundingBox(), composer = await page.locator('.composer-wrap').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThan(composer!.y);
  await page.evaluate(() => {
    const original = window.scrollTo.bind(window);
    (window as any).scrollTo = (options: ScrollToOptions) => { (window as any).lastScrollBehavior = options.behavior; original(options); };
  });
  await jump.click();
  await expect(jump).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).lastScrollBehavior)).toBe('instant');
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(jump).toBeVisible();
  // Repeated real wheel events keep the arrow reachable while reading above the end.
  await page.mouse.move(width / 2, 300);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(60); expect(await jump.count()).toBe(1); }
  await expect(jump).toBeVisible();
  await page.setViewportSize({ width, height: 460 });
  await expect(jump).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('.jump-latest')!.getBoundingClientRect().bottom - document.querySelector('.composer-wrap')!.getBoundingClientRect().top)).toBeLessThan(0);
  const smallBox = await jump.boundingBox(), smallComposer = await page.locator('.composer-wrap').boundingBox();
  expect(smallBox!.y).toBeGreaterThan(70);
  expect(smallBox!.y + smallBox!.height).toBeLessThan(smallComposer!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `artifacts/jump-latest-${width}.png` });
  await jump.click(); await expect(jump).toHaveCount(0);
});

test('stream growth respects a reader above the story, jump resumes following, and completion does not pull them down', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page, 'off', true);
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>Model planning</think>The gate opens.');
  await expect(page.getByLabel('Live story response')).toHaveText('The gate opens.');
  await token(page, '\n\n' + 'Finch waits under the lantern. '.repeat(30));
  const jump = page.getByRole('button', { name: 'Jump to latest story' });
  await page.keyboard.press('Home'); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0); await expect(jump).toBeVisible();
  const readingAt = await page.evaluate(() => scrollY);
  await token(page, '\n\nA second light appears. '.repeat(15));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => scrollY)).toBe(readingAt);
  await jump.click(); await expect(jump).toHaveCount(0);
  await token(page, '\n\nThe fox steps forward. '.repeat(10));
  await expect.poll(() => page.evaluate(() => document.querySelector('.story-end')!.getBoundingClientRect().bottom - document.querySelector('.composer-wrap')!.getBoundingClientRect().top)).toBeLessThan(0);
  await page.keyboard.press('Home'); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0); await expect(jump).toBeVisible();
  await finish(page);
  await expect(page.getByText('1 turns · Saved on this device', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(jump).toBeVisible();
  await page.getByRole('button', { name: 'Back to adventures' }).click();
  await expect(jump).toHaveCount(0);
});

test('completed Context work transitions into live public answer and thinking without an Output hook', async ({ page }) => {
  await openStory(page, 'context-only');
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 1);
  await token(page, '<think>Consider the moon.</think>The gate');
  await expect(page.getByRole('button', { name: /Show thinking/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Live story response')).toHaveText('The gate');
  await token(page, ' opens.');
  await expect(page.getByLabel('Live story response')).toHaveText('The gate opens.');
  expect(await page.evaluate(() => (window as any).nativeStore.adventures[0].turns)).toHaveLength(0);
  await finish(page);
  await expect(page.getByText('1 turns · Saved on this device', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => (window as any).nativeStore.adventures[0]);
  expect(saved.state.prepared).toBe(true);
  expect(saved.turns[0].output).toBe('The gate opens.');
  expect(JSON.stringify(saved)).not.toContain('Consider the moon.');
});


for (const width of [320, 390, 1440]) test(`Think remains private through save, Redo and resume; Say is audible at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await openStory(page);
  for (const name of ['Do', 'Say', 'Think', 'Story', 'Redo']) {
    const control = page.getByRole('button', { name, exact: true });
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button', { name: 'Think', exact: true }).click();
  await expect(page.getByLabel('Your action')).toHaveAttribute('placeholder', /private thought/);
  await page.getByLabel('Your action').fill('Perhaps the key is under the bridge.');
  await page.getByRole('button', { name: 'Send action' }).click(); await count(page, 1);
  expect(await page.evaluate(() => JSON.stringify((window as any).generations[0].request))).toContain('[Private player thought;');
  await token(page, 'Finch watches the rain.'); await finish(page);
  await expect(page.locator('.private-thought')).toContainText('Private thought');
  await expect(page.locator('.private-thought')).toContainText('Perhaps the key is under the bridge.');
  await expect(page.getByRole('button', { name: /Show thinking/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).nativeStore.adventures[0].turns[0].mode)).toBe('think');
  await page.getByRole('button', { name: 'Say', exact: true }).click();
  await page.getByLabel('Your action').fill('An unsent line');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await count(page, 2);
  expect(await page.evaluate(() => JSON.stringify((window as any).generations[1].request))).toContain('[Private player thought;');
  expect(await page.evaluate(() => JSON.stringify((window as any).generations[1].request))).not.toContain('An unsent line');
  await token(page, 'Finch shelters the lantern.', 1); await finish(page, 1);
  await expect(page.getByLabel('Your action')).toHaveValue('An unsent line');
  await expect(page.getByRole('button', { name: 'Say', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Your action').fill('Let us check beneath the bridge.');
  await page.getByRole('button', { name: 'Send action' }).click(); await count(page, 3);
  const prompt = await page.evaluate(() => JSON.stringify((window as any).generations[2].request));
  expect(prompt).toContain('[End private thought]'); expect(prompt).toContain('You say');
  await token(page, 'Finch lifts his lantern toward the bridge.', 2); await finish(page, 2);
  await expect(page.getByText('2 turns · Saved on this device', { exact: true })).toBeVisible();
  await expect(page.locator('.player-action').last()).toContainText('You say');
  expect(await page.evaluate(() => (window as any).nativeStore.adventures[0].turns.map((t: any) => t.mode))).toEqual(['think', 'say']);
  await page.getByRole('button', { name: 'Back to adventures' }).click();
  await page.getByRole('button', { name: 'Resume The Lantern Hollow', exact: true }).click();
  await expect(page.locator('.private-thought')).toContainText('Perhaps the key is under the bridge.');
  await page.getByRole('button', { name: 'Think', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to latest story' }).click();
  await expect(page.getByRole('button', { name: 'Jump to latest story' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `docs/screenshots/private-thought-${width}.png` });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('1 turns · Saved on this device', { exact: true })).toBeVisible();
  await expect(page.locator('.private-thought')).toContainText('Private thought');
  await page.getByRole('button', { name: 'Continue story' }).click(); await count(page, 4);
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(page.getByRole('button', { name: 'Back to adventures' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).nativeStore.adventures[0].turns)).toHaveLength(1);
});
