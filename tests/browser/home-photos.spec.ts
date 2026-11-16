import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${/-2\.jpg$/.test(url.pathname) ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="#bbb"/></svg>` });
    return route.abort();
  });
});

test("Home main photos and film copies use separate common-viewer albums with shared anonymous likes and author links", async ({ page, browser }, info) => {
  await login(page);
  const origin = "http://127.0.0.1:4329", headers = { Origin: origin }, ownerId = `photo-owner-${info.project.name}`;
  const admin = page.request, catalog = (await (await admin.get("/api/admin/home-photos")).json()).photos;
  const original = (await (await admin.get("/api/admin/content/home")).json()).document;
  const ownPhotos = catalog.filter((photo: any) => photo.portfolioId === ownerId);
  const titled = ownPhotos.find((photo: any) => /-1\.jpg$/.test(new URL(photo.url).pathname));
  expect(titled).toBeTruthy();
  const otherPhoto = catalog.find((photo: any) => photo.portfolioId !== ownerId && photo.width > photo.height);
  expect(otherPhoto).toBeTruthy();
  const selectedIds = new Set([titled.id, otherPhoto.id]);
  const change = async (action: string, data?: any) => {
    const current = (await (await admin.get("/api/admin/content/home")).json()).document;
    expect((await admin.post("/api/admin/content/home", { headers, data: { action, revision: current.revision, data } })).ok()).toBe(true);
  };
  const guest = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  let likedRef: any;
  try {
    await change("save", { ...original.published, excludedPhotoIds: catalog.filter((photo: any) => !selectedIds.has(photo.id)).map((photo: any) => photo.id) }); await change("publish");
    const home = await guest.newPage();
    await home.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") return route.continue();
      if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${/-2\.jpg$/.test(url.pathname) ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="#b3c6ce"/></svg>` });
      return route.abort();
    });
    await home.goto("/");
    await expect(home.locator("#photo-dialog")).toHaveCount(1); await expect(home.locator("[data-lightbox]")).toHaveCount(0);
    await expect(home.locator("script[src*='lightbox'],script[src*='jquery']")).toHaveCount(0);
    const main = home.locator('[data-photo-group="home-main"]'), originals = home.locator('.photo-carousel-contents ul:not([aria-hidden]) a'), copies = home.locator('.photo-carousel-contents ul[aria-hidden="true"] a');
    await expect(main).toHaveCount(2); await expect(originals).toHaveCount(2); await expect(copies).toHaveCount(2); await expect(home.locator("[data-photo-ref]")).toHaveCount(4);
    await expect(copies.first()).toHaveAttribute("tabindex", "-1"); await expect(copies.first()).not.toHaveAttribute("data-photo-ref");
    const mainPhoto = main.filter({ has: home.locator(`img[src*='${ownerId}-1.jpg']`) }), mainIndex = await main.evaluateAll((links, id) => links.findIndex(link => link.getAttribute("data-home-photo-id") === id), titled.id);
    await mainPhoto.focus(); await mainPhoto.press("Enter");
    const viewer = home.locator("#photo-dialog"), toggle = viewer.locator("[data-photo-toggle]"), heart = viewer.locator("[data-photo-like]");
    await expect(viewer).toBeVisible(); await expect(viewer).toHaveAttribute("data-info-open", "false"); await expect(viewer.locator("[data-photo-position]")).toHaveText(`${mainIndex + 1} / 2`);
    await expect.poll(async () => (await toggle.boundingBox())!.width).toBeGreaterThan(1400);
    await toggle.click(); await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1"); await expect(viewer.locator("h2")).toHaveText("憧憬"); await expect(viewer.locator("[data-photo-camera]")).toHaveText("Nikon Z5");
    await expect(viewer.locator("[data-photo-caption]")).toHaveCSS("font-size", "16px"); await expect(viewer.locator("[data-photo-author] a")).toHaveAttribute("href", `/Portfolio/${ownerId}`);
    if (mainIndex === 1) await viewer.locator("[data-photo-next]").click();
    await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    await viewer.locator("[data-photo-prev]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await viewer.locator("[data-photo-next]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    if (mainIndex === 1) await viewer.locator("[data-photo-prev]").click();
    await expect(heart).toBeEnabled(); await expect(viewer.locator("[data-photo-count]")).toBeHidden(); await heart.click(); await expect(heart).toHaveAttribute("aria-pressed", "true");
    likedRef = JSON.parse((await mainPhoto.getAttribute("data-photo-ref"))!);
    const cookie = (await guest.cookies()).find(value => value.name === "photo-visitor")!; expect(cookie.httpOnly).toBe(true);
    await home.keyboard.press("Escape"); await expect(mainPhoto).toBeFocused();
    await home.locator(".photo-carousel-contents").scrollIntoViewIfNeeded();
    // The film keeps moving under the pointer, so do not wait for a stable box.
    await copies.first().click({ force: true, timeout: 5000 });
    await expect(viewer).toBeVisible(); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    const filmRef = JSON.parse((await originals.first().getAttribute("data-photo-ref"))!); await expect(heart).toHaveAttribute("aria-pressed", filmRef.imageId === titled.id ? "true" : "false");
    const track = home.locator(".photo-carousel-contents ul").first(), before = await track.evaluate(element => getComputedStyle(element).transform);
    await home.waitForTimeout(180); expect(await track.evaluate(element => getComputedStyle(element).transform)).toBe(before);
    await home.keyboard.press("ArrowRight"); await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2"); await expect(viewer.locator("[data-photo-next]")).toBeEnabled();
    await viewer.locator("[data-photo-next]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    await viewer.locator("[data-photo-prev]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await home.keyboard.press("ArrowRight"); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    await home.keyboard.press("ArrowLeft"); await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await home.keyboard.press("Escape"); await home.mouse.move(0, 0); await expect.poll(() => track.evaluate(element => getComputedStyle(element).transform)).not.toBe(before);
    const owner = await browser.newContext({ baseURL: origin });
    try {
      expect((await fixtureLogin(owner.request, "/api/auth/login", { headers, data: { email: `${ownerId}@example.invalid`, password: "fixture-password-123" } })).ok()).toBe(true);
      const notifications = (await (await owner.request.get("/api/member/photo-notifications")).json()).notifications;
      expect(notifications).toHaveLength(1); expect(notifications[0].title).toBe("憧憬"); expect(notifications[0].count).toBe(1); expect(notifications[0].href).toContain(`/Portfolio/${ownerId}?photo=${titled.id}`);
      const count = (await (await owner.request.post("/api/photos/state", { headers, data: { refs: [likedRef] } })).json()).results[0].photo.count; expect(count).toBe(1);
    } finally { await owner.close(); }
    await home.reload(); await expect(home.locator("[data-photo-ref]")).toHaveCount(4);
    await mainPhoto.focus(); await mainPhoto.press("Enter"); await expect(heart).toHaveAttribute("aria-pressed", "true"); expect((await guest.cookies()).find(value => value.name === "photo-visitor")?.value).toBe(cookie.value);
    await home.keyboard.press("Escape"); await home.setViewportSize({ width: 390, height: 844 }); await mainPhoto.focus(); await mainPhoto.press("Enter");
    await expect(viewer).toHaveAttribute("data-photo-rotated", "true"); await toggle.click(); await expect(viewer.locator("#photo-information")).toHaveCSS("opacity", "1");
    await expect(viewer.locator("[data-photo-caption]")).toHaveCSS("font-size", "16px"); await viewer.locator("[data-photo-author] a").click(); await expect(home).toHaveURL(new RegExp(`/Portfolio/${ownerId}$`));
  } finally {
    if (likedRef) expect((await guest.request.post("/api/photos/like", { headers, data: { ref: likedRef, liked: false } })).ok()).toBe(true);
    await guest.close(); await change("save", original.published); await change("publish");
    if (JSON.stringify(original.draft) !== JSON.stringify(original.published)) await change("save", original.draft);
  }
});
async function login(page: any) {
  const result = await fixtureLogin(page.request, "/api/auth/login", { headers: { Origin: "http://127.0.0.1:4329" }, data: { email: "admin@example.invalid", password: "fixture-password-123" } });
  expect(result.status()).toBe(200);
}

test("Home selects Portfolio photos and its exclusion popup supports draft, publish, cancellation and restore", async ({ page, request }) => {
  await login(page);
  const catalog = (await (await page.request.get("/api/admin/home-photos")).json()).photos;
  expect(catalog.length).toBeGreaterThan(3);
  expect(catalog.every((photo: { width: number; height: number }) => photo.width > photo.height && photo.height > 0)).toBe(true);
  const original = (await (await page.request.get("/api/admin/content/home")).json()).document;
  const change = async (action: string, data?: any) => {
    const { document } = await (await page.request.get("/api/admin/content/home")).json();
    const result = await page.request.post("/api/admin/content/home", { headers: { Origin: "http://127.0.0.1:4329" }, data: { action, revision: document.revision, data } });
    expect(result.status()).toBe(200);
  };
  const ids = catalog.map((p: any) => p.id);
  // All but one excluded in the draft: public Home still uses the published pool.
  await change("save", { ...original.published, excludedPhotoIds: ids.slice(1) });
  await page.goto("/Admin/content/home");
  const trigger = page.getByRole("button", { name: "写真の除外設定を開く" });
  await trigger.click();
  const popup = page.locator("#home-photo-picker");
  await expect(popup).toBeVisible();
  await expect(popup.locator("#home-photo-apply")).toBeEnabled();
  await popup.locator("#home-photo-filter").selectOption("included");
  await expect(popup.locator("[data-photo-id]")).toHaveCount(1);
  await popup.locator("[data-photo-id]").click();
  await popup.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(popup.locator("#home-photo-apply")).toBeEnabled();
  await popup.locator("#home-photo-filter").selectOption("included");
  await expect(popup.locator("[data-photo-id]")).toHaveCount(1);
  await popup.locator("[data-photo-id]").click();
  await popup.getByRole("button", { name: "選択を反映" }).click();
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.locator("#editor-status")).toContainText("下書きを保存しました");
  await page.goto("/?preview=draft&editor=home");
  await expect(page.locator("[data-home-photo-id]")).toHaveCount(0);
  await expect(page.locator(".photo-carousel")).not.toBeVisible();
  await expect(page.locator(".main-visual .click-popup")).not.toBeVisible();
  const publicHome = await (await request.get("/?preview=draft")).text();
  expect(publicHome).toContain("data-home-photo-id=");
  expect(publicHome).not.toContain("ads-images/Photo");
  await change("publish");
  expect(await (await request.get("/")).text()).not.toContain("data-home-photo-id=");
  await change("restore");
  const restored = await (await request.get("/")).text();
  expect(restored).toContain("data-home-photo-id=");
  await page.goto("/");
  const main = page.locator('.main-visual [data-home-photo-id]');
  await expect(main).toHaveCount(3);
  expect(ids).toContain(await main.first().getAttribute("data-home-photo-id"));
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  // The original design overlaps its three photos; the third is on top.
  await main.last().click(); await expect(page.locator("#photo-dialog")).toBeVisible();
  await expect(page.locator("[data-photo-position]")).toHaveText("3 / 3");
  await page.keyboard.press("Escape"); await expect(page.locator("#photo-dialog")).not.toBeVisible();
  expect((await request.get("/api/admin/home-photos")).status()).toBe(401);
});

test("exclusion popup fits phones and desktop, filters and pages large collections, and recovers from load failure", async ({ page }) => {
  await login(page);
  const photos = Array.from({ length: 83 }, (_, i) => ({ id: i.toString(16).padStart(64, "0"), url: `https://images.microcms-assets.io/assets/fixture/picker-${i}.jpg`, portfolioId: `person-${i}`, portfolioName: i < 40 ? "写真確認の会員" : "別の会員", position: i + 1, width: 1200, height: 800 }));
  let fail = true;
  await page.route("**/api/admin/home-photos", route => fail
    ? route.fulfill({ status: 503, json: { ok: false, message: "写真一覧を取得できませんでした。" } })
    : route.fulfill({ json: { ok: true, photos } }));
  await page.goto("/Admin/content/home");
  const trigger = page.getByRole("button", { name: "写真の除外設定を開く" });
  const popup = page.locator("#home-photo-picker");
  await trigger.click();
  await expect(popup.locator("#home-photo-retry")).toBeVisible();
  await expect(popup.locator("#home-photo-apply")).toBeDisabled();
  fail = false; await popup.locator("#home-photo-retry").click();
  await expect(popup.locator("[data-photo-id]")).toHaveCount(36);
  await popup.locator("#home-photo-next").click();
  await expect(popup.locator("#home-photo-page")).toHaveText("2 / 3");
  await popup.locator("#home-photo-search").fill("別の会員");
  await expect(popup.locator("#home-photo-page")).toHaveText("1 / 2");
  await expect(popup.locator("#home-photo-picker-count")).toContainText("検索結果 43枚");
  for (const [width, height] of [[320, 568], [390, 844], [768, 900], [1440, 900], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => popup.evaluate(el => {
      const r = el.getBoundingClientRect(), apply = el.querySelector("#home-photo-apply")!.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && apply.bottom <= innerHeight && apply.top >= 0;
    })).toBe(true);
    await expect.poll(() => popup.locator(".home-photo-picker-scroll").evaluate(el => el.clientHeight)).toBeGreaterThan(100);
  }
  await page.keyboard.press("Escape"); await expect(popup).not.toBeVisible(); await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
