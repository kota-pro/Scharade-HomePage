import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';

test('login errors include the API number, readable instructions, and do not number progress text', async ({ page }) => {
  await page.goto('/Login');
  await page.locator('#login-email').fill('member@example.invalid');
  await page.locator('#login-password').fill('wrong-password-123');
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.locator('#login-form button[type="submit"]').click();
  const body = await (await response).json();
  await expect(page.locator('#login-message')).toContainText(`エラー番号：${body.errorCode}`);
  await expect(page.locator('#login-message')).toContainText('パスワード');
  await expect(page.locator('#login-message')).not.toContainText('JSON');
});
test('initial, dynamic and structured errors are numbered while links, inputs and ordinary text survive', async ({ page }) => {
  await page.goto('/Errors'); await expect(page.locator('#SITE-001')).toBeVisible();
  await page.evaluate(() => {
    const host = document.createElement('section'); host.id = 'test-errors'; host.innerHTML = '<p class="error">識別番号を確認してください。</p><p data-error="true">通信できませんでした。もう一度お試しください。</p><p role="alert">保存できませんでした。<a href="/Contact">お問い合わせ</a></p><p id="ordinary">通信エラーの仕組みを説明する記事です。</p><p id="progress" data-kind="progress">保存しています…</p><label>作品数<input id="test-required" required></label><label>写真の幅<input id="test-range" type="number" max="10" value="11"></label><div role="alert"><ul><li class="error">名前を入力してください。</li></ul></div>'; document.querySelector('main')!.append(host);
  });
  const host = page.locator('#test-errors');
  await expect(host.locator('p.error')).toContainText('エラー番号：SITE-010');
  await expect(host.locator('p.error')).not.toContainText('識別番号');
  await expect(host.locator('[data-error="true"]')).toContainText('SITE-012');
  await expect(host.locator('p[role="alert"]')).toContainText('エラー番号：');
  await expect(host.getByRole('link', { name: 'お問い合わせ' })).toHaveAttribute('href', '/Contact');
  await expect(host.locator('li')).toContainText('SITE-001');
  await expect(host.locator('#ordinary')).not.toContainText('エラー番号'); await expect(host.locator('#progress')).not.toContainText('エラー番号');
  await host.locator('#test-required').evaluate((field: HTMLInputElement) => field.reportValidity());
  expect(await host.locator('#test-required').evaluate((field: HTMLInputElement) => field.validationMessage)).toContain('エラー番号：SITE-001');
  expect(await host.locator('#test-required').evaluate((field: HTMLInputElement) => field.validationMessage)).toContain('作品数を入力してください');
  await host.locator('#test-range').evaluate((field: HTMLInputElement) => field.reportValidity());
  expect(await host.locator('#test-range').evaluate((field: HTMLInputElement) => field.validationMessage)).toContain('写真の幅は10以下');
  await host.locator('#test-required').fill('入力済み'); expect(await host.locator('#test-required').evaluate((field: HTMLInputElement) => field.checkValidity())).toBe(true);
  await host.locator('p.error').evaluate(el => { el.classList.remove('error'); el.textContent = '保存しました。'; });
  await expect(host.locator('p').first()).toHaveText('保存しました。');
});
test('public error pages and support mapping are available without login and fit mobile screens', async ({ page }, info) => {
  await page.goto('/does-not-exist'); await expect(page.getByRole('alert')).toContainText('SITE-006');
  await page.goto('/503'); await expect(page.getByRole('alert')).toContainText('SITE-011');
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/Errors');
  await expect(page.locator('#EXH-001')).toContainText('提出する写真の枚数分');
  await expect(page.locator('#EXH-021')).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('error-guide-mobile.png') });
});
test('middleware denials are numbered before feature handlers, and member inline errors retain input', async ({ page }) => {
  const unauth = await page.request.get('/api/member/activities'); expect(unauth.status()).toBe(401); expect((await unauth.json()).errorCode).toBe('SITE-002');
  const headers = { Origin: 'http://127.0.0.1:4329' };
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: 'member@example.invalid', password: 'fixture-password-123' } })).ok()).toBe(true);
  const denied = await page.request.post('/api/member/activities', { headers: { Origin: 'https://wrong.invalid' }, data: { action: 'event.save' } });
  expect(denied.status()).toBe(403); expect((await denied.json()).errorCode).toBe('SITE-003');
  await page.goto('/Portfolio/edit');
  await expect(page.locator('#portfolio-form')).toBeVisible();
  await page.route('**/api/portfolio/update', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, errorCode: 'SITE-011', message: '現在、保存できませんでした。時間をおいて再度お試しください。' }) }));
  const name = page.locator('#field-name'); await name.fill('保存失敗でも残す名前');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-button').click();
  await expect(page.locator('#status-message')).toContainText('SITE-011'); await expect(name).toHaveValue('保存失敗でも残す名前');
});
