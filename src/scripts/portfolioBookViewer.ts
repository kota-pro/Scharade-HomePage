import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { bookPageAt, bookPagesInView, type BookDirection, type BookReaderOptions } from "../types/portfolioBooks";
import { createBookZoom } from "./portfolioBookZoom";

const reader = document.querySelector<HTMLDialogElement>("#portfolio-book-reader");
if (reader) setup(reader);

function setup(reader: HTMLDialogElement) {
  const title = reader.querySelector<HTMLHeadingElement>("#portfolio-book-reader-title")!;
  const stage = reader.querySelector<HTMLElement>("[data-book-stage]")!;
  const pages = reader.querySelector<HTMLElement>("[data-book-pages]")!;
  const loading = reader.querySelector<HTMLElement>("[data-book-loading]")!;
  const errorPanel = reader.querySelector<HTMLElement>("[data-book-error]")!;
  const position = reader.querySelector<HTMLElement>("[data-book-position]")!;
  const left = reader.querySelector<HTMLButtonElement>('[data-book-turn="left"]')!;
  const right = reader.querySelector<HTMLButtonElement>('[data-book-turn="right"]')!;
  const portrait = matchMedia("(max-width: 767px) and (orientation: portrait)");
  let opener: HTMLElement | undefined, direction: BookDirection = "left", source = "", active = 1;
  let single = false, blanks: number[] = [];
  let pdf: PDFDocumentProxy | undefined, task: PDFDocumentLoadingTask | undefined;
  let reading: typeof import("./portfolioBookPdf") | undefined;
  let activeRenders: RenderTask[] = [], generation = 0, frame = 0;
  const zoom = createBookZoom(stage, pages, reader.querySelector<HTMLElement>("[data-book-zoom-toolbar]")!,
    () => void paint(true), { onSwipe: dx => turn(dx < 0 ? "right" : "left"), enabled: () => loading.hidden && errorPanel.hidden });

  function cancelRender() {
    for (const render of activeRenders) render.cancel();
    activeRenders = [];
    return ++generation;
  }

  function displayed() {
    return pdf ? bookPagesInView(active, pdf.numPages + blanks.length, single || portrait.matches) : [active];
  }

  function resetPages() {
    for (const canvas of pages.querySelectorAll("canvas")) canvas.width = canvas.height = 0;
    pages.replaceChildren();
  }

  async function paint(refine = false) {
    if (!reader.open || !pdf || !reading) return;
    const id = cancelRender(), documentPdf = pdf, numbers = displayed();
    const total = documentPdf.numPages + blanks.length;
    const first = numbers[0], last = numbers[numbers.length - 1];
    const order = direction === "right" ? [...numbers].reverse() : numbers;
    const forward = direction === "right" ? left : right;
    const backward = forward === left ? right : left;
    forward.disabled = last >= total;
    backward.disabled = first <= 1;
    position.textContent = `${numbers.join("–")} / ${total}`;
    if (!refine) loading.hidden = false;
    errorPanel.hidden = true;
    const width = (stage.clientWidth - 24) / numbers.length;
    const height = stage.clientHeight - 12;
    const magnification = zoom.scale;
    zoom.refresh();
    if (width < 1 || height < 1) return;
    try {
      const rendered = await Promise.all(order.map(async number => {
        const { pdfPage, blankIndex } = bookPageAt(number, blanks);
        const page = await documentPdf.getPage(pdfPage);
        if (id !== generation) return;
        const canvas = document.createElement("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", blankIndex === undefined ? `${number}ページ` : `${number}ページ（白紙）`);
        try {
          const render = reading!.renderBookViewportPage(page, canvas, width, height, magnification, blankIndex !== undefined);
          if (render) {
            activeRenders.push(render);
            await render.promise;
          }
          return canvas;
        } finally { page.cleanup(); }
      }));
      if (id !== generation) return;
      resetPages();
      pages.replaceChildren(...rendered.filter(canvas => canvas !== undefined));
      loading.hidden = true;
      activeRenders = [];
      zoom.refresh();
    } catch {
      if (id !== generation) return;
      cancelRender();
      loading.hidden = true;
      errorPanel.hidden = false;
      zoom.refresh();
    }
  }

  async function openPdf() {
    const id = cancelRender();
    left.disabled = right.disabled = true;
    errorPanel.hidden = true;
    loading.hidden = false;
    position.textContent = "";
    try {
      reading ??= await import("./portfolioBookPdf");
      if (id !== generation || !reader.open) return;
      task = reading.loadBookPdf(source);
      const loaded = await task.promise;
      if (id !== generation || !reader.open) return;
      pdf = loaded;
      await paint();
    } catch {
      if (id !== generation || !reader.open) return;
      if (task) void task.destroy().catch(() => {});
      task = undefined;
      loading.hidden = true;
      errorPanel.hidden = false;
    }
  }

  document.addEventListener("book:read", event => {
    if (reader.open) return;
    const { book, title: bookTitle, opener: button } = (event as CustomEvent<{ book: BookReaderOptions; title: string; opener: HTMLElement }>).detail;
    opener = button;
    source = book.source;
    direction = book.direction;
    single = book.pageLayout === "single";
    blanks = book.blankPagesAfter ?? [];
    active = 1;
    zoom.reset();
    title.textContent = bookTitle || "ブック";
    reader.showModal();
    void openPdf();
  });
  reader.addEventListener("close", () => {
    cancelRender();
    pdf = undefined;
    if (task) void task.destroy().catch(() => {});
    task = undefined;
    resetPages();
    zoom.reset();
    opener?.focus({ preventScroll: true });
  });

  function turn(side: BookDirection) {
    if (!reader.open || !pdf) return;
    const numbers = displayed();
    const next = side !== direction ? numbers[numbers.length - 1] + 1 : numbers[0] - 1;
    if (next < 1 || next > pdf.numPages + blanks.length) return;
    active = next;
    zoom.reset();
    void paint();
  }

  left.addEventListener("click", () => turn("left"));
  right.addEventListener("click", () => turn("right"));
  reader.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    turn(event.key === "ArrowLeft" ? "left" : "right");
  });
  reader.querySelector("[data-book-retry]")!.addEventListener("click", () => { void (pdf ? paint() : openPdf()); });
  new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void paint();
    });
  }).observe(stage);
  portrait.addEventListener("change", () => void paint());
}
