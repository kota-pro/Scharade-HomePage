import { test, expect, type Page, type Route } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';

const headers = { Origin: 'http://127.0.0.1:4329' };
const login = async (page: Page, name: string) => expect((await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: `${name}@example.invalid`, password: 'fixture-password-123' } })).ok()).toBe(true);

async function setup(page: Page, title: string) {
  await login(page, 'planner');
  const command = async (data: unknown) => {
    const response = await page.request.post('/api/member/exhibitions', { headers, data });
    expect(response.ok(), await response.text()).toBe(true); return (await response.json()).exhibition;
  };
  let exhibition = await command({ action: 'create', title, openingSchedule: { startDate: '2027-01-05', endDate: '2027-01-05', regular: { open: '10:00', close: '12:00' } } });
  const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
  exhibition = await command({ action: 'settings', exhibitionId: exhibition.id, revision: exhibition.revision, title, status: 'open', gallery: 'staff', voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), opensAt: iso(-60000), closesAt: iso(3600000), recipientIds: ['member'] });
  await command({ action: 'participation.publish', exhibitionId: exhibition.id, revision: exhibition.revision });
  await expect.poll(async () => (await (await page.request.get(`/api/member/exhibitions/${exhibition.id}`)).json()).exhibition.participation.state).toBe('published');
  const endpoint = `/api/member/exhibitions/${exhibition.id}/shifts`;
  const get = async () => (await page.request.get(endpoint)).json();
  const action = async (body: Record<string, unknown>) => {
    const data = await get(), response = await page.request.post(endpoint, { headers, data: { revision: data.record.revision, ...body } });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  await action({ action: 'settings', config: { state: 'open', opensAt: iso(-60000), closesAt: iso(3600000), rules: { together: [], apart: [['activity-0', 'activity-5']] } } });
  const initial = await get(), slot = initial.slots[0].id;
  for (const name of ['other', 'activity-0', 'activity-1', 'activity-2', 'activity-3', 'activity-4', 'activity-5']) {
    await login(page, name);
    const state = await (await page.request.get(`/api/exhibitions/${exhibition.id}/shifts`)).json();
    const response = await page.request.post(`/api/exhibitions/${exhibition.id}/shifts`, { headers, data: { action: name === 'activity-3' ? 'save' : 'submit', ownerId: name, scheduleKey: state.scheduleKey, revision: 0, content: { none: name === 'activity-4', slotIds: name === 'activity-4' ? [] : [name === 'activity-2' ? state.slots[1].id : slot] } } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await login(page, 'planner');
  const assignments = ['other', 'activity-0'].map(personId => ({ id: `replacement-${personId}`, personId, slotId: slot, manual: true, fixed: true }));
  const data = await get();
  await action({ action: 'plan.save', planRevision: data.record.plan.revision, assignments });
  const saved = await get();
  await action({ action: 'publish', planRevision: saved.record.plan.revision, confirmMissing: true });
  await page.goto(`/Member/manage/exhibitions/${exhibition.id}/shifts`);
  await page.getByRole('tab', { name: 'シフト表', exact: true }).click();
  return { get, action, slot, assignments, endpoint };
}

test('change icon replaces only with another applicant, preserves answers/publication, and rejects a stale edit', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const f = await setup(page, `担当者変更 ${info.project.name}`), before = await f.get();
  const change = page.locator('[data-replace="replacement-other"]');
  await page.locator('[data-help-open]').click();
  await page.locator('#help-query').fill('シフトを差し替え');
  await page.locator('#help-search-results').getByRole('button', { name: /シフトの担当者を希望者から変更する/ }).click();
  await expect(page.locator('[data-replace].help-target')).toBeVisible();
  await change.click();
  const popup = page.locator('dialog[data-shift-replacement]');
  await page.locator('[data-help-next]').click();
  await expect(popup.locator('[data-replacement-search]')).toHaveClass(/help-target/);
  await page.locator('[data-help-stop]').click();
  await expect(popup.locator('[data-replacement-person]')).toHaveCount(2);
  await expect(popup.locator('[data-replacement-person="activity-5"]')).toBeDisabled();
  for (const excluded of ['other', 'activity-0', 'activity-2', 'activity-3', 'activity-4']) await expect(popup.locator(`[data-replacement-person="${excluded}"]`)).toHaveCount(0);
  await popup.locator('[data-replacement-search]').fill('activity-1');
  await expect(popup.locator('[data-replacement-person]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('replacement-desktop.png'), fullPage: true });
  await popup.locator('.shift-close').click();
  expect((await f.get()).record.plan).toEqual(before.record.plan);
  await change.focus(); await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await popup.locator('[data-replacement-person="activity-1"]').click();
  await expect(popup).toHaveCount(0);
  let current = await f.get();
  expect(current.record.plan.assignments).toEqual([{ ...f.assignments[0], personId: 'activity-1' }, f.assignments[1]]);
  expect(current.record.responses).toEqual(before.record.responses);
  expect(current.record.published).toEqual(before.record.published);
  await page.reload(); await page.getByRole('tab', { name: 'シフト表', exact: true }).click();
  await expect(page.locator('[data-seat="replacement-other"]')).toContainText('activity-1');
  // A generation status poll may refresh the page's data while the picker stays open.
  let backgroundRefreshes = 0;
  const backgroundRefresh = async (route: Route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch(), body = await response.json();
    body.record.job = { id: 'synthetic-generation', state: 'running' };
    await route.fulfill({ response, json: body }); backgroundRefreshes++;
  };
  await page.route(`**${f.endpoint}`, backgroundRefresh);
  await change.click(); await expect(popup).toBeVisible();
  current = await f.get();
  await f.action({ action: 'plan.save', planRevision: current.record.plan.revision, assignments: current.record.plan.assignments.map((a: any) => ({ ...a, fixed: false })) });
  const concurrent = (await f.get()).record.plan;
  await expect.poll(() => backgroundRefreshes).toBeGreaterThan(1);
  await popup.locator('[data-replacement-person="other"]').click();
  await expect(page.getByText('別の操作でシフトが更新されました。', { exact: false })).toBeVisible();
  expect((await f.get()).record.plan).toEqual(concurrent);
  await page.unrouteAll({behavior:'wait'});
  await popup.locator('.shift-close').click();
  await change.click(); await expect(popup).toBeVisible();
  await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0);
  await expect(change).toBeFocused();
  expect(errors).toEqual([]);
});

test.describe('touch replacement', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  test('long press opens applicants; a short tap and a scrolling gesture do not', async ({ page }, info) => {
    test.setTimeout(120000);
    const f = await setup(page, `長押し担当者変更 ${info.project.name}`);
    const seat = page.locator('[data-seat="replacement-other"]'), popup = page.locator('dialog[data-shift-replacement]');
    const down = () => seat.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 81, isPrimary: true, clientX: 120, clientY: 300, bubbles: true });
    await seat.tap(); await expect(seat).toHaveAttribute('aria-pressed', 'true');
    await expect(popup).toHaveCount(0);
    await down();
    await seat.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 81, isPrimary: true, clientX: 145, clientY: 300, bubbles: true });
    await page.waitForTimeout(650); await expect(popup).toHaveCount(0);
    await seat.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 81, isPrimary: true, bubbles: true });
    await down(); await expect(popup).toBeVisible();
    await page.dispatchEvent('body', 'pointerup', { pointerType: 'touch', pointerId: 81, isPrimary: true, bubbles: true });
    await popup.locator('[data-replacement-person="activity-1"]').tap();
    await expect(popup).toHaveCount(0);
    expect((await f.get()).record.plan.assignments[0].personId).toBe('activity-1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('replacement-mobile.png'), fullPage: true });
  });
});
