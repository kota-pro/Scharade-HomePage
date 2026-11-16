import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { PORTFOLIO_UPLOAD_LIMIT } from "../../src/types/portfolioUpload";
import { fixtureLogin } from "./fixture-auth";

test("oversized photos and books can be added from the Portfolio editor", async ({ page }, info) => {
  test.setTimeout(120_000);
  const id = `photo-staff-${info.project.name}`;
  const origin = "http://127.0.0.1:4329";
  const login = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: origin }, data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(login.status()).toBe(200);
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(`/Portfolio/edit?id=${id}`);
  await expect(page.locator("#picture-list .picture-chip")).toHaveCount(2);

  const width = 4400, height = 3500;
  await mkdir(info.outputDir, { recursive: true });
  const photoPath = info.outputPath("large.jpg");
  await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .withExif({ IFD0: { Make: "NIKON CORPORATION", Model: "Nikon Z5" } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toFile(photoPath);
  const originalPhoto = await readFile(photoPath);
  expect(originalPhoto.length).toBeGreaterThan(PORTFOLIO_UPLOAD_LIMIT);

  const photoUpload = page.waitForResponse(response => new URL(response.url()).pathname === "/api/portfolio/upload");
  await page.locator("#picture-files").setInputFiles(photoPath);
  const photoResponse = await photoUpload;
  expect(photoResponse.status()).toBe(200);
  await expect(page.locator("#picture-list .picture-chip")).toHaveCount(3);
  await page.locator("#picture-list .picture-chip").last().getByRole("button", { name: "写真情報を編集" }).click();
  await expect(page.locator("#portfolio-photo-editor").getByLabel("カメラ", { exact: true })).toHaveValue("Nikon Z5");
  await page.keyboard.press("Escape");

  const book = await PDFDocument.create();
  const font = await book.embedFont(StandardFonts.Helvetica);
  const image = await book.embedJpg(originalPhoto);
  book.addPage([792, 612]).drawImage(image, { x: 0, y: 0, width: 792, height: 612 });
  book.addPage([360, 480]).drawText("Keep this text", { font });
  const originalBook = await book.save();
  expect(originalBook.length).toBeGreaterThan(PORTFOLIO_UPLOAD_LIMIT);
  const bookPath = info.outputPath("large.pdf");
  await writeFile(bookPath, originalBook);

  await page.getByRole("button", { name: "ブックを追加" }).click();
  const dialog = page.locator("#portfolio-book-editor");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("閲覧用PDF").setInputFiles(bookPath);
  await expect(dialog.locator("[data-book-filename]")).toContainText("2ページ", { timeout: 25_000 });
  await dialog.getByLabel("タイトル", { exact: true }).fill("容量の大きな写真集");
  const bookUpload = page.waitForResponse(response => new URL(response.url()).pathname === "/api/portfolio/books/upload");
  await dialog.getByRole("button", { name: "ブックを反映" }).click();
  const pdfResponse = await bookUpload;
  expect(pdfResponse.status()).toBe(200);
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  await page.getByRole("button", { name: "ブックを編集" }).click();
  const previewRequest = page.waitForResponse(response => new URL(response.url()).pathname.startsWith(`/api/portfolio/books/${id}/`) &&
    response.headers()["content-type"]?.startsWith("application/pdf"));
  await dialog.getByRole("button", { name: "ページ配置をプレビュー" }).click();
  const draft = await previewRequest;
  const saved = await page.request.get(draft.url());
  expect(saved.status()).toBe(200);
  const bytes = await saved.body();
  expect(bytes.length).toBeLessThanOrEqual(PORTFOLIO_UPLOAD_LIMIT);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPages().map(page => page.getSize())).toEqual([{ width: 792, height: 612 }, { width: 360, height: 480 }]);
  expect(pdf.getPage(1).node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.keys()).toHaveLength(1);
});
