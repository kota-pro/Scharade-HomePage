import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fixtureLogin, restoreFixtureRoster } from './fixture-auth';
const headers = { Origin: 'http://127.0.0.1:4329' };
async function login(page: any, user: string) {
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `${user}@example.invalid`, password: 'fixture-password-123' } })).status()).toBe(200);
}

test('Portfolio preserves saved grades on every visit and supports doctoral saving and listing', async ({ page }, info) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await login(page, 'admin'); await restoreFixtureRoster(page.request);
  for (const portfolioId of ['admin', 'member', 'other']) {
    expect((await page.request.post('/api/portfolio/update', { headers, data: { portfolioId, grade: '1st Grade' } })).status()).toBe(200);
  }
  const { directory } = JSON.parse(fs.readFileSync('.data/browser-fixture-path.json', 'utf8'));
  if (!directory.startsWith(path.join(os.tmpdir(), 'scharade-browser-'))) throw new Error('Synthetic fixture required');
  const file = path.join(directory, 'member-activities.json'), before = fs.readFileSync(file);
  const data = JSON.parse(before.toString());
  for (const [index, user, grade] of [[0, 'admin', 'master'], [1, 'member', 'doctorate'], [2, 'other', '3']] as const) {
    const record = data.roster.records[index]; record.grade = grade;
    data.roster.bindings[user] = record.key;
  }
  fs.writeFileSync(file, JSON.stringify(data));
  try {
    await page.goto('/Portfolio/edit?id=other');
    await expect(page.locator('#field-grade')).toHaveValue('1st Grade');
    await page.goto('/Portfolio/edit');
    await expect(page.locator('#field-grade')).toHaveValue('1st Grade');
    await login(page, 'member'); await page.goto('/Portfolio/edit');
    const select = page.locator('#field-grade');
    await expect(select).toHaveValue("1st Grade");
    const values = await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    expect(values[values.indexOf("Master's Program") + 1]).toBe("Doctor's Program");
    await expect(page.locator('.helper').filter({ hasText: '保存した学年' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await select.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('portfolio-roster-grade.png') });
    const saved = await page.request.post('/api/portfolio/update', { headers, data: { grade: "Doctor's Program" } });
    expect(saved.status(), await saved.text()).toBe(200);
    await page.goto('/Portfolio');
    const section = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Doctor's Program$/ }) });
    await expect(section.locator('.member-card[href="/Portfolio/member"]')).toHaveCount(1);
    // A different linked grade never overrides a saved manual selection on repeated visits.
    data.roster.records[1].grade = 'master'; fs.writeFileSync(file, JSON.stringify(data));
    for (let visit = 0; visit < 2; visit++) {
      await page.goto('/Portfolio/edit'); await expect(select).toHaveValue("Doctor's Program");
    }
    // No linked record: retain the saved CMS value.
    delete data.roster.bindings.member; fs.writeFileSync(file, JSON.stringify(data));
    await page.goto('/Portfolio/edit'); await expect(select).toHaveValue("Doctor's Program");
    const response = await page.request.get('/Portfolio/edit?id=other'); expect(response.status()).toBe(403);
  } finally { fs.writeFileSync(file, before); }
});

test('event, general and exhibition notification filters omit fifth and sixth years', async ({ page }, info) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await login(page, 'planner');
  for (const url of ['/Member/manage/events/new', '/Member/manage/notifications']) {
    await page.goto(url);
    const filter = page.locator('select[data-recipient-grade]');
    await expect(filter).toHaveCount(1);
    await expect(filter.locator('option[value="5"],option[value="6"]')).toHaveCount(0);
    await expect(filter.locator('option[value="doctorate"]')).toHaveCount(1);
  }
  const created = await page.request.post('/api/member/exhibitions', { headers, data: { action: 'create', title: `通知学年 ${info.project.name}` } });
  expect(created.status()).toBe(200);
  const { exhibition } = await created.json();
  await page.goto(`/Member/manage/exhibitions/${exhibition.id}`);
  const filter = page.locator('select[data-recipient-grade]');
  await expect(filter.locator('option[value="5"],option[value="6"]')).toHaveCount(0);
  await expect(filter.locator('option[value="doctorate"]')).toHaveCount(1);
  await filter.selectOption('doctorate');
  await page.getByRole('button', { name: 'この学年を選択', exact: true }).click();
  await expect(filter).toHaveValue('doctorate');
});
