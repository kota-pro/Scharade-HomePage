import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fixtureLogin } from './fixture-auth';
const headers = { Origin: 'http://127.0.0.1:4329' };
function dataDir() {
  const { directory } = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8'));
  if (!directory.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))) throw new Error('Synthetic fixture required');
  return directory as string;
}
function snapshot() {
  const directory = dataDir();
  const files = ['users.json', 'member-activities.json', 'exhibitions.json'];
  const saved = files.map(name => ({ name, value: fs.existsSync(path.join(directory, name)) ? fs.readFileSync(path.join(directory, name)) : null }));
  return () => { for (const { name, value } of saved) if (value) fs.writeFileSync(path.join(directory, name), value); else fs.rmSync(path.join(directory, name), { force: true }); };
}
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8'));
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
test('mobile approval is opaque and succeeds without a roster error; executives receive roster work instead', async ({ page }, info) => {
  const undo = snapshot();
  const id = `pending-${7 + ['chromium', 'firefox', 'webkit'].indexOf(info.project.name)}`;
  try {
    expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `photo-executive-${info.project.name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBe(true);
    await page.goto('/Admin');
    await expect(page.getByRole('heading', { name: '名簿', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '名簿', exact: true })).toHaveAttribute('href', '/Admin/grouping-roster');
    await page.goto(`/Admin/accounts/${id}`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const open = page.locator('[data-approval-open]');
      await expect(open).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(open).toHaveCSS('opacity', '1');
      await open.click();
      const dialog = page.locator('[data-approval-dialog]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(dialog).toHaveCSS('opacity', '1');
      const confirm = page.locator('[data-approval-confirm]');
      await expect(confirm).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(confirm).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(confirm).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await dialog.screenshot({ path: info.outputPath(`approval-${width}.png`) });
      await page.locator('[data-approval-back]').click();
      expect(read('users.json').find((user: any) => user.id === id).approved).toBe(false);
    }
    await page.locator('[data-approval-open]').click();
    await page.locator('[data-approval-confirm]').click();
    await expect(page.locator('[data-approval-status]')).toContainText('登録を承認しました');
    await expect(page.locator('[data-approval-status]')).toContainText('やることリスト');
    await expect(page.locator('[data-approval-open]')).toBeHidden();
    const tasks = (await (await page.request.get('/api/help/tasks')).json()).tasks;
    expect(tasks.some((task: any) => task.id === 'roster:bindings' && task.href === '/Admin/grouping-roster')).toBe(true);
    expect(tasks.some((task: any) => task.id === `approval:${id}` || task.id === `approval-followup:${id}`)).toBe(false);
    await page.locator('[data-help-open]').click();
    await expect(page.locator('[data-help-tasks]')).toContainText('名簿とアカウントの未連携を確認');
    await page.locator('#help-panel').screenshot({ path: info.outputPath('roster-tasks.png') });
  } finally { undo(); }
});
test('saving a corrected account name refreshes Google and confirms the matching roster profile', async ({ page }, info) => {
  const undo = snapshot();
  try {
    const users = read('users.json');
    users.find((user: any) => user.id === 'activity-0').name = '訂正前のアカウント名';
    fs.writeFileSync(path.join(dataDir(), 'users.json'), JSON.stringify(users));
    fs.rmSync(path.join(dataDir(), 'member-activities.json'), { force: true });
    expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `photo-executive-${info.project.name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBe(true);
    await page.goto('/Admin/accounts/activity-0');
    await page.locator('.admin-account-editor > summary').click();
    await page.locator('#account-editor [name=name]').fill('撮影会員　activity-0');
    const posted = page.waitForResponse(response => response.url().endsWith('/api/admin/accounts/activity-0') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '登録内容を保存', exact: true }).click();
    const response = await posted;
    expect(response.ok()).toBe(true);
    await expect(page).toHaveURL(/\?saved=1$/);
    const data = read('member-activities.json');
    const key = crypto.createHash('sha256').update('activity-0').digest('hex');
    expect(data.roster.bindings['activity-0']).toBe(key);
    expect(data.profiles['activity-0'].rosterKey).toBe(key);
    expect(read('users.json').find((user: any) => user.id === 'activity-0').rosterRelink).toBeUndefined();
    await page.goto('/Admin/grouping-roster');
    await expect(page.getByRole('heading', { name: '名簿', exact: true })).toBeVisible();
  } finally { undo(); }
});

test('retrying a legacy approval hides the completed retry action even without an initialization record', async ({ page }, info) => {
  const undo = snapshot();
  try {
    const id = `pending-${10 + ['chromium', 'firefox', 'webkit'].indexOf(info.project.name)}`;
    const users = read('users.json'), target = users.find((user: any) => user.id === id);
    target.approved = true; target.approvalReviewAction = 'approve'; target.approvalReviewedAt = new Date().toISOString();
    delete target.approvalSetup; delete target.approvalNotifiedAt;
    fs.writeFileSync(path.join(dataDir(), 'users.json'), JSON.stringify(users));
    expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `photo-executive-${info.project.name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBe(true);
    await page.goto(`/Admin/accounts/${id}`);
    await page.locator('[data-approval-open]').click();
    await page.locator('[data-approval-confirm]').click();
    await expect(page.locator('[data-approval-status]')).toContainText('登録を承認しました');
    await expect(page.locator('[data-approval-open]')).toBeHidden();
    expect(read('users.json').find((user: any) => user.id === id).approvalNotifiedAt).toBeTruthy();
  } finally { undo(); }
});
