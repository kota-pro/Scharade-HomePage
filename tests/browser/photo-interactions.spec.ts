import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
async function login(request: APIRequestContext, email: string) {
  expect((await fixtureLogin(request, "/api/auth/login", { headers, data: { email, password: "fixture-password-123" } })).status()).toBe(200);
}
async function images(page: Page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("microcms-assets.io")) return route.abort();
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#b3c6ce"/><circle cx="600" cy="350" r="120" fill="#f5e9cd"/></svg>' });
  });
}
test("anonymous likes persist; owners open grouped notifications and mark all read", async ({ page, browser }, info) => {
  const engine = info.project.name, ownerId = `photo-owner-${engine}`;
  await images(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/Portfolio/${ownerId}`);
  const visitorCookie = (await page.context().cookies()).find(cookie => cookie.name === "photo-visitor")!;
  expect(visitorCookie.httpOnly).toBe(true);
  await page.locator(".photo-wrapper").first().hover();
  await expect(page.locator(".photo-footer").first()).toContainText("憧憬");
  await expect(page.locator(".photo-hover").first()).toHaveCSS("opacity", "1");
  await page.locator(".photo-wrapper").first().screenshot({ path: info.outputPath("photo-hover-desktop.png") });
  await page.locator(".photo-open").first().click();
  const viewer = page.locator("#photo-dialog"), heart = viewer.locator("[data-photo-like]");
  await expect(viewer).toBeVisible(); await expect(viewer.locator("h2")).toHaveText("憧憬");
  await expect(viewer.locator("[data-photo-caption]")).toContainText("写真のキャプション");
  await expect(heart).toBeEnabled(); await expect(viewer.locator("[data-photo-count]")).toBeHidden();
  await heart.click(); await expect(heart).toHaveAttribute("aria-pressed", "true");
  expect((await page.context().cookies()).find(cookie => cookie.name === "photo-visitor")?.value).toBe(visitorCookie.value);
  await expect(viewer).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("photo-dialog-desktop.png") });
  await page.reload(); await page.locator(".photo-open").first().click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  const context = await browser.newContext({ baseURL: origin }), owner = await context.newPage(); await images(owner);
  try {
    await login(context.request, `${ownerId}@example.invalid`); await owner.goto("/Member");
    const bell = owner.locator('[data-photo-notification-bell][data-placement="member"]:visible');
    for (const width of [1440, 1024, 769]) {
      await owner.setViewportSize({ width, height: 1000 });
      await expect(bell).toHaveCount(1);
      await expect(bell).toHaveCSS("border-top-width", "0px");
      await bell.hover(); await expect(bell).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const button = (await bell.boundingBox())!, intro = (await owner.locator(".member-home-intro .admin-intro").boundingBox())!, body = (await owner.locator(".body-contents").boundingBox())!;
      expect(Math.abs(button.y + button.height / 2 - intro.y - intro.height / 2)).toBeLessThan(1);
      expect(Math.abs(button.x + button.width - body.x - body.width)).toBeLessThan(1);
      expect(intro.x + intro.width).toBeLessThanOrEqual(button.x - 15);
    }
    for (const width of [768, 390, 320]) {
      await owner.setViewportSize({ width, height: 844 });
      await expect(bell).toHaveCount(1);
      const button = (await bell.boundingBox())!, heading = (await owner.locator(".member-title h1").boundingBox())!, row = (await owner.locator(".member-title").boundingBox())!;
      expect(Math.abs(button.y + button.height / 2 - heading.y - heading.height / 2)).toBeLessThan(1);
      expect(Math.abs(button.x + button.width - row.x - row.width)).toBeLessThan(1);
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await bell.click(); await expect(owner.locator("#photo-notifications")).toBeVisible();
    await owner.locator("[data-photo-notifications-close]").click(); await expect(bell).toBeFocused();
    await owner.setViewportSize({ width: 1440, height: 1000 });
    await expect(bell).toHaveAttribute("aria-label", /未読1件/); await bell.click();
    const notices = owner.locator("#photo-notifications");
    await expect(notices.locator("li")).toHaveCount(1); await expect(notices).toContainText("憧憬に1件のいいねがありました。");
    await notices.getByRole("link").click(); await expect(owner).toHaveURL(/Portfolio\/photo-owner-.*photo=/);
    await expect(owner.locator("#photo-dialog")).toBeVisible();
    await expect(owner.locator("#photo-dialog [data-photo-count]")).toHaveText("1");
    await expect.poll(async () => (await (await context.request.get("/api/member/photo-notifications")).json()).unread).toBe(0);
    await page.locator(".photo-open").nth(1).click(); await expect(heart).toBeEnabled(); await heart.click(); await expect(heart).toHaveAttribute("aria-pressed", "true");
    await owner.goto("/Member"); await expect(bell).toHaveAttribute("aria-label", /未読1件/); await bell.click();
    await expect(notices).toContainText("写真に1件のいいねがありました。");
    const check = notices.getByRole("button", { name: "すべて既読にする" }), close = notices.getByRole("button", { name: "通知を閉じる" });
    expect((await check.boundingBox())!.x).toBeLessThan((await close.boundingBox())!.x);
    await owner.route("**/api/member/photo-notifications", route => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "既読のテスト失敗" }) }) : route.continue());
    await check.click(); await expect(notices).toContainText("既読のテスト失敗"); await expect(notices.locator("li")).toHaveCount(1);
    await owner.unroute("**/api/member/photo-notifications"); await check.click();
    await expect(notices).toBeVisible(); await expect(notices.locator("li")).toHaveCount(0); await expect(notices).toContainText("未読のいいね通知はありません。");
    await close.click(); await owner.setViewportSize({ width: 390, height: 844 }); await owner.goto(`/Portfolio/${ownerId}`); await owner.locator(".photo-open").first().click();
    await expect(owner.locator("#photo-dialog")).toHaveAttribute("data-info-open", "false");
    await owner.locator("#photo-dialog [data-photo-toggle]").click(); await expect(owner.locator("#photo-dialog")).toHaveAttribute("data-info-open", "true");
    await expect(owner.locator("#photo-dialog [data-photo-image]")).toHaveCSS("transform", "none");
    await expect(owner.locator("#photo-dialog")).toHaveCSS("opacity", "1");
    await owner.screenshot({ path: info.outputPath("photo-dialog-mobile.png") });
  } finally { await context.close(); }
});
test("executives inherit staff features and see all counts but cannot change privileged accounts", async ({ page, browser }, info) => {
  const engine = info.project.name; await images(page);
  await login(page.request, `photo-executive-${engine}@example.invalid`);
  await page.goto("/Admin"); await expect(page.getByRole("heading", { name: "アカウント管理", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "サイト情報・ページ編集", exact: true })).toHaveCount(0);
  expect((await page.request.get("/Member/manage")).status()).toBe(200); expect((await page.request.get("/Admin/grouping-roster")).status()).toBe(200);
  expect((await (await page.request.get("/api/member/app-context")).json()).user.role).toBe("executive");
  expect((await page.request.get("/Admin/content/home")).status()).toBe(403);
  await page.goto(`/Portfolio/photo-owner-${engine}`); await page.locator(".photo-open").first().click(); await expect(page.locator("#photo-dialog [data-photo-count]")).toBeVisible();
  await page.goto(`/Admin/accounts/photo-owner-${engine}`); await page.locator(".admin-account-editor > summary").click();
  await expect(page.locator("#account-role option")).toHaveCount(2);
  const payload = await page.locator("#account-editor").evaluate((form: HTMLFormElement) => ({ ...Object.fromEntries(new FormData(form)), revision: form.dataset.revision }));
  expect((await page.request.post(`/api/admin/accounts/photo-owner-${engine}`, { headers, data: { ...payload, role: "admin" } })).status()).toBe(403);
  await page.goto(`/Admin/accounts/photo-executive-${engine}`); await expect(page.locator("#account-editor")).toHaveCount(0); await expect(page.locator("#account-delete-open")).toHaveCount(0);
  await page.goto("/Admin/photos"); await page.locator("#photo-container").selectOption(`portfolio:photo-owner-${engine}`); await expect(page.locator("[data-photo-manager-list] article")).toHaveCount(2); await expect(page.locator("[data-photo-manager-list] form")).toHaveCount(0);
  const context = await browser.newContext({ baseURL: origin });
  try {
    await login(context.request, `photo-staff-${engine}@example.invalid`); const staff = await context.newPage(); await images(staff); await staff.goto(`/Portfolio/photo-owner-${engine}`); await staff.locator(".photo-open").first().click(); await expect(staff.locator("#photo-dialog [data-photo-count]")).toBeHidden();
    expect((await context.request.get("/Admin/photos")).status()).toBe(403);
  } finally { await context.close(); }
});
test("exhibition Gallery likes notify the submitter and open Gallery when absent from Portfolio", async ({ page, browser }, info) => {
  const engine = info.project.name; await images(page); await page.goto(`/Gallery/photo-exhibition-${engine}`); await page.locator(".photo-open").click();
  const viewer = page.locator("#photo-dialog"); await expect(viewer.locator("[data-photo-caption]")).toHaveText("フォームから取得したキャプション");
  await expect(viewer.locator("[data-photo-image]")).toHaveJSProperty("naturalWidth", 1200);
  await expect(viewer.locator("[data-photo-like]")).toBeEnabled(); await viewer.locator("[data-photo-like]").click(); await expect(viewer.locator("[data-photo-like]")).toHaveAttribute("aria-pressed", "true");
  const context = await browser.newContext({ baseURL: origin }), owner = await context.newPage(); await images(owner);
  try {
    await login(context.request, `photo-owner-${engine}@example.invalid`); await owner.goto("/Member"); await owner.locator('[data-placement="member"]:visible').click();
    const link = owner.locator("#photo-notifications").getByRole("link").filter({ hasText: "展示写真に1件" }); await expect(link).toHaveAttribute("href", new RegExp(`/Gallery/photo-exhibition-${engine}\\?photo=`)); await link.click();
    await expect(owner.locator("#photo-dialog")).toBeVisible(); await expect(owner.locator("#photo-dialog [data-photo-count]")).toHaveText("1");
    await expect.poll(async () => (await (await context.request.get("/api/member/photo-notifications")).json()).unread).toBe(0);
  } finally { await context.close(); }
});

test("Blog featured and body photos open the common viewer and empty fields stay hidden", async ({ page }) => {
  await images(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/posts/test-post?from=activity");
  await expect(page.locator(".post-pictures [data-photo-ref]")).toHaveCount(1);
  await expect(page.locator(".post-body [data-photo-ref]")).toHaveCount(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [selector, frameSelector] of [[".post-pictures .photo-open", ".post-eyecatch"], [".post-body .photo-open", ".taped-image"]]) {
      const link = page.locator(selector);
      await link.hover();
      await expect(link.locator("img")).toHaveJSProperty("complete", true);
      await expect(page.locator(".post-pictures, .post-body").locator(".photo-hover, [data-photo-like]")).toHaveCount(0);
      const frame = await link.evaluate((anchor, frameSelector) => {
        const image = anchor.querySelector("img")!.getBoundingClientRect();
        const bounds = anchor.getBoundingClientRect();
        const tapeFrame = anchor.closest(frameSelector)!;
        const tape = getComputedStyle(tapeFrame, "::after");
        const position = tapeFrame.getBoundingClientRect();
        return {
          linkMatchesImage: (["top", "right", "bottom", "left"] as const).every(side =>
            Math.abs(bounds[side] - image[side]) <= 1),
          tapeAtImageTop: Math.abs(position.top + parseFloat(tape.top) - image.top) <= 1,
          tapeVisible: tape.backgroundImage.includes("/images/tapes/"),
          tapePassesPointer: tape.pointerEvents === "none",
        };
      }, frameSelector);
      expect(frame).toEqual({ linkMatchesImage: true, tapeAtImageTop: true, tapeVisible: true, tapePassesPointer: true });
    }
  }
  await page.locator(".post-body .photo-open").click();
  const viewer = page.locator("#photo-dialog"); await expect(viewer).toBeVisible();
  await expect(viewer.locator("[data-photo-like]")).toBeEnabled();
  await expect(viewer.locator("[data-photo-title]")).toBeHidden(); await expect(viewer.locator("[data-photo-caption]")).toBeHidden(); await expect(viewer.locator("details")).toBeHidden();
  await viewer.locator("[data-photo-like]").click(); await expect(viewer.locator("[data-photo-like]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape"); await expect(viewer).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Portfolio displays each saved title and shooting detail on hover and in the dialog; blanks stay hidden", async ({ page }, info) => {
  const id = `photo-owner-${info.project.name}`; await images(page); await login(page.request, `${id}@example.invalid`);
  await page.goto(`/Portfolio/edit?id=${id}`);
  const card = page.locator("#picture-list .picture-chip").first(); await card.getByRole("button", { name: "写真情報を編集", exact: true }).click();
  const editor = page.locator("#portfolio-photo-editor");
  const fields = { タイトル: "雨上がりの街", キャプション: "夕方の光を撮影しました。", カメラ: "Nikon Z5 Ⅱ ①", レンズ: "Ai Nikkor 50mm f/1.4", フィルム: "Kodak Gold 200 コダック", F値: "2.8", シャッタースピード: "1/250", ISO感度: "200" };
  for (const [label, value] of Object.entries(fields)) await editor.getByLabel(label, { exact: true }).fill(value);
  await editor.getByRole("button", { name: "編集内容を反映", exact: true }).click();
  page.once("dialog", dialog => dialog.accept()); await page.locator("#submit-button").click(); await expect(page).toHaveURL(new RegExp(`/Portfolio/${id}$`));
  const thumbnail = page.locator(".photo-wrapper").first(); await thumbnail.hover();
  await expect(thumbnail.locator("[data-photo-title]")).toHaveText(fields.タイトル);
  await expect(thumbnail.locator("[data-photo-equipment]")).toHaveText(`${fields.カメラ}\n${fields.レンズ}\n${fields.フィルム}`);
  expect(await thumbnail.evaluate(card => {
    const size = (field: string) => parseFloat(getComputedStyle(card.querySelector(`[data-photo-${field}]`)!).fontSize);
    return size("film") <= size("lens");
  })).toBe(true);
  await expect(thumbnail.locator("[data-photo-settings]")).toHaveText("f2.8\nSS 1/250\nISO 200");
  await thumbnail.locator(".photo-open").click(); const viewer = page.locator("#photo-dialog");
  await viewer.getByRole("button", { name: "写真の情報を表示" }).click();
  await expect(viewer.locator("[data-photo-title]")).toHaveText(fields.タイトル);
  await expect(viewer.locator("[data-photo-caption]")).toHaveText(fields.キャプション);
  await expect(viewer.locator("[data-photo-equipment]")).toHaveText(`${fields.カメラ}\n${fields.レンズ}\n${fields.フィルム}`);
  await expect(viewer.locator("[data-photo-settings]")).toHaveText("f2.8\nSS 1/250\nISO 200");
  await expect(viewer.locator("[data-photo-film]")).toBeVisible();
  for (const container of [thumbnail, viewer]) {
    for (const field of ["camera", "lens", "film", "settings"]) {
      await expect(container.locator(`[data-photo-${field}]`)).toHaveCSS("font-family", /^"?Grandiflora One"?[,]/);
    }
  }
  await page.goto(`/Portfolio/edit?id=${id}`); await card.getByRole("button", { name: "写真情報を編集", exact: true }).click();
  for (const [label, value] of Object.entries(fields)) {
    await expect(editor.getByLabel(label, { exact: true })).toHaveValue(value);
    await editor.getByLabel(label, { exact: true }).fill("");
  }
  await editor.getByLabel("レンズ", { exact: true }).fill("0.0mmf0.0");
  await editor.getByRole("button", { name: "編集内容を反映", exact: true }).click();
  page.once("dialog", dialog => dialog.accept()); await page.locator("#submit-button").click(); await expect(page).toHaveURL(new RegExp(`/Portfolio/${id}$`));
  await page.locator(".photo-open").first().click();
  await expect(viewer.locator("[data-photo-title]")).toBeHidden(); await expect(viewer.locator("[data-photo-caption]")).toBeHidden(); await expect(viewer.locator("details")).toBeHidden();
  await expect(viewer.locator("[data-photo-lens]")).toBeHidden();
  await expect(viewer.locator("[data-photo-film]")).toBeHidden();
});

test("Gallery staff edit photo information and its owner can clear a field", async ({ page, browser }, info) => {
  const guest = await browser.newContext({ baseURL: origin });
  const photographer = await browser.newContext({ baseURL: origin });
  const gallery = `/Gallery/photo-exhibition-${info.project.name}`;
  let ref;
  try {
    await login(page.request, `photo-staff-${info.project.name}@example.invalid`);
    await images(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gallery);
    const card = page.locator(".photo-wrapper").first();
    ref = JSON.parse((await card.getAttribute("data-photo-ref"))!);
    expect((await guest.request.patch("/api/photos/metadata", { headers, data: { ref, metadata: { film: "拒否される値" } } })).status()).toBe(401);
    await login(guest.request, "member@example.invalid");
    expect((await guest.request.patch("/api/photos/metadata", { headers, data: { ref, metadata: { film: "拒否される値" } } })).status()).toBe(403);
    expect((await page.request.post("/api/photos/metadata", { headers, data: { ref, metadata: { title: "保持する作品情報", lens: "55mm f1.7" } } })).ok()).toBe(true);
    await card.locator(".photo-open").click();
    const viewer = page.locator("#photo-dialog");
    await viewer.getByRole("button", { name: "写真の情報を表示" }).click();
    const editButton = viewer.getByRole("button", { name: "写真情報を編集" });
    const likeButton = viewer.locator("[data-photo-like]");
    await expect(editButton).toBeVisible();
    const editBox = (await editButton.boundingBox())!, likeBox = (await likeButton.boundingBox())!;
    expect(editBox.width).toBe(likeBox.width);
    const positions = await viewer.locator(".photo-dialog-actions button").evaluateAll(buttons => buttons.slice(0, 2).map(button => (button as HTMLElement).offsetLeft));
    expect(positions[0]).toBeLessThan(positions[1]);
    await editButton.click();
    const editor = page.locator("#gallery-photo-editor");
    await expect(editor.locator("[data-gallery-editor-image]")).toBeVisible();
    await editor.getByLabel("フィルム", { exact: true }).fill("FUJIFILM SUPERIA X-TRA 400");
    await editor.getByLabel("キャプション", { exact: true }).fill("Galleryで編集したキャプション");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(viewer.locator("[data-photo-film]")).toHaveText("FUJIFILM SUPERIA X-TRA 400");
    const publicPage = await guest.newPage();
    await images(publicPage);
    await publicPage.goto(gallery);
    await publicPage.locator(".photo-open").first().click();
    await publicPage.locator("#photo-dialog").getByRole("button", { name: "写真の情報を表示" }).click();
    await expect(publicPage.locator("#photo-dialog [data-photo-film]")).toHaveText("FUJIFILM SUPERIA X-TRA 400");
    await expect(publicPage.locator("#photo-dialog [data-photo-title]")).toHaveText("保持する作品情報");
    await expect(publicPage.locator("#photo-dialog [data-photo-lens]")).toHaveText("55mm f1.7");
    await expect(publicPage.locator("#photo-dialog [data-photo-caption]")).toHaveText("Galleryで編集したキャプション");
    await expect(publicPage.getByRole("button", { name: "写真情報を編集" })).toHaveCount(0);
    await login(photographer.request, `photo-owner-${info.project.name}@example.invalid`);
    const ownerPage = await photographer.newPage();
    await images(ownerPage);
    await ownerPage.goto(gallery);
    await ownerPage.locator(".photo-open").first().click();
    await ownerPage.getByRole("button", { name: "写真情報を編集" }).click();
    const ownerEditor = ownerPage.locator("#gallery-photo-editor");
    await ownerEditor.getByLabel("フィルム", { exact: true }).fill("");
    await ownerEditor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(ownerEditor).not.toBeVisible();
    await expect(ownerPage.locator("#photo-dialog [data-photo-film]")).toBeHidden();
    await expect(ownerPage.locator("#photo-dialog [data-photo-title]")).toHaveText("保持する作品情報");
  } finally {
    if (ref) await page.request.post("/api/photos/metadata", { headers, data: { ref, metadata: {} }, timeout: 5000 });
    await guest.close();
    await photographer.close();
  }
});

test("Gallery owners edit a series layout and read a book inside the editor", async ({ page }, info) => {
  await login(page.request, `photo-owner-${info.project.name}@example.invalid`);
  await images(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/Gallery/gallery-works-${info.project.name}`);
  const viewer = page.locator("#photo-dialog");
  const editor = page.locator("#gallery-photo-editor");
  const edit = viewer.getByRole("button", { name: "写真情報を編集" });
  const seriesCard = page.locator('.photo-wrapper[data-photo-series="true"]');
  const ref = JSON.parse((await seriesCard.getAttribute("data-photo-ref"))!);
  const state = async () => (await (await page.request.post("/api/photos/state", { headers, data: { refs: [ref], details: true } })).json()).results[0].photo;
  const before = await state();
  await seriesCard.locator(".photo-open").click();
  await edit.click();
  await expect(editor.getByRole("heading", { name: "組写真を編集" })).toBeVisible();
  const previewBox = (await editor.getByRole("region", { name: "作品のプレビュー" }).boundingBox())!;
  const fieldsBox = (await editor.getByRole("group", { name: "作品情報と撮影諸元" }).boundingBox())!;
  expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(fieldsBox.x + 1);
  await editor.locator('[data-series-photo="1"]').press("ArrowRight");
  await editor.getByLabel("タイトル", { exact: true }).fill("組写真の更新");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(viewer.locator("[data-photo-title]")).toHaveText("組写真の更新");
  const after = await state();
  expect(after.series.photos[1].x).toBeGreaterThan(before.series.photos[1].x);
  expect((await page.request.patch("/api/photos/metadata", { headers, data: { ref, scope: "work", metadata: {}, layout: [], layoutRevision: before.galleryEdit.layoutRevision } })).status()).toBe(409);
  await viewer.getByRole("button", { name: "写真を閉じる" }).click();
  await page.locator('.photo-wrapper:not([data-photo-series]) .photo-open').first().click();
  await edit.click();
  await expect(editor.getByRole("heading", { name: "ブックを編集" })).toBeVisible();
  await expect(editor.locator("[data-gallery-book-position]")).toHaveText("1 / 2");
  await editor.getByRole("button", { name: "次のページ" }).click();
  await expect(editor.locator("[data-gallery-book-position]")).toHaveText("2 / 2");
  await expect(editor.locator("[data-gallery-editor-image]")).toHaveAttribute("alt", "book-2.jpg");
  await editor.getByLabel("キャプション", { exact: true }).fill("ブックの更新");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(viewer.locator("[data-photo-caption]")).toHaveText("ブックの更新");
});

test("a delayed notification poll cannot restore rows after mark all read", async ({ page, browser }, info) => {
  const id = `photo-owner-${info.project.name}`; await images(page); await login(page.request, `${id}@example.invalid`);
  await page.goto(`/Portfolio/${id}`);
  const ref = JSON.parse((await page.locator(".photo-wrapper").last().getAttribute("data-photo-ref"))!);
  const guest = await browser.newContext({ baseURL: origin });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }); let captured = false;
  try {
    expect((await guest.request.post("/api/photos/like", { headers, data: { ref, liked: true } })).ok()).toBe(true);
    await page.goto("/Member"); await page.locator('[data-placement="member"]:visible').click();
    const popup = page.locator("#photo-notifications"); await expect(popup.locator("li")).toHaveCount(1);
    const old = await (await page.request.get("/api/member/photo-notifications")).json();
    await page.route("**/api/member/photo-notifications", async route => {
      if (route.request().method() === "GET" && !captured) { captured = true; await waiting; return route.fulfill({ contentType: "application/json", body: JSON.stringify(old) }); }
      return route.continue();
    });
    await page.evaluate(() => document.dispatchEvent(new Event("photo:likes-changed"))); await expect.poll(() => captured).toBe(true);
    await popup.getByRole("button", { name: "すべて既読にする" }).click(); await expect(popup.locator("li")).toHaveCount(0);
    const response = page.waitForResponse(res => res.url().endsWith("/api/member/photo-notifications") && res.request().method() === "GET");
    release(); await response; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(popup.locator("li")).toHaveCount(0); await expect(popup).toContainText("未読のいいね通知はありません。");
  } finally { release(); await guest.close(); }
});

test("administrators use the photo ranking as a read-only overview", async ({ page }) => {
  await images(page); await login(page.request, "admin@example.invalid");
  await page.goto("/Admin/photos");
  await expect(page.getByRole("heading", { name: "写真のいいねランキング", exact: true })).toBeVisible();
  await expect(page.locator("#photo-manager")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("[data-photo-summary=totalLikes]")).not.toHaveText("—");
  await expect(page.locator("[data-photo-manager-list] form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "写真情報を保存" })).toHaveCount(0);
  await page.locator("#photo-container").selectOption("blog:post");
  await expect(page.locator("#photo-manager")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("[data-photo-ranking-scope]")).toHaveText("撮影会のお知らせ");
  await expect(page.locator("[data-photo-manager-list] form")).toHaveCount(0);
});
