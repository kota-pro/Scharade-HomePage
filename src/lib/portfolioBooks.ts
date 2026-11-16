import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { imageSignature, withImageSlot } from "./imageSecurity.ts";
import { fitPortfolioImage } from "./portfolioImage.ts";
import { PORTFOLIO_UPLOAD_LIMIT } from "../types/portfolioUpload.ts";
import { parsePhotoMetadata } from "./photoMetadata.ts";
import { dataPath, readData, withStoreLock, writeData } from "./store.ts";
import { PORTFOLIO_BOOK_BLANK_LIMIT, PORTFOLIO_BOOK_LIMIT, type PortfolioBook, type PortfolioBookDetails } from "../types/portfolioBooks.ts";

type Pdf = { kind: "pdf"; name: string; pageCount: number };
type Cover = { kind: "cover"; width: number; height: number };
type BookAsset = (Pdf | Cover) & { id: string; owner: string; createdAt: number };
type Books = { revision: string; books: PortfolioBook[] };
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const draftLifetime = 24 * 60 * 60 * 1000;

export class PortfolioBookInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function indexName(portfolioId: string) {
  if (!idPattern.test(portfolioId)) throw new PortfolioBookInputError("Portfolioを確認してください。");
  return `portfolio-books-${portfolioId}.json`;
}

function assetDirectory(portfolioId: string) {
  return dataPath(indexName(portfolioId).replace(/\.json$/, "-assets"));
}

function assetPath(portfolioId: string, assetId: string) {
  return path.join(assetDirectory(portfolioId), assetId);
}

function readAsset(portfolioId: string, assetId: unknown): BookAsset | undefined {
  if (typeof assetId !== "string" || !uuidPattern.test(assetId)) return;
  try {
    return JSON.parse(fs.readFileSync(`${assetPath(portfolioId, assetId)}.json`, "utf8")) as BookAsset;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readPortfolioBooks(portfolioId: string): Books {
  return readData<Books>(indexName(portfolioId), { revision: "", books: [] });
}

export function withPortfolioBooksLock<T>(portfolioId: string, action: () => T | Promise<T>) {
  return withStoreLock(indexName(portfolioId), action);
}

function bookDetails(portfolioId: string, book: PortfolioBook): PortfolioBookDetails | undefined {
  const pdf = readAsset(portfolioId, book.pdfId);
  const cover = readAsset(portfolioId, book.coverId);
  if (pdf?.kind === "pdf" && cover?.kind === "cover")
    return { ...book, pageCount: pdf.pageCount, pdfName: pdf.name, width: cover.width, height: cover.height };
}

export function listPortfolioBooks(portfolioId: string, state = readPortfolioBooks(portfolioId)): PortfolioBookDetails[] {
  return state.books.map(book => bookDetails(portfolioId, book)).filter(book => book !== undefined);
}

export function findPortfolioBook(portfolioId: string, bookId: string) {
  if (!uuidPattern.test(bookId)) return;
  const book = readPortfolioBooks(portfolioId).books.find(item => item.id === bookId);
  return book && bookDetails(portfolioId, book);
}

function publishedAssets(state: Books) {
  return new Set(state.books.flatMap(book => [book.pdfId, book.coverId]));
}

export function hasPublishedPortfolioBookAsset(portfolioId: string, assetId: string) {
  return idPattern.test(portfolioId) && uuidPattern.test(assetId) && publishedAssets(readPortfolioBooks(portfolioId)).has(assetId);
}

function removeAssets(portfolioId: string, ids: Iterable<string>) {
  for (const id of ids) {
    const file = assetPath(portfolioId, id);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.json`, { force: true });
  }
}

export async function stagePortfolioBookAsset(portfolioId: string, owner: string, kind: string, file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  let content = input;
  let info: Pdf | Cover;
  if (kind === "pdf") {
    if (!/\.pdf$/i.test(file.name) || !input.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new PortfolioBookInputError("InDesignの原稿はPDFに書き出してから選択してください。");
    if (!input.subarray(-1024).includes(Buffer.from("%%EOF")))
      throw new PortfolioBookInputError("PDFが破損しています。PDFを書き出し直してください。");
    const count = await withImageSlot(async () => {
      try {
        const pdf = await PDFDocument.load(input, { throwOnInvalidObject: true, updateMetadata: false });
        return pdf.getPageCount();
      } catch {
        throw new PortfolioBookInputError("PDFを読み取れません。パスワードを解除し、PDFを書き出し直してください。");
      }
    });
    if (count < 1) throw new PortfolioBookInputError("1ページ以上のPDFを選択してください。");
    info = { kind, name: file.name.slice(0, 240), pageCount: count };
  } else if (kind === "cover") {
    if (!imageSignature(input)) throw new PortfolioBookInputError("表紙に使う画像を選択してください。");
    const image = await withImageSlot(async () => {
      try {
        const source = sharp(input, { limitInputPixels: 60_000_000, failOn: "error" }).timeout({ seconds: 20 });
        const metadata = await source.metadata();
        if ((metadata.pages ?? 1) !== 1) throw new Error("Multiple frames");
        return await fitPortfolioImage(source.rotate(), metadata.width, metadata.height, PORTFOLIO_UPLOAD_LIMIT);
      } catch { throw new PortfolioBookInputError("表紙画像を読み取れません。JPEG・PNG・WebPを選択してください。"); }
    });
    content = image.data;
    info = { kind, width: image.info.width, height: image.info.height };
  } else {
    throw new PortfolioBookInputError("ブック素材の種類を確認してください。");
  }

  return withPortfolioBooksLock(portfolioId, () => {
    const directory = assetDirectory(portfolioId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keep = publishedAssets(readPortfolioBooks(portfolioId));
    for (const filename of fs.readdirSync(directory)) {
      if (!uuidPattern.test(filename) || keep.has(filename)) continue;
      const asset = readAsset(portfolioId, filename);
      const createdAt = asset?.createdAt ?? fs.statSync(assetPath(portfolioId, filename)).mtimeMs;
      if (Date.now() - createdAt >= draftLifetime) removeAssets(portfolioId, [filename]);
    }
    const asset: BookAsset = { ...info, id: crypto.randomUUID(), owner, createdAt: Date.now() };
    const output = assetPath(portfolioId, asset.id);
    try {
      fs.writeFileSync(output, content, { flag: "wx", mode: 0o600, flush: true });
      fs.writeFileSync(`${output}.json`, JSON.stringify(asset), { flag: "wx", mode: 0o600 });
    } catch (error) {
      removeAssets(portfolioId, [asset.id]);
      throw error;
    }
    return asset;
  });
}

// Called while holding the Portfolio's publication lock.
export function preparePortfolioBooks(portfolioId: string, owner: string, revision: unknown, input: unknown) {
  if (!Array.isArray(input) || input.length > PORTFOLIO_BOOK_LIMIT || typeof revision !== "string")
    throw new PortfolioBookInputError(`ブックは${PORTFOLIO_BOOK_LIMIT}冊以内で指定してください。`);
  const current = readPortfolioBooks(portfolioId);
  const published = publishedAssets(current);
  const ids = new Set<string>();
  const books: PortfolioBook[] = input.map(book => {
    if (!book || typeof book !== "object" || typeof book.id !== "string" || !uuidPattern.test(book.id) ||
      ids.has(book.id) || (book.direction !== "left" && book.direction !== "right"))
      throw new PortfolioBookInputError("ブックの内容と開き方向を確認してください。");
    ids.add(book.id);
    const pdf = readAsset(portfolioId, book.pdfId);
    const cover = readAsset(portfolioId, book.coverId);
    const accessible = (asset: BookAsset) => published.has(asset.id) || asset.owner === owner && Date.now() - asset.createdAt < draftLifetime;
    if (pdf?.kind !== "pdf" || cover?.kind !== "cover" || !accessible(pdf) || !accessible(cover))
      throw new PortfolioBookInputError("PDFまたは表紙を選択し直してください。");
    if (book.coverPage !== null && (!Number.isInteger(book.coverPage) || book.coverPage < 1 || book.coverPage > pdf.pageCount))
      throw new PortfolioBookInputError("表紙のページ番号を確認してください。");
    const { pageLayout, blankPagesAfter } = book;
    if (pageLayout !== undefined && pageLayout !== "single" && pageLayout !== "spread")
      throw new PortfolioBookInputError("ページの表示方法を確認してください。");
    if (blankPagesAfter !== undefined && (!Array.isArray(blankPagesAfter) || blankPagesAfter.length > PORTFOLIO_BOOK_BLANK_LIMIT ||
      blankPagesAfter.some(page => !Number.isInteger(page) || page < 1 || page > pdf.pageCount)))
      throw new PortfolioBookInputError("白紙を挿入する位置を確認してください。");
    let metadata;
    try { metadata = parsePhotoMetadata(book.metadata); }
    catch (error) { throw new PortfolioBookInputError((error as Error).message); }
    if (!metadata.title) throw new PortfolioBookInputError("ブックのタイトルを入力してください。");
    return {
      id: book.id, pdfId: pdf.id, coverId: cover.id, coverPage: book.coverPage, direction: book.direction, metadata,
      ...(pageLayout === "single" ? { pageLayout } : {}),
      ...(blankPagesAfter?.length ? { blankPagesAfter: [...blankPagesAfter].sort((a, b) => a - b) } : {}),
    };
  });
  if (JSON.stringify(current.books) === JSON.stringify(books)) return undefined;
  if (revision !== current.revision)
    throw new PortfolioBookInputError("別の画面でブックが更新されました。編集画面を読み込み直してください。", 409);
  return { revision: crypto.randomUUID(), books };
}

export function publishPortfolioBooks(portfolioId: string, next: Books) {
  const previous = publishedAssets(readPortfolioBooks(portfolioId));
  writeData(indexName(portfolioId), next);
  for (const id of publishedAssets(next)) previous.delete(id);
  try { removeAssets(portfolioId, previous); } catch { /* Unreferenced files can be collected by a later upload. */ }
}

export async function clearPortfolioBooks(portfolioId: string) {
  return withPortfolioBooksLock(portfolioId, () => {
    fs.rmSync(dataPath(indexName(portfolioId)), { force: true });
    fs.rmSync(assetDirectory(portfolioId), { force: true, recursive: true });
  });
}

export function portfolioBookResponse(request: Request, portfolioId: string, assetId: string, owner?: string) {
  const unavailable = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!idPattern.test(portfolioId)) return unavailable();
  const published = publishedAssets(readPortfolioBooks(portfolioId)).has(assetId);
  if (!published && !owner) return unavailable();
  const asset = readAsset(portfolioId, assetId);
  if (!asset || (!published && (asset.owner !== owner || Date.now() - asset.createdAt >= draftLifetime))) return unavailable();
  const file = assetPath(portfolioId, asset.id);
  let size: number;
  try { size = fs.statSync(file).size; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return unavailable();
    throw error;
  }
  const headers = new Headers({
    "Cache-Control": asset.kind === "cover" && published && !owner ? "public, max-age=300" : "private, no-store",
    "Content-Type": asset.kind === "pdf" ? "application/pdf" : "image/webp",
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0, end = size - 1, status = 200;
  if (asset.kind === "pdf") {
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Disposition", 'attachment; filename="portfolio-book.pdf"');
    const range = request.headers.get("Range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match?.[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      } else if (match?.[2]) start = Math.max(0, size - Number(match[2]));
      if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || start > end) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
  }
  headers.set("Content-Length", String(end - start + 1));
  const body = request.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
