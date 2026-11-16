import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';

test('roster search distinguishes namesakes, resets changed selections and submits only the selected person', async ({ page }, info) => {
  const headers = { Origin: 'http://127.0.0.1:4329' };
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `photo-executive-${info.project.name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBeTruthy();
  const result = await (await page.request.get('/api/admin/accounting')).json();
  const member = (id: string, name: string, university: string, lineName: string, rosterKey = '') => ({ id, name, university, lineName, rosterKey, active: !!rosterKey, siteUserIds: [] });
  result.data.members = [
    member('past-a', '山田 太郎', '架空大学Ａ', 'Ｔａｒｏ'),
    member('past-b', '山田太郎', '架空大学Ｂ', 'Photo-B'),
    member('past-c', '鈴木 花子', '', 'Hanako'),
    member('linked', '対応済み会員', '架空大学Ｂ', 'Photo-B', 'already-linked'),
  ];
  result.data.rosterPending = [
    { record: { key: 'pending-a', name: '山田　太郎', university: '架空大学Ｂ', lineName: 'Photo-B', active: true, uncertain: false, siteUserIds: [] }, reason: '人物対応を確認してください。' },
    { record: { key: 'pending-b', name: '鈴木 花子', university: '', lineName: 'Hanako', active: true, uncertain: true, siteUserIds: [] }, reason: 'Adminで本人を確認してください。' },
  ];
  result.data.rosterStatus = { configured: true, current: true, revision: 1, title: '検索の架空名簿', error: false };
  // Only the screen's data is replaced. No synthetic correspondence reaches storage.
  await page.route('**/api/admin/accounting', route => route.fulfill({ json: result }));
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/admin/accounting/actions', async route => {
    sent.push(route.request().postDataJSON());
    const updated = structuredClone(result);
    updated.data.rosterPending = updated.data.rosterPending.filter((p: any) => p.record.key !== 'pending-a');
    await route.fulfill({ json: updated });
  });
  await page.goto('/Admin/accounting');
  await page.getByRole('button', { name: '名簿', exact: true }).click();
  const pendingSearch = page.getByLabel('対応待ちの名簿を検索', { exact: true });
  const cards = page.locator('[data-roster-key]:visible');
  await pendingSearch.fill('ｐｈｏｔｏ－ｂ　架空大学Ｂ');
  await expect(cards).toHaveCount(1);
  await expect(page.locator('#accounting-pending-count')).toHaveText('2件中1件を表示');
  await pendingSearch.fill('見つからない氏名');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('#accounting-pending-empty')).toBeVisible();
  await pendingSearch.fill('山田 太郎');
  await expect(cards).toHaveCount(1);
  const form = page.locator('[data-roster-key="pending-a"] form');
  const search = form.getByLabel('対応先を検索', { exact: true });
  const picker = form.getByRole('combobox');
  await search.fill('山田');
  await expect(picker.locator('option[value^="past-"]')).toHaveCount(2);
  await expect(picker.locator('option[value="linked"]')).toHaveCount(0);
  await search.fill('ｔａｒｏ');
  await expect(picker.locator('option[value^="past-"]')).toHaveCount(1);
  await picker.selectOption('past-a');
  await expect(form.locator('[data-candidate-preview]')).toContainText('Ｔａｒｏ');
  await search.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(sent).toHaveLength(0);
  await search.fill('該当なし');
  await expect(picker).toHaveValue('');
  await expect(form.locator('[data-candidate-preview]')).toBeHidden();
  await expect(form.locator('[data-candidate-count]')).toContainText('一致する会計人物がいません');
  await expect(picker.locator('option[value="new"]')).toHaveCount(1);
  await search.fill('ｐｈｏｔｏ－ｂ　架空大学Ｂ');
  await expect(form.locator('[data-candidate-count]')).toContainText('候補：1人');
  await picker.selectOption('past-b');
  await expect(form.locator('[data-candidate-preview]')).toContainText('LINE：Photo-B');
  const listSearch = page.getByLabel('会計の人物一覧を検索', { exact: true });
  await listSearch.fill('HANAKO');
  await expect(page.locator('#accounting-members-count')).toHaveText('4人中1人を表示');
  await expect(page.locator('#accounting-members-list tbody tr')).toHaveCount(1);
  await listSearch.fill('該当なし');
  await expect(page.locator('#accounting-members-list')).toContainText('一致する会計人物が見つかりません');
  await listSearch.fill('');
  await expect(page.locator('#accounting-members-list tbody tr')).toHaveCount(4);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.getByRole('button', { name: '人物対応を確認する', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('大学：架空大学Ｂ');
  await expect(dialog).toContainText('LINE：Photo-B');
  expect(sent).toHaveLength(0);
  await dialog.getByRole('button', { name: '入力に戻る', exact: true }).click();
  await expect(picker).toHaveValue('past-b');
  await page.setViewportSize({ width: 1280, height: 900 });
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('accounting-roster-search.png') });
  await form.getByRole('button', { name: '人物対応を確認する', exact: true }).click();
  await dialog.getByRole('button', { name: 'この内容で確定する', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ action: 'resolveRoster', key: 'pending-a', memberId: 'past-b' });
  expect(Object.keys(sent[0]).sort()).toEqual(['action', 'expectedRevision', 'key', 'memberId', 'operationId']);
  await expect(page.locator('[data-roster-key="pending-a"]')).toHaveCount(0);
  await expect(page.locator('[data-roster-key="pending-b"]').getByRole('link', { name: 'Adminで確認する' })).toBeVisible();
});
