import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
import { addShape, openRoomCreation, clickLayout, outputSvgText } from "./layout-tools-helper";
const headers = { Origin: "http://127.0.0.1:4329" };
async function login(page: Page, email = "planner@example.invalid") {
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email, password: "fixture-password-123" } })).ok()).toBe(true);
}
async function create(page: Page, title: string) {
  await login(page); await page.setViewportSize({ width: 1440, height: 1000 });
  const id = (await (await page.request.post("/api/member/exhibitions", { headers, data: { action: "create", title } })).json()).exhibition.id;
  await page.goto(`/Member/manage/exhibitions/${id}/layout`);
  await expect(page.locator("#exhibition-admin [data-room-add]")).toHaveCount(0);
  await page.locator('[data-open-room-editor="floor"]').click(); await page.locator("[data-room-add]").click();
  return id as string;
}
async function move(page: Page, x: number, y: number) {
  const point = await page.locator("[data-layout-canvas]").evaluate((svg, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: q.x, y: q.y }; }, { x, y });
  await page.mouse.move(point.x, point.y);
}
const state = async (page: Page, id: string) => (await (await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;

test("manual shape sizes and floor opening previews match their eventual placement; panels scroll independently", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const id = await create(page, `表示整理 ${info.project.name}`), canvas = page.locator("[data-layout-canvas]");
  await page.locator('[data-layout-tool="shapes"]').click(); await move(page, 1000, 1000);
  await expect(page.locator("[data-layout-shape-preview]")).toHaveCount(0);
  await clickLayout(page, 1000, 1000);
  expect((await state(page, id)).rooms[0].annotations ?? []).toHaveLength(0);
  await page.locator('[data-layout-shape-size="width"]').fill("900"); await page.locator('[data-layout-shape-size="width"]').press("Tab");
  await move(page, 1000, 1000); await expect(page.locator("[data-layout-shape-preview]")).toHaveCount(0);
  await page.locator('[data-layout-shape-size="height"]').fill("600"); await page.locator('[data-layout-shape-size="height"]').press("Tab");
  await move(page, 1000, 1000); await expect(page.locator("[data-layout-shape-preview]")).toContainText("900.0 × 600.0 mm");
  await clickLayout(page, 1000, 1000);
  await expect.poll(async () => (await state(page, id)).rooms[0].annotations?.[0]).toMatchObject({ width: 900, height: 600 });
  await page.locator('[data-layout-shape="door"]').click(); await move(page, 2400, 0);
  const opening = page.locator("[data-layout-opening-preview]"); await expect(opening).toBeVisible();
  expect(await opening.evaluate(el => (el as SVGGElement).getBBox().height)).toBeLessThan(1000);
  await clickLayout(page, 2400, 0); await page.locator('[data-layout-tool="select"]').click();
  await expect(page.locator('[data-layout-property="opening-width"]')).toHaveValue("900");
  await expect(page.locator('[data-layout-property="opening-height"]')).toHaveValue("2100");
  await expect(page.locator('[data-layout-property="height"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("properties-desktop.png") });
  await page.locator('[data-layout-tool="shapes"]').click(); await page.locator('[data-layout-shape="window"]').click(); await move(page, 4200, 0);
  await expect(opening).toBeVisible(); expect(await opening.evaluate(el => (el as SVGGElement).getBBox().height)).toBeLessThan(20);
  await clickLayout(page, 4200, 0); await page.locator('[data-layout-tool="select"]').click();
  await page.locator('[data-layout-view]').selectOption("wall:0"); await page.locator('[data-layout-tab="align"]').click();
  await expect(page.locator("[data-layout-key]")).toHaveCount(0); await page.locator('[data-layout-align-reference="key"]').click();
  await expect(page.locator("[data-layout-key]")).toBeVisible(); await page.locator('[data-layout-align-reference="selection"]').click();
  const rect = await canvas.boundingBox(); await page.locator("[data-layout-inspector]").evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await canvas.boundingBox()).toEqual(rect);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await expect(page.locator("[data-layout-save]")).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+2)).toBe(true); await page.screenshot({ path: info.outputPath(`align-${width}.png`) }); }
  await page.locator("[data-room-modal-close]").click(); await page.locator('[data-open-room-editor="floor"]').click();
  await expect(page.locator('[data-layout-tab="properties"]')).toHaveAttribute("aria-selected", "true"); await openRoomCreation(page);
  expect(errors).toEqual([]);
});

test("two accounts see keyboard selection immediately, stable distinct colors and names that hide near the pointer", async ({ page, browser }, info) => {
  const id = await create(page, `共同選択 ${info.project.name}`);
  await addShape(page, "rect", 1000, 1000); await addShape(page, "ellipse", 3500, 2200);
  await expect(page.locator("[data-layout-sync-status]")).toHaveText("保存済み");
  const before = structuredClone((await state(page, id)).rooms), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), other = await context.newPage();
  try {
    await login(other, "admin@example.invalid"); await other.goto(`/Member/manage/exhibitions/${id}/layout`); await other.locator('[data-open-room-editor="floor"]').click();
    await page.locator("[data-layout-canvas]").focus(); await page.keyboard.press("ControlOrMeta+A");
    await expect(other.locator("[data-layout-peer-selection]")).toHaveCount(2, { timeout: 2500 });
    await expect(other.locator("[data-layout-peer-label]")).toHaveCount(2);
    await expect(other.locator("[data-layout-peer-label]").first()).toContainText("企画運営テスト");
    const color = await other.locator("[data-layout-peer-selection]").first().getAttribute("stroke");
    const badge = other.locator("[data-layout-peer-label]").first(), r = (await badge.boundingBox())!;
    await other.mouse.move(r.x+r.width/2, r.y+r.height/2); await expect(badge).toHaveCSS("opacity", "0");
    await expect(other.locator("[data-layout-peer-selection]").first()).toBeVisible();
    await other.mouse.move(120, 250); await expect(badge).toHaveCSS("opacity", "1");
    await page.screenshot({ path: info.outputPath("collaborator-local.png") });
    await other.screenshot({ path: info.outputPath("collaborator-selection.png") });
    await other.locator('[data-layout-kind="annotation"]').last().click();
    await expect(page.locator("[data-layout-peer-label]")).toContainText(["サイト管理テスト"]);
    expect(await page.locator("[data-layout-peer-selection]").first().getAttribute("stroke")).not.toBe(color);
    expect(await other.locator("[data-layout-peer-selection]").first().getAttribute("stroke")).toBe(color);
    await page.locator("[data-layout-canvas]").focus(); await page.keyboard.press("Escape");
    await expect(other.locator("[data-layout-peer-selection]")).toHaveCount(0, { timeout: 2500 });
    expect((await state(page, id)).rooms).toEqual(before);
    const output = await page.request.get(`/api/member/exhibitions/${id}/output?kind=layout-svg&room=${before[0].id}`);
    expect(output.ok()).toBe(true); const svg = await outputSvgText(output);
    expect(svg).not.toContain("data-layout-peer"); expect(svg).not.toContain("企画運営テスト");
  } finally { await context.close(); }
});
