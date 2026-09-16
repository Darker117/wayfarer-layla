import { test, expect } from '@playwright/test';

test('Stop cancels exactly one request, unlocks Back, and never resubmits the form', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /The Lantern Hollow/ }).click();
  await page.getByRole('button', { name: 'Begin adventure', exact: true }).click();
  await page.evaluate(() => {
    const w = window as any;
    w.sentCommands = [];
    const original = w.ReactNativeWebView.postMessage.bind(w.ReactNativeWebView);
    w.ReactNativeWebView.postMessage = (raw: string) => {
      w.sentCommands.push(JSON.parse(raw).cmd);
      original(raw);
    };
  });
  await page.getByLabel('Your action').fill('follow the silver bird');
  await page.getByRole('button', { name: 'Send action' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).sentCommands.filter((cmd: string) => cmd.startsWith('send_message')).length)).toBe(1);
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  const commands = await page.evaluate(() => (window as any).sentCommands);
  expect(commands.filter((cmd: string) => cmd === 'cancel')).toHaveLength(1);
  expect(commands.filter((cmd: string) => cmd.startsWith('send_message'))).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Back to adventures' })).toBeEnabled({ timeout: 1000 });
  await expect(page.getByLabel('Your action')).toHaveValue('follow the silver bird');
  // A deliberate new submission still works after cancellation.
  await page.getByRole('button', { name: 'Send action' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).sentCommands.filter((cmd: string) => cmd.startsWith('send_message')).length)).toBe(2);
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(page.getByRole('button', { name: 'Back to adventures' })).toBeEnabled({ timeout: 1000 });
  const finalCommands = await page.evaluate(() => (window as any).sentCommands);
  expect(finalCommands.filter((cmd: string) => cmd === 'cancel')).toHaveLength(2);
  expect(finalCommands.filter((cmd: string) => cmd.startsWith('send_message'))).toHaveLength(2);
  await page.getByRole('button', { name: 'Back to adventures' }).click();
  await expect(page.getByRole('heading', { name: 'Adventures', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wayfarer-demo-v1')!));
  expect(saved.adventures[0].turns).toHaveLength(0);
});
