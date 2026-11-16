import { test, expect } from '@playwright/test';
import { fixtureLogin, restoreFixtureRoster } from './fixture-auth';

const headers = { Origin: 'http://127.0.0.1:4329' };
test('executive accounting uses the applied Admin roster and retries a lost result once', async ({ page }, info) => {
  page.setDefaultTimeout(8000);
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `photo-executive-${info.project.name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBeTruthy();
  await restoreFixtureRoster(page.request);
  await expect.poll(async () => (await (await page.request.get('/api/admin/accounting')).json()).data?.rosterStatus?.current).toBe(true);
  const before = (await (await page.request.get('/api/admin/accounting')).json()).data;
  await page.goto('/Admin');
  await page.getByRole('link', { name: '会計管理へ' }).click();
  await expect(page.getByRole('heading', { name: '月ごとの収支' })).toBeVisible();
  await page.getByRole('button', { name: '名簿', exact: true }).click();
  await expect(page.getByText('2026年度後期テスト名簿', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '名簿管理を開く' })).toHaveAttribute('href', '/Admin/grouping-roster');
  await expect(page.locator('#accounting-content input[type="url"]')).toHaveCount(0);
  await page.getByRole('button', { name: '取引記録', exact: true }).click();
  const form = page.locator('[data-form="transaction"]');
  await form.getByLabel('日付', { exact: true }).fill('2026-09-01');
  await form.getByLabel('金額（円）').fill('1500');
  const title = `架空会費 ${info.project.name}`;
  await form.getByLabel('項目名').fill(title);
  await form.getByRole('button', { name: '取引内容を確認する' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(title);
  // The real backend saves the operation, but the browser loses its response.
  await page.route('**/api/admin/accounting/actions', async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await dialog.locator('#accounting-confirm-send').click();
  await expect(page.locator('#accounting-send-status')).not.toHaveText('保存しています…');
  await dialog.locator('#accounting-confirm-close').click();
  await page.getByRole('button', { name: '前回の操作を再確認', exact: true }).click();
  await dialog.locator('#accounting-confirm-send').click();
  await expect(dialog).not.toBeVisible();
  const after = (await (await page.request.get('/api/admin/accounting')).json()).data;
  expect(after.events.filter((e: any) => e.description === title)).toHaveLength(1);
  expect(after.summary.bank).toBe(before.summary.bank + 1500);
  expect(after.history[0].actor).toContain(`photo-executive-${info.project.name}`);
  await page.setViewportSize({ width: 320, height: 740 });
  await form.getByRole('combobox', { name: '区分', exact: true }).selectOption('advance');
  await form.getByRole('combobox', { name: '立替者', exact: true }).selectOption({ label: '撮影会員 activity-0 / テスト大学' });
  await form.getByLabel('金額（円）').fill('600');
  await form.getByLabel('項目名').fill(`架空備品 ${info.project.name}`);
  await form.getByRole('button', { name: '取引内容を確認する' }).click();
  await expect(dialog).toContainText('撮影会員 activity-0');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(320);
  await dialog.locator('#accounting-confirm-send').click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '立替・返金', exact: true }).click();
  const card = page.locator('.accounting-card').filter({ hasText: `架空備品 ${info.project.name}` });
  await card.getByRole('button', { name: '返金を記録する' }).click();
  await form.getByLabel('金額（円）').fill('200');
  await form.getByRole('button', { name: '取引内容を確認する' }).click();
  await dialog.locator('#accounting-confirm-send').click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '立替・返金', exact: true }).click();
  await expect(card).toContainText('未返金 400円');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('accounting-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '残高確認', exact: true }).click();
  await page.getByLabel('確認日').fill('2026-11-03');
  await page.getByLabel('実際の残高（円）').fill('12000');
  await page.getByRole('button', { name: '残高の入力内容を確認する' }).click();
  await dialog.locator('#accounting-confirm-send').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '照合結果' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '収支・通帳', exact: true }).click();
  await page.screenshot({ path: info.outputPath('accounting-desktop.png'), fullPage: true });
});

test('accounting pages, mutations and receipts deny guests, ordinary members and staff', async ({ browser }) => {
  for (const identity of [null, 'member', 'photo-staff-chromium']) {
    const context = await browser.newContext(); const page = await context.newPage();
    if (identity) expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `${identity}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBeTruthy();
    for (const path of ['/api/admin/accounting', '/api/admin/accounting/receipts/ADV-' + 'a'.repeat(32)]) {
      expect([401, 403]).toContain((await page.request.get(path)).status());
    }
    expect([401, 403]).toContain((await page.request.post('/api/admin/accounting/actions', { headers, data: { action: 'refresh' } })).status());
    await page.goto('/Admin/accounting');
    await expect(page.locator('#accounting')).toHaveCount(0);
    await context.close();
  }
});
