import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';

const origin = 'http://127.0.0.1:4329', headers = { Origin: origin };
const phoneWidths = [320, 375, 390, 430, 768];

test('filled exhibition dates save in Japan time and each period fits its card on phones', async ({ browser, browserName }, info) => {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: browserName !== 'firefox', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  try {
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    expect((await fixtureLogin(context.request, '/api/auth/login', { headers, data: { email: 'planner@example.invalid', password: 'fixture-password-123' } })).status()).toBe(200);
    const title = 'Exhibition-2026-' + 'PhotographyReception'.repeat(6);
    const created = await context.request.post('/api/member/exhibitions', { headers, data: { action: 'create', title } });
    expect(created.status()).toBe(200);
    const { exhibition } = await created.json();
    const url = `/Member/manage/exhibitions/${exhibition.id}`;
    await page.goto(url);
    const year = new Date().getUTCFullYear() + 1;
    const values = { voteOpensAt: `${year}-11-01T09:30`, voteClosesAt: `${year}-11-30T23:59`, opensAt: `${year}-11-02T10:00`, closesAt: `${year}-12-01T23:59` };
    for (const [key, value] of Object.entries(values)) await page.locator(`[data-setting="${key}"]`).fill(value);
    await page.locator('[data-exhibition-recipient="member"]').check();
    for (const width of phoneWidths) {
      await page.setViewportSize({ width, height: 844 });
      for (const key of Object.keys(values)) {
        const input = page.locator(`[data-setting="${key}"]`);
        const box = (await input.boundingBox())!;
        // Full-width fields leave space for native iOS date text and the picker affordance.
        expect(box.width).toBeGreaterThanOrEqual(width - 36);
        expect(box.x).toBeGreaterThanOrEqual(15);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 15);
        await expect(input).toHaveValue(values[key as keyof typeof values]);
        expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-setting="voteOpensAt"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('exhibition-reception-mobile.png') });
    await page.locator('[data-save-settings]').click();
    await expect(page.locator('.exhibition-status')).toContainText('受付設定を保存しました');
    const saved = (await (await context.request.get(`/api/member/exhibitions/${exhibition.id}`)).json()).exhibition;
    expect(saved.participation.opensAt).toBe(`${year}-11-01T00:30:00.000Z`);
    expect(saved.participation.closesAt).toBe(`${year}-11-30T14:59:00.000Z`);
    expect(saved.opensAt).toBe(`${year}-11-02T01:00:00.000Z`);
    expect(saved.closesAt).toBe(`${year}-12-01T14:59:00.000Z`);
    const published = await context.request.post('/api/member/exhibitions', { headers, data: { action: 'participation.publish', exhibitionId: exhibition.id, revision: saved.revision, body: '合成データによる日時表示の確認です。' } });
    expect(published.status()).toBe(200);
    await expect.poll(async () => (await (await context.request.get(`/api/member/exhibitions/${exhibition.id}`)).json()).exhibition.participation.state).toBe('published');
    expect((await fixtureLogin(context.request, '/api/auth/login', { headers, data: { email: 'member@example.invalid', password: 'fixture-password-123' } })).status()).toBe(200);
    await page.goto(`/Member/exhibitions/${exhibition.id}`);
    await expect(page.locator('.exhibition-period time')).toHaveCount(4);
    for (const width of phoneWidths) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const periods = await page.locator('.exhibition-period').evaluateAll(els => els.map(el => {
        const panel = el.closest('.exhibition-panel')!.getBoundingClientRect();
        return [...el.querySelectorAll('time')].every(time => {
          const range = document.createRange(); range.selectNodeContents(time);
          return [...range.getClientRects()].every(box => box.left >= panel.left + 12 && box.right <= panel.right - 12);
        });
      }));
      expect(periods).toEqual([true, true]);
      const buttons = await page.locator('[data-exhibition-answer]').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { y: r.y, width: r.width }; }));
      expect(new Set(buttons.map(b => b.y)).size).toBe(1);
      expect(Math.max(...buttons.map(b => b.width)) - Math.min(...buttons.map(b => b.width))).toBeLessThan(1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('member-reception-mobile.png') });
  } finally { await context.close(); }
});

test('long names and URLs wrap inside shared account and event content on phones', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: 'admin@example.invalid', password: 'fixture-password-123' } })).status()).toBe(200);
  for (const route of ['/Member/advance', '/Admin/accounts', '/Admin/accounts/other', '/Member/manage/events/new']) {
    await page.goto(route);
    // Use unbroken data rather than only short fixture labels.
    await page.locator('.admin-page').evaluate(root => {
      const target = root.querySelector('#advance-account, .admin-account-row h3 a, .admin-account-details dd, .activity-field-hint');
      if (!target) throw new Error('Expected real content container');
      target.textContent = 'LongNameAndPortfolioURL'.repeat(12);
      target.setAttribute('data-overflow-example', '');
    });
    for (const width of phoneWidths) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route}: ${width}`).toBe(true);
      expect(await page.locator('[data-overflow-example]').evaluate(el => {
        const container = el.closest('.advance-account-row, .admin-account-row, .admin-account-details, .activity-form')!.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(el);
        return [...range.getClientRects()].every(box => box.left >= container.left && box.right <= container.right);
      }), `${route}: text must fit its own card`).toBe(true);
      for (const input of await page.locator('input[type="datetime-local"]').all()) {
        await input.fill('2026-11-30T23:59');
        const rect = (await input.boundingBox())!;
        expect(rect.x + rect.width).toBeLessThanOrEqual(width - 15);
        expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
  }
});
