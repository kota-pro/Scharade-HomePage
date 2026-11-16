import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixtureLogin } from './fixture-auth';
import { defaultRules } from '../../src/lib/activityTypes';
const headers = { Origin: 'http://127.0.0.1:4329' };
async function login(page: Page, id = 'member') {
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `${id}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBe(true);
}
async function open(page: Page) { await page.locator('[data-help-open]').click(); await expect(page.locator('#help-panel')).toBeVisible(); }
async function basic(page: Page) { await open(page); await page.locator('[data-help-page]').click(); await expect(page.locator('[data-help-tour]')).toBeVisible(); }
async function searchGuide(page: Page, title: string) { await open(page); await page.locator('#help-query').fill(title); await page.locator('#help-search-results button').first().click(); await expect(page.locator('[data-help-tour]')).toBeVisible(); }
async function advanceTo(page: Page, selector: string) {
  const target = page.locator(selector).and(page.locator('.help-target'));
  const number = page.locator('[data-help-step-number]');
  for (let attempts = 0; !(await target.count()) && attempts < 20; attempts++) {
    const current = await number.textContent();
    await page.locator('[data-help-next]').click();
    await expect(number).not.toHaveText(current ?? '');
  }
  await expect(target).toBeVisible();
}
async function pointsToVisibleTarget(page: Page) {
  await expect(page.locator('[data-help-arrow]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector('.help-target'), arrow = document.querySelector<HTMLElement>('[data-help-arrow]')!, banner = document.querySelector('[data-help-tour]')!;
    if (!el) return false;
    const r = el.getBoundingClientRect(), a = arrow.getBoundingClientRect(), b = banner.getBoundingClientRect();
    const x = Number(arrow.dataset.tipX), y = Number(arrow.dataset.tipY);
    const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const overlap = (u: DOMRect, v: DOMRect) => u.left < v.right && u.right > v.left && u.top < v.bottom && u.bottom > v.top;
    return distance >= 4 && distance <= 8 && a.left >= 0 && a.right <= innerWidth && a.top >= 0 && a.bottom <= innerHeight && !overlap(a, b) && !overlap(r, b);
  })).toBe(true);
}
test('Portfolio office help starts at the account list and highlights its separate settings form', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/Admin/accounts?q=other%40example.invalid');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await searchGuide(page, '役職の決定');
  await expect(page.locator('#account-query')).toHaveClass(/help-target/);
  await advanceTo(page, '.admin-account-links a[href="/Admin/accounts/other"]');
  await page.locator('.admin-account-links a[href="/Admin/accounts/other"]').click();
  await expect(page.locator('#portfolio-office-title')).toHaveClass(/help-marker/);
  await advanceTo(page, '#portfolio-office-select');
  await advanceTo(page, '#portfolio-office-form button[type="submit"]');
  expect(writes).toEqual([]);
});
test('Portfolio series help follows photo selection and the nested layout editor', async ({ page }, info) => {
  await login(page, `photo-owner-${info.project.name}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Portfolio/edit');
  await searchGuide(page, 'Portfolioで組写真を作りたい');
  await expect(page.locator('label[for="series-files"]')).toHaveClass(/help-target/);
  await advanceTo(page, '[data-portfolio-series-create]');
  await page.locator('[data-portfolio-series-create]').click();
  const chooser = page.locator('#portfolio-series-editor');
  await expect(chooser).toBeVisible();
  await advanceTo(page, '[data-portfolio-series-picks] label');
  for (const checkbox of await chooser.getByRole('checkbox').all()) await checkbox.check();
  await advanceTo(page, '#portfolio-series-editor [name="title"]');
  await advanceTo(page, '[data-portfolio-series-layout]');
  await pointsToVisibleTarget(page);
  await page.locator('[data-portfolio-series-layout]').click();
  const layout = page.locator('.series-editor-dialog');
  await expect(layout).toBeVisible();
  await advanceTo(page, '[data-series-editor]');
  await advanceTo(page, '[data-series-dimensions] > summary');
  await page.locator('[data-series-dimensions] > summary.help-target').click();
  await advanceTo(page, '[data-series-paper]');
  await advanceTo(page, '[data-series-orientation]');
  await advanceTo(page, '[data-series-photo-key="width"]');
  await advanceTo(page, '[data-series-photo-key="height"]');
  await advanceTo(page, '.series-dialog-footer [data-series-dialog-close]');
  await layout.locator('.series-dialog-footer [data-series-dialog-close]').click();
  await advanceTo(page, '#portfolio-series-editor button[type="submit"]');
});
test('Portfolio book help follows the chosen cover type and points to the actual publish action', async ({ page }, info) => {
  await login(page, `photo-owner-${info.project.name}`);
  await page.goto('/Portfolio/edit');
  await searchGuide(page, '本をPortfolioに載せたい');
  await expect(page.locator('[data-portfolio-book-create]')).toHaveClass(/help-target/);
  await page.locator('[data-portfolio-book-create]').click();
  const editor = page.locator('#portfolio-book-editor');
  await expect(editor).toBeVisible();
  await advanceTo(page, '#portfolio-book-editor [name="pdf"]');
  await advanceTo(page, '#portfolio-book-editor [name="coverMode"]');
  await editor.locator('[name="coverMode"]').selectOption('image');
  await page.locator('[data-help-next]').click();
  await expect(editor.locator('[name="coverFile"]')).toHaveClass(/help-target/);
  await advanceTo(page, '#portfolio-book-editor [name="direction"]');
  await advanceTo(page, '#portfolio-book-editor button[type="submit"]');
  await editor.locator('[data-book-edit-close]').click();
  await advanceTo(page, '#submit-button');
});
test('Gallery exclusions help follows the mode and per-photo controls without changing visibility', async ({ page }) => {
  await login(page, 'planner');
  await page.goto('/Gallery/gallery-series-fixture');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await searchGuide(page, '公開しない写真');
  await expect(page.locator('[data-open-gallery-settings]')).toHaveClass(/help-target/);
  await page.locator('[data-open-gallery-settings]').click();
  await advanceTo(page, '[data-gallery-settings-mode="exclusions"]');
  await page.locator('[data-gallery-settings-mode="exclusions"]').click();
  await advanceTo(page, '[data-gallery-exclusion-photos] [data-exclusion-id]');
  await advanceTo(page, '.gallery-settings-dialog button[type="submit"]');
  expect(writes).toEqual([]);
});
test('Gallery series help points from the group card to an individual photo and back', async ({ page }) => {
  await page.goto('/Gallery/gallery-series-fixture');
  await searchGuide(page, '組写真を見る');
  const group = page.locator('[data-photo-series="true"] .photo-open').first();
  await expect(group).toHaveClass(/help-target/);
  await group.click();
  await advanceTo(page, '[data-photo-series-frame]');
  await page.locator('[data-photo-series-frame].help-target').click();
  await advanceTo(page, '#photo-dialog [data-photo-toggle]');
  await advanceTo(page, '[data-photo-series-back]');
});
test('member calendar help points at previous and next month on the calendar', async ({ page }) => {
  await login(page); await page.goto('/Member');
  await searchGuide(page, '過去の企画');
  const calendar = page.locator('main a[href^="?view=calendar"]');
  await expect(calendar).toHaveClass(/help-target/);
  await calendar.click();
  await expect(page).toHaveURL(/view=calendar/);
  await expect(page.locator('[data-help-tour]')).toBeVisible();
  await advanceTo(page, '[data-calendar-previous]');
  await advanceTo(page, '[data-calendar-next]');
});
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
for (const width of [390, 768]) test(`opening mobile help and menu does not focus a search field at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/Contact'); await open(page);
  await expect(page.locator('[data-help-close]')).toBeFocused();
  await expect(page.locator('#help-query')).not.toBeFocused();
  await page.locator('#help-query').click(); await expect(page.locator('#help-query')).toBeFocused();
  await page.locator('[data-help-close]').click(); await page.locator('.toggle_btn').click();
  await expect(page.locator('.toggle_btn')).toBeFocused(); await expect(page.locator('#searchbox')).not.toBeFocused();
  await page.locator('#searchbox').click(); await expect(page.locator('#searchbox')).toBeFocused();
});
test('site-management tasks contain administrative follow-ups and can start roster guidance', async ({ page }) => {
  await login(page, 'site-manager'); await page.goto('/Admin');
  const data = await (await page.request.get('/api/help/tasks')).json();
  expect(data.tasks.length).toBeGreaterThan(0);
  expect(data.tasks.every((t: any) => t.group === 'management')).toBe(true);
  expect(data.tasks.some((t: any) => ['event-vote', 'tool-answer', 'exhibition-vote', 'exhibition-submit', 'exhibition-shift'].includes(t.guideId))).toBe(false);
  expect(data.tasks.some((t: any) => t.id.startsWith('roster:'))).toBe(true);
  const task = data.tasks.find((t: any) => t.id === 'roster:setup' || t.id === 'roster:bindings');
  expect(task).toBeTruthy();
  await open(page); const roster = page.locator('[data-help-tasks] button').filter({ hasText: task.title });
  await roster.click(); await page.locator('[data-help-selection-content] button').click();
  await expect(page).toHaveURL(/\/Admin\/grouping-roster$/);
  if (task.guideId === 'roster') {
    await page.locator('[data-help-next]').click();
    await expect(page.locator('[data-activity-action="roster.preview"] input[type="url"]').first()).toHaveClass(/help-target/);
  } else await expect(page.locator('[data-roster-account-search]')).toHaveClass(/help-target/);
});
test('shift management guidance opens the correct sections and tabs without saving', async ({ page }, info) => {
  await login(page, 'planner'); const index = ['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1;
  await page.goto(`/Member/manage/exhibitions/f2000000-0000-4000-8000-00000000000${index}/shifts`);
  await expect(page.locator('[data-schedule]')).toHaveCount(1); await basic(page);
  await expect(page.locator('[data-help-tour-name]')).toHaveText('展示シフトの受付・割り当て・公開');
  await expect(page.locator('[data-schedule] [name=startDate]')).toHaveClass(/help-target/);
  await advanceTo(page, '[data-schedule] [name=endDate]');
  await advanceTo(page, '[data-config] [name=state]');
  await advanceTo(page, '[data-config] [name=opensAt]');
  await advanceTo(page, '[data-config] [name=closesAt]');
  await advanceTo(page, '[data-response-search]');
  await advanceTo(page, '[data-response-filter]');
  await advanceTo(page, '[data-action=generate]');
});
test('title-board and Lightroom guides follow their real dialogs', async ({ page }, info) => {
  await login(page, 'planner');
  const index = ['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1;
  const base = `/Member/manage/exhibitions/f5000000-0000-4000-8000-00000000000${index}`;
  await page.goto(base + '/submissions'); await page.locator('[data-manage-boards]').waitFor();
  await searchGuide(page, 'タイトルボードの配置・印刷');
  await expect(page.locator('[data-manage-boards]')).toHaveClass(/help-target/);
  await page.locator('[data-manage-boards]').click(); await expect(page.locator('[data-bm-search]')).toBeVisible();
  await advanceTo(page, '[data-bm-search]');
  await advanceTo(page, '[data-bm-issues-only]');
  await advanceTo(page, '[data-bm-edit]');
  await page.locator('[data-bm-edit]').first().click(); await page.locator('[data-bm-canvas]').waitFor();
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-bm-canvas]')).toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click(); await page.locator('[data-bm-close]').click();
  await page.goto(base); await page.locator('[data-lightroom-create]').waitFor();
  await searchGuide(page, 'Lightroom・展示アルバムの写真除外'); await expect(page.locator('[data-lightroom-create]')).toHaveClass(/help-target/);
  await page.locator('[data-lightroom-create]').click(); await page.locator('[data-album-search]').waitFor();
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-album-search]')).toHaveClass(/help-target/);
  await advanceTo(page, '[data-album-filter]');
  await advanceTo(page, '[data-album-photo]');
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-album-apply]')).toHaveClass(/help-target/);
});
test('administrator view guidance points at role selection and denies staff access', async ({ page }) => {
  await login(page, 'admin'); await page.goto('/Admin/view'); await basic(page);
  await expect(page.locator('[data-help-tour-name]')).toHaveText('ログイン・ロールの表示を確認する');
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-admin-view-role=member]')).toHaveClass(/help-target/);
  await expect(page.locator('[data-help-step-text]')).toContainText('閲覧専用');
});
test('specified SVG, Back, Hide, resume and upper-right Close have distinct behavior', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/Contact');
  await expect(page.locator('[data-help-open] svg')).toHaveAttribute('viewBox', '0 0 36 36');
  await expect(page.locator('[data-help-open] .clr-i-outline-path-1')).toHaveCount(1);
  await expect(page.locator('[data-help-badge]')).toBeHidden();
  await basic(page);
  await expect(page.locator('[data-help-prev]')).toBeDisabled();
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('お名前を入力する');
  await expect(page.locator('[data-help-arrow]')).toBeVisible();
  await expect(page.locator('#contact-form [name=name]')).toHaveClass(/help-target/);
  await pointsToVisibleTarget(page);
  await page.locator('[data-help-next]').click();
  await page.locator('[data-help-prev]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('お名前を入力する');
  await page.locator('[data-help-hide]').click();
  await expect(page.locator('[data-help-tour]')).toBeHidden();
  await expect(page.locator('[data-help-arrow]')).toBeHidden();
  await expect(page.locator('.help-target')).toHaveCount(0);
  await page.reload(); await open(page);
  await page.locator('[data-help-resume]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('お名前を入力する');
  await page.locator('[data-help-stop]').click();
  await expect(page.locator('[data-help-tour]')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('scharade-help-tour-v1'))).toBeNull();
  await open(page); await expect(page.locator('[data-help-resume-box]')).toBeHidden();
  await page.screenshot({ path: info.outputPath('help-panel-desktop.png'), fullPage: true, animations: 'disabled' });
  const panelBounds = await page.locator('#help-panel').boundingBox();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0); expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(1280);
  expect(errors).toEqual([]);
});
test('search button shares the menu icon and searches candidates without starting one', async ({ page }) => {
  await page.goto('/Contact'); await open(page);
  expect(await page.locator('[data-help-search-button] svg').innerHTML()).toBe(await page.locator('#searchbutton svg').innerHTML());
  await expect(page.locator('[data-help-search-button] svg')).toHaveCSS('width', '18px');
  await page.locator('#help-query').fill('写真展に出展したい');
  await page.locator('[data-help-search-button]').click();
  await expect(page.locator('#help-search-results button').first()).toBeFocused();
  await expect(page.locator('#help-search-results')).not.toContainText('お問い合わせ');
  await expect(page.locator('#help-panel')).toBeVisible();
});
test('mobile arrows follow the exact field after scroll, resize, and a completed radio group', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/Contact');
  await page.locator('[name=name]').fill('案内確認'); await page.locator('[name=furigana]').fill('アンナイカクニン');
  await page.locator('[name=institution]').fill('確認大学'); await page.locator('#grade-2').check();
  await basic(page); await page.locator('[data-help-next]').click();
  await expect(page.locator('[name=faculty]')).toHaveClass(/help-target/);
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('メールアドレスを入力する');
  await expect(page.locator('[name=email]')).toHaveClass(/help-target/); await pointsToVisibleTarget(page);
  await page.evaluate(() => window.scrollBy(0, 60)); await pointsToVisibleTarget(page);
  await page.setViewportSize({ width: 320, height: 640 }); await pointsToVisibleTarget(page);
  await page.screenshot({ path: info.outputPath('help-field-redesign-mobile.png'), animations: 'disabled' });
});
test('contact guide highlights each visible choice group and its heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Contact'); await basic(page);
  await advanceTo(page, '#contact-form td:has([name="grade"])');
  await expect(page.locator('#grade')).toHaveClass(/help-marker/);
  await pointsToVisibleTarget(page);
  await page.locator('#grade-2').check();
  await advanceTo(page, '#contact-form td:has([name="inquiry"])');
  await expect(page.locator('#inquiry')).toHaveClass(/help-marker/);
  await expect(page.locator('#grade')).not.toHaveClass(/help-marker/);
  await pointsToVisibleTarget(page);
});
test('list and detail guidance identifies real controls rather than decorative pictures', async ({ page }) => {
  await page.goto('/Portfolio'); await basic(page); await page.locator('[data-help-next]').click();
  await expect(page.locator('.help-target')).toHaveAttribute('href', /^\/Portfolio\//);
  await expect(page.locator('[data-help-step-text]')).toContainText('メンバーのカード'); await pointsToVisibleTarget(page);
  await page.locator('[data-help-stop]').click(); await login(page, 'admin'); await page.goto('/Admin/accounts');
  await basic(page); await page.locator('[data-help-next]').click(); await expect(page.locator('#account-query')).toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click(); await page.goto('/Admin/accounts/member'); await basic(page); await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('登録内容を確認する');
  await expect(page.locator('section[aria-label="登録内容"]')).toHaveClass(/help-target/);
});
test('public alumni search opens the Portfolio section and highlights its cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await searchGuide(page, '卒業生の作品');
  await expect(page).toHaveURL(/\/Portfolio$/);
  const alumni = page.locator('details[data-portfolio-grade="OB/OG"]');
  await expect(alumni.locator('summary')).toHaveClass(/help-target/);
  await page.locator('[data-help-next]').click();
  await expect(alumni).toHaveAttribute('open', '');
  const cards = alumni.locator('.member-card');
  if (await cards.count()) await expect(cards.first()).toHaveClass(/help-target/);
  else await expect(alumni.locator('summary')).toHaveClass(/help-target/);
});
test('layout guide uses the actual toolbar and keeps Save usable inside the modal', async ({ page }, info) => {
  await login(page, 'planner'); const index = ['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1;
  await page.goto(`/Member/manage/exhibitions/f2000000-0000-4000-8000-00000000000${index}/layout`);
  await page.locator('[data-open-room-editor="wall"]').click(); await basic(page);
  await expect(page.locator('[data-help-tour-name]')).toHaveText('展示レイアウトの基本');
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-layout-view]')).toHaveClass(/help-target/); await pointsToVisibleTarget(page);
  await page.locator('[data-help-next]').click(); await expect(page.locator('[data-layout-tab="works"]')).toHaveClass(/help-target/); await pointsToVisibleTarget(page);
  await advanceTo(page, '[data-layout-fit]');
  await advanceTo(page, '[data-layout-save]'); await pointsToVisibleTarget(page);
  await page.screenshot({ path: info.outputPath('help-layout-save-redesign.png'), animations: 'disabled' });
});
test('layout search and equal-spacing guides point at the controls inside the editor', async ({ page }, info) => {
  await login(page, 'planner');
  const index = ['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1;
  await page.goto(`/Member/manage/exhibitions/f2000000-0000-4000-8000-00000000000${index}/layout`);
  await searchGuide(page, '配置済みの作品を検索');
  await expect(page.locator('[data-layout-tab="works"]')).toHaveClass(/help-target/);
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-layout-work-search]')).toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click();
  await searchGuide(page, '両端の余白も含めて均等配置');
  await page.locator('[data-help-next]').click();
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-layout-equalize-surface]')).toHaveClass(/help-target/);
  await pointsToVisibleTarget(page);
});
test('a different open dialog never leaves an arrow on an inert background input', async ({ page }) => {
  await page.goto('/Contact'); await basic(page); await page.locator('[data-help-next]').click();
  await page.evaluate(() => { const d = document.createElement('dialog'); d.id = 'unrelated-dialog'; d.innerHTML = '<h2>別の確認画面</h2><button>確認</button>'; document.body.append(d); d.showModal(); });
  await expect(page.locator('[data-help-arrow]')).toBeHidden(); await expect(page.locator('.help-target')).toHaveCount(0);
  await expect(page.locator('.help-marker')).toHaveCount(0);
  await page.evaluate(() => document.querySelector<HTMLDialogElement>('#unrelated-dialog')!.close());
  await expect(page.locator('[name=name]')).toHaveClass(/help-target/); await pointsToVisibleTarget(page);
});
test('photo information guidance starts with an album and follows through to the viewer controls', async ({ page }) => {
  await page.goto('/Gallery'); await open(page); await page.locator('#help-query').fill('写真の拡大・撮影情報・いいね');
  await page.locator('#help-search-results button').first().click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('アルバムを選ぶ');
  await page.locator('main a.help-target').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('写真を開く');
  await expect(page.locator('.photo-open').first()).toHaveClass(/help-target/);
  await page.locator('.photo-open').first().click(); await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('撮影情報を表示する');
  await expect(page.locator('#photo-dialog [data-photo-toggle]')).toHaveClass(/help-target/);
  await expect(page.locator('#photo-dialog [data-photo-close]')).not.toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click(); await expect(page.locator('#photo-dialog')).toBeVisible();
});
test('Next skips completed fields and Back returns to the previous displayed step', async ({ page }) => {
  await page.goto('/Contact');
  await page.locator('#contact-form [name=name]').fill('確認 太郎');
  await page.locator('#contact-form [name=furigana]').fill('カクニン タロウ');
  await basic(page); await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('所属を入力する');
  await page.locator('[data-help-prev]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('このページでできること');
});
test('registration guide points at each name and password field separately', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Signup'); await basic(page);
  for (const field of ['#signup-name', '#signup-portfolio-name', '#signup-email', '#signup-password', '#signup-password-confirm']) {
    await page.locator('[data-help-next]').click();
    await expect(page.locator(field)).toHaveClass(/help-target/);
    await expect(page.locator('.help-target')).toHaveCount(1);
  }
  await pointsToVisibleTarget(page);
});
test('advance guide follows the selected refund method and skips the unrelated fields', async ({ page }) => {
  await login(page); await page.goto('/Member/advance'); await basic(page);
  await advanceTo(page, '#refund-method');
  await page.locator('#refund-method').selectOption('paypay');
  await page.locator('[data-help-next]').click();
  await expect(page.locator('#refund-line-name')).toHaveClass(/help-target/);
  await page.locator('[data-help-next]').click();
  await expect(page.locator('#roster-name')).toHaveClass(/help-target/);
});
test('accounting guide points at each work area separately', async ({ page }) => {
  await login(page, 'admin'); await page.goto('/Admin/accounting');
  await expect(page.locator('#accounting-nav [data-tab="summary"]')).toBeVisible();
  await basic(page);
  await advanceTo(page, '#accounting-nav [data-tab="summary"]');
  await advanceTo(page, '[name="ledger-account"]');
  for (const tab of ['transaction', 'requests', 'advances', 'checks', 'roster', 'settings']) {
    await advanceTo(page, `#accounting-nav [data-tab="${tab}"]`);
    await expect(page.locator('.help-target')).toHaveCount(1);
  }
});
test('search follows a permitted exhibition across navigation and reload without auto-submitting', async ({ page }, info) => {
  await login(page); await page.goto('/Member');
  await expect(page.locator('[data-help-badge]')).toBeVisible();
  await open(page); await page.locator('#help-query').fill('写真展に出展したい');
  await page.locator('#help-search-results button').first().click();
  await page.locator('[data-help-selection-content] button').filter({ hasText: `写真展入力テスト ${info.project.name}` }).first().click();
  await expect(page).toHaveURL(/\/Member\/exhibitions\//);
  await expect(page.locator('[data-help-tour]')).toBeVisible();
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('出展フォームへ進む');
  await page.locator('[data-help-next]').click();
  await expect(page).toHaveURL(/\/Exhibition\//);
  await expect(page.locator('[data-help-step-title]')).toHaveText('出展を開始する');
  await page.locator('[data-begin]').click();
  await expect(page.locator('[data-common=name]')).toBeVisible();
  await page.reload(); await expect(page.locator('[data-help-tour]')).toBeVisible();
  await advanceTo(page, '[data-section-toggle]');
  await expect(page.locator('[data-help-step-title]')).toHaveText('展示区分を選ぶ');
  await page.locator('[data-help-stop]').click();
  const data = await (await page.request.get('/api/help/tasks')).json();
  expect(data.tasks.some((t: any) => t.guideId === 'exhibition-submit')).toBe(true);
});
test('mobile panel and guide fit the viewport and keyboard navigation remains usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto('/Login');
  await open(page); await expect(page.locator('[data-help-tools]')).toBeVisible();
  await expect(page.locator('[data-help-close]')).toBeFocused();
  await page.locator('#help-query').fill('ログイン'); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#help-search-results button').first()).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('[data-help-tour]')).toBeVisible();
  await page.locator('[data-help-next]').click(); await expect(page.locator('#login-email')).toHaveClass(/help-target/);
  const bounds = await page.locator('[data-help-tour]').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('help-tour-mobile.png'), fullPage: true, animations: 'disabled' });
});
for (const viewer of ['guest', 'member'] as const) test(`${viewer} can browse only available tools and start guidance from the description`, async ({ page }) => {
  if (viewer === 'member') await login(page);
  await page.goto('/Contact'); await open(page);
  await expect(page.locator('[data-help-tools]')).toBeVisible();
  await page.locator('[data-help-tools]').click();
  const list = page.locator('[data-help-selection-content]');
  await expect(list).toContainText('お問い合わせを送る');
  await expect(list).toContainText('写真の拡大・撮影情報・いいね');
  await expect(list).not.toContainText('写真展を管理する');
  await expect(list).not.toContainText('会計を管理する');
  await expect(list).not.toContainText('アカウント登録を承認する');
  if (viewer === 'guest') {
    await expect(list).not.toContainText('立替費用を申請する');
    await expect(list).not.toContainText('写真展に作品を出展する');
    await expect(list).not.toContainText('自分のPortfolioを編集する');
    await list.getByRole('button', { name: 'お問い合わせを送る', exact: false }).click();
  } else {
    await expect(list).toContainText('立替費用を申請する');
    await expect(list).toContainText('写真展に作品を出展する');
    await list.getByRole('button', { name: '自分のPortfolioを編集する', exact: false }).click();
  }
  await expect(list.getByRole('button', { name: '手順を説明しますか？ ▶︎' })).toBeVisible();
  await list.getByRole('button', { name: '手順を説明しますか？ ▶︎' }).click();
  await expect(page.locator('[data-help-tour]')).toBeVisible();
  await expect(page.locator('[data-help-tour-name]')).toHaveText(viewer === 'guest' ? 'お問い合わせを送る' : '自分のPortfolioを編集する');
  await expect(page).toHaveURL(viewer === 'guest' ? /\/Contact$/ : /\/Portfolio\/edit$/);
});
test('management badge, task prompt and in-site approval update without duplicate mail', async ({ page }, info) => {
  await login(page, 'admin'); await page.goto('/Admin/accounts?status=pending');
  await expect(page.locator('[data-help-badge]')).toBeVisible();
  await open(page); await expect(page.locator('[data-help-tools]')).toBeVisible();
  await expect(page.locator('[data-help-tasks]')).toContainText('登録承認');
  const targetId = `pending-${19 + ['chromium', 'firefox', 'webkit'].indexOf(info.project.name)}`;
  const pointer = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8'));
  expect(pointer.directory.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))).toBe(true);
  const userFile = path.join(pointer.directory, 'users.json');
  const previous = JSON.parse(fs.readFileSync(userFile, 'utf8')).find((u: any) => u.id === targetId);
  try {
    const button = page.locator('[data-help-tasks] button').filter({ hasText: `${previous.name}の登録承認` }); await button.click();
    await page.locator('[data-help-selection-content] button').click();
    await expect(page).toHaveURL(new RegExp(`/Admin/accounts/${targetId}$`));
    await page.locator('[data-help-next]').click();
    await page.locator('[data-approval-open]').click();
    await expect(page.locator('[data-approval-dialog]')).toBeVisible();
    await expect(page.locator('[data-help-open]')).toBeVisible();
    await page.locator('[data-help-next]').click();
    await expect(page.locator('[data-approval-dialog] dl')).toHaveClass(/help-target/);
    await page.locator('[data-help-next]').click();
    await expect(page.locator('[data-approval-confirm]')).toHaveClass(/help-target/);
    await page.locator('[data-approval-confirm]').click();
    await expect(page.locator('[data-approval-status]')).toContainText('登録を承認しました');
    await expect.poll(async () => (await (await page.request.get('/api/help/tasks')).json()).tasks.some((t: any) => t.id === `approval:${targetId}`)).toBe(false);
    await page.locator('[data-help-stop]').click();
    await expect(page.locator('[data-help-tour]')).toBeHidden();
    const details = await page.request.get(`/Admin/accounts/${targetId}`); expect(await details.text()).toContain('承認済み');
  } finally {
    const users = JSON.parse(fs.readFileSync(userFile, 'utf8')).map((u: any) => u.id === targetId ? previous : u);
    fs.writeFileSync(userFile, JSON.stringify(users), { mode: 0o600 });
  }
});
test('management acknowledgement persists per account at the bottom and disappears after completion', async ({ page, browser }, info) => {
  test.setTimeout(90000);
  const actor = `photo-executive-${info.project.name}`, targetId = `pending-${25 + ['chromium', 'firefox', 'webkit'].indexOf(info.project.name)}`;
  await login(page, actor); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/Member');
  const pointer = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8'));
  expect(pointer.directory.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))).toBe(true);
  const userFile = path.join(pointer.directory, 'users.json'), receiptFile = path.join(pointer.directory, 'help-task-reads.json');
  const previous = JSON.parse(fs.readFileSync(userFile, 'utf8')).find((u: any) => u.id === targetId);
  const taskId = `approval:${targetId}`, selector = `[data-help-task-id="${taskId}"]`;
  try {
    const task = (await (await page.request.get('/api/help/tasks')).json()).tasks.find((t: any) => t.id === taskId);
    expect(task.readState.at).toBeUndefined();
    await open(page); await page.locator(selector).click();
    expect((await (await page.request.get('/api/help/tasks')).json()).tasks.find((t: any) => t.id === taskId).readState.at).toBeUndefined();
    await page.getByRole('button', { name: 'このやることを確認する ▶︎', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/Admin/accounts/${targetId}$`));
    await page.locator('[data-help-stop]').click(); await open(page);
    const pending = page.locator('[data-help-task-group="pending"]');
    await expect(pending.locator(selector)).toContainText('既読・未対応');
    await expect(page.locator('[data-help-tasks] > section').last()).toHaveAttribute('data-help-task-group', 'pending');
    await expect(page.locator('[data-help-task-group="management"]').locator(selector)).toHaveCount(0);
    const unreadCount = async () => {
      const sources = await Promise.all(['/api/help/tasks', '/api/help/tasks?source=accounting'].map(async url => (await (await page.request.get(url)).json()).tasks));
      return sources.flat().filter(t => !t.readState?.at).length;
    };
    await expect.poll(async () => Number(await page.locator('[data-help-badge]').textContent())).toBe(await unreadCount());
    await pending.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('help-read-pending-mobile.png'), animations: 'disabled' });
    await page.reload(); await open(page); await expect(page.locator('[data-help-task-group="pending"]').locator(selector)).toBeVisible();
    const separate = await browser.newContext({ baseURL: 'http://127.0.0.1:4329' });
    try {
      const otherPage = await separate.newPage(); await login(otherPage, 'admin');
      expect((await (await otherPage.request.get('/api/help/tasks')).json()).tasks.find((t: any) => t.id === taskId).readState.at).toBeUndefined();
    } finally { await separate.close(); }
    await page.locator('[data-help-close]').click();
    await page.locator('[data-approval-open]').click(); await page.locator('[data-approval-confirm]').click();
    await expect.poll(async () => (await (await page.request.get('/api/help/tasks')).json()).tasks.some((t: any) => t.id === taskId)).toBe(false);
    await open(page); await expect(page.locator('[data-help-task-group="pending"]').locator(selector)).toHaveCount(0);
  } finally {
    fs.writeFileSync(userFile, JSON.stringify(JSON.parse(fs.readFileSync(userFile, 'utf8')).map((u: any) => u.id === targetId ? previous : u)), { mode: 0o600 });
    if (fs.existsSync(receiptFile)) {
      const store = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));store.reads = store.reads.filter((r: any) => r.userId !== actor || r.taskId !== taskId);fs.writeFileSync(receiptFile, JSON.stringify(store), { mode: 0o600 });
    }
  }
});
test('personal answers, staff and read-only role previews cannot acquire management read receipts', async ({ page }, info) => {
  test.setTimeout(90000);
  const actor = `photo-executive-${info.project.name}`;
  await login(page, actor); await page.goto('/Member');
  const pointer = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8'));expect(pointer.directory.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))).toBe(true);
  const file = path.join(pointer.directory, 'member-activities.json'), id = crypto.randomUUID();
  const data = JSON.parse(fs.readFileSync(file, 'utf8')), now = new Date().toISOString();
  data.events.push({ id, revision: 1, status: 'published', title: '既読の対象外の参加回答', category: 'other', description: '', startsAt: new Date(Date.now()+172800000).toISOString(), endsAt: new Date(Date.now()+176400000).toISOString(), meeting: '', itinerary: '', fee: '', deadline: new Date(Date.now() + 86400000).toISOString(), theme: '', ownerId: 'planner', ownerName: '運営', recipientIds: [actor], createdAt: now, updatedAt: now, votes: {}, rules: defaultRules(), groupHistory: [] });
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  try {
    const taskId = `event-vote:${id}`, body = { id: taskId, version: '0'.repeat(64), source: 'local' };
    expect((await (await page.request.get('/api/help/tasks')).json()).tasks.find((t: any) => t.id === taskId).readState).toBeUndefined();
    expect((await page.request.post('/api/help/tasks', { headers, data: body })).status()).toBe(403);
    await open(page); await page.locator(`[data-help-task-id="${taskId}"]`).click();
    await expect(page.getByRole('button', { name: '手順を説明しますか？ ▶︎', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'このやることを確認する ▶︎', exact: true })).toHaveCount(0);
    await page.locator('[data-help-close]').click(); await login(page, 'planner'); await page.goto('/Member');
    expect((await page.request.post('/api/help/tasks', { headers, data: body })).status()).toBe(403);
    expect((await (await page.request.get('/api/help/tasks')).json()).tasks.every((t: any) => !t.readState)).toBe(true);
    await login(page, 'admin'); await page.goto('/Admin/view'); await page.locator('[data-admin-view-role="executive"]').click();
    await expect(page.locator('[data-admin-view-banner]')).toContainText('幹部として表示確認中');
    await page.waitForLoadState('domcontentloaded');
    expect((await page.evaluate(async () => (await (await fetch('/api/help/tasks')).json()).tasks)).every((t: any) => !t.readState)).toBe(true);
    const denied = await page.evaluate(async body => { const r = await fetch('/api/help/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });return { status: r.status, body: await r.json() }; }, body);
    expect(denied.status).toBe(403);expect(denied.body.message).toContain('閲覧専用');
  } finally {
    const latest = JSON.parse(fs.readFileSync(file, 'utf8'));latest.events = latest.events.filter((e: any) => e.id !== id);fs.writeFileSync(file, JSON.stringify(latest), { mode: 0o600 });
  }
});
test('server denies unauthorized help targets and accounting tasks, and failures stay recoverable', async ({ page }) => {
  await page.goto('/');
  expect((await page.request.get('/api/help/context?guide=content-edit')).status()).toBe(401);
  expect((await page.request.get('/api/help/tasks')).status()).toBe(401);
  await login(page); expect((await page.request.get('/api/help/tasks?source=accounting')).status()).toBe(403);
  expect((await page.request.get('/api/help/context?guide=account-approve&entity=member')).status()).toBe(403);
  expect((await page.request.post('/api/admin/accounts/pending-1/approval', { headers, data: { revision: 'a'.repeat(64) } })).status()).toBe(403);
  await page.goto('/Member'); await page.route('**/api/help/tasks', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
  await open(page); await expect(page.locator('[data-help-tasks]')).toContainText('取得できませんでした');
  await page.unroute('**/api/help/tasks'); await page.locator('[data-help-refresh]').click();
  await expect(page.locator('[data-help-tasks]')).toContainText('作品提出');
});
test('a real answer clears the notification badge and the task immediately', async ({ page }) => {
  await login(page, 'planner');
  const created = await (await page.request.post('/api/member/tools', { headers, data: { kind: 'poll' } })).json();
  const endpoint = `/api/member/tools/${created.id}`;
  let tool = (await (await page.request.get(endpoint)).json()).tool;
  const saved = await page.request.post(endpoint, { headers, data: { action: 'save', revision: tool.revision, answerRevision: tool.answerRevision, question: 'ヘルプ通知の確認', recipientIds: ['planner'], options: [{ text: '回答A' }, { text: '回答B' }], settings: {} } });
  expect(saved.ok(), await saved.text()).toBe(true); tool = (await saved.json()).tool;
  expect((await page.request.post(endpoint, { headers, data: { action: 'publish', revision: tool.revision, answerRevision: tool.answerRevision } })).ok()).toBe(true);
  await page.goto(`/Member/tools/${created.id}`);
  await expect(page.locator('[data-help-badge]')).toHaveText('1');
  await basic(page);
  await advanceTo(page, '[data-tool-answer] input[name=choice]');
  await expect(page.locator('[data-help-step-title]')).toHaveText('投票する選択肢を選ぶ');
  await advanceTo(page, '[data-tool-answer] button[type=submit]');
  await page.locator('[data-help-stop]').click();
  await page.locator('[data-tool-answer] input[name=choice]').first().check();
  await page.locator('[data-tool-answer] button[type=submit]').click();
  await expect(page.locator('[data-help-badge]')).toBeHidden();
  await open(page); await expect(page.locator('[data-help-tasks]')).toContainText('対応が必要な項目はありません');
});
test('optional detailed guidance returns to its basic guide', async ({ page }) => {
  await login(page); await page.goto('/Portfolio/edit'); await basic(page);
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('プロフィールを入力する');
  await page.locator('[data-help-detail]').click();
  await page.locator('[data-help-selection-content] button').filter({ hasText: '自己紹介の装飾' }).click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('自己紹介を編集する');
  await advanceTo(page, '[data-intro-command="bold"]');
  await advanceTo(page, '[data-intro-command="italic"]');
  await advanceTo(page, '[data-intro-command="underline"]');
  await advanceTo(page, '[data-intro-color]');
  await advanceTo(page, '#submit-button');
  await page.locator('[data-help-next]').click();
  await expect(page.locator('[data-help-step-title]')).toHaveText('プロフィールを入力する');
});
test('SVG canvas is highlighted and help stays usable inside an editor dialog', async ({ page }, info) => {
  await login(page, 'planner');
  const index = ['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1;
  await page.goto(`/Member/manage/exhibitions/f2000000-0000-4000-8000-00000000000${index}/layout`);
  await open(page); await page.locator('#help-query').fill('展示レイアウトの基本');
  await page.locator('#help-search-results button').first().click();
  await expect(page.locator('.room-edit-dialog')).toBeVisible();
  await expect(page.locator('[data-help-open]')).toHaveCSS('border-radius', '50%');
  await expect(page.locator('[data-help-open] svg')).toHaveCSS('width', '32px');
  await expect(page.locator('[data-layout-canvas]')).toHaveClass(/help-target/);
  await expect(page.locator('.room-edit-dialog [data-help-tour]')).toBeVisible();
  await expect(page.locator('.room-edit-dialog .help-marker')).toBeVisible();
  await page.screenshot({ path: info.outputPath('help-layout-active.png'), fullPage: true, animations: 'disabled' });
  await page.locator('[data-help-hide]').click(); await expect(page.locator('[data-help-arrow]')).toBeHidden();
  await open(page); await page.locator('[data-help-resume]').click();
  await expect(page.locator('[data-layout-canvas]')).toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click(); await expect(page.locator('.room-edit-dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('help-layout-dialog.png'), fullPage: true, animations: 'disabled' });
});
test('closing while Next checks completion cannot restart or crash the finished guide', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/Contact'); await basic(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/help/context?*', async route => { await gate; await route.continue(); });
  const requested = page.waitForRequest(r => new URL(r.url()).pathname === '/api/help/context');
  await page.locator('[data-help-next]').click(); await requested;
  await page.locator('[data-help-stop]').click(); release();
  await page.unrouteAll({ behavior: 'wait' });
  await open(page); await expect(page.locator('[data-help-resume-box]')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('scharade-help-tour-v1'))).toBeNull();
  expect(errors).toEqual([]);
});
test('logging out clears a hidden private guide before a public page is displayed', async ({ page }) => {
  await login(page); await page.goto('/Member'); await basic(page);
  await page.locator('[data-help-hide]').click();
  expect(await page.evaluate(() => sessionStorage.getItem('scharade-help-tour-v1'))).not.toBeNull();
  expect((await page.request.post('/api/auth/logout', { headers })).ok()).toBe(true);
  await page.goto('/Contact'); await open(page);
  await expect(page.locator('[data-help-resume-box]')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('scharade-help-tour-v1'))).toBeNull();
});
