import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixtureLogin } from './fixture-auth';

const headers = { Origin: 'http://127.0.0.1:4329' };
async function prepare(page: Page, kind: 'single' | 'series' | 'book', title: string) {
  const login = async (email: string) => expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email, password: 'fixture-password-123' } })).ok()).toBe(true);
  await login('planner@example.invalid');
  const command = async (data: Record<string, unknown>) => { const r = await page.request.post('/api/member/exhibitions', { headers, data }); expect(r.status(), await r.text()).toBe(200); return (await r.json()).exhibition; };
  let e = await command({ action: 'create', title }); const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
  e = await command({ action: 'settings', exhibitionId: e.id, revision: e.revision, title, status: 'open', gallery: 'staff', opensAt: iso(-60000), closesAt: iso(3600000), voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), recipientIds: ['member'] });
  await command({ action: 'participation.publish', exhibitionId: e.id, revision: e.revision });
  const current = async () => (await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;
  await expect.poll(async () => (await current()).participation.state).toBe('published'); e = await current();
  await command({ action: 'participation.attendance.set', exhibitionId: e.id, revision: e.revision, userId: 'member', vote: 'attending' });
  await login('member@example.invalid');
  const endpoint = `/api/exhibitions/${e.id}`;
  const begun = await (await page.request.post(endpoint, { headers, data: { action: 'begin' } })).json(), sectionId = e.schemas[0].sections[0].id;
  const photo = () => ({ assetId: '', x: -20, y: 0, width: 120, height: 80, rotation: 0 });
  const content = { ...begun.submission.draft, name: '作者', authorName: '作者', grade: '2年', sections: [{ sectionId, singles: kind === 'single' ? 1 : 0, series: kind === 'series' ? 1 : 0, books: kind === 'book' ? 1 : 0, seriesPhotoCounts: kind === 'series' ? [2] : [], fields: {} }], works: [{ id: crypto.randomUUID(), sectionId, kind, title: '光', caption: '提出する説明', location: '', equipment: '', settings: '', photos: kind === 'series' ? [photo(), photo()] : [photo()], fields: {} }] };
  expect((await page.request.post(endpoint, { headers, data: { action: 'save', revision: begun.submission.revision, content } })).status()).toBe(200);
  await page.goto(`/Exhibition/${e.id}`, { waitUntil: "domcontentloaded" }); await expect(page.locator('[data-work-key="title"]')).toHaveValue('光');
  return { endpoint, saved: async () => (await (await page.request.get(endpoint)).json()).submission };
}
async function attach(page: Page, index: number) {
  const bytes = await sharp({ create: { width: 12, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  await page.locator(`[data-upload-index="${index}"]`).setInputFiles({ name: `写真${index + 1}.png`, mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('.exhibition-status')).toContainText('写真を保存しました');
  await expect(page.locator('[data-submit]')).toBeEnabled();
}
for (const kind of ['single', 'series'] as const) test(`${kind}: missing photos show a number and an attachment instruction; attaching and resubmitting succeeds`, async ({ page }, info) => {
  const { saved } = await prepare(page, kind, `添付エラー ${kind} ${info.project.name}`);
  if (kind === 'series') await attach(page, 0);
  await page.locator('[data-submit]').click();
  await expect(page.locator('.exhibition-status')).toContainText('エラー番号：EXH-001\n提出する写真の枚数分、写真を添付してください。');
  await expect(page.locator('.exhibition-status')).toContainText(kind === 'series' ? '写真2枚目' : '写真1枚目');
  await expect(page.locator('.site-notice-text').last()).toContainText('EXH-001');
  await expect(page.locator('[data-work-key="caption"]')).toHaveValue('提出する説明');
  if (kind === 'single') { await page.locator('.exhibition-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('missing-photo-error.png') }); }
  let s = await saved(); expect(s.versions).toHaveLength(0); expect(s.draft.works[0].photos[0].x).toBe(-20);
  await page.reload(); await expect(page.locator('[data-work-key="title"]')).toHaveValue('光');
  await attach(page, kind === 'series' ? 1 : 0);
  await page.locator('[data-submit]').click(); await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  s = await saved(); expect(s.versions).toHaveLength(1);
});
test('failed client fonts retain structural text checks and preserve the warning, input and focus', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/fonts/zen-old-mincho/*.ttf', route => route.abort('failed'));
  const { saved } = await prepare(page, 'book', `文字確認の代替 ${info.project.name}`);
  await expect(page.locator('[data-metadata-lines]')).toContainText('提出時に確認');
  const title = page.locator('[data-work-key="title"]'); await title.fill('光\t影');
  await page.locator('[data-submit]').click();
  await expect(page.locator('.exhibition-status')).toContainText('エラー番号：EXH-004');
  await expect(title).toHaveAttribute('aria-invalid', 'true'); await expect(title).toBeFocused();
  await expect(title.locator('..').locator('[data-text-warning]')).toContainText('EXH-004');
  expect((await saved()).versions).toHaveLength(0); await expect(title).toHaveValue('光\t影');
  await title.fill('光'); await page.locator('[data-submit]').click();
  await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  expect((await saved()).versions).toHaveLength(1); expect(errors).toEqual([]);
});
test('font acquisition can recover without reloading the form', async ({ page }, info) => {
  let fail = true, successfulRequests = 0;
  await page.route('**/fonts/zen-old-mincho/*.ttf', route => { if (fail) return route.abort('failed'); successfulRequests++; return route.continue(); });
  const { saved } = await prepare(page, 'book', `文字確認の再試行 ${info.project.name}`);
  await expect(page.locator('[data-metadata-lines]')).toContainText('提出時に確認');
  fail = false; await page.locator('[data-submit]').click();
  await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  await expect(page.locator('[data-work-key="caption"]').locator('..').locator('[data-text-counter]')).toContainText('10pt');
  expect(successfulRequests).toBeGreaterThanOrEqual(2); expect((await saved()).versions).toHaveLength(1);
});
test('stalled fonts stop waiting after five seconds and double clicks only submit once', async ({ page }, info) => {
  let release!: () => void, submits = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fonts/zen-old-mincho/*.ttf', async route => { await gate; await route.abort('failed').catch(() => {}); });
  try {
    const { endpoint, saved } = await prepare(page, 'book', `文字確認の待機上限 ${info.project.name}`);
    page.on('request', request => { if (request.url().endsWith(endpoint) && request.method() === 'POST' && request.postDataJSON().action === 'submit') submits++; });
    const started = Date.now();
    await page.locator('[data-submit]').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page.locator('[data-submit]')).toBeDisabled();
    await expect(page.locator('.exhibition-status')).toContainText('提出しました', { timeout: 12000 });
    expect(Date.now() - started).toBeLessThan(11000); expect(submits).toBe(1); expect((await saved()).versions).toHaveLength(1);
  } finally { release(); }
});
test('unreadable responses and attachment failures always display a number and readable instructions', async ({ page }, info) => {
  const { endpoint } = await prepare(page, 'single', `その他のエラー ${info.project.name}`);
  await page.route(`**${endpoint}/upload`, route => route.fulfill({ status: 502, contentType: 'text/html', body: '<title>Bad Gateway</title>' }));
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  await page.locator('[data-upload-index="0"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('.exhibition-status')).toContainText('EXH-018'); await expect(page.locator('.exhibition-status')).toContainText('画面を再読み込み');
  await page.route(url => url.pathname === endpoint, route => route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'EXH-014', message: '写真展フォームを読み込めませんでした。' }) }) : route.continue());
  await page.reload(); await expect(page.locator('.exhibition-status')).toContainText('EXH-014');
});
