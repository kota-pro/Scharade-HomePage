import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { dataPath, readData, writeData, withStoreLock } from "./store.ts";
import { AdvanceError, advanceIntegrationConfigured, postAccountingPayload } from "./advanceRequests.ts";
import type { User } from "./auth.ts";
import { boundedFormData, HttpInputError } from "./http.ts";
import { imageSignature, withImageSlot, ImageBusyError } from "./imageSecurity.ts";

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
type Receipt = { id: string; ownerId: string; name: string; mimeType: string; size: number; sha256: string; createdAt: string; driveFileId?: string; url?: string; };
const retryMessage = "領収書の保存結果を確認できませんでした。同じ内容でもう一度送信してください。";

/** Limit the stream as well as Content-Length before parsing multipart data. */
export async function receiptFormData(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new AdvanceError("ファイルの送信形式を確認してください。");
  try { return await boundedFormData(request, MAX_RECEIPT_BYTES + 65536); }
  catch (error) { throw new AdvanceError(error instanceof HttpInputError && error.status === 413 ? "領収書は10MB以下のファイルを選んでください。" : "ファイルの送信内容を確認してください。", error instanceof HttpInputError ? error.status : 400); }
}

export async function inspectReceipt(file: File) {
  if (!file.size || file.size > MAX_RECEIPT_BYTES) throw new AdvanceError("領収書は空でない10MB以下のファイルを選んでください。", file.size ? 413 : 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  let mimeType: string;
  if (bytes.subarray(0, 5).toString() === "%PDF-" && /%%EOF\s*$/.test(bytes.subarray(-2048).toString())) mimeType = "application/pdf";
  else {
    try {
      if (!imageSignature(bytes)) throw new Error("format");
      mimeType = await withImageSlot(async () => {
      const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: "error" }).timeout({ seconds: 20 });
      const metadata = await image.metadata();
      const types: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
      const mime = types[metadata.format ?? ""];
      if (!mime || (metadata.pages ?? 1) > 1) throw new Error();
      await image.stats();
      return mime;
      });
    } catch (error) { throw new AdvanceError(error instanceof ImageBusyError ? error.message : "JPEG・PNG・WebP画像、またはPDFを選んでください。破損したファイルは添付できません。", error instanceof ImageBusyError ? error.status : 400); }
  }
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" } as Record<string,string>)[mimeType];
  const stem = file.name.replace(/\.[^.]*$/, "").replace(/[\x00-\x1f\x7f/\\<>]/g, "_").trim().slice(0, 120) || "領収書";
  return { bytes, name: `${stem}.${extension}`, mimeType, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export async function uploadAdvanceReceipt(user: User, key: string, file?: File) {
  if (!user.approved) throw new AdvanceError("ログインが必要です。", 401);
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(key)) throw new AdvanceError("添付ファイルを選び直してください。");
  if (!advanceIntegrationConfigured()) throw new AdvanceError("領収書の受付準備中です。会計担当者へお問い合わせください。", 503);
  const id = "REC-" + crypto.createHash("sha256").update(`${user.id}:${key.toLowerCase()}`).digest("hex").slice(0, 32);
  const info = file ? await inspectReceipt(file) : null;
  return withStoreLock(id, async () => {
    const metaName = `${id}.json`, binaryPath = dataPath(`${id}.bin`);
    let receipt = readData<Receipt | null>(metaName, null);
    if (receipt && (receipt.ownerId !== user.id || (info && info.sha256 !== receipt.sha256))) throw new AdvanceError("前回と異なる領収書です。添付を解除して選び直してください。", 409);
    if (!receipt) {
      if (!info) throw new AdvanceError("領収書ファイルをもう一度選んでください。");
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true, mode: 0o700 });
      const temporary = `${binaryPath}.${crypto.randomUUID()}.tmp`;
      try {
        const fd = fs.openSync(temporary, "wx", 0o600);
        try { fs.writeFileSync(fd, info.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, binaryPath);
      } finally { fs.rmSync(temporary, { force: true }); }
      receipt = { id, ownerId: user.id, name: info.name, mimeType: info.mimeType, size: info.size, sha256: info.sha256, createdAt: new Date().toISOString() };
      writeData(metaName, receipt);
    }
    if (!receipt.url) {
      try {
        if (!receipt.driveFileId) {
          const response = await postAccountingPayload({ action: "receipt.prepare", receiptId: id });
          const result = await response.json();
          if (!response.ok || !result?.ok || result.receiptId !== id || !/^[A-Za-z0-9_-]{10,200}$/.test(result.driveFileId ?? "")) throw new Error();
          receipt.driveFileId = result.driveFileId;
          // Persist the reserved Drive ID before uploading. An uncertain upload reuses it.
          writeData(metaName, receipt);
        }
        const bytes = fs.readFileSync(binaryPath);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== receipt.sha256) throw new Error();
        const response = await postAccountingPayload({ action: "receipt.upload", receiptId: id, driveFileId: receipt.driveFileId,
          name: receipt.name, mimeType: receipt.mimeType, size: receipt.size, sha256: receipt.sha256, data: bytes.toString("base64") }, 45000);
        const result = await response.json();
        const expected = `https://drive.google.com/file/d/${receipt.driveFileId}/view`;
        if (!response.ok || !result?.ok || result.receiptId !== id || result.url !== expected) throw new Error();
        receipt.url = result.url;
        writeData(metaName, receipt);
      } catch { throw new AdvanceError(retryMessage, 503); }
    }
    // Only discard the staging copy after Drive has confirmed durable storage.
    fs.rmSync(binaryPath, { force: true });
    return { id: receipt.id, name: receipt.name, mimeType: receipt.mimeType, size: receipt.size, url: receipt.url };
  });
}
