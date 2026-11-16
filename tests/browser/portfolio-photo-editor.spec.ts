import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329";
async function setup(page: Page, engine: string) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ path: path.resolve("public/media/site/activity/Photo1-480.webp"), contentType: "image/webp" });
    return route.abort();
  });
  const id = `photo-owner-${engine}`;
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers: { Origin: origin }, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).status()).toBe(200);
  await page.goto(`/Portfolio/edit?id=${id}`);
  await expect(page.locator("#picture-list .picture-chip")).toHaveCount(2);
}
const edit = (page: Page, index = 0) => page.locator("#picture-list .picture-chip").nth(index).getByRole("button", { name: "写真情報を編集", exact: true });
const editor = (page: Page) => page.locator("#portfolio-photo-editor");

test("photo cards and the independent editor fit every width; cancel and Escape discard edits and restore focus", async ({ page }, info) => {
  await setup(page, info.project.name);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await edit(page).click(); await expect(editor(page)).toBeVisible();
    expect(await editor(page).locator("input,textarea").count()).toBe(8);
    expect(await editor(page).locator(":required").count()).toBe(0);
    expect(await editor(page).evaluate(el => !el.closest("#portfolio-form"))).toBe(true);
    const baseline = await editor(page).getByLabel("タイトル", { exact: true }).inputValue();
    await editor(page).getByLabel("タイトル", { exact: true }).fill("キャンセルする編集");
    expect(await editor(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const apply = await editor(page).getByRole("button", { name: "編集内容を反映" }).boundingBox();
    expect(apply!.y + apply!.height).toBeLessThanOrEqual(width === 320 ? 568 : 900);
    await page.keyboard.press("Escape"); await expect(editor(page)).not.toBeVisible(); await expect(edit(page)).toBeFocused();
    await edit(page).click(); await expect(editor(page).getByLabel("タイトル", { exact: true })).toHaveValue(baseline);
    await editor(page).getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/portfolio-photo-editing/);
  }
});

test("late EXIF preserves typed and cleared fields; applying stages metadata until the Portfolio is saved", async ({ page }, info) => {
  await setup(page, info.project.name);
  // The second photograph starts without a saved manual override.
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/photos/state", async route => {
    await pending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, results: [{ ok: true, photo: { camera: "自動カメラ", lens: "自動レンズ", iso: "400" } }] }) });
  });
  try {
    await edit(page, 1).click(); await expect(editor(page).locator("[data-photo-editor-loading]")).toBeVisible();
    await editor(page).getByLabel("カメラ", { exact: true }).fill("手入力のカメラ");
    await editor(page).getByLabel("ISO感度", { exact: true }).fill("100");
    await editor(page).getByLabel("ISO感度", { exact: true }).fill("");
    release(); await expect(editor(page).getByLabel("レンズ", { exact: true })).toHaveValue("自動レンズ");
    await expect(editor(page).getByLabel("カメラ", { exact: true })).toHaveValue("手入力のカメラ");
    await expect(editor(page).getByLabel("ISO感度", { exact: true })).toHaveValue("");
    await editor(page).getByLabel("タイトル", { exact: true }).fill("光の記憶");
    await editor(page).getByRole("button", { name: "編集内容を反映" }).click();
    await expect(editor(page)).not.toBeVisible(); await expect(edit(page, 1)).toBeFocused();
    await expect(page.locator("#picture-list .picture-chip").nth(1)).toContainText("光の記憶");
    await edit(page, 1).click(); await editor(page).getByLabel("レンズ", { exact: true }).fill("");
    await editor(page).getByRole("button", { name: "編集内容を反映" }).click();
    await edit(page, 1).click(); await expect(editor(page).getByLabel("レンズ", { exact: true })).toHaveValue("");
    await editor(page).getByRole("button", { name: "キャンセル", exact: true }).click();
    let saved: any;
    await page.route("**/api/portfolio/update", route => { saved = route.request().postDataJSON(); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, message: "検証用に公開せず停止しました。" }) }); });
    page.once("dialog", dialog => dialog.accept()); await page.locator("#submit-button").click();
    await expect.poll(() => Boolean(saved)).toBe(true);
    expect(saved.photoMetadata[saved.pictures[1]]).toMatchObject({ title: "光の記憶", camera: "手入力のカメラ", lens: "", iso: "" });
  } finally { release(); }
});

test("closing while EXIF is pending cannot populate a different photograph; failed inspection can be retried", async ({ page }, info) => {
  await setup(page, info.project.name);
  let release!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/photos/state", async route => {
    const index = ++requests;
    if (index === 1) { await pending; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, results: [{ photo: { lens: "前の写真のレンズ" } }] }) }); }
    if (index === 2) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, results: [{ photo: { lens: "現在の写真のレンズ" } }] }) });
  });
  try {
    await edit(page).click(); await expect.poll(() => requests).toBe(1); await page.keyboard.press("Escape");
    await edit(page, 1).click(); await expect(editor(page).getByRole("button", { name: "もう一度読み込む" })).toBeVisible();
    release(); await expect(editor(page).getByLabel("レンズ", { exact: true })).toHaveValue("");
    await editor(page).getByRole("button", { name: "もう一度読み込む" }).click();
    await expect(editor(page).getByLabel("レンズ", { exact: true })).toHaveValue("現在の写真のレンズ");
    await editor(page).getByRole("button", { name: "キャンセル", exact: true }).click();
  } finally { release(); }
});

test("upload progress, partial failures, reorder, removal and empty states retain the correct per-photo metadata", async ({ page }, info) => {
  await setup(page, info.project.name);
  let uploads = 0;
  const added = `https://images.microcms-assets.io/assets/fixture/editor-added-${info.project.name}.jpg`;
  await page.route("**/api/portfolio/upload", route => ++uploads === 1
    ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, url: added, photoMetadata: { title: "追加した作品", camera: "Z5" } }) })
    : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "2枚目のアップロードに失敗しました。" }) }));
  const file = path.resolve("public/media/site/activity/Photo1-480.webp");
  await page.locator("#picture-files").setInputFiles([{ name: "first.webp", mimeType: "image/webp", buffer: await (await import("node:fs/promises")).readFile(file) }, { name: "second.webp", mimeType: "image/webp", buffer: await (await import("node:fs/promises")).readFile(file) }]);
  await expect(page.locator("#picture-list .picture-chip")).toHaveCount(3);
  await expect(page.locator("[data-picture-count]")).toHaveText("3 / 500枚");
  await expect(page.locator("[data-picture-upload-status]")).toContainText("1 / 2枚を追加しました。");
  await expect(page.locator("[data-picture-upload-status]")).toContainText("SITE-011");
  await expect(page.locator("#picture-files")).toBeEnabled();
  await expect(page.getByRole("button", { name: "作品 1 を前へ", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "作品 3 を後へ", exact: true })).toBeDisabled();
  await edit(page, 2).click(); await expect(editor(page).getByLabel("カメラ", { exact: true })).toHaveValue("Z5");
  await editor(page).getByLabel("キャプション", { exact: true }).fill("写真と一緒に移動する説明");
  await editor(page).getByRole("button", { name: "編集内容を反映" }).click();
  await page.getByRole("button", { name: "作品 3 を前へ", exact: true }).click();
  await expect(page.locator("#picture-list .picture-chip").nth(1)).toContainText("追加した作品");
  await edit(page, 1).click(); await expect(editor(page).getByLabel("キャプション", { exact: true })).toHaveValue("写真と一緒に移動する説明");
  await editor(page).getByRole("button", { name: "キャンセル", exact: true }).click();
  for (let count = 3; count > 0; count--) { await page.getByRole("button", { name: "作品 1 を削除", exact: true }).click(); await expect(page.locator("#picture-list .picture-chip")).toHaveCount(count - 1); }
  await expect(page.locator("#picture-list")).toContainText("写真を追加すると");
  await expect(page.locator("[data-picture-count]")).toHaveText("0 / 500枚");
  await expect(page.locator("#icon-preview img")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Portfolio publishes one series with a custom layout and keeps individual photo links", async ({ page }, info) => {
  const id = `photo-owner-${info.project.name}`;
  await setup(page, info.project.name);
  const initial = JSON.parse((await page.locator("#portfolio-edit-data").getAttribute("data-initial"))!);
  const chooser = page.getByRole("dialog", { name: "組写真を編集" });
  const headers = { Origin: origin };
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await edit(page).click();
    await editor(page).getByLabel("レンズ", { exact: true }).fill("個別写真のレンズ");
    await editor(page).getByRole("button", { name: "編集内容を反映" }).click();
    await page.getByRole("button", { name: "登録済みの写真から組写真を作る", exact: true }).click();
    await expect(chooser.getByRole("button", { name: "配置を編集" })).toBeDisabled();
    for (const checkbox of await chooser.getByRole("checkbox").all()) await checkbox.check();
    await chooser.getByLabel("タイトル", { exact: true }).fill("二つの風景");
    await chooser.getByLabel("キャプション", { exact: true }).fill("組全体の説明");
    await chooser.getByLabel("カメラ", { exact: true }).fill("Nikon Z5");
    await chooser.getByLabel("フィルム", { exact: true }).fill("Kodak Portra 400");
    await chooser.getByLabel("ISO感度", { exact: true }).fill("400");
    await chooser.getByRole("button", { name: "配置を編集" }).click();
    const layout = page.getByRole("dialog", { name: "組写真の配置・サイズ編集" });
    await expect(layout.locator("[data-series-photo]")).toHaveCount(2);
    await layout.locator('[data-series-dimensions="1"] summary').click();
    const position = layout.locator('[data-series-index="1"][data-series-photo-key="x"]');
    await position.fill("160"); await position.press("Tab");
    await expect(position).toHaveValue("160");
    await layout.getByRole("button", { name: "配置を反映して閉じる" }).click();
    await expect(layout).toHaveCount(0);
    await chooser.getByRole("button", { name: "組写真を反映" }).click();
    await expect(page.locator("[data-portfolio-series-list]")).toContainText("二つの風景（2枚）");
    await expect(page.getByRole("button", { name: "組写真を編集", exact: true })).toBeFocused();
    const invalid = await page.request.post("/api/portfolio/update", { headers, data: {
      portfolioId: id, pictures: initial.pictures, photoSeries: [{ id: "test", metadata: {}, photos: [0, 1].map(() => ({
        assetId: initial.pictures[0], x: 0, y: 0, width: 100, height: 100, rotation: 0,
      })) }],
    } });
    expect(invalid.status()).toBe(400);
    page.once("dialog", confirm => confirm.accept());
    await page.locator("#submit-button").click();
    await expect(page).toHaveURL(`/Portfolio/${id}`);
    const cards = page.locator(".justified-grid .photo-wrapper");
    await expect(cards).toHaveCount(1);
    await expect(cards.locator(".photo-series-badge")).toHaveText("組写真 · 2枚");
    await page.setViewportSize({ width: 1440, height: 900 });
    const thumbnail = cards.locator(".photo-series-thumbnail img");
    await expect(thumbnail).toHaveCount(2);
    await expect.poll(async () => {
      const left = (await thumbnail.first().boundingBox())!, right = (await thumbnail.last().boundingBox())!;
      return left.x + left.width < right.x;
    }).toBe(true);
    await cards.hover();
    await expect(cards.locator("[data-photo-film]")).toHaveText("Kodak Portra 400");
    await expect(cards.locator("[data-photo-lens]")).toBeHidden();
    await cards.locator(".photo-open").click();
    const viewer = page.locator("#photo-dialog"), overview = viewer.getByRole("region", { name: "組写真の全体" });
    const infoPanel = viewer.locator("#photo-information");
    await expect(infoPanel.locator("[data-photo-title]")).toHaveText("二つの風景");
    await expect(infoPanel.locator("[data-photo-caption]")).toHaveText("組全体の説明");
    await expect(infoPanel.locator("[data-photo-settings]")).toHaveText("ISO 400");
    await expect(infoPanel.locator("[data-photo-film]")).toHaveText("Kodak Portra 400");
    await expect(infoPanel.locator("[data-photo-lens]")).toBeHidden();
    await expect(overview.locator("[data-photo-series-frame]")).toHaveCount(2);
    expect(await thumbnail.last().evaluate(el => (el as HTMLElement).style.left))
      .toBe(await overview.locator("[data-photo-series-frame]").last().evaluate(el => (el as HTMLElement).style.left));
    await expect.poll(async () => {
      const left = (await overview.boundingBox())!, right = (await infoPanel.boundingBox())!;
      return left.x + left.width < right.x && right.width > 160;
    }).toBe(true);
    await viewer.screenshot({ path: info.outputPath("portfolio-series-view.png"), animations: "disabled" });
    await overview.getByRole("button", { name: "写真 2 を拡大" }).click();
    await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await viewer.getByRole("button", { name: "組写真の全体へ" }).click();
    await expect(overview).toBeVisible();
    await expect(infoPanel.locator("[data-photo-title]")).toHaveText("二つの風景");
    await page.goto(`/Portfolio/${id}?photo=${initial.photoIds[initial.pictures[1]]}`);
    await expect(viewer.locator("[data-photo-position]")).toHaveText("2 / 2");
    await page.goto(`/Portfolio/edit?id=${id}`);
    await page.getByRole("button", { name: "組写真を編集", exact: true }).click();
    await expect(chooser.getByLabel("タイトル", { exact: true })).toHaveValue("二つの風景");
    await chooser.getByRole("button", { name: "配置を編集" }).click();
    await layout.locator('[data-series-dimensions="1"] summary').click();
    await expect(position).toHaveValue("160");
    await layout.getByRole("button", { name: "配置を反映して閉じる" }).click();
    await chooser.getByRole("button", { name: "組写真の編集を閉じる" }).click();
  } finally {
    await page.request.post("/api/portfolio/update", { headers, data: { portfolioId: id, pictures: initial.pictures, photoMetadata: initial.photoMetadata, photoSeries: [] } });
  }
});
