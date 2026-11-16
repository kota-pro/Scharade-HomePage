import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
import type { PhotoMetadata } from "../../src/types/photos";

const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
async function images(page: Page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("microcms-assets.io")) return route.abort();
    const portrait = /-2\.jpg$/.test(url.pathname);
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="#b3c6ce"/></svg>` });
  });
}
async function prepare(page: Page, request: APIRequestContext, engine: string, metadata: PhotoMetadata = { title: "雨上がり", caption: "写真ごとの説明", camera: "Z5", lens: "55mm f1.7" }) {
  const id = `photo-owner-${engine}`;
  await page.goto(`/Portfolio/${id}`);
  const ref = JSON.parse((await page.locator(".photo-wrapper").first().getAttribute("data-photo-ref"))!);
  expect((await fixtureLogin(request, "/api/auth/login", { headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).ok()).toBe(true);
  expect((await request.post("/api/photos/metadata", { headers, data: { ref, metadata } })).ok()).toBe(true);
  await page.reload();
}

test("photo arrows and arrow keys loop in both directions on desktop and mobile", async ({ page }, info) => {
  await images(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`/Portfolio/photo-owner-${info.project.name}`);
    const cards = page.locator(".photo-wrapper"), firstImage = await cards.first().locator(".gallery-image").getAttribute("src"), lastImage = await cards.last().locator(".gallery-image").getAttribute("src");
    await expect(cards).toHaveCount(2); await cards.first().locator(".photo-open").click();
    const viewer = page.locator("#photo-dialog"), position = viewer.locator("[data-photo-position]"), photo = viewer.locator("[data-photo-image]"), prev = viewer.locator("[data-photo-prev]"), next = viewer.locator("[data-photo-next]");
    const checkImage = async (expected: string | null) => { const expectedUrl = new URL(expected!); await expect.poll(async () => new URL((await photo.getAttribute("src"))!).pathname).toBe(expectedUrl.pathname); };
    await expect(prev).toBeEnabled(); await expect(next).toBeEnabled(); await expect(position).toHaveText("1 / 2");
    await prev.click(); await expect(position).toHaveText("2 / 2"); await checkImage(lastImage);
    await next.click(); await expect(position).toHaveText("1 / 2"); await checkImage(firstImage);
    await page.keyboard.press("ArrowLeft"); await expect(position).toHaveText("2 / 2"); await checkImage(lastImage);
    await page.keyboard.press("ArrowRight"); await expect(position).toHaveText("1 / 2"); await checkImage(firstImage);
    await page.keyboard.press("ArrowRight"); await expect(position).toHaveText("2 / 2"); await expect(next).toBeEnabled();
    await next.click(); await expect(position).toHaveText("1 / 2");
    await viewer.locator("[data-photo-close]").click(); await expect(viewer).not.toBeVisible();
  }
});

test("a single photograph keeps navigation disabled and arrow keys leave it open", async ({ page }, info) => {
  await images(page); await page.goto(`/Portfolio/photo-owner-${info.project.name}`);
  await page.locator(".photo-wrapper").nth(1).evaluate(card => card.remove());
  await page.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog");
  await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 1");
  await expect(viewer.locator("[data-photo-prev]")).toBeDisabled(); await expect(viewer.locator("[data-photo-next]")).toBeDisabled();
  const photo = await viewer.locator("[data-photo-image]").getAttribute("src");
  for (const key of ["ArrowLeft", "ArrowRight"]) { await page.keyboard.press(key); await expect(viewer).toBeVisible(); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 1"); await expect(viewer.locator("[data-photo-image]")).toHaveAttribute("src", photo!); }
});

test("photos start maximized, toggle the information panel and grow back to the full image area", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 }); await prepare(page, request, info.project.name);
  await page.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog"), photo = viewer.locator("[data-photo-toggle]"), panel = viewer.locator("#photo-information");
  await expect(viewer).toHaveAttribute("data-info-open", "false"); await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(1400);
  const fullWidth = (await photo.boundingBox())!.width;
  await photo.click(); await expect(viewer).toHaveAttribute("data-info-open", "true"); await expect(panel).toHaveCSS("opacity", "1");
  await expect(panel.locator("h2")).toBeVisible(); await expect(panel).toContainText("雨上がり");
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeLessThan(fullWidth * .8);
  await photo.click(); await expect(viewer).toHaveAttribute("data-info-open", "false");
  await expect.poll(async () => Math.abs((await photo.boundingBox())!.width - fullWidth)).toBeLessThan(1);
});

test("the information panel keeps its author in place, uses the requested point sizes and scrolls the caption separately", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1920, height: 1000 });
  await prepare(page, request, info.project.name, { title: "憧憬", caption: "キャプションの長文をスクロールして確認します。\n".repeat(80), camera: "Nikon Z5", lens: "Minolta 55mm f1.7", fNumber: "16", shutterSpeed: "1/400", iso: "4000" });
  await page.locator(".photo-open").first().click(); const viewer = page.locator("#photo-dialog");
  const authorBefore = (await viewer.locator("[data-photo-author]").boundingBox())!;
  await viewer.locator("[data-photo-toggle]").click(); await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1");
  await viewer.evaluate(el => Promise.allSettled(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)));
  const sizes = await viewer.evaluate(el => {
    const font = (selector: string) => parseFloat(getComputedStyle(el.querySelector(selector)!).fontSize);
    const size = (selector: string) => { const bounds = el.querySelector(selector)!.getBoundingClientRect(); return [bounds.width, bounds.height]; };
    return { title: font("[data-photo-title]"), camera: font("[data-photo-camera]"), lens: font("[data-photo-lens]"), settings: font("[data-photo-settings]"), caption: font("[data-photo-caption]"), heart: size(".photo-dialog-actions svg") };
  });
  for (const [key, pt] of Object.entries({ title: 64, camera: 20, lens: 15, settings: 14, caption: 12 })) expect(sizes[key as keyof typeof sizes]).toBeCloseTo(pt * 4 / 3, 1);
  expect(sizes.heart[0]).toBeCloseTo(22 * 4 / 3, 1); expect(sizes.heart[1]).toBeCloseTo(20 * 4 / 3, 1);
  await expect(viewer.locator(".photo-author")).toHaveCount(1); await expect(viewer.locator("[data-photo-author]")).toBeVisible();
  expect(await viewer.locator("[data-photo-author]").boundingBox()).toEqual(authorBefore);
  const positions = () => viewer.evaluate(el => Object.fromEntries([".photo-information-heading", ".photo-exif", ".photo-dialog-actions"].map(selector => { const box = el.querySelector(selector)!.getBoundingClientRect(); return [selector, [box.x, box.y, box.width, box.height]]; })));
  const before = await positions(); const caption = viewer.locator("[data-photo-caption]");
  expect(await caption.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await caption.evaluate(el => { el.scrollTop = 300; }); await expect.poll(() => caption.evaluate(el => el.scrollTop)).toBeGreaterThan(200);
  expect(await positions()).toEqual(before);
  const box = (await caption.boundingBox())!, heart = (await viewer.locator(".photo-dialog-actions").boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(heart.y);
});

test("titles scale with the available width down to 28pt while authors stay fixed and captions remain 12pt", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1920, height: 1000 });
  await prepare(page, request, info.project.name, { title: "光の記憶", caption: "キャプションの文字は12ptです。\n".repeat(30), camera: "Nikon Z5", lens: "Minolta 55mm f1.7", fNumber: "16", shutterSpeed: "1/400", iso: "4000" });
  await page.locator(".photo-open").first().click(); const viewer = page.locator("#photo-dialog"), toggle = viewer.locator("[data-photo-toggle]");
  const finish = () => viewer.evaluate(el => Promise.allSettled(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)));
  const fonts: number[] = [];
  for (const [width, height] of [[1920, 1000], [1460, 900], [1280, 900], [1024, 768], [844, 390], [568, 320], [480, 320], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => viewer.locator("[data-photo-viewport]").evaluate(el => Math.abs(el.clientWidth - (innerWidth <= 768 && innerHeight > innerWidth ? el.closest("dialog")!.clientHeight : el.closest("dialog")!.clientWidth)))).toBeLessThan(1);
    const authorBefore = (await viewer.locator("[data-photo-author]").boundingBox())!;
    await toggle.click(); await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1"); await finish();
    const measurements = await viewer.evaluate(el => {
      const title = el.querySelector<HTMLElement>("[data-photo-title]")!, caption = el.querySelector<HTMLElement>("[data-photo-caption]")!;
      const bounds = (element: Element) => { const r = element.getBoundingClientRect(); return (el as HTMLElement).dataset.photoRotated === "true" ? { left: r.top, right: r.bottom, top: -r.right, bottom: -r.left } : r; };
      const a = bounds(title), b = bounds(el.querySelector("[data-photo-author]")!);
      const equipment = bounds(el.querySelector("[data-photo-equipment]")!), settings = bounds(el.querySelector("[data-photo-settings]")!), captionBounds = bounds(caption), content = bounds(el.querySelector(".photo-information-content")!), heart = bounds(el.querySelector(".photo-dialog-actions")!);
      return { font: parseFloat(getComputedStyle(title).fontSize), caption: parseFloat(getComputedStyle(caption).fontSize), noOverlap: a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom, titleFits: title.scrollWidth <= title.clientWidth + 1, captionFits: caption.clientHeight >= 32 && caption.scrollWidth <= caption.clientWidth + 1 && captionBounds.bottom <= content.bottom + 1 && captionBounds.bottom <= heart.top + 1, rowsClear: a.bottom <= Math.min(equipment.top, settings.top) + 1 && Math.max(equipment.bottom, settings.bottom) <= captionBounds.top + 1 };
    });
    fonts.push(measurements.font); expect(measurements.font).toBeGreaterThanOrEqual(28 * 4 / 3 - .05); expect(measurements.font).toBeLessThanOrEqual(64 * 4 / 3 + .05);
    expect(measurements.caption).toBe(16);
    for (const key of ["noOverlap", "titleFits", "captionFits", "rowsClear"] as const) expect(measurements[key], `${width}×${height}: ${key}`).toBe(true);
    const authorAfter = (await viewer.locator("[data-photo-author]").boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(authorAfter[key]).toBeCloseTo(authorBefore[key], 1);
    await toggle.click(); await expect(viewer).toHaveAttribute("data-info-open", "false"); await finish();
  }
  expect(fonts[0]).toBeCloseTo(64 * 4 / 3, 1); expect(fonts[2]).toBeLessThan(fonts[0]); expect(fonts[6]).toBeCloseTo(28 * 4 / 3, 1);
});

test("photo titles fit one line until the shooting information size is reached", async ({ page, request }, info) => {
  await images(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const name = "暮れゆく街に残る光と静かな帰り道";
  await prepare(page, request, info.project.name, { title: name, camera: "Nikon Z5", fNumber: "8", iso: "400", caption: "夕暮れの写真です。" });
  await page.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog");
  await viewer.locator("[data-photo-toggle]").click();
  const title = viewer.locator("[data-photo-title]");
  await expect(title).toHaveText(name);
  const measure = () => title.evaluate(element => {
    const style = getComputedStyle(element);
    const camera = element.closest("#photo-information")!.querySelector("[data-photo-camera]")!;
    return {
      size: parseFloat(style.fontSize),
      cameraSize: parseFloat(getComputedStyle(camera).fontSize),
      wraps: element.scrollHeight > parseFloat(style.lineHeight) + 1,
      fits: element.scrollWidth <= element.clientWidth + 1,
    };
  });
  await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1");
  await expect.poll(measure).toMatchObject({ wraps: false, fits: true });
  const wide = await measure();
  expect(wide.size).toBeGreaterThan(wide.cameraSize);
  expect(wide.size).toBeLessThan(64 * 4 / 3);

  await page.setViewportSize({ width: 480, height: 320 });
  await expect.poll(measure).toMatchObject({ wraps: true, fits: true });
  const narrow = await measure();
  expect(narrow.size).toBeCloseTo(narrow.cameraSize, 1);
  await expect(viewer.locator("[data-photo-caption]")).toBeVisible();

  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect.poll(measure).toMatchObject({ wraps: false, fits: true });
  await expect.poll(async () => Math.abs((await measure()).size - wide.size)).toBeLessThan(0.5);
});

test("hover shooting settings stay against the right edge without equipment", async ({ page, request }, info) => {
  await images(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const metadata = { fNumber: "8", shutterSpeed: "1/250", iso: "400" };
  await prepare(page, request, info.project.name, metadata);
  const cards = page.locator(".photo-wrapper");
  const ref = JSON.parse((await cards.nth(1).getAttribute("data-photo-ref"))!);
  expect((await request.post("/api/photos/metadata", { headers, data: { ref, metadata } })).ok()).toBe(true);
  await page.reload();

  for (const card of await cards.all()) {
    await card.hover();
    const exif = card.locator(".photo-hover .photo-exif");
    const settings = exif.locator("[data-photo-settings]");
    await expect(settings).toContainText("ISO 400");
    await expect(exif.locator("[data-photo-equipment]")).toBeHidden();
    await expect.poll(() => settings.evaluate(element => {
      const right = element.getBoundingClientRect().right;
      return Math.abs(element.parentElement!.getBoundingClientRect().right - right);
    })).toBeLessThan(1);
  }
});

test("long equipment names wrap while shooting settings remain on three lines and the caption stays usable", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page, request, info.project.name, { title: "憧憬", caption: "長い説明文も独立してスクロールできます。\n".repeat(50), camera: "FUJIFILM GFX100 II Limited Edition Professional Camera", lens: "FUJINON GF 100-200mm F5.6 R LM OIS WR Long Lens", fNumber: "16", shutterSpeed: "1/400", iso: "4000" });
  await page.locator(".photo-open").first().click(); const viewer = page.locator("#photo-dialog");
  await viewer.locator("[data-photo-toggle]").click(); await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1");
  for (const [width, height] of [[1440, 900], [844, 390], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => viewer.evaluate(el => {
      const equipment = el.querySelector<HTMLElement>("[data-photo-equipment]")!, settings = el.querySelector<HTMLElement>("[data-photo-settings]")!, caption = el.querySelector<HTMLElement>("[data-photo-caption]")!;
      const a = equipment.getBoundingClientRect(), b = settings.getBoundingClientRect();
      const avatar = el.querySelector("[data-photo-author] img")!.getBoundingClientRect(), close = el.querySelector("[data-photo-close]")!.getBoundingClientRect();
      const authorClearsClose = avatar.right <= close.left || avatar.left >= close.right || avatar.bottom <= close.top || avatar.top >= close.bottom;
      return authorClearsClose && a.right <= b.left && settings.scrollWidth <= settings.clientWidth + 1 && settings.clientHeight <= parseFloat(getComputedStyle(settings).lineHeight) * 3 + 1 && caption.clientHeight >= 32 && caption.scrollWidth <= caption.clientWidth + 1;
    })).toBe(true);
  }
});

test("empty metadata and author-only photos keep the whole image area", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 }); await prepare(page, request, info.project.name, { title: "", caption: "", camera: "NORITSU KOKI QSS-32_33", lens: "" });
  const card = page.locator(".photo-wrapper").first(); await card.hover(); await expect(card.locator(".photo-hover")).toHaveCSS("opacity", "1");
  await expect.poll(async () => (await card.boundingBox())!.x + (await card.boundingBox())!.width - (await card.locator("[data-photo-like]").boundingBox())!.x - (await card.locator("[data-photo-like]").boundingBox())!.width).toBeLessThan(20);
  await page.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog"), photo = viewer.locator("[data-photo-toggle]");
  await expect(photo).toHaveAttribute("aria-disabled", "true"); await expect(viewer.locator("[data-photo-author]")).toBeVisible();
  await photo.click({ force: true }); await expect(viewer).toHaveAttribute("data-info-open", "false");
  await expect(viewer.locator("#photo-information")).toBeHidden();
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(1400);
});

test("Blog and exhibition dialogs link authors to their Portfolio", async ({ page }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [route, expected] of [["/posts/test-post", "/Portfolio/photo-owner-chromium"], [`/Gallery/photo-exhibition-${info.project.name}`, `/Portfolio/photo-owner-${info.project.name}`]]) {
    await page.goto(route); const card = page.locator(".photo-wrapper").first(); await card.hover();
    if (route.startsWith("/posts/")) await expect(card.locator(".photo-hover, [data-photo-like]")).toHaveCount(0);
    else await expect(card.locator(".photo-author a")).toHaveAttribute("href", expected);
    await card.locator(".photo-open").click(); const link = page.locator("#photo-dialog [data-photo-author] a");
    await expect(link).toHaveAttribute("href", expected); await link.click(); await expect(page).toHaveURL(new RegExp(`${expected}$`));
  }
  await page.goto(`/Portfolio/photo-owner-${info.project.name}`); await page.locator(".photo-open").first().click();
  await expect(page.locator("#photo-dialog [data-photo-author] a")).toHaveCount(0);
});

test("pointer closing clears hover, moving reactivates it and keyboard opening restores focus", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 }); await prepare(page, request, info.project.name);
  const card = page.locator(".photo-wrapper").first(), link = card.locator(".photo-open"), hover = card.locator(".photo-hover");
  await card.hover(); await expect(hover).toHaveCSS("opacity", "1"); await link.click(); await page.keyboard.press("Escape");
  await expect(page.locator("#photo-dialog")).not.toBeVisible(); await expect(hover).toHaveCSS("opacity", "0"); await expect(link).not.toBeFocused();
  const bounds = (await card.boundingBox())!; await page.mouse.move(bounds.x + 20, bounds.y + 20); await expect(hover).toHaveCSS("opacity", "1");
  await link.focus(); await link.press("Enter"); await expect(page.locator("#photo-dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(link).toBeFocused();
});

test("slow information requests show the shared SVG centered in the panel and recover on retry", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 }); await prepare(page, request, info.project.name);
  let release!: () => void, fail = true;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/photos/state", async route => {
    if (!route.request().postDataJSON()?.details) return route.continue();
    await wait;
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    return route.continue();
  });
  try {
    await page.locator(".photo-open").first().click(); const viewer = page.locator("#photo-dialog"); await viewer.locator("[data-photo-toggle]").click();
    const loader = viewer.locator("[data-photo-details-loading]");
    const symbol = loader.locator("img");
    await expect(loader).toBeVisible();
    await expect(symbol).toHaveAttribute("src", /loading-camera[\w.-]*\.svg$/);
    await expect.poll(async () => { const a = (await symbol.boundingBox())!, b = (await viewer.locator("#photo-information").boundingBox())!; return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) + Math.abs(a.y + a.height / 2 - b.y - b.height / 2); }).toBeLessThan(2);
    release(); await expect(viewer.locator("[data-photo-detail-retry]")).toBeVisible(); await expect(loader).toBeHidden();
    fail = false; await viewer.locator("[data-photo-detail-retry]").click(); await expect(viewer.locator("[data-photo-title]")).toHaveText("雨上がり"); await expect(viewer.locator("[data-photo-detail-retry]")).toBeHidden();
  } finally { release(); }
});

test("mobile landscape photos rotate the entire viewer and retain a desktop information layout", async ({ page, request }, info) => {
  await images(page); await page.setViewportSize({ width: 390, height: 844 }); await prepare(page, request, info.project.name);
  await page.locator(".photo-open").first().click(); const viewer = page.locator("#photo-dialog");
  await expect(viewer).toHaveAttribute("data-photo-rotated", "true"); await expect(viewer).toHaveAttribute("data-info-open", "false");
  await viewer.locator("[data-photo-toggle]").click(); await expect(viewer).toHaveAttribute("data-info-open", "true");
  await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1");
  const fits = async () => expect.poll(() => viewer.evaluate(viewer => [...viewer.querySelectorAll("[data-photo-image], [data-photo-close], [data-photo-like]")].every(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }))).toBe(true);
  await fits();
  await page.setViewportSize({ width: 844, height: 390 }); await expect(viewer).toHaveAttribute("data-photo-rotated", "false"); await fits();
  await expect.poll(async () => { const content = (await viewer.locator(".photo-information-content").boundingBox())!, heart = (await viewer.locator("[data-photo-like]").boundingBox())!; return content.y + content.height <= heart.y; }).toBe(true);
  for (const [width, height] of [[568, 320], [640, 360], [667, 375], [844, 390], [932, 430]]) {
    await page.setViewportSize({ width, height }); await fits();
    await expect.poll(() => viewer.locator(".photo-information-content").evaluate(content => { const panel = content.parentElement!.getBoundingClientRect(), bounds = content.getBoundingClientRect(); return bounds.left >= panel.left - 1 && bounds.right <= panel.right + 1 && content.scrollWidth <= content.clientWidth + 1; })).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await viewer.locator("[data-photo-next]").click();
  await expect(viewer.locator("[data-photo-image]")).toHaveJSProperty("naturalWidth", 600); await expect(viewer).toHaveAttribute("data-photo-rotated", "false"); await fits();
});
