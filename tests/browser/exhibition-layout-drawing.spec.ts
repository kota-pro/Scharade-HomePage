import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
import { openRoomCreation } from "./layout-tools-helper";
const headers = { Origin: "http://127.0.0.1:4329" };
async function screen(page: Page, x: number, y: number) {
  return page.locator("[data-layout-canvas]").evaluate(
    (el, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        (el as SVGSVGElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}
async function gesture(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
  release = true,
) {
  const p = await screen(page, a.x, a.y),
    q = await screen(page, b.x, b.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 8 });
  if (release) await page.mouse.up();
}
async function create(page: Page, title: string) {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: {
          email: "planner@example.invalid",
          password: "fixture-password-123",
        },
      })
    ).ok(),
  ).toBe(true);
  const r = await page.request.post("/api/member/exhibitions", {
    headers,
    data: { action: "create", title },
  });
  expect(r.status()).toBe(200);
  const id = (await r.json()).exhibition.id;
  await page.goto(`/Member/manage/exhibitions/${id}/layout`);
  return id as string;
}
const room = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/member/exhibitions/${id}`)).json())
    .exhibition.rooms[0];
test("dimension-first rooms, tool cursors and drag-drawn rectangles/ellipses persist with undo and cancellation", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await create(page, `作図とカーソル ${info.project.name}`);
  await expect(page.locator('#exhibition-admin [data-room-add]')).toHaveCount(0);
  await page.locator('[data-open-room-editor="floor"]').click();
  await expect(page.locator('[data-layout-tab="properties"]')).toHaveAttribute('aria-selected','true');
  await page.locator('[data-room-size="width"]').fill("-5");
  await expect(page.locator('[data-room-size="width"]')).toHaveValue("-5");
  await page.locator("[data-room-add]").click();
  expect(await room(page,id)).toBeUndefined();
  await page.locator('[data-room-size="width"]').fill("8250.5");
  await page.locator('[data-room-size="height"]').fill("4650.5");
  await page.locator("[data-room-add]").click();
  await expect
    .poll(async () =>
      (await room(page, id))?.vertices.map((p: any) => [p.x, p.y]),
    )
    .toEqual([
      [0, 0],
      [8250.5, 0],
      [8250.5, 4650.5],
      [0, 4650.5],
    ]);
  const canvas = page.locator("[data-layout-canvas]");
  await expect(page.locator('[data-layout-tool="text"] svg')).toHaveAttribute(
    "viewBox",
    "0 0 56 56",
  );
  const signatures = {
    select: "l-15-7c-.38",
    direct: "l-15-7a.99",
    draw: "m6.95 14.93",
    anchor: 'cx="18"',
    freehand: "M28.828 7.134",
    ruler: "M128 28",
  };
  for (const [tool, signature] of Object.entries(signatures)) {
    await page.locator(`[data-layout-tool="${tool}"]`).click();
    const value = await canvas.evaluate((el) => getComputedStyle(el).cursor);
    expect(value).toContain("data:image/svg+xml,");
    expect(decodeURIComponent(value)).toContain(signature);
    expect(decodeURIComponent(value)).toContain('width="24" height="24"');
    if(['anchor','freehand'].includes(tool))expect(value).toMatch(/0 0, crosshair$/);
  }
  await page.locator('[data-layout-tool="text"]').click();
  await expect(canvas).toHaveCSS("cursor", "text");
  await page.locator('[data-layout-tool="shapes"]').click();
  await page.locator('[data-layout-shape="rect"]').click();
  await page.mouse.move((await screen(page, 1000, 1000)).x,(await screen(page,1000,1000)).y);
  await expect(page.locator('[data-layout-shape-preview]')).toHaveCount(0);
  await gesture(page, { x: 1000, y: 1000 }, { x: 2400, y: 1900 }, false);
  await expect(page.locator("[data-layout-shape-preview]")).toContainText(
    "1400.0 × 900.0 mm",
  );
  expect((await room(page, id)).annotations ?? []).toHaveLength(0);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await room(page, id)).annotations?.map((a: any) => [
        a.kind,
        a.x,
        a.y,
        a.width,
        a.height,
      ]),
    )
    .toEqual([["rect", 1000, 1000, 1400, 900]]);
  await page.locator("[data-layout-undo]").click();
  await expect
    .poll(async () => (await room(page, id)).annotations?.length ?? 0)
    .toBe(0);
  await page.locator("[data-layout-redo]").click();
  await expect
    .poll(async () => (await room(page, id)).annotations?.length)
    .toBe(1);
  await page.locator('[data-layout-shape="ellipse"]').click();
  await gesture(page, { x: 4500, y: 3000 }, { x: 3300, y: 2300 });
  await expect
    .poll(async () => (await room(page, id)).annotations?.[1])
    .toMatchObject({
      kind: "ellipse",
      x: 3300,
      y: 2300,
      width: 1200,
      height: 700,
    });
  await gesture(page, { x: 500, y: 3500 }, { x: 1400, y: 4000 }, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-layout-shape-preview]")).toHaveCount(0);
  expect((await room(page, id)).annotations).toHaveLength(2);
  await gesture(page, { x: 500, y: 3500 }, { x: 1400, y: 4000 }, false);
  const pointerId = Number(await canvas.getAttribute("data-pointer-id"));
  await canvas.dispatchEvent("pointercancel", { pointerId });
  await page.mouse.up();
  await expect(page.locator("[data-layout-shape-preview]")).toHaveCount(0);
  expect((await room(page, id)).annotations).toHaveLength(2);
  await page.locator('[data-layout-tool="select"]').click();
  const object = page.locator('[data-layout-kind="annotation"]').first();
  expect(await object.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    await canvas.evaluate((el) => getComputedStyle(el).cursor),
  );
  await page.locator('[data-layout-tool="pan"]').click();
  const pan = await screen(page, 5500, 3500);
  await page.mouse.move(pan.x, pan.y);
  await page.mouse.down();
  await page.mouse.move(pan.x + 30, pan.y + 15);
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();
  await expect(canvas).toHaveCSS("cursor", "grab");
  await page.locator("[data-layout-view]").selectOption("wall:0");
  await page.locator('[data-layout-tool="shapes"]').click();
  await page.locator('[data-layout-shape="rect"]').click();
  await gesture(page, { x: 1000, y: 700 }, { x: 1900, y: 1300 });
  await expect
    .poll(async () => (await room(page, id)).annotations?.[2])
    .toMatchObject({
      kind: "rect",
      surface: "wall:0",
      x: 1000,
      y: 700,
      width: 900,
      height: 600,
    });
  await page.locator('[data-layout-tool="ruler"]').click();
  const wallPoint = await screen(page, 500, 200),
    wallEnd = await screen(page, 2500, 200);
  await page.mouse.click(wallPoint.x, wallPoint.y);
  await page.mouse.click(wallEnd.x, wallEnd.y);
  const distance = page.locator("[data-layout-distance]").first();
  await expect(distance).toBeVisible();
  await expect(distance).toHaveCSS(
    "cursor",
    await canvas.evaluate((el) => getComputedStyle(el).cursor),
  );
  await page.locator("[data-layout-save]").click();
  await expect(page.locator("[data-layout-sync-status]")).toHaveText(
    "保存済み",
  );
  await page.screenshot({ path: info.outputPath("wall-drawing.png") });
  await page.locator("[data-room-modal-close]").click();
  const original = await room(page, id);
  await page.locator('[data-open-room-editor="floor"]').click();
  await openRoomCreation(page);
  await page.locator('[data-room-size="width"]').fill("7000");
  await page.locator('[data-room-size="height"]').fill("3000");
  await page.locator("[data-room-add]").click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/member/exhibitions/${id}`)).json())
          .exhibition.rooms.length,
    )
    .toBe(2);
  expect(await room(page, id)).toEqual(original);
  await page.locator("[data-room-modal-close]").click();
  await page.reload();
  await page.locator('[data-room-select="0"]').click();
  await page.locator('[data-open-room-editor="floor"]').click();
  await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(2);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await expect(page.locator("[data-layout-save]")).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`drawing-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
test("a second touch cancels a rectangle preview before pinch zoom", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Native multi-touch is driven through Chromium CDP.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = await create(page, "図形とピンチ");
  await page.locator('[data-open-room-editor="floor"]').click();
  await page.locator("[data-room-add]").click();
  await page.locator('[data-layout-tool="shapes"]').click();
  await page.locator('[data-layout-shape="rect"]').click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  const c = (await page.locator("[data-layout-canvas]").boundingBox())!,
    x = c.x + c.width / 2,
    y = c.y + c.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: x - 70, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: x - 40, y: y + 30 }],
  });
  await expect(page.locator("[data-layout-shape-preview]")).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: x - 40, y: y + 30 },
      { id: 2, x: x + 40, y: y + 30 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: x - 110, y: y + 30 },
      { id: 2, x: x + 110, y: y + 30 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("[data-layout-shape-preview]")).toHaveCount(0);
  expect((await room(page, id)).annotations ?? []).toHaveLength(0);
  await expect(page.locator("[data-layout-zoom-label]")).not.toHaveText("100%");
  await cdp.detach();
});
