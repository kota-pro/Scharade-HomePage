import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';
import { addShape } from './layout-tools-helper';

const headers = { Origin: 'http://127.0.0.1:4329' };
test('central overview shows the saved floor scene, fits mobile, switches rooms and refreshes after editing', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await fixtureLogin(page.request, '/api/auth/login', { headers, data: { email: 'planner@example.invalid', password: 'fixture-password-123' } });
  const id = `f2000000-0000-4000-8000-00000000000${['chromium', 'firefox', 'webkit'].indexOf(info.project.name) + 1}`;
  const state = async () => (await (await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
  const data = await (await page.request.get(`/api/member/exhibitions/${id}`)).json(), r = data.exhibition.rooms[0];
  r.vertices[0].radius = 250;
  r.placements = [{ workId: data.submissions[0].content.works[0].id, wall: 0, x: 1200, bottom: 1000, rotation: 0 }];
  r.openings = [{ id: crypto.randomUUID(), kind: 'door', wall: 0, offset: 3000, width: 900, bottom: 0, height: 2000 }];
  r.tables = [{ id: crypto.randomUUID(), name: '受付', x: 4200, y: 2700, width: 900, depth: 600, rotation: 0 }];
  r.boardGroups = [{ id: crypto.randomUUID(), name: '連結展示ボード', x: 1500, y: 1800, rotation: 0, panels: [0, 1].map(i => ({ id: crypto.randomUUID(), name: `パネル${i + 1}`, width: 900, height: 1800, thickness: 30, hingeAngle: i ? 45 : 0 })) }];
  r.annotations = [false, true].map(hidden => ({ id: crypto.randomUUID(), kind: 'power', x: hidden ? 2000 : 1000, y: 3000, width: 200, height: 300, rotation: 0, fontSize: 100, text: '' }));
  r.editor = { order: [], hidden: [`annotation:${r.annotations[1].id}`], locked: [], groups: [] };
  const second = { ...structuredClone(r), id: crypto.randomUUID(), name: '別の展示室', placements: [], tables: [], openings: [], annotations: [], boardGroups: [], editor: {order: [], hidden: [], locked: [], groups: []} };
  const setup = await page.request.post('/api/member/exhibitions', { headers, data: { action: 'rooms', exhibitionId: id, revision: data.exhibition.revision, rooms: [r, second] } });
  expect(setup.ok(), await setup.text()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/Member/manage/exhibitions/${id}/layout`);
  const preview = page.locator('.room-summary-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-preview-layout-kind="work"]')).toHaveCount(1);
  await expect(preview.locator('[data-preview-layout-kind="opening"]')).toHaveCount(1);
  await expect(preview.locator('[data-preview-layout-kind="table"]')).toHaveCount(1);
  await expect(preview.locator('[data-preview-layout-kind="annotation"]')).toHaveCount(1);
  await expect(preview.locator('[data-preview-board-panel]')).toHaveCount(2);
  const boundary = await preview.locator('[data-preview-layout-room-boundary]').getAttribute('d');
  expect(boundary).toMatch(/[ACQ]/);
  const saved = await state();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => preview.evaluate(svg => {
      const frame = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('[data-preview-layout-room-boundary],[data-preview-layout-kind],text')].every(el => {
        const box = el.getBoundingClientRect();
        return box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
      });
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    await preview.screenshot({ path: `/private/tmp/exhibition-room-preview-20261014/preview-${info.project.name}-${width}.png` });
  }
  expect(await state()).toEqual(saved);
  await page.locator('[data-room-select="1"]').click();
  await expect(preview.locator('[data-preview-layout-kind]')).toHaveCount(0);
  await page.locator('[data-room-select="0"]').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-open-room-editor="floor"]').click();
  expect(await page.locator('[data-layout-room-boundary]').getAttribute('d')).toBe(boundary);
  await expect(page.locator('[data-layout-kind="board"]')).toHaveCount(1);
  await addShape(page, 'rect', 3000, 2500);
  await page.locator('[data-room-modal-close]').click();
  await expect(page.locator('.room-edit-dialog')).not.toBeVisible();
  await expect(preview.locator('[data-preview-layout-kind="annotation"]')).toHaveCount(2);
  await page.reload();
  await expect(preview.locator('[data-preview-layout-kind="annotation"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
