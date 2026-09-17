import { test, expect, type Page } from '@playwright/test';
import { initialStore } from '../src/seeds';

async function installHost(page: Page, failure: 'native' | 'row') {
  await page.addInitScript(({ saved, failure }) => {
    const w = window as any;
    w.sqlQueries = [];
    if (!sessionStorage.getItem('native-library')) sessionStorage.setItem('native-library', saved);
    w.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw);
      if (request.cmd !== 'execute_sql') return;
      w.sqlQueries.push(request.data.query);
      const broken = !sessionStorage.getItem('host-recovered');
      const response = broken && failure === 'native'
        ? { event: 'on_error', data: { message: "Error processing Layla API message: Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: java.lang.NullPointerException" } }
        : { event: 'on_execute_sql_response', data: {
          rows: request.data.query.startsWith('SELECT') ? [broken ? {} : { payload: sessionStorage.getItem('native-library') }] : [],
          rowsAffected: 0, insertId: 0,
        } };
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ ...response, id: request.id }) })), 0);
    } };
    // A separate browser library must never mask a failed native load.
    localStorage.setItem('wayfarer-v1', saved);
  }, { saved: JSON.stringify(initialStore()), failure });
}

test('a stuck native database explains full restart, preserves storage, and loads after host recovery', async ({ page }) => {
  await installHost(page, 'native');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Layla needs a full restart.' })).toBeVisible();
  await expect(page.getByText('Android Settings → Apps → Layla → Force stop', { exact: true })).toBeVisible();
  await page.getByText('Error details', { exact: true }).click();
  await expect(page.getByText(/NativeDatabase.execAsync/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/startup-error-320.png', fullPage: true });
  const before = await page.evaluate(() => ({ native: sessionStorage.getItem('native-library'), browser: localStorage.getItem('wayfarer-v1') }));
  expect(await page.evaluate(() => (window as any).sqlQueries)).toHaveLength(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Layla needs a full restart.' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('host-recovered', '1'));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
  expect(await page.evaluate(() => ({ native: sessionStorage.getItem('native-library'), browser: localStorage.getItem('wayfarer-v1') }))).toEqual(before);
  expect(await page.evaluate(() => (window as any).sqlQueries.some((query: string) => query.startsWith('INSERT')))).toBe(false);
});

test('an invalid native library row blocks startup without a replacement or browser fallback', async ({ page }) => {
  await installHost(page, 'row');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your library couldn’t be opened.' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).sqlQueries.some((query: string) => query.startsWith('INSERT')))).toBe(false);
});
