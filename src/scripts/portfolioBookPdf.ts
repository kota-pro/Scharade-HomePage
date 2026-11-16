import { getDocument, GlobalWorkerOptions, version, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { PORTFOLIO_UPLOAD_LIMIT } from "../types/portfolioUpload";

GlobalWorkerOptions.workerSrc = worker;
const resources = new URL(`/portfolio-book-renderer/${version}/`, location.origin);

export function loadBookPdf(source: string | Uint8Array) {
  const oversizedOriginal = typeof source !== "string" && source.byteLength > PORTFOLIO_UPLOAD_LIMIT;
  return getDocument({
    ...(typeof source === "string" ? { url: source } : { data: source }),
    cMapUrl: new URL("cmaps/", resources).href,
    standardFontDataUrl: new URL("standard_fonts/", resources).href,
    wasmUrl: new URL("wasm/", resources).href,
    useWasm: false,
    enableXfa: false,
    maxImageSize: oversizedOriginal ? -1 : 48_000_000,
    ...(oversizedOriginal ? { stopAtErrors: true, canvasMaxAreaInBytes: 48_000_000 } : {}),
    disableAutoFetch: true,
    disableStream: true,
  });
}

function sizeBookPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number, height: number) {
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(width / natural.width, height / natural.height) });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  return viewport;
}

export function renderBookPdfPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number, height: number) {
  return page.render({ canvas, viewport: sizeBookPage(page, canvas, width, height) });
}

export function renderBookBlankPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number, height: number) {
  sizeBookPage(page, canvas, width, height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

export function renderBookViewportPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number, height: number, zoom: number, blank: boolean) {
  const natural = page.getViewport({ scale: 1 });
  const fit = Math.min(width / natural.width, height / natural.height);
  const cssWidth = natural.width * fit, cssHeight = natural.height * fit;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const density = Math.min(Math.min(2, devicePixelRatio || 1) * zoom, 4096 / Math.max(cssWidth, cssHeight),
    Math.sqrt(8_000_000 / (cssWidth * cssHeight)));
  if (blank) renderBookBlankPage(page, canvas, cssWidth * density, cssHeight * density);
  else return renderBookPdfPage(page, canvas, cssWidth * density, cssHeight * density);
}
