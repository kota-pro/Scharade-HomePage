import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
const pageApi = (page: Page, path: string) => page.request.get(path, { maxRedirects: 0 });

async function login(page: Page, id: string) {
  const response = await fixtureLogin(page.request, "/api/auth/login", {
    headers,
    data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(response.status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "images.microcms-assets.io") return route.fulfill({ path: "public/media/site/activity/Photo1-480.webp", contentType: "image/webp" });
    return url.origin === origin ? route.continue() : route.abort();
  });
});

test("content management pages and APIs enforce staff access", async ({ page }) => {
  expect((await pageApi(page, "/Management/gallery")).status()).toBe(302);
  expect((await pageApi(page, "/Management/blog/new")).status()).toBe(302);
  expect((await page.request.post("/api/member/blog", { headers, data: {} })).status()).toBe(401);
  await login(page, "other");
  expect((await pageApi(page, "/Management/gallery/new")).status()).toBe(403);
  expect((await pageApi(page, "/Management/blog/edit/post")).status()).toBe(403);
  expect((await page.request.delete("/api/member/blog/articles/post", { headers, data: {} })).status()).toBe(403);
  expect((await page.request.post("/api/member/gallery", { headers, data: {} })).status()).toBe(403);
  expect((await page.request.post("/Management/blog/preview", { headers, form: { content: "{}" } })).status()).toBe(403);
  await login(page, "planner");
  await page.goto("/Management");
  await expect(page.getByRole("link", { name: /Galleryのアルバム管理/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Activityのブログ管理/ })).toBeVisible();
});

test("authenticated HTTPS management responses fit the production proxy header buffer", async ({ request }) => {
  const forwarded = {
    Origin: "https://scharade.jp",
    "X-Forwarded-Host": "scharade.jp",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Port": "443",
  };
  const login = await fixtureLogin(request, "/api/auth/login", {
    headers: forwarded,
    data: { email: "planner@example.invalid", password: "fixture-password-123" },
  });
  expect(login.status()).toBe(200);
  const cookie = login.headersArray()
    .filter(header => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("__Host-"))
    .map(header => header.value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("__Host-mfa-browser=");
  for (const route of ["/Management", "/Management/gallery", "/Management/blog", "/Management/blog/new"]) {
    const response = await request.get(route, {
      headers: { ...forwarded, Cookie: cookie, Accept: "text/html" },
      maxRedirects: 0,
    });
    expect(response.status(), route).toBe(200);
    const headers = response.headersArray();
    expect(headers.some(header => header.name.toLowerCase() === "set-cookie" &&
      header.value.startsWith("__Host-mfa-browser=")), route).toBe(true);
    const headerBytes = Buffer.byteLength("HTTP/1.1 200 OK\r\n\r\n") +
      headers.reduce((size, header) => size + Buffer.byteLength(`${header.name}: ${header.value}\r\n`), 0);
    expect(headerBytes, route).toBeLessThanOrEqual(4096);
  }
});

test("blog settings sit above a full-width editor and secondary actions use outlines", async ({ page }, info) => {
  await login(page, "planner");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/Management/blog");
  const editPath = (await page.getByRole("link", { name: "撮影会のお知らせ", exact: true }).getAttribute("href"))!;
  const create = page.getByRole("link", { name: "新規作成" });
  await expect(create).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await create.hover();
  await expect(create).toHaveCSS("background-color", "rgb(232, 232, 232)");
  await expect(create).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
  await create.click();
  const settings = page.getByRole("region", { name: "記事の設定" });
  const editor = page.getByRole("textbox", { name: "本文" });
  const tools = page.getByRole("group", { name: "本文の編集ツール" });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const settingsBox = (await settings.boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    expect(editorBox.y).toBeGreaterThan(settingsBox.y + settingsBox.height);
    expect(editorBox.width).toBeCloseTo(settingsBox.width, 0);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const gutter = width >= 1024 ? 120 : 16;
    expect(editorBox.x).toBeCloseTo(gutter, 0);
    expect(clientWidth - editorBox.x - editorBox.width).toBeCloseTo(gutter, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const size = tools.getByRole("combobox", { name: "文字サイズ" });
    await expect(size).toHaveCSS("color", "rgba(0, 0, 0, 0)");
    await expect(size).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (width === 1440) {
      const bold = (await tools.getByRole("button", { name: "太字" }).boundingBox())!;
      const expand = (await tools.getByRole("button", { name: "全画面で編集" }).boundingBox())!;
      expect(expand.y).toBeCloseTo(bold.y, 0);
    }
    if (info.project.name === "chromium" && (width === 1440 || width === 390))
      await page.locator("[data-blog-editor]").screenshot({ path: info.outputPath(`wide-editor-${width}.png`) });
  }
  await expect(tools.getByRole("button", { name: "太字" }).locator("svg")).toBeVisible();
  await expect(tools.getByRole("button", { name: "コードブロック" }).locator("svg")).toBeVisible();
  await expect(tools.getByRole("combobox", { name: "段落・見出し" })).toBeVisible();
  await expect(page.getByRole("button", { name: "プレビュー", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "下書き保存" })).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(editPath);
  const existingBox = (await editor.boundingBox())!;
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(existingBox.x).toBeCloseTo(120, 0);
  expect(clientWidth - existingBox.x - existingBox.width).toBeCloseTo(120, 0);
});

test("Activity article links use the original unframed icon", async ({ page }) => {
  await page.goto("/Activity");
  const article = page.locator(".Activity-item > a:visible").first();
  const icon = article.locator('img.link-button[src="/icons/link.svg"]');
  for (const [width, iconWidth, padding] of [[1440, 50, 15], [700, 40, 10], [320, 34, 8]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.mouse.move(0, 0);
    await expect(icon).toHaveCSS("width", `${iconWidth}px`);
    await expect(icon).toHaveCSS("padding-top", `${padding}px`);
    await expect(icon).toHaveCSS("border-top-width", "0px");
    await expect(icon).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await icon.hover();
    await expect(icon).toHaveCSS("background-color", "rgb(240, 240, 240)");
  }
  const href = (await article.getAttribute("href"))!;
  await icon.click();
  await expect(page).toHaveURL(new URL(href, origin).href);
});

test("the blog toolbar stays visible while long content scrolls within the editor", async ({ page }) => {
  await login(page, "planner");
  await page.goto("/Management/blog/new");
  const editor = page.getByRole("textbox", { name: "本文" });
  const tools = page.getByRole("group", { name: "本文の編集ツール" });
  await editor.evaluate(body => {
    body.replaceChildren(...Array.from({ length: 100 }, (_, index) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = `本文の段落 ${index + 1}`;
      return paragraph;
    }));
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await editor.evaluate(body => { body.scrollTop = 0; });
    await tools.evaluate(toolbar => {
      window.scrollTo({ top: 0, behavior: "instant" });
      window.scrollBy({ top: toolbar.getBoundingClientRect().top - 48, behavior: "instant" });
    });
    const header = (await page.getByRole("banner").first().boundingBox())!;
    await expect.poll(async () => (await tools.boundingBox())!.y).toBeCloseTo(header.y + header.height, 0);

    const editorBox = (await editor.boundingBox())!;
    expect(editorBox.height).toBeCloseTo(900 * 0.85, 0);
    expect(await editor.evaluate(body => body.scrollHeight)).toBeGreaterThan(editorBox.height);
    const pageScroll = await page.evaluate(() => window.scrollY);
    const toolbarY = (await tools.boundingBox())!.y;
    await page.mouse.move(editorBox.x + 24, toolbarY + (await tools.boundingBox())!.height + 24);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => editor.evaluate(body => body.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(pageScroll, 0);
    expect((await tools.boundingBox())!.y).toBeCloseTo(toolbarY, 0);
  }

  await tools.getByRole("button", { name: "全画面で編集" }).click();
  await editor.evaluate(body => { body.scrollTop = 0; });
  const expandedToolsY = (await tools.boundingBox())!.y;
  const expandedBox = (await editor.boundingBox())!;
  expect(expandedBox.y + expandedBox.height).toBeLessThanOrEqual(900);
  await page.mouse.move(expandedBox.x + 24, expandedBox.y + 24);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => editor.evaluate(body => body.scrollTop)).toBeGreaterThan(0);
  expect((await tools.boundingBox())!.y).toBeCloseTo(expandedToolsY, 0);
  await page.keyboard.press("Escape");
  await expect(tools.getByRole("button", { name: "全画面で編集" })).toBeVisible();
});

test("the blog preview matches the published article at desktop and phone widths", async ({ page }) => {
  await login(page, "planner");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/Management/blog/edit/post");
  const article = await page.context().newPage();
  await article.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "images.microcms-assets.io") return route.fulfill({ path: "public/media/site/activity/Photo1-480.webp", contentType: "image/webp" });
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "プレビュー" });
  const frame = dialog.frameLocator("iframe");
  await expect(frame.locator(".post-body .taped-image img")).toHaveCount(1);
  const view = (body: Element) => {
    const styles = (selector: string) => {
      const node = body.querySelector<HTMLElement>(selector)!;
      const css = getComputedStyle(node);
      return [Math.round(node.offsetWidth), css.fontSize, css.borderTopWidth, css.getPropertyValue("--tape-url"), css.getPropertyValue("--tape-rotate")];
    };
    return {
      viewport: [innerWidth, innerHeight],
      title: styles(".post-title"),
      content: styles(".post-body"),
      photo: styles(".post-body .taped-image img"),
      leadPhoto: styles(".post-eyecatch img"),
      breadcrumbs: body.querySelector(".breadcrumb-bar")?.textContent?.replace(/\s+/g, " ").trim(),
      back: body.querySelector(".back-link a")?.textContent?.trim(),
    };
  };
  try {
    for (const [name, width, height] of [["PC幅", 1440, 900], ["スマートフォン幅", 390, 844]] as const) {
      await dialog.getByRole("button", { name, exact: true }).click();
      await article.setViewportSize({ width, height });
      await article.goto("/posts/test-post?from=activity");
      await expect(article.locator(".post-body .taped-image img")).toHaveCount(1);
      for (const root of [article, frame]) {
        await root.locator(".post-body .taped-image img").evaluate(image => (image as HTMLImageElement).decode());
        await root.locator(".post-eyecatch img").evaluate(image => (image as HTMLImageElement).decode());
        await root.locator("body").evaluate(() => document.fonts.ready.then(() => undefined));
      }
      const published = await article.locator("body").evaluate(view);
      expect(published.viewport).toEqual([width, height]);
      await expect.poll(() => frame.locator("body").evaluate(view)).toEqual(published);
    }
  } finally { await article.close(); }
});

test.describe("blog preview on touch screens", () => {
  test.use({ hasTouch: true });

  test("blog preview opens under the production no-referrer policy and closes from the backdrop or upper-right button", async ({ page }) => {
    await login(page, "planner");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/Management/blog/new", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "Referrer-Policy": "no-referrer" } });
    });
    await page.goto("/Management/blog/new");
    const open = page.getByRole("button", { name: "プレビュー", exact: true });
    const preview = page.getByRole("dialog", { name: "プレビュー" });
    await page.getByLabel("タイトル", { exact: true }).fill("確認用の撮影会");
    await page.getByRole("textbox", { name: "本文" }).fill("本文のプレビュー");
    const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/Management/blog/preview");
    await open.click();
    const response = await posted;
    expect(response.status()).toBe(200);
    expect(response.request().isNavigationRequest()).toBe(false);
    expect((await response.request().allHeaders()).origin).toBe(origin);
    await expect(preview.frameLocator("iframe").locator(".post-title")).toHaveText("確認用の撮影会");
    await expect(preview.frameLocator("iframe").locator(".post-body")).toHaveText("本文のプレビュー");

    const title = preview.getByRole("heading", { name: "プレビュー" });
    const close = preview.getByRole("button", { name: "閉じる", exact: true });
    const closeBox = (await close.boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    expect(closeBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    expect(Math.abs(closeBox.y + closeBox.height / 2 - titleBox.y - titleBox.height / 2)).toBeLessThan(2);
    await expect(close.locator("span")).toHaveCount(2);
    await title.tap();
    await expect(preview).toBeVisible();
    const previewBox = (await preview.boundingBox())!;
    await page.touchscreen.tap(previewBox.x / 2, previewBox.y + previewBox.height / 2);
    await expect(preview).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await expect(preview.frameLocator("iframe").locator(".post-title")).toHaveText("確認用の撮影会");
    await close.tap();
    await expect(preview).toBeHidden();
    await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue("確認用の撮影会");
    expect((await page.request.post("/Management/blog/preview", {
      headers: { Origin: "https://foreign.example.invalid" },
      form: { content: "{}" },
    })).status()).toBe(403);
  });
});

test("staff publish and remove Lightroom albums and retry a partial upload", async ({ page }, info) => {
  await login(page, "planner");
  await page.goto("/Management/gallery");
  await page.getByRole("link", { name: "新規作成" }).click();
  const name = `運営作成アルバム ${info.project.name}`;
  await page.getByLabel("アルバム名").fill(name);
  await page.getByLabel("分類").selectOption("shooting");
  await page.getByRole("button", { name: "アルバムを作成" }).click();
  await expect(page).toHaveURL(/\/Management\/gallery\/[a-f0-9]{32}$/);
  await expect(page.getByLabel("公開範囲")).toHaveValue("staff");
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("[data-gallery-editor]").screenshot({ path: info.outputPath("album-management-desktop.png") });
  }
  const id = page.url().split("/").at(-1)!;
  const visitor = await page.context().browser()!.newContext();
  expect((await visitor.request.get(origin + `/Gallery/${id}`)).status()).toBe(404);

  const image = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#8a7656" } }).png().toBuffer();
  await page.locator("input[name=photos]").setInputFiles({ name: "retry-camera.png", mimeType: "image/png", buffer: image });
  const upload = page.waitForResponse(response => response.url().endsWith("/upload"));
  await page.getByRole("button", { name: "Lightroomにアップロード" }).click();
  expect((await upload).status()).toBe(503);
  const retry = page.getByRole("button", { name: "再試行", exact: true });
  await expect(retry).toBeVisible();
  const interrupted = page.waitForResponse(response => response.url().endsWith("/upload"));
  await retry.click();
  expect((await interrupted).status()).toBe(503);
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByText(/アップロード済み/)).toBeVisible();
  const album = await (await page.request.get(`/api/gallery/${id}`)).json();
  expect(album.photos).toHaveLength(1);
  expect((await visitor.request.get(origin + album.photos[0].src)).status()).toBe(404);
  await page.getByRole("button", { name: "カバー・掲載写真" }).click();
  const photos = page.getByRole("dialog", { name: "カバー・掲載写真" });
  await photos.getByRole("button", { name: "retry-camera.pngをカバーにする" }).click();
  await photos.getByRole("button", { name: "設定を保存" }).click();
  await expect(photos).toBeHidden();

  await page.getByLabel("公開範囲").selectOption("public");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect.poll(async () => (await visitor.request.get(origin + album.photos[0].src)).status()).toBe(200);
  await expect(page.getByLabel("公開範囲")).toHaveValue("public");
  await page.getByRole("button", { name: "アルバムを削除", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "アルバムを削除" });
  await expect(confirmation).toContainText(name);
  await confirmation.getByRole("checkbox").check();
  await confirmation.getByRole("button", { name: "削除を確定" }).click();
  await expect(page).toHaveURL(/\/Management\/gallery\?deleted=1/);
  expect((await visitor.request.get(origin + album.photos[0].src)).status()).toBe(404);

  const existingId = `site-management-album-${info.project.name}`;
  await page.goto(`/Management/gallery/${existingId}`);
  await page.locator("input[name=photos]").setInputFiles({ name: "existing-camera.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "Lightroomにアップロード" }).click();
  await expect(page.getByText(/アップロード済み/)).toBeVisible();
  let cursor: string | null = null;
  const findings: Array<{ id: string; src: string; name: string }> = [];
  do {
    const result = await (await page.request.get(`/api/gallery/${existingId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)).json();
    findings.push(...result.photos);
    cursor = result.nextCursor;
  } while (cursor && findings.length < 100);
  expect(findings).toHaveLength(36);
  const added = findings.find(item => item.name === "existing-camera.png");
  expect(added).toBeDefined();
  expect((await page.request.get(added!.src)).status()).toBe(200);
  expect((await visitor.request.get(origin + added!.src)).status()).toBe(404);
  await page.getByRole("button", { name: "アルバムを削除", exact: true }).click();
  await expect(confirmation).toContainText("元のアルバムは保存先に残ります");
  await confirmation.getByRole("checkbox").check();
  await confirmation.getByRole("button", { name: "削除を確定" }).click();
  await expect(page).toHaveURL(/\/Management\/gallery\?deleted=1/);
  expect((await page.request.get(added!.src)).status()).toBe(404);
  await visitor.close();
});

test("staff preview unsaved rich posts, publish, update, unpublish, and delete", async ({ page, request }, info) => {
  await login(page, "planner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Management/blog");
  await expect(page.getByRole("link", { name: "撮影会のお知らせ", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "新規作成" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThan(2);
  const slug = `管理ブログ-${info.project.name}`;
  const path = `/posts/${encodeURIComponent(slug)}`;
  async function expectPublicListings(listed: boolean, title?: string) {
    const search = `/SearchResult?category=activity&q=${encodeURIComponent("撮影会")}`;
    await Promise.all(["/Activity", search, "/sitemap.xml"].map(async listing => {
      const response = await request.get(listing, { maxRedirects: 0 });
      expect(response.status(), listing).toBe(200);
      const body = await response.text();
      expect(body.includes(path), listing).toBe(listed);
      if (title && listing !== "/sitemap.xml") expect(body, listing).toContain(title);
    }));
  }
  await page.getByLabel("タイトル", { exact: true }).fill("公開前の撮影会");
  await page.getByLabel("記事URL").fill(slug);
  const editor = page.getByRole("textbox", { name: "本文" });
  await editor.fill("太字の本文");
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "太字", exact: true }).click();
  await expect(editor.locator("b,strong")).toHaveText("太字の本文");
  await editor.press("ArrowRight");
  await editor.press("Enter");
  await page.getByRole("button", { name: "表", exact: true }).click();
  await page.getByRole("button", { name: "適用", exact: true }).click();
  await expect(editor.locator("table td")).toHaveCount(2);
  await editor.locator("table th").first().click();
  await page.getByRole("combobox", { name: "表を編集" }).selectOption("merge");
  await page.getByRole("button", { name: "適用", exact: true }).click();
  await expect(editor.locator("table th")).toHaveAttribute("colspan", "2");
  await editor.locator("table th").click();
  await page.getByRole("combobox", { name: "表を編集" }).selectOption("split");
  await expect(editor.locator("table tr").first().locator("th,td")).toHaveCount(2);
  await page.getByRole("button", { name: "全画面で編集" }).click();
  await expect(page.getByRole("button", { name: "全画面を閉じる" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "全画面で編集" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "記事写真を追加" }).click();
  const mediaDialog = page.getByRole("dialog", { name: "記事写真を追加" });
  await mediaDialog.getByText("既存のメディアから選ぶ").click();
  await mediaDialog.getByRole("button", { name: "gallery-editor.jpg" }).click();
  await mediaDialog.getByRole("button", { name: "適用" }).click();
  await expect(mediaDialog).toBeHidden();
  if (info.project.name === "chromium")
    await page.locator("[data-blog-editor]").screenshot({ path: info.outputPath("blog-management-mobile.png") });
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "プレビュー" });
  const frame = preview.frameLocator("iframe");
  await expect(frame.locator(".post-title")).toHaveText("公開前の撮影会");
  await expect(frame.locator(".post-body strong")).toHaveText("太字の本文");
  await expect(frame.locator(".post-body table tr").first().locator("th,td")).toHaveCount(2);
  await expect(frame.locator(".post-pictures img")).toHaveAttribute("src", /gallery-editor\.jpg/);
  await preview.getByRole("button", { name: "スマートフォン幅" }).click();
  await expect(preview.locator("iframe")).toHaveAttribute("data-mobile", "");
  expect((await pageApi(page, path)).status()).toBe(404);
  await preview.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue("公開前の撮影会");
  await page.getByRole("button", { name: "下書き保存" }).click();
  await expect(page).toHaveURL(/\/Management\/blog\/edit\/b-[a-f0-9]+\?saved=1/);
  expect((await pageApi(page, path)).status()).toBe(404);
  await expectPublicListings(false);
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/saved=publish/);
  await expect(page.getByLabel("記事URL")).toHaveAttribute("readonly", "");
  expect((await pageApi(page, path)).status()).toBe(200);
  await expectPublicListings(true, "公開前の撮影会");
  const editorForm = page.locator("[data-blog-editor]");
  const endpoint = (await editorForm.getAttribute("data-endpoint"))!;
  const publishedRevision = await editorForm.getAttribute("data-updated-at");
  await page.getByLabel("タイトル", { exact: true }).fill("公開後に更新した撮影会");
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(frame.locator(".post-title")).toHaveText("公開後に更新した撮影会");
  expect(await (await pageApi(page, path)).text()).toContain("公開前の撮影会");
  await preview.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "公開内容を更新" }).click();
  await expect(page.getByRole("heading", { name: "公開後に更新した撮影会" })).toBeVisible();
  expect(await (await pageApi(page, path)).text()).toContain("公開後に更新した撮影会");
  await expectPublicListings(true, "公開後に更新した撮影会");
  const stale = await page.request.patch(endpoint, { headers, data: { action: "save", title: "上書き確認", updatedAt: publishedRevision } });
  expect(stale.status()).toBe(409);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "公開を取り下げる" }).click();
  await expect(page).toHaveURL(/saved=unpublish/);
  expect((await pageApi(page, path)).status()).toBe(404);
  await expectPublicListings(false);
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/saved=publish/);
  await expectPublicListings(true);
  await page.getByRole("button", { name: "記事を削除", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "記事を削除" });
  await expect(confirm).toContainText("公開後に更新した撮影会");
  await confirm.getByRole("checkbox").check();
  await confirm.getByRole("button", { name: "削除を確定" }).click();
  await expect(page).toHaveURL(/\/Management\/blog\?deleted=1/);
  expect((await pageApi(page, path)).status()).toBe(404);
  await expectPublicListings(false);
});

test("staff can delete an existing microCMS article with a reserved screen name as its ID", async ({ page }, info) => {
  const id = ({ chromium: "new", firefox: "media", webkit: "preview" } as Record<string, string>)[info.project.name];
  const title = `既存の編集中記事 ${id}`;
  await login(page, "planner");
  await page.goto("/Management/blog");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(`${origin}/Management/blog/edit/${id}`);
  await expect(page.getByLabel("記事URL")).toHaveValue(`legacy-${id}`);
  await expect(page.getByLabel("記事URL")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "記事を削除", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "記事を削除" });
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole("checkbox").check();
  await confirmation.getByRole("button", { name: "削除を確定" }).click();
  await expect(page).toHaveURL(`${origin}/Management/blog?deleted=1`);
  await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  expect((await pageApi(page, `/Management/blog/edit/${id}`)).status()).toBe(404);
});
