import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixtureLogin } from './fixture-auth';
const headers = { Origin: 'http://127.0.0.1:4329' };
async function login(page: Page, email = 'member@example.invalid') {
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email, password: 'fixture-password-123' } })).ok()).toBe(true);
}
const settled = async (page: Page) => expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');

test('series photos are added individually and deleting a chosen photo preserves the other images and layouts', async ({ page }, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await login(page, 'planner@example.invalid');
  const command = async (data: Record<string, unknown>) => {
    const r = await page.request.post('/api/member/exhibitions', { headers, data });
    expect(r.status(), await r.text()).toBe(200); return (await r.json()).exhibition;
  };
  let e = await command({ action: 'create', title: `写真を個別追加 ${info.project.name}` });
  const id = e.id, endpoint = `/api/exhibitions/${id}`, iso = (d: number) => new Date(Date.now() + d).toISOString();
  e = await command({ action: 'settings', exhibitionId: id, revision: e.revision, title: e.title, status: 'open', gallery: 'staff', opensAt: iso(-60000), closesAt: iso(3600000), voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), recipientIds: ['member'] });
  await command({ action: 'participation.publish', exhibitionId: id, revision: e.revision });
  const current = async () => (await (await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
  await expect.poll(async () => (await current()).participation.state).toBe('published'); e = await current();
  await command({ action: 'participation.attendance.set', exhibitionId: id, revision: e.revision, userId: 'member', vote: 'attending' });
  await login(page);
  await page.goto(`/Exhibition/${id}`);
  await page.locator('[data-begin]').click();
  await page.locator('[data-common="name"]').fill('作者');
  await page.locator('[data-common="authorName"]').fill('作者');
  await page.locator('[data-common="grade"]').selectOption('2年');
  await page.getByLabel('通常展示', { exact: true }).check();
  await page.locator('[data-count="series"]').fill('2'); await page.locator('[data-count="series"]').press('Tab');
  const first = page.locator('.exhibition-work').nth(0), second = page.locator('.exhibition-work').nth(1);
  await expect(page.locator('[data-series-count]')).toHaveCount(0);
  await expect(first.locator('[data-upload-work]')).toHaveCount(1);
  await expect(second.locator('[data-upload-work]')).toHaveCount(1);
  await first.locator('[data-add-series-photo]').click();
  await expect(first.locator('[data-upload-work]')).toHaveCount(2);
  await first.locator('[data-add-series-photo]').click();
  await expect(first.locator('[data-upload-work]')).toHaveCount(3);
  const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#548a83' } }).png().toBuffer();
  for (let i = 0; i < 3; i++) {
    await first.locator(`[data-upload-index="${i}"]`).setInputFiles({ name: `写真${i + 1}.png`, mimeType: 'image/png', buffer: bytes });
    await expect(first.locator('[data-file-info]').nth(i)).toContainText(`写真${i + 1}.png`);
    await expect(first.locator('[data-add-series-photo]')).toBeEnabled();
    await first.locator(`[data-photo-index="${i}"][data-photo-key="x"]`).fill(String(i * 200 + 17));
    await first.locator(`[data-photo-index="${i}"][data-photo-key="x"]`).press('Tab');
  }
  await settled(page);
  const saved = async () => (await (await page.request.get(endpoint)).json()).submission;
  const before = structuredClone((await saved()).draft);
  // Start a gap edit so deletion also exercises clearing indices in the layout tool.
  await first.locator('[data-series-open]').click();
  const popup = page.locator('.series-editor-dialog');
  await popup.locator('[data-series-gap-axis="x"]').first().click();
  await page.locator('[data-series-gap-next]').click();
  await popup.locator('[data-series-dimensions="1"] summary').click();
  await popup.locator('[data-series-remove-photo="1"]').click();
  await popup.locator('[data-series-dialog-close]').first().click();
  await expect(first.locator('[data-upload-work]')).toHaveCount(2); await settled(page);
  let after = (await saved()).draft;
  expect(after.works[0].photos).toEqual([before.works[0].photos[0], before.works[0].photos[2]]);
  expect(after.works[1]).toEqual(before.works[1]);
  expect(after.sections[0].seriesPhotoCounts).toEqual([2, 1]);
  await expect(first.locator('[data-file-info]').nth(1)).toContainText('写真3.png');
  await page.reload(); await settled(page);
  expect((await saved()).draft.works[0].photos).toEqual(after.works[0].photos);
  await first.locator('[data-remove-series-photo="0"]').click();
  await first.locator('[data-remove-series-photo="0"]').click(); await settled(page);
  await expect(first.locator('[data-upload-work]')).toHaveCount(0);
  expect((await saved()).draft.sections[0].seriesPhotoCounts).toEqual([0, 1]);
  const empty = await saved();
  const rejected = await page.request.post(endpoint, { headers, data: { action: 'submit', revision: empty.revision, content: empty.draft } });
  expect(rejected.status()).toBe(400); expect((await saved()).versions).toHaveLength(0);
  await page.reload(); await settled(page); await expect(first.locator('[data-upload-work]')).toHaveCount(0);
  await first.locator('[data-add-series-photo]').click(); await settled(page);
  await expect(first.locator('[data-upload-work]')).toHaveCount(1);
  await expect(first.locator('[data-file-info]')).toHaveText('ファイル未選択');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 }); await first.locator('[data-add-series-photo]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    await page.screenshot({ path: info.outputPath(`series-${width}.png`) });
  }
  // A previously saved series at the limit stays intact and cannot add a 101st photo.
  after = (await saved()).draft;
  after.works[0].photos = Array.from({ length: 100 }, (_, i) => ({ ...before.works[0].photos[0], assetId: '', x: i * 130 }));
  after.sections[0].seriesPhotoCounts = [100, 1];
  let s = await saved();
  const r = await page.request.post(endpoint, { headers, data: { action: 'save', revision: s.revision, content: after } });
  expect(r.status(), await r.text()).toBe(200);
  await page.reload(); await expect(first.locator('[data-add-series-photo]')).toBeDisabled(); await settled(page);
  expect((await saved()).draft.works[0].photos).toHaveLength(100);
  // Restore a valid submission, then exercise the same per-photo controls in the staff editor.
  s = await saved(); const final = structuredClone(before); final.works[1].photos = [before.works[0].photos[0]];
  const submitted = await page.request.post(endpoint, { headers, data: { action: 'submit', revision: s.revision, content: final } });
  expect(submitted.status(), await submitted.text()).toBe(200);
  await login(page, 'planner@example.invalid'); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/Member/manage/exhibitions/${id}/submissions`);
  await page.getByRole('tab', { name: '提出状況', exact: true }).click(); await page.locator('[data-submission-detail]').first().click();
  const modal = page.locator('.submission-editor-dialog');
  await modal.locator('[data-se-remove-photo="1"]').click();
  await expect(modal.locator('.se-photo-row')).toHaveCount(2);
  await expect(modal.locator('.se-photo-row').nth(1)).toContainText('写真3.png');
  await modal.locator('[data-se-add-photo]').click(); await expect(modal.locator('.se-photo-row')).toHaveCount(3);
  for (let i = 0; i < 3; i++) await modal.locator('[data-se-remove-photo="0"]').click();
  await expect(modal.locator('.se-photo-row')).toHaveCount(0);
  await modal.locator('[data-se-add-photo]').click(); await expect(modal.locator('.se-photo-row')).toHaveCount(1);
  await modal.locator('[data-se-mode="counts"]').click();
  await modal.locator('[data-se-count="series"]').fill('3'); await modal.locator('[data-se-count="series"]').press('Tab');
  await modal.locator('[data-se-mode=""]').click();
  await modal.locator('[data-se-work]').selectOption({ index: 2 });
  await expect(modal.locator('.se-photo-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
