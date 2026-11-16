import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { unzlibSync } from "fflate";
import { PORTFOLIO_UPLOAD_LIMIT } from "../types/portfolioUpload";
import { fitPortfolioCanvas } from "./portfolioCanvasCompression";
import { renderBookPdfPage } from "./portfolioBookPdf";

function pdfFile(original: File, bytes: Uint8Array<ArrayBuffer>) {
  return new File([bytes], original.name, { type: "application/pdf" });
}

async function drawEmbeddedPhoto(stream: PDFRawStream, canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false })!;
  const dict = stream.dict;
  if (dict.get(PDFName.of("Filter")) === PDFName.of("FlateDecode")) {
    const width = dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 8192) || width * height > 16_000_000)
      throw new Error("Embedded image exceeds canvas limits");
    const length = width * height * 3;
    const pixels = unzlibSync(stream.getContents(), { out: new Uint8Array(length + 1) });
    if (pixels.length !== length) throw new Error("Unexpected embedded image length");
    canvas.width = width;
    canvas.height = height;
    const image = context.createImageData(width, height);
    for (let source = 0, target = 0; source < length; source += 3, target += 4) {
      image.data[target] = pixels[source];
      image.data[target + 1] = pixels[source + 1];
      image.data[target + 2] = pixels[source + 2];
      image.data[target + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return;
  }
  const bytes = new Uint8Array(stream.getContents());
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { imageOrientation: "none", colorSpaceConversion: "none" });
  try {
    const scale = Math.min(1, 8192 / Math.max(bitmap.width, bitmap.height), Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

async function shrinkEmbeddedPhotos(pdf: PDFDocument, packedSize: number) {
  const name = PDFName.of;
  const images = pdf.context.enumerateIndirectObjects().flatMap(([ref, object]) => {
    if (!(object instanceof PDFRawStream) || object.getContentsSize() < 32_768) return [];
    const { dict } = object;
    // Preserve color spaces, decode transforms, and the dimensions of masked images.
    const filter = dict.get(name("Filter"));
    if (dict.get(name("Subtype")) !== name("Image") || (filter !== name("DCTDecode") && filter !== name("FlateDecode")) ||
      dict.get(name("ColorSpace")) !== name("DeviceRGB") || dict.get(name("BitsPerComponent"))?.toString() !== "8" ||
      ["Decode", "DecodeParms", "SMask", "Mask", "Alternates"].some(key => dict.has(name(key)))) return [];
    return [{ ref, stream: object }];
  });
  let remainingSource = images.reduce((sum, { stream }) => sum + stream.getContentsSize(), 0);
  let remainingBudget = PORTFOLIO_UPLOAD_LIMIT - (packedSize - remainingSource) - 4096;
  if (remainingBudget < 1024 || !images.length) return;

  for (const { ref, stream } of images) {
    const originalSize = stream.getContentsSize();
    const budget = Math.floor(remainingBudget * originalSize / remainingSource);
    remainingSource -= originalSize;
    if (budget >= originalSize) break;
    if (budget < 1024) return;
    const canvas = document.createElement("canvas");
    let size = originalSize;
    try {
      await drawEmbeddedPhoto(stream, canvas);
      const { blob, width, height } = await fitPortfolioCanvas(canvas, budget, "image/jpeg");
      const dict = stream.dict.clone();
      dict.set(name("Filter"), name("DCTDecode"));
      dict.set(name("Width"), PDFNumber.of(width));
      dict.set(name("Height"), PDFNumber.of(height));
      pdf.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(await blob.arrayBuffer())));
      size = blob.size;
    } catch { /* Leave images with unsupported encodings in place. */ }
    finally {
      canvas.width = canvas.height = 0;
    }
    remainingBudget -= size;
  }
  const compressed = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
  if (compressed.byteLength <= PORTFOLIO_UPLOAD_LIMIT) return compressed;
}

export async function compressPortfolioPdf(file: File, source: PDFDocumentProxy, progress: (message: string) => void) {
  progress("PDFの容量を減らしています…");
  try {
    const pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    const packed = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
    if (pdf.getPageCount() === source.numPages) {
      if (packed.byteLength <= PORTFOLIO_UPLOAD_LIMIT) return pdfFile(file, packed as Uint8Array<ArrayBuffer>);
      const compressed = await shrinkEmbeddedPhotos(pdf, packed.byteLength);
      if (compressed) return pdfFile(file, compressed as Uint8Array<ArrayBuffer>);
    }
  } catch { /* PDF.js can render some documents that pdf-lib cannot rewrite. */ }

  const output = await PDFDocument.create();
  const canvas = document.createElement("canvas");
  // Allow room for PDF objects and the cross-reference table, in addition to the JPEG streams.
  let remainingBytes = PORTFOLIO_UPLOAD_LIMIT - 8192 - source.numPages * 1024;
  try {
    for (let number = 1; number <= source.numPages; number++) {
      progress(`PDFを圧縮しています… ${number} / ${source.numPages}ページ`);
      const budget = Math.floor(remainingBytes / (source.numPages - number + 1));
      if (budget < 1024) throw new Error("PDFを20MB以下に圧縮できませんでした。ページを分けてください。");
      const originalPage = await source.getPage(number);
      try {
        const { width, height } = originalPage.getViewport({ scale: 1 });
        const scale = Math.min(6, 5600 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
        await renderBookPdfPage(originalPage, canvas, width * scale, height * scale).promise;
        const { blob: image } = await fitPortfolioCanvas(canvas, budget, "image/jpeg");
        const jpeg = await output.embedJpg(await image.arrayBuffer());
        const page = output.addPage([width, height]);
        page.drawImage(jpeg, { x: 0, y: 0, width, height });
        remainingBytes -= image.size;
      } finally {
        originalPage.cleanup();
        canvas.width = canvas.height = 0;
      }
    }
    const bytes = await output.save({ useObjectStreams: true });
    if (bytes.byteLength > PORTFOLIO_UPLOAD_LIMIT) throw new Error("PDFを20MB以下に圧縮できませんでした。ページを分けてください。");
    return pdfFile(file, bytes as Uint8Array<ArrayBuffer>);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
