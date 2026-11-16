import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixtureLogin } from './fixture-auth';

const origin = 'http://127.0.0.1:4329';
function directory() {
  const value = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8')).directory;
  if (!value.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))) throw new Error('Synthetic mailbox required');
  return value as string;
}
function messages(code: string) {
  const file = path.join(directory(), 'synthetic-error-reports.json');
  return (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []).filter((mail: any) => mail.subject.endsWith(code));
}
function savedReports(code: string) {
  const file = path.join(directory(), 'site-error-reports.json');
  return (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).reports : []).filter((entry: any) => entry.report.code === code);
}
async function show(page: Page, code: string, content = '入力を確認してください。') {
  await page.evaluate(({ code, content }) => { const el = document.createElement('p'); el.className = 'error'; el.textContent = `エラー番号：${code}\n${content}`; document.querySelector('main')!.append(el); }, { code, content });
}
test.beforeEach(async ({ page }) => {
  // Each browser must produce its own evidence rather than inheriting a previous engine's mail.
  for (const [name, value] of [['site-error-reports.json', { version: 1, reports: [], deliveries: [] }], ['synthetic-error-reports.json', []]] as const) {
    const file = path.join(directory(), name), temporary = file + '.reset'; fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, file);
  }
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
test('visible input mistakes and native validation never submit a report, even after reload', async ({ page }) => {
  const submissions: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/error-reports')) submissions.push(request.postData() ?? ''); });
  await page.goto('/Login?token=private-url-token#private-fragment');
  await page.locator('#login-email').fill('private-person@example.invalid'); await page.locator('#login-password').fill('private-password');
  await show(page, 'EXH-021', 'private-form-input private-person@example.invalid');
  await page.evaluate(() => { const label = document.createElement('label'); label.textContent = 'private-label'; const input = document.createElement('input'); input.required = true; label.append(input); document.querySelector('main')!.append(label); input.reportValidity(); });
  await expect(page.locator('input[required]').last()).toHaveJSProperty('validationMessage', 'エラー番号：SITE-001\nprivate-labelを入力してください。');
  await page.reload(); await show(page, 'EXH-021'); await expect(page.locator('p.error').last()).toContainText('EXH-021');
  expect(submissions).toHaveLength(0); expect(savedReports('EXH-021')).toHaveLength(0); expect(messages('SITE-001')).toHaveLength(0);
});
test('credential mismatches and login rate limits retain their API number without mail', async ({ page }, info) => {
  await page.goto('/Login');
  const email = `wrong-${info.project.name}-${Date.now()}@example.invalid`, ip = `192.0.2.${30 + ['chromium','firefox','webkit'].indexOf(info.project.name)}`;
  for (let index = 0; index < 6; index++) {
    const response = await page.request.post('/api/auth/login', { headers: { Origin: origin, 'X-Real-IP': ip }, data: { email, password: 'private-wrong-password' } });
    const body = await response.json();
    expect(response.status()).toBe(index < 5 ? 400 : 429);
    expect(body.errorCode).toBe(index < 5 ? 'SITE-016' : 'SITE-008');
    expect(body.message).toContain(index < 5 ? 'メールアドレスまたはパスワードが間違っています。' : '15分後');
    await show(page, body.errorCode, body.message.split('\n').slice(1).join('\n'));
    await expect(page.locator('p.error').last()).toHaveText(body.message);
  }
  expect(messages('SITE-016')).toHaveLength(0); expect(messages('SITE-008')).toHaveLength(0);
});
test('a real server failure emails exactly the public explanation and repeated display sends no duplicate', async ({ page }) => {
  const headers = { Origin: origin };
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: 'member@example.invalid', password: 'fixture-password-123' } })).ok()).toBe(true);
  await page.goto('/Errors');
  const file = path.join(directory(), 'member-activities.json'), previous = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  try {
    fs.writeFileSync(file, '{synthetic-corrupt-data');
    const response = await page.request.get('/api/member/activities'); expect(response.status()).toBe(503);
    const body = await response.json(); expect(body.errorCode).toBe('SITE-011');
    await expect.poll(() => messages('SITE-011').length).toBe(1);
    const mail = messages('SITE-011')[0]; expect(mail.to).toBe('contact@scharade.jp');
    expect(mail.text).toContain(`エラー内容：${body.message.split('\n').slice(1).join('\n')}`);
    expect(mail.text).toContain('/api/member/activities'); expect(mail.text).not.toMatch(/synthetic-corrupt|member@example|session=/);
    await show(page, body.errorCode, body.message.split('\n').slice(1).join('\n'));
    await page.reload(); expect(messages('SITE-011')).toHaveLength(1);
  } finally { if (previous) fs.writeFileSync(file, previous); else fs.rmSync(file, { force: true }); }
});
test('unexpected browser bugs report only fixed diagnostics; aborted requests and offline errors do not', async ({ page, context }) => {
  await page.goto('/Errors');
  await page.evaluate(() => { window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new DOMException('private-abort', 'AbortError') })); });
  expect(messages('SITE-010')).toHaveLength(0);
  await context.setOffline(true);
  await show(page, 'EXH-008', 'private-photo-name.jpg');
  expect(await page.evaluate(() => sessionStorage.getItem('scharade:error-reports:v1'))).toBeNull();
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.route('**/synthetic-runtime-bug.js', route => route.fulfill({ contentType: 'text/javascript', body: "setTimeout(() => { throw new TypeError('private-runtime-input'); }, 0);" }));
  await page.addScriptTag({ url: origin + '/synthetic-runtime-bug.js' });
  await expect.poll(() => messages('SITE-010').length).toBe(1);
  expect(messages('SITE-010')[0].text).toContain('TypeError'); expect(messages('SITE-010')[0].text).not.toContain('private-runtime-input');
});
test('all API route denials return a matching number in JSON and headers without sending mail', async ({ page }) => {
  const files = fs.readdirSync('src/pages/api', { recursive: true }).filter(file => String(file).endsWith('.ts'));
  for (const file of files) {
    const url = '/api/' + String(file).replace(/\.ts$/, '').replace(/\[[^\]]+\]/g, 'missing');
    const response = await page.request.post(url, { headers: { Origin: 'https://outside.invalid' }, data: {} });
    expect([401,403], url).toContain(response.status());
    const body = await response.json(); expect(body.message, url).toMatch(new RegExp(`^エラー番号：${body.errorCode}\\n`));
    expect(response.headers()['x-error-code'], url).toBe(body.errorCode);
  }
  expect(messages('SITE-002')).toHaveLength(0); expect(messages('SITE-003')).toHaveLength(0);
});
test('an own-script bug occurring offline is safely retained and reported after reconnect, while fetch rejections are ignored', async ({ page, context }) => {
  await page.goto('/Errors');
  await page.route('**/synthetic-promise-bug.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.addEventListener('synthetic-bug', () => { void Promise.reject(new Error('private-promise-input')); }); window.addEventListener('synthetic-network', () => { void Promise.reject(new TypeError('Failed to fetch')); });" }));
  await page.addScriptTag({ url: origin + '/synthetic-promise-bug.js' });
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-network')));
  await context.setOffline(true); await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-bug')));
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('scharade:error-reports:v1') ?? '')).toContain('SITE-010');
  const saved = await page.evaluate(() => sessionStorage.getItem('scharade:error-reports:v1')); expect(saved).not.toContain('private-');
  expect(messages('SITE-010')).toHaveLength(0);
  await context.setOffline(false); await expect.poll(() => messages('SITE-010').length).toBe(1);
  expect(messages('SITE-010')[0].text).toContain('例外の種類：Error');
  expect(messages('SITE-010')[0].text).not.toContain('private-promise-input');
});
test('font HTTP failures report the status and resource while the form can still submit', async ({ page }, info) => {
  const headers = { Origin: origin };
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: 'member@example.invalid', password: 'fixture-password-123' } })).ok()).toBe(true);
  const index = ['chromium','firefox','webkit'].indexOf(info.project.name) + 1, endpoint = `/api/exhibitions/f1000000-0000-4000-8000-00000000000${index}`;
  const begun = await (await page.request.post(endpoint, { headers, data: { action: 'begin' } })).json(), sectionId = begun.schema.sections[0].id;
  const content = { ...begun.submission.draft, name: '作者', authorName: '作者', grade: '2年', sections: [{ sectionId, singles: 0, series: 0, books: 1, seriesPhotoCounts: [], fields: {} }], works: [{ id: crypto.randomUUID(), sectionId, kind: 'book', title: '光', caption: 'private-caption', location: '', equipment: '', settings: '', photos: [], fields: {} }] };
  expect((await page.request.post(endpoint, { headers, data: { action: 'save', revision: begun.submission.revision, content } })).status()).toBe(200);
  await page.route('**/fonts/zen-old-mincho/ZenOldMincho-Regular.ttf', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(endpoint.replace('/api/exhibitions/', '/Exhibition/'));
  await expect.poll(() => messages('EXH-022').filter((mail: any) => mail.text.includes('font-regular')).length).toBe(1);
  const mail = messages('EXH-022').find((mail: any) => mail.text.includes('font-regular'));
  expect(mail.text).toContain('HTTP状態：404'); expect(mail.text).not.toContain('private-caption');
  await page.locator('[data-work-key="caption"]').fill('短い説明');
  await page.locator('[data-submit]').click(); await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  expect(messages('EXH-022').filter((mail: any) => mail.text.includes('font-regular'))).toHaveLength(1);
});
