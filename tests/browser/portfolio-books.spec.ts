import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329";
const picture = await sharp({ create: { width: 128, height: 80, channels: 3, background: "#359583" } }).png().toBuffer();
const image = { name: "image.png", mimeType: "image/png", buffer: picture };

async function editor(page: Page, engine: string) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ body: picture, contentType: "image/png" });
    return route.abort();
  });
  const id = `photo-owner-${engine}`;
  const login = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: origin }, data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(login.status()).toBe(200);
  await page.goto(`/Portfolio/edit?id=${id}`);
  return id;
}

async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 5; number++) {
    const page = pdf.addPage([360, 480]);
    page.drawRectangle({ x: 0, y: 0, width: 360, height: 480, color: rgb(number * .15, .6, .7) });
    page.drawText(`Page ${number}`, { x: 30, y: 390, size: 20, font });
  }
  return Buffer.from(await pdf.save());
}

async function save(page: Page) {
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#submit-button").click();
}

test("single and grouped additions have separate paths; cancel is local and grouped upload can be retried", async ({ page }, info) => {
  await editor(page, info.project.name);
  const pictures = page.locator("#picture-list .picture-chip");
  await expect(pictures).toHaveCount(2);
  let count = 0;
  await page.route("**/api/portfolio/upload", route => {
    count++;
    return route.fulfill({ status: count === 4 ? 400 : 200, json: count === 4 ? { message: "再試行のテスト" } : {
      ok: true, url: `https://images.microcms-assets.io/assets/fixture/book-tests-${count}.png`,
    } });
  });
  const files = [image, { ...image, name: "second.png" }];
  await page.locator("#picture-files").setInputFiles(files);
  await expect(pictures).toHaveCount(4);
  const series = page.locator("#portfolio-series-editor");
  await page.locator("#series-files").setInputFiles(files);
  await expect(series.locator("input:checked")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(series).toBeHidden();
  expect(count).toBe(2);
  await page.locator("#series-files").setInputFiles(files);
  await series.getByLabel("タイトル", { exact: true }).fill("組み合わせ");
  await series.getByRole("button", { name: "組写真を反映" }).click();
  await expect(series.locator("[data-portfolio-series-count]")).toContainText("再試行のテスト");
  await expect(pictures).toHaveCount(4);
  await series.getByRole("button", { name: "組写真を反映" }).click();
  await expect(series).toBeHidden();
  await expect(pictures).toHaveCount(6);
  await expect(page.locator("[data-portfolio-series-list]")).toContainText("組み合わせ");
  expect(count).toBe(5);
});

test("publish, open only on cover click, turn pages, rotate, update cover, and remove a PDF book", async ({ page, browser }, info) => {
  const id = await editor(page, info.project.name);
  const editorPath = `/Portfolio/edit?id=${id}`, publicPath = `/Portfolio/${id}`;
  const dialog = page.locator("#portfolio-book-editor");
  const headers = { Origin: origin };
  const restore = await page.locator("#portfolio-edit-data").evaluate(node => JSON.parse((node as HTMLElement).dataset.initial!).pictures as string[]);
  const anonymous = await browser.newPage({ baseURL: origin });
  await anonymous.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  try {
    const corrupt = await page.request.post("/api/portfolio/books/upload", { headers, multipart: {
      portfolioId: id, kind: "pdf", file: { name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") },
    } });
    expect(corrupt.status()).toBe(400);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator(".portfolio-work-tools").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "ブックを追加" }).click();
    await dialog.getByLabel("閲覧用PDF").setInputFiles({ name: "冊子.pdf", mimeType: "application/pdf", buffer: await makePdf() });
    await expect(dialog.locator("[data-book-filename]")).toContainText("5ページ", { timeout: 15000 });
    await expect(dialog.locator("[data-book-cover-preview]")).toBeVisible();
    await dialog.getByLabel("表紙のページ番号").fill("2");
    await dialog.getByRole("button", { name: "選んだページをプレビュー" }).click();
    await expect(dialog.locator("[data-book-cover-preview]")).toBeVisible();
    await dialog.getByLabel("ページの開き方").selectOption("right");
    await dialog.getByLabel("タイトル", { exact: true }).fill("冬の光");
    await dialog.getByLabel("キャプション").fill("写真を集めた冊子です。");
    await dialog.getByLabel("カメラ").fill("Nikon Z5");
    await dialog.getByLabel("フィルム", { exact: true }).fill("Kodak Ektar 100");
    await dialog.getByRole("button", { name: "ブックを反映" }).click();
    await expect(dialog).toBeHidden();
    const draftCover = await page.locator("[data-portfolio-book-list] img").getAttribute("src");
    expect((await anonymous.request.get(draftCover!.replace(`/api/portfolio/books/${id}/`, `/Portfolio/${id}/book-media/`))).status()).toBe(404);
    for (let i = 0; i < restore.length; i++) await page.getByRole("button", { name: "作品 1 を削除", exact: true }).click();
    await save(page);
    await expect(page).toHaveURL(publicPath);
    await anonymous.setViewportSize({ width: 390, height: 844 });
    const pdfRequests: string[] = [];
    anonymous.on("response", response => { if (response.headers()["content-type"]?.startsWith("application/pdf")) pdfRequests.push(response.url()); });
    await anonymous.goto(publicPath);
    await expect(anonymous.locator(".justified-grid .photo-wrapper")).toHaveCount(1);
    const tile = anonymous.getByRole("link", { name: "冬の光の詳細を開く" });
    const coverUrl = await tile.locator("img").getAttribute("src");
    const coverPixel = await sharp(await (await anonymous.request.get(coverUrl!)).body())
      .extract({ left: 12, top: 12, width: 1, height: 1 }).raw().toBuffer();
    expect(coverPixel[0]).toBeGreaterThan(60);
    expect(coverPixel[0]).toBeLessThan(95);
    await tile.hover();
    const card = tile.locator("..");
    await expect(card.locator("[data-photo-title]")).toHaveText("冬の光");
    await expect(card.locator(".photo-hover [data-photo-film]")).toHaveText("Kodak Ektar 100");
    await tile.focus();
    await anonymous.keyboard.press("Enter");
    const detail = anonymous.locator("#photo-dialog");
    await detail.getByRole("button", { name: "写真の情報を表示" }).click();
    await expect(detail.getByRole("heading", { name: "冬の光" })).toBeVisible();
    await expect(detail).toContainText("Nikon Z5");
    await expect(detail.locator("[data-photo-film]")).toHaveText("Kodak Ektar 100");
    const like = detail.getByRole("button", { name: "いいねする" });
    await like.click();
    await expect(detail.getByRole("button", { name: "いいねを取り消す" })).toHaveAttribute("aria-pressed", "true");
    expect(pdfRequests).toHaveLength(0);
    await anonymous.locator('[data-help-open]').click();
    await anonymous.locator('[data-help-page]').click();
    await expect(anonymous.locator('[data-help-tour-name]')).toHaveText('Portfolioのブックを読む');
    await anonymous.locator('[data-help-next]').click();
    await expect(detail.locator('[data-open-book-reader]')).toHaveClass(/help-target/);
    const reader = anonymous.locator("#portfolio-book-reader");
    await detail.getByRole("button", { name: "ブックを読む", exact: true }).click();
    await expect(reader.getByRole("img", { name: "1ページ", exact: true })).toBeVisible({ timeout: 15000 });
    expect(pdfRequests.length).toBeGreaterThan(0);
    const pdfUrl = JSON.parse((await card.getAttribute("data-book-reader"))!).source as string;
    const range = await anonymous.request.get(pdfUrl!, { headers: { Range: "bytes=0-4" } });
    expect(range.status()).toBe(206);
    expect(await range.text()).toBe("%PDF-");
    await anonymous.locator('[data-help-next]').click();
    await expect(reader.locator('[data-book-turn="left"]')).toHaveClass(/help-target/);
    await anonymous.locator('[data-help-next]').click();
    await expect(reader.locator('[data-book-turn="right"]')).toHaveClass(/help-target/);
    await anonymous.locator('[data-help-stop]').click();
    await reader.getByRole("button", { name: "左へめくる" }).click();
    await expect(reader.getByRole("img", { name: "2ページ", exact: true })).toBeVisible();
    await anonymous.keyboard.press("ArrowLeft");
    await expect(reader.getByRole("img", { name: "3ページ", exact: true })).toBeVisible();
    await anonymous.setViewportSize({ width: 844, height: 390 });
    await expect(reader.locator("canvas")).toHaveCount(2);
    await expect(reader.locator("canvas").first()).toHaveAttribute("aria-label", "3ページ");
    await expect(reader.locator("canvas").last()).toHaveAttribute("aria-label", "2ページ");
    await anonymous.setViewportSize({ width: 390, height: 844 });
    await expect(reader.locator("canvas")).toHaveCount(1);
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "3ページ");
    const stage = reader.locator("[data-book-stage]");
    await expect(reader.getByRole("button", { name: "拡大", exact: true })).toBeEnabled();
    const bounds = (await stage.boundingBox())!;
    const middleX = bounds.x + bounds.width / 2, middleY = bounds.y + bounds.height / 2;
    const originalPixels = await reader.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width);
    const touch = (pointerId: number, offset: number) => ({ pointerType: "touch", pointerId, clientX: middleX + offset, clientY: middleY });
    await stage.dispatchEvent("pointerdown", touch(1, -30));
    await stage.dispatchEvent("pointerdown", touch(2, 30));
    await stage.dispatchEvent("pointermove", touch(1, -60));
    await stage.dispatchEvent("pointermove", touch(2, 60));
    await stage.dispatchEvent("pointerup", touch(1, -60));
    await stage.dispatchEvent("pointerup", touch(2, 60));
    await expect(reader.locator('[data-book-zoom="reset"]')).toHaveText("200%");
    await expect.poll(() => reader.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(originalPixels);
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "3ページ");
    await reader.getByRole("button", { name: "拡大率を100%に戻す" }).click();
    await expect(reader.locator('[data-book-zoom="reset"]')).toHaveText("100%");
    await stage.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 150 });
    await stage.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, clientX: 230, clientY: 152 });
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "4ページ");
    await anonymous.keyboard.press("Escape");
    await expect(reader).toBeHidden();
    await expect(detail.getByRole("button", { name: "ブックを読む", exact: true })).toBeFocused();
    await anonymous.keyboard.press("Escape");
    await expect(tile).toBeFocused();

    await page.goto(editorPath);
    await page.getByRole("button", { name: "ブックを編集" }).click();
    await dialog.getByRole("combobox", { name: "表紙", exact: true }).selectOption("image", { timeout: 5000 });
    await dialog.getByLabel("表紙画像").setInputFiles(image);
    await dialog.getByLabel("ページの開き方").selectOption("left");
    await dialog.getByLabel("タイトル", { exact: true }).fill("冬の光・改訂");
    await dialog.getByRole("button", { name: "ブックを反映" }).click();
    await expect(dialog).toBeHidden();
    await page.route("**/api/portfolio/update", route => route.fulfill({ status: 502, json: { message: "保存失敗のテスト" } }), { times: 1 });
    await save(page);
    await expect(page.locator("#status-message")).toContainText("SITE-011");
    await anonymous.reload();
    await expect(tile).toBeVisible();
    await save(page);
    await expect(page).toHaveURL(publicPath);
    await anonymous.setViewportSize({ width: 1280, height: 900 });
    await anonymous.reload();
    await anonymous.getByRole("link", { name: "冬の光・改訂の詳細を開く" }).click();
    await expect.poll(() => detail.locator("[data-photo-image]").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(128);
    await detail.getByRole("button", { name: "ブックを読む", exact: true }).click();
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "1ページ");
    await reader.getByRole("button", { name: "右へめくる" }).click();
    await expect(reader.locator("canvas").first()).toHaveAttribute("aria-label", "2ページ");
    await expect(reader.locator("canvas").last()).toHaveAttribute("aria-label", "3ページ");
    await page.goto(editorPath);
    await page.getByRole("button", { name: "ブックを編集" }).click();
    await dialog.getByRole("button", { name: "ページ配置をプレビュー" }).click();
    const previewStage = dialog.locator("[data-book-layout-stage]");
    await expect(previewStage.locator("canvas")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "拡大", exact: true })).toBeEnabled();
    await previewStage.dispatchEvent("wheel", { ctrlKey: true, deltaY: -60 });
    await expect(previewStage).toHaveAttribute("data-zoomed", "");
    await dialog.getByRole("button", { name: "拡大率を100%に戻す" }).click();
    await expect(previewStage).not.toHaveAttribute("data-zoomed");
    await dialog.getByRole("button", { name: "PDF 1ページの後ろに白紙を挿入" }).click();
    await expect(dialog.locator("[data-book-layout-position]")).toHaveText("2–3 / 6");
    await dialog.getByRole("button", { name: "2ページの白紙を削除" }).click();
    await expect(dialog.locator("[data-book-layout-position]")).toHaveText("2–3 / 5");
    await dialog.getByRole("button", { name: "先頭", exact: true }).click();
    await dialog.getByRole("button", { name: "PDF 1ページの後ろに白紙を挿入" }).click();
    await dialog.getByRole("combobox", { name: "ページの表示", exact: true }).selectOption("single");
    await dialog.getByRole("button", { name: "末尾", exact: true }).click();
    await dialog.getByRole("button", { name: "前へ", exact: true }).click();
    await dialog.getByRole("button", { name: "PDF 4ページの後ろに白紙を挿入" }).click();
    await expect(dialog.locator("[data-book-layout-position]")).toHaveText("6 / 7");
    await dialog.getByRole("button", { name: "ブックを反映" }).click();
    await expect(dialog).toBeHidden();
    await save(page);
    await expect(page).toHaveURL(publicPath);
    await anonymous.reload();
    await anonymous.getByRole("link", { name: "冬の光・改訂の詳細を開く" }).click();
    await detail.getByRole("button", { name: "ブックを読む", exact: true }).click();
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "1ページ");
    await reader.getByRole("button", { name: "右へめくる" }).click();
    await expect(reader.locator("canvas")).toHaveAttribute("aria-label", "2ページ（白紙）");
    await expect(reader.locator("[data-book-position]")).toHaveText("2 / 7");
    expect((await page.request.post("/api/portfolio/update", { headers, data: { portfolioId: id, pictures: restore } })).ok()).toBe(true);
    await anonymous.reload();
    await anonymous.locator(".photo-open").first().click();
    await expect(detail.locator("[data-open-book-reader]")).toBeHidden();
    await detail.locator("[data-photo-prev]").click();
    await expect(detail).toHaveAttribute("data-photo-book", "");
    await expect(detail.locator("[data-photo-title]")).toHaveText("冬の光・改訂");
    await expect(detail.locator("[data-open-book-reader]")).toBeVisible();
    await page.goto(editorPath);
    await page.locator("[data-portfolio-book-list]").getByRole("button", { name: "削除" }).click();
    await save(page);
    await expect(page).toHaveURL(publicPath);
    expect((await anonymous.request.get(pdfUrl!)).status()).toBe(404);
  } finally {
    await page.request.post("/api/portfolio/update", { headers, data: { portfolioId: id, pictures: restore }, timeout: 5000 });
    await anonymous.close();
  }
});
