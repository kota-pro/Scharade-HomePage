import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
import sharp from "sharp";
async function rows(page: Page) {
  await expect.poll(() => page.locator(".justified-grid").evaluate(grid => {
    if ((grid as HTMLElement).dataset.layout !== "justified") return false;
    const bounds = grid.getBoundingClientRect(), mobile = innerWidth <= 768;
    return [...grid.querySelectorAll<HTMLElement>(".photo-wrapper")].filter(el => !el.hidden).every(el => {
      const img = el.querySelector("img")!, rect = el.getBoundingClientRect(), ratio = img.naturalWidth / img.naturalHeight || 1.5;
      return rect.width > 0 && rect.height > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
        Math.abs(rect.width / rect.height - ratio) < 0.02 && getComputedStyle(img).objectFit === "contain" &&
        (!mobile || Math.abs(rect.width - bounds.width) < 1);
    });
  })).toBe(true);
}
async function images(page: Page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const match = url.pathname.match(/^\/api\/images\/(?:full\/)?photo-(\d+)$/);
    if (!match) return route.continue();
    const portrait = Number(match[1]) % 2 === 1;
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="${portrait ? '#b8bfab' : '#9fb3c2'}"/></svg>` });
  });
}
test("Gallery shows ready thumbnails without waiting for another photo and hides stale enlargements", async ({ page }) => {
  await images(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const thumbnails = new Set<string>();
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/images\/photo-\d+$/.test(path)) thumbnails.add(path);
  });
  let releaseThumbnail!: () => void, releaseEnlargement!: () => void;
  const thumbnailReady = new Promise<void>(resolve => { releaseThumbnail = resolve; });
  const enlargementReady = new Promise<void>(resolve => { releaseEnlargement = resolve; });
  await page.route("**/api/images/photo-1?*", async route => { await thumbnailReady; await route.fallback(); });
  await page.route("**/api/images/full/photo-1?*", async route => { await enlargementReady; await route.fallback(); });
  await page.goto("/Gallery/public-album", { waitUntil: "domcontentloaded" });
  const grid = page.locator(".justified-grid");
  await expect(grid).toHaveAttribute("data-layout", "justified");
  await expect(grid.locator(".photo-grid-loading")).toBeHidden();
  const first = grid.locator("img.gallery-image").first();
  await expect.poll(() => first.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(thumbnails.has("/api/images/photo-99")).toBe(false);
  expect(thumbnails.size).toBeLessThan(20);
  await expect(grid.locator("img.gallery-image").nth(1)).toHaveJSProperty("naturalWidth", 0);
  releaseThumbnail();
  await expect(page.locator(".picture-count-value")).toHaveText("135");
  await grid.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog"), image = viewer.locator("[data-photo-image]"), loader = viewer.locator("[data-photo-media-loading]");
  await expect(image).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 135");
  await expect(loader).toBeVisible();
  await expect(image).toBeHidden();
  releaseEnlargement();
  await expect(image).toBeVisible();
  await expect(loader).toBeHidden();
  await expect(image).toHaveAttribute("src", /\/full\/photo-1\?/);
  await page.keyboard.press("Escape");
  await page.locator(".panel-bottom .next-btn").click();
  await expect(grid.locator(".photo-wrapper:visible")).toHaveCount(35);
  await expect.poll(async () => Math.abs((await page.locator(".panel-top").boundingBox())!.y)).toBeLessThan(10);
});

test("Gallery keeps the same photo in view when a delayed aspect ratio is learned above it", async ({ page }) => {
  await images(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/images/photo-1?*", async route => { await delayed; await route.fallback(); });
  await page.goto("/Gallery/public-album", { waitUntil: "domcontentloaded" });
  const grid = page.locator(".justified-grid");
  await expect(grid).toHaveAttribute("data-layout", "justified");
  const tiles = grid.locator(".photo-wrapper");
  const changingTile = tiles.nth(1);
  const previousHeight = (await changingTile.boundingBox())!.height;
  const anchor = tiles.nth(6);
  await anchor.evaluate(element => window.scrollBy({ top: element.getBoundingClientRect().top + 10, behavior: "instant" }));
  await expect.poll(() => anchor.evaluate(element => Math.abs(element.getBoundingClientRect().top + 10))).toBeLessThan(3);
  const previousTop = await anchor.evaluate(element => element.getBoundingClientRect().top);
  release();
  await expect(changingTile).toHaveAttribute("data-aspect-ratio", "0.75");
  await expect.poll(async () => (await changingTile.boundingBox())!.height).toBeGreaterThan(previousHeight + 50);
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - previousTop)).toBeLessThan(3);
});

test("Gallery requests a cover only when its category is visible and falls back on an error", async ({ page }) => {
  await images(page);
  await page.setViewportSize({ width: 320, height: 740 });
  let requested = 0;
  await page.route("**/api/gallery/public-album/cover*", route => {
    ++requested;
    expect(new URL(route.request().url()).searchParams.get("size")).toBe("320");
    return route.fulfill({ status: 503 });
  });
  await page.goto("/Gallery");
  const album = page.locator('a.gallery-link[href="/Gallery/public-album"]').first();
  const cover = album.locator("img");
  await expect(cover).toBeHidden();
  expect(requested).toBe(0);
  await album.locator("xpath=ancestor::details").locator("summary").click();
  await album.scrollIntoViewIfNeeded();
  await expect(cover).toHaveAttribute("src", "/images/temp.png");
  expect(requested).toBe(1);
});

test("Gallery covers remain usable with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4329", javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await images(page);
    await page.goto("/Gallery");
    const album = page.locator('a.gallery-link[href="/Gallery/public-album"]').first();
    await album.locator("xpath=ancestor::details").locator("summary").click();
    const cover = album.locator("noscript img");
    await cover.scrollIntoViewIfNeeded();
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const card = (await album.locator(".image-wrapper").boundingBox())!, image = (await cover.boundingBox())!;
    expect(Math.abs(image.y - card.y)).toBeLessThan(6);
  } finally { await context.close(); }
});

test("Gallery serves allowlisted cover sizes and retries a missing small Lightroom rendition", async ({ page }, info) => {
  const origin = "http://127.0.0.1:4329";
  for (const size of [320, 640]) {
    const response = await page.request.get(`/api/gallery/public-album/cover?size=${size}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect((await sharp(await response.body()).metadata()).width).toBe(size);
  }
  expect((await page.request.get("/api/gallery/public-album/cover?size=2048")).status()).toBe(400);
  expect((await page.request.get("/api/gallery/private-album/cover")).status()).toBe(404);
  const login = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: origin },
    data: { email: `photo-staff-${info.project.name}@example.invalid`, password: "fixture-password-123" },
  });
  expect(login.ok()).toBe(true);
  const album = "private-album";
  await page.goto(`/Gallery/${album}`);
  const editor = page.locator("[data-gallery-settings]");
  await expect(editor).toHaveAttribute("data-revision", /^\d+$/);
  const revision = Number(await editor.getAttribute("data-revision"));
  const settings = `/api/member/gallery/${album}/settings`;
  const saveCover = (value: number, coverPhotoId: string | null) => page.request.post(settings, {
    headers: { Origin: origin }, data: { revision: value, visibility: "members", coverPhotoId },
  });
  expect((await saveCover(revision, "photo-1")).ok()).toBe(true);
  try {
    const response = await page.request.get(`/api/gallery/${album}/cover?size=320`);
    expect(response.status()).toBe(200);
    expect((await sharp(await response.body()).metadata()).width).toBe(640);
  } finally {
    expect((await saveCover(revision + 1, null)).ok()).toBe(true);
  }
});
test("Gallery album return restores the previously opened category and scroll position", async ({ page }) => {
  await images(page);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto("/Gallery");
  const album = page.locator('a.gallery-link[href="/Gallery/public-album"]').first();
  await album.locator("xpath=ancestor::details").locator("summary").click();
  await album.scrollIntoViewIfNeeded();
  const listScroll = await page.evaluate(() => scrollY);
  await album.click();
  await expect(page).toHaveURL(/\/Gallery\/public-album$/);
  await page.getByRole("navigation", { name: "パンくずリスト" }).getByRole("link", { name: "Gallery", exact: true }).click();
  await expect(page).toHaveURL(/\/Gallery$/);
  await expect(album).toBeVisible();
  await expect.poll(() => page.evaluate(expected => Math.abs(scrollY - expected), listScroll)).toBeLessThan(12);
});
test("Gallery uses Portfolio layout, pagination and mobile enlargement including appended photos", async ({ page }, info) => {
  await images(page);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Gallery/public-album");
  await expect(page.locator(".photo-wrapper")).toHaveCount(135);
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await expect(page.locator(".picture-count-value")).toHaveText("135");
  for (const width of [320, 390, 768, 769, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await rows(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("gallery-desktop.png") });
  await page.locator(".next-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(35);
  await expect(page.locator(".page-input-top")).toHaveValue("2");
  await page.locator(".photo-wrapper:visible img").evaluateAll(images => images.forEach(img => { (img as HTMLImageElement).loading = "eager"; }));
  await expect.poll(() => page.locator(".photo-wrapper:visible img").evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await rows(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await rows(page);
  await page.screenshot({ path: info.outputPath("gallery-mobile.png") });
  const photo = page.locator(".photo-wrapper:visible").first();
  await photo.click();
  const viewer = page.locator("#photo-dialog");
  await expect(viewer.locator("[data-photo-position]")).toHaveText("101 / 135");
  await expect.poll(() => viewer.evaluate(el => {
    const image = el.querySelector("[data-photo-image]")!.getBoundingClientRect(), close = el.querySelector("[data-photo-close]")!.getBoundingClientRect();
    return image.width > 0 && image.left >= 0 && image.right <= innerWidth && image.top >= 0 && image.bottom <= innerHeight && close.top >= 0 && close.bottom <= innerHeight;
  })).toBe(true);
  await expect(viewer.locator("[data-photo-image]")).toHaveCSS("opacity", "1");

  await page.screenshot({ path: info.outputPath("gallery-lightbox-mobile.png") });
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator("[data-photo-position]")).toHaveText("102 / 135");
  await page.keyboard.press("ArrowLeft");
  await viewer.locator("[data-photo-close]").click();
  await page.locator(".photo-wrapper:visible").last().locator(".photo-open").click();
  await expect(viewer.locator("[data-photo-position]")).toHaveText("135 / 135");
  await viewer.locator("[data-photo-next]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 135");
  await viewer.locator("[data-photo-prev]").click(); await expect(viewer.locator("[data-photo-position]")).toHaveText("135 / 135");
  await page.keyboard.press("ArrowRight"); await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 135");
  await page.keyboard.press("ArrowLeft"); await expect(viewer.locator("[data-photo-position]")).toHaveText("135 / 135");
  await page.setViewportSize({ width: 844, height: 390 });
  await viewer.locator("[data-photo-close]").click();
  await expect(viewer).not.toBeVisible();
  await expect(photo.locator(".photo-open")).not.toBeFocused();
  await expect(photo.locator(".photo-hover")).toHaveCSS("opacity", "0");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page.locator(".prev-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await rows(page);
  expect(errors).toEqual([]);
});
test("Gallery keeps initial photos usable after continuation failure", async ({ page }) => {
  await images(page);
  await page.route("**/api/gallery/**", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.route("**/api/images/photo-3?*", route => route.abort());
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/Gallery/public-album");
  await expect(page.locator(".gallery-load-status")).toContainText("写真の続きを取得できません");
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await rows(page);
  await page.locator(".photo-wrapper").first().click();
  await expect(page.locator("[data-photo-position]")).toHaveText("1 / 100");
  await page.keyboard.press("Escape");
  await expect(page.locator("#photo-dialog")).not.toBeVisible();
});

test("Gallery waits for a pending continuation before wrapping the photo arrows", async ({ page }) => {
  await images(page);
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/gallery/public-album?*", async route => { await delayed; await route.fallback(); });
  await page.goto("/Gallery/public-album", { waitUntil: "domcontentloaded" });
  const viewer = page.locator("#photo-dialog");
  const position = viewer.locator("[data-photo-position]");
  try {
    await page.locator(".justified-grid .photo-open").first().click();
    await expect(position).toHaveText("1 / 100");
    await viewer.getByRole("button", { name: "前の写真" }).click();
    await expect(position).toHaveText("1 / 100");
  } finally { release(); }
  await expect(position).toHaveText("135 / 135");
  await viewer.getByRole("button", { name: "次の写真" }).click();
  await expect(position).toHaveText("1 / 135");
});

test("Gallery renders a composed thumbnail when a series arrives on a later page", async ({ page }) => {
  await images(page);
  let grouped = false;
  await page.route("**/api/gallery/public-album?*", async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (!grouped && data.photos.length >= 2) {
      const [first, second, ...remaining] = data.photos;
      const frame = { y: 0, width: 150, height: 100, rotation: 0 };
      first.series = { title: "後続ページの組写真", width: 350, height: 100, photos: [
        { ...frame, id: first.id, src: first.src, x: 0 },
        { ...frame, id: second.id, src: second.src, x: 200 },
      ] };
      data.photos = [first, ...remaining];
      grouped = true;
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/Gallery/public-album");
  await expect(page.locator(".photo-wrapper")).toHaveCount(134);
  await page.locator(".next-btn-top").click();
  const group = page.getByRole("link", { name: "組写真「後続ページの組写真」を開く" });
  await expect(group).toBeVisible();
  await expect(group.locator(".photo-series-thumbnail img")).toHaveCount(2);
});
test("Gallery deep links reveal and open a photograph from a later fetched page", async ({ page }) => {
  await images(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Gallery/public-album?photo=photo-131");
  await expect(page.locator("#photo-dialog")).toBeVisible();
  await expect(page.locator("#photo-dialog [data-photo-position]")).toHaveText("132 / 135");
  await expect(page.locator(".page-input-top")).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(35);
});
test("Gallery shows a series in its submitted layout and opens each visible frame", async ({ page }, info) => {
  await images(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = "/Gallery/gallery-series-fixture";
  await page.goto(url);
  const tiles = page.locator(".photo-wrapper"), viewer = page.locator("#photo-dialog");
  await expect(tiles).toHaveCount(1);
  const thumbnail = tiles.locator(".photo-series-thumbnail img");
  await expect(thumbnail).toHaveCount(2);
  await expect(tiles.locator(".photo-series-badge")).toHaveText("組写真 · 2枚");
  await expect(thumbnail.last()).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
  const grouped = await (await page.request.get("/api/gallery/gallery-series-fixture?view=works")).json();
  expect(grouped.photos).toHaveLength(1);
  expect(grouped.photos[0].series.photos.map((frame: { id: string }) => frame.id)).toEqual(["series-fixture-photo-1", "series-fixture-photo-2"]);
  expect(grouped.photos[0].series.shooting).toEqual({});
  const overview = viewer.getByRole("region", { name: "組写真の全体" });
  const frames = overview.locator("[data-photo-series-frame]");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => thumbnail.evaluateAll(images => {
      const first = images[0].getBoundingClientRect();
      const last = images.at(-1)!.getBoundingClientRect();
      return first.width > 0 && last.width > 0 && last.left > first.right;
    })).toBe(true);
    await tiles.hover();
    await expect(tiles.locator("[data-photo-title]")).toHaveText("光のあいだ");
    await expect(tiles.locator(".photo-exif")).toBeHidden();
    await tiles.locator(".photo-open").click();
    await expect(viewer.locator("#photo-information [data-photo-title]")).toHaveText("光のあいだ");
    await expect(viewer.locator("#photo-information [data-photo-caption]")).toHaveText("組写真の説明");
    await expect(viewer.locator("#photo-information .photo-exif")).toBeHidden();
    await expect.poll(async () => {
      const layout = (await overview.boundingBox())!, details = (await viewer.locator("#photo-information").boundingBox())!;
      return width > 768 ? layout.x + layout.width < details.x : layout.y + layout.height < details.y;
    }).toBe(true);
    await expect(frames).toHaveCount(2);
    const placement = (element: Element) => {
      const style = (element as HTMLElement).style;
      return [style.left, style.top, style.width, style.height, style.transform];
    };
    expect(await thumbnail.last().evaluate(placement)).toEqual(await frames.last().evaluate(placement));
    await expect.poll(() => frames.evaluateAll(buttons => buttons.every(button => button.querySelector("img")!.naturalWidth > 0))).toBe(true);
    await expect(frames.last()).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
    const first = (await frames.first().boundingBox())!, second = (await frames.last().boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x + first.width);
    expect(second.x + second.width).toBeLessThan(width);
    await viewer.screenshot({ path: info.outputPath(`series-layout-${width}.png`) });
    await frames.last().click();
    await expect(overview).toBeHidden();
    await expect(viewer.locator("[data-photo-image]")).toHaveAttribute("src", /\/full\/series-fixture-photo-2\?/);
    await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await viewer.getByRole("button", { name: "写真の情報を表示" }).click();
    await expect(viewer.locator("[data-photo-film]")).toHaveText("Ilford HP5 Plus");
    await expect(viewer.locator("[data-photo-film]")).toBeVisible();
    await viewer.getByRole("button", { name: "前の写真" }).click();
    await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    await viewer.getByRole("button", { name: "組写真の全体へ" }).click();
    await expect(overview).toBeVisible();
    await expect(viewer.locator("#photo-information .photo-exif")).toBeHidden();
    await viewer.getByRole("button", { name: "写真を閉じる" }).click();
  }
  await page.goto(`${url}?photo=series-fixture-photo-2`);
  await expect(viewer).toBeVisible();
  await expect(overview).toBeHidden();
  await expect(viewer.locator("[data-photo-image]")).toHaveAttribute("src", /\/full\/series-fixture-photo-2\?/);
  expect(errors).toEqual([]);
});

test("Gallery arrows continue through the album from a series overview", async ({ page }, info) => {
  await images(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/Gallery/gallery-works-${info.project.name}`);
    const cards = page.locator(".photo-wrapper");
    const series = cards.filter({ has: page.getByRole("link", { name: /組写真.*を開く/ }) });
    const neighbors = cards.filter({ hasNot: page.locator(".photo-series-thumbnail") }).locator(".photo-open");
    const nextPath = new URL((await neighbors.first().getAttribute("href"))!, page.url()).pathname;
    const previousPath = new URL((await neighbors.last().getAttribute("href"))!, page.url()).pathname;
    const viewer = page.locator("#photo-dialog");
    const overview = viewer.getByRole("region", { name: "組写真の全体" });
    const previous = viewer.getByRole("button", { name: "前の写真" });
    const next = viewer.getByRole("button", { name: "次の写真" });
    const image = viewer.locator("[data-photo-image]");
    const frames = overview.locator("[data-photo-series-frame]");
    await series.locator(".photo-open").click();
    await expect(overview).toBeVisible();
    await expect(next).toBeVisible();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(overview).toBeHidden();
    await expect(image).toBeVisible();
    await expect.poll(async () => new URL((await image.getAttribute("src"))!, page.url()).pathname).toBe(nextPath);
    await page.keyboard.press("ArrowLeft");
    await expect(overview).toBeVisible();
    await frames.last().click();
    await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await next.click();
    await expect(viewer.locator("[data-photo-position]")).toHaveText("1 / 2");
    await viewer.getByRole("button", { name: "組写真の全体へ" }).click();
    await previous.click();
    await expect(overview).toBeHidden();
    await expect(image).toBeVisible();
    await expect.poll(async () => new URL((await image.getAttribute("src"))!, page.url()).pathname).toBe(previousPath);
    await next.click();
    await expect(overview).toBeVisible();
    await expect(frames).toHaveCount(2);
    await viewer.getByRole("button", { name: "写真を閉じる" }).click();
  }
});

test("staff can choose a cover and restrict an exhibition album across Gallery, search and image links", async ({ browser }, info) => {
  const origin = "http://127.0.0.1:4329", albumId = "gallery-series-fixture", url = `/Gallery/${albumId}`;
  const staff = await browser.newContext({ baseURL: origin }), member = await browser.newContext({ baseURL: origin }), anonymous = await browser.newContext({ baseURL: origin });
  const api = `/api/member/gallery/${albumId}/settings`, headers = { Origin: origin };
  const login = async (context: typeof staff, email: string) => {
    const response = await fixtureLogin(context.request, "/api/auth/login", { headers, data: { email, password: "fixture-password-123" } });
    expect(response.ok()).toBe(true);
  };
  const page = await staff.newPage(), publicPage = await anonymous.newPage(), memberPage = await member.newPage();
  await Promise.all([images(page), images(publicPage), images(memberPage)]);
  let revision: number | undefined;
  try {
    await publicPage.goto(url);
    await expect(publicPage.locator(".justified-grid .photo-open")).toHaveCount(1);
    const signedImage = (await publicPage.locator(".justified-grid .photo-open").first().getAttribute("href"))!;
    await expect(publicPage.getByRole("button", { name: "アルバム設定" })).toHaveCount(0);
    expect((await anonymous.request.post(api, { headers, data: {} })).status()).toBe(401);
    await login(member, "member@example.invalid");
    expect((await member.request.post(api, { headers, data: {} })).status()).toBe(403);
    await login(staff, `photo-staff-${info.project.name}@example.invalid`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    const settings = page.locator("[data-gallery-settings]");
    const initialRevision = Number(await settings.getAttribute("data-revision"));
    expect((await staff.request.post(api, { headers, data: { revision: initialRevision, visibility: "public", coverPhotoId: "series-fixture-photo-3" } })).status()).toBe(400);
    const trigger = page.getByRole("button", { name: "アルバム設定" });
    await expect(trigger.locator("svg")).toBeVisible();
    const titleBox = (await page.locator(".album-title h1").boundingBox())!, buttonBox = (await trigger.boundingBox())!;
    expect(buttonBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1);
    expect(Math.abs(titleBox.y + titleBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(2);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "アルバム設定" });
    await expect(dialog.getByLabel("公開範囲")).toHaveValue("public");
    await dialog.getByLabel("公開範囲").selectOption("members");
    await dialog.getByRole("button", { name: "組写真-2.jpgをカバーにする" }).click();
    await expect(dialog.getByRole("button", { name: "組写真-2.jpgをカバーにする" })).toHaveAttribute("aria-pressed", "true");
    await dialog.screenshot({ path: info.outputPath("album-settings-mobile.png") });
    await dialog.getByRole("button", { name: "設定を保存" }).click();
    await expect(page.locator(".album-title").getByRole("img", { name: "会員限定" })).toBeVisible();
    revision = Number(await settings.getAttribute("data-revision"));
    expect(revision).toBe(initialRevision + 1);
    expect((await staff.request.post(api, { headers, data: { revision: initialRevision, visibility: "public", coverPhotoId: null } })).status()).toBe(409);
    const coverPath = `/api/gallery/${albumId}/cover`;
    for (const path of [url, `/api/gallery/${albumId}`, signedImage, coverPath]) expect((await anonymous.request.get(path)).status()).toBe(404);
    for (const path of ["/Gallery", "/sitemap.xml", `/SearchResult?q=${encodeURIComponent("組写真の公開確認")}`]) {
      expect(await (await anonymous.request.get(path)).text()).not.toContain(url);
    }
    await memberPage.goto("/Gallery");
    const panel = memberPage.locator(".tab-panel:visible");
    await panel.locator("summary").filter({ hasText: "展示" }).click();
    const cover = panel.locator(`.gallery-link[href="${url}"]`);
    await cover.scrollIntoViewIfNeeded();
    await expect(cover.locator("img")).toHaveAttribute("src", new RegExp(`${coverPath}(?:\\?size=320)?$`));
    await expect(cover.getByRole("img", { name: "会員限定" })).toHaveCount(1);
    const photos = await (await member.request.get(`/api/gallery/${albumId}`)).json();
    const expectedCover = photos.photos.find((photo: { id: string }) => photo.id === "series-fixture-photo-2");
    const memberCover = await member.request.get(coverPath);
    expect(memberCover.status()).toBe(200);
    expect(memberCover.headers()["cache-control"]).toBe("private, no-store");
    expect(await memberCover.body()).toEqual(await (await member.request.get(expectedCover.src)).body());
    await memberPage.goto(url);
    await expect(memberPage.locator(".album-title").getByRole("img", { name: "会員限定" })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "アルバム設定" })).toHaveCount(0);
    const restricted = await staff.request.post(api, { headers, data: { revision, visibility: "staff", coverPhotoId: expectedCover.id } });
    expect(restricted.status()).toBe(200);
    ++revision;
    expect((await member.request.get(coverPath)).status()).toBe(404);
    expect((await member.request.get(signedImage)).status()).toBe(404);
    expect((await staff.request.get(coverPath)).status()).toBe(200);
  } finally {
    if (revision !== undefined) await staff.request.post(api, { headers, data: { revision, visibility: "public", coverPhotoId: null } });
    await Promise.all([staff.close(), member.close(), anonymous.close()]);
  }
});

test("album settings keep header controls and save visible while the cover list scrolls", async ({ page }, info) => {
  await images(page);
  const login = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:4329" },
    data: { email: `photo-staff-${info.project.name}@example.invalid`, password: "fixture-password-123" },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/Gallery/public-album");
  const trigger = page.getByRole("button", { name: "アルバム設定" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "アルバム設定" });
  const thumbnails = dialog.locator("[data-gallery-cover-photos] button");
  const scroll = dialog.locator("[data-gallery-settings-scroll]");
  await expect(thumbnails).toHaveCount(30);
  for (const [width, height] of [[1440, 900], [320, 568], [390, 844], [667, 375]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => dialog.evaluate(element => {
      const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect(), heading = rect(".gallery-settings-head");
      const help = rect("[data-help-open]"), close = rect("[data-close-gallery-settings]"), save = rect("button[type=submit]");
      const visibility = rect("select[name=visibility]");
      const list = element.querySelector("[data-gallery-settings-scroll]")!;
      const thumbnail = rect("[data-gallery-cover-photos] button");
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight &&
        help.top >= heading.top && help.bottom <= heading.bottom && help.right < close.left &&
        Math.abs(help.top - close.top) < 2 && save.bottom <= bounds.bottom && visibility.height >= 44 &&
        thumbnail.top < list.getBoundingClientRect().bottom && Math.abs(thumbnail.width - thumbnail.height) < 1 &&
        list.scrollWidth <= list.clientWidth + 1 &&
        ((innerWidth > 480 && innerHeight > 450) || list.scrollHeight > list.clientHeight);
    })).toBe(true);
    await dialog.screenshot({ path: info.outputPath(`album-settings-${width}.png`), animations: "disabled" });
  }
  const more = dialog.getByRole("button", { name: "写真をさらに表示" });
  await more.click();
  await expect(thumbnails).toHaveCount(60);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const cover = thumbnails.nth(45);
  await cover.click();
  await expect(cover).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "設定を保存" })).toBeInViewport();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
});

for (const albumId of ["public-album", "gallery-series-fixture"]) {
  test(`album settings hide and restore photos in ${albumId} without leaving an accessible Gallery link`, async ({ page, browser }, info) => {
    const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
    const settings = `/api/member/gallery/${albumId}`, album = `/Gallery/${albumId}`;
    const local = albumId === "gallery-series-fixture";
    const photoId = local ? "series-fixture-photo-1" : "photo-0";
    const anonymous = await browser.newContext({ baseURL: origin });
    const getExclusions = async () => (await page.request.get(`${settings}/exclusions`)).json();
    let original: string[] | undefined;
    try {
      await images(page);
      const login = await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: `photo-staff-${info.project.name}@example.invalid`, password: "fixture-password-123" } });
      expect(login.ok()).toBe(true);
      expect((await anonymous.request.get(`${settings}/exclusions`)).status()).toBe(401);
      const gallery = await (await anonymous.request.get(`/api/gallery/${albumId}`)).json();
      const publicPhoto = gallery.photos.find((photo: { id: string }) => photo.id === photoId);
      expect((await anonymous.request.get(publicPhoto.full)).status()).toBe(200);
      const start = await getExclusions();
      original = start.excludedPhotoIds;
      const preview = start.photos.find((photo: { id: string }) => photo.id === photoId).src;
      expect((await anonymous.request.get(preview)).status()).toBe(404);
      expect((await page.request.get(preview)).status()).toBe(200);
      const invalid = await page.request.post(`${settings}/exclusions`, { headers, data: { revision: start.revision, excludedPhotoIds: ["nonexistent-photo"] } });
      expect(invalid.status()).toBe(400);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(album);
      const open = async () => {
        await page.getByRole("button", { name: "アルバム設定" }).click();
        const dialog = page.getByRole("dialog", { name: "アルバム設定" });
        await dialog.getByRole("button", { name: "公開しない写真", exact: true }).click();
        return dialog;
      };
      let dialog = await open();
      const selected = () => dialog.locator(`[data-exclusion-id="${photoId}"]`);
      if (local) {
        await expect(dialog.locator("[data-exclusion-id]")).toHaveCount(3);
        await expect(dialog.locator('[data-exclusion-id="series-fixture-photo-3"]')).toHaveAttribute("aria-pressed", "true");
      }
      await selected().click();
      await expect(selected()).toHaveAttribute("aria-pressed", "true");
      if (local) {
        await dialog.locator('[data-exclusion-id="series-fixture-photo-2"]').click();
        await expect(dialog.locator("[data-gallery-exclusion-count]")).toHaveText("非公開 3枚");
        await dialog.screenshot({ path: info.outputPath("album-exclusions-mobile.png"), animations: "disabled" });
      }
      await dialog.getByRole("button", { name: "非公開設定を保存" }).click();
      await expect(dialog).toBeHidden();
      const hidden = await getExclusions();
      expect(hidden.excludedPhotoIds).toContain(photoId);
      expect((await page.request.post(`${settings}/exclusions`, { headers, data: { revision: start.revision, excludedPhotoIds: [] } })).status()).toBe(409);
      const publicPage = await (await anonymous.request.get(`/api/gallery/${albumId}`)).json();
      expect(publicPage.photos.map((photo: { id: string }) => photo.id)).not.toContain(photoId);
      for (const url of [publicPhoto.full, publicPhoto.src]) expect((await anonymous.request.get(url)).status()).toBe(404);
      const proof = new URL(publicPhoto.full, origin).searchParams.get("proof");
      const ref = { source: "gallery", containerId: albumId, imageId: photoId, proof };
      const detail = await anonymous.request.post("/api/photos/state", { headers, data: { refs: [ref] } });
      expect((await detail.json()).results[0].ok).toBe(false);
      if (local) {
        expect(publicPage.photos).toHaveLength(0);
        const picker = await (await page.request.get("/api/member/exhibitions/f5100000-0000-4000-8000-000000000001/album-photos")).json();
        const asset = picker.photos.find((photo: { name: string }) => photo.name === "組写真-1.jpg");
        expect(picker.excludedAssetIds).toContain(asset.id);
      } else {
        const body = { revision: hidden.revision, visibility: "public", coverPhotoId: "photo-1" };
        expect((await page.request.post(`${settings}/settings`, { headers, data: body })).ok()).toBe(true);
        expect((await getExclusions()).excludedPhotoIds).toContain(photoId);
        await page.reload();
      }
      dialog = await open();
      await expect(selected()).toHaveAttribute("aria-pressed", "true");
      await selected().click();
      if (local) await dialog.locator('[data-exclusion-id="series-fixture-photo-2"]').click();
      await dialog.getByRole("button", { name: "非公開設定を保存" }).click();
      await expect(dialog).toBeHidden();
      expect((await getExclusions()).excludedPhotoIds).toEqual(original);
      expect((await anonymous.request.get(publicPhoto.full)).status()).toBe(200);
    } finally {
      if (original) {
        const current = await getExclusions();
        await page.request.post(`${settings}/exclusions`, { headers, data: { revision: current.revision, excludedPhotoIds: original } });
        if (!local) {
          const restored = await getExclusions();
          await page.request.post(`${settings}/settings`, { headers, data: { revision: restored.revision, visibility: "public", coverPhotoId: null } });
        }
      }
      await anonymous.close();
    }
  });
}
