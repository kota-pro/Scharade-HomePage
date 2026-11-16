import exifr from "exifr";
import { photoExifFields, readPhotoExifValues } from "../lib/photoExifValues";
import { PORTFOLIO_UPLOAD_LIMIT } from "../types/portfolioUpload";
import { fitPortfolioCanvas } from "./portfolioCanvasCompression";

async function inspectImage(file: File): Promise<{ type: string; exif?: Blob | ArrayBuffer; opaque?: boolean }> {
  const header = new DataView(await file.slice(0, 32).arrayBuffer());
  if (header.byteLength >= 3 && header.getUint16(0) === 0xffd8 && header.getUint8(2) === 0xff) {
    return { type: "image/jpeg", exif: file, opaque: true };
  }
  const png = header.byteLength >= 8 && header.getUint32(0) === 0x89504e47 && header.getUint32(4) === 0x0d0a1a0a;
  const webp = header.byteLength >= 12 && header.getUint32(0) === 0x52494646 && header.getUint32(8) === 0x57454250;
  if (!png && !webp) throw new Error("JPEG・PNG・WebP画像を選択してください。");
  if (webp && header.getUint32(4, true) + 8 !== file.size) throw new Error("WebP画像を読み込めませんでした。");
  if (webp && header.byteLength >= 21 && header.getUint32(12) === 0x56503858 && (header.getUint8(20) & 2)) {
    throw new Error("複数フレームの画像は添付できません。");
  }

  // Do not flatten animations that the upload endpoint would otherwise reject.
  let transparent = !png || header.byteLength < 26 || [4, 6].includes(header.getUint8(25));
  for (let offset = png ? 8 : 12; offset + 8 <= file.size;) {
    const chunk = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const type = chunk.getUint32(png ? 4 : 0);
    const length = chunk.getUint32(png ? 0 : 4, webp);
    const start = offset + 8;
    if (type === 0x6163544c || type === 0x414e494d || type === 0x414e4d46) {
      throw new Error("複数フレームの画像は添付できません。");
    }
    if (png && type === 0x74524e53) transparent = true;
    if (png && type === 0x49444154) break;
    if (webp && type === 0x45584946 && length <= 65536) {
      const bytes = await file.slice(start, start + length).arrayBuffer();
      const marker = new TextDecoder().decode(bytes.slice(0, 6));
      return { type: "image/webp", exif: marker === "Exif\0\0" ? bytes.slice(6) : bytes };
    }
    offset = start + length + (png ? 4 : length % 2);
  }
  return png ? { type: "image/png", exif: file, opaque: !transparent } : { type: "image/webp" };
}

export async function compressPortfolioImage(file: File) {
  const { type, exif, opaque } = await inspectImage(file);
  const metadata = readPhotoExifValues(exif ? await exifr.parse(exif, photoExifFields).catch(() => undefined) : undefined);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 8192 / Math.max(bitmap.width, bitmap.height), Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { blob } = await fitPortfolioCanvas(canvas, PORTFOLIO_UPLOAD_LIMIT, type === "image/jpeg" ? type : "image/webp", { losslessFirst: true, opaque });
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: blob.type }), metadata };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
