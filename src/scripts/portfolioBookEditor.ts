import { apiErrorMessage, readApiResponse } from "./apiResponse";
import { photoMetadataFields, type PhotoMetadata } from "../types/photos";
import { bookPageAt, bookPagesInView, portfolioBookMediaUrl, PORTFOLIO_BOOK_BLANK_LIMIT, PORTFOLIO_BOOK_FILE_LIMIT, type BookDirection, type BookPageLayout, type PortfolioBookDetails } from "../types/portfolioBooks";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { PORTFOLIO_PDF_SOURCE_LIMIT } from "../types/portfolioUpload";
import { createBookZoom } from "./portfolioBookZoom";

type PdfAsset = { id: string; name: string; pageCount: number };
type CoverAsset = { id: string; width: number; height: number };

export function createPortfolioBookEditor(dialog: HTMLDialogElement, portfolioId: string, apply: (book: PortfolioBookDetails) => void) {
  const form = dialog.querySelector("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const pdfField = field("pdf"), pageField = field("coverPage"), imageField = field("coverFile"), mode = field("coverMode");
  const preview = dialog.querySelector<HTMLImageElement>("[data-book-cover-preview]")!;
  const previewPage = dialog.querySelector<HTMLButtonElement>("[data-book-preview-page]")!;
  const layoutButton = dialog.querySelector<HTMLButtonElement>("[data-book-preview-layout]")!;
  const layout = dialog.querySelector<HTMLElement>("[data-book-layout-preview]")!;
  const layoutPages = layout.querySelector<HTMLElement>("[data-book-layout-pages]")!;
  const layoutStage = layout.querySelector<HTMLElement>("[data-book-layout-stage]")!;
  const artwork = layout.querySelector<HTMLElement>("[data-book-layout-artwork]")!;
  const layoutPosition = layout.querySelector<HTMLElement>("[data-book-layout-position]")!;
  const layoutNavigation = [...layout.querySelectorAll<HTMLButtonElement>("[data-book-layout-go]")];
  const layoutField = field("pageLayout"), directionField = field("direction");
  const status = dialog.querySelector<HTMLElement>("[data-book-edit-status]")!;
  const filename = dialog.querySelector<HTMLElement>("[data-book-filename]")!;
  const close = dialog.querySelector<HTMLButtonElement>("[data-book-edit-close]")!;
  let opener: HTMLElement | undefined, book: PortfolioBookDetails | undefined, pdfAsset: PdfAsset | undefined;
  let task: PDFDocumentLoadingTask | undefined, temporaryPreview: string | undefined;
  let pending = false, pageCount = 0, accepted = false;
  let activePage = 1, blanks: number[] = [];
  let artworkVersion = 0, renders: RenderTask[] = [];
  const zoom = createBookZoom(layoutStage, artwork, layout.querySelector<HTMLElement>("[data-book-zoom-toolbar]")!,
    refineLayout, { enabled: () => !pending && !layout.hidden, scrollArea: dialog.querySelector<HTMLElement>(".photo-editor-body")! });

  function displayedPages() {
    return bookPagesInView(activePage, pageCount + blanks.length, layoutField.value === "single");
  }

  function clearLayout() {
    cancelArtwork();
    replaceArtwork([]);
    layoutPages.replaceChildren();
    zoom.reset();
  }

  function showLayout(open: boolean) {
    layout.hidden = !open;
    layoutButton.setAttribute("aria-expanded", String(open));
    if (!open) clearLayout();
  }

  function showPreview(url?: string, blob?: Blob) {
    if (temporaryPreview) URL.revokeObjectURL(temporaryPreview);
    temporaryPreview = blob ? URL.createObjectURL(blob) : undefined;
    const source = temporaryPreview ?? url;
    if (source) preview.src = source;
    else preview.removeAttribute("src");
    preview.hidden = !source;
  }

  function controls() {
    const usePage = mode.value === "page";
    dialog.querySelector<HTMLElement>("[data-book-cover-page]")!.hidden = !usePage;
    dialog.querySelector<HTMLElement>("[data-book-cover-file]")!.hidden = usePage;
    previewPage.hidden = !usePage;
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("button,input,select,textarea"))
      control.disabled = pending;
    pageField.disabled = pending || !usePage || pageCount === 0;
    imageField.disabled = pending || usePage;
    previewPage.disabled = pending || pageCount === 0;
    layoutButton.disabled = pending || pageCount === 0;
    const displayed = displayedPages();
    for (const button of layoutNavigation) {
      const backward = ["first", "previous"].includes(button.dataset.bookLayoutGo!);
      button.disabled = pending || (backward ? displayed[0] === 1 : displayed.at(-1) === pageCount + blanks.length);
    }
    layoutPages.querySelectorAll<HTMLButtonElement>("[data-book-insert-blank]").forEach(button => {
      button.disabled = pending || blanks.length >= PORTFOLIO_BOOK_BLANK_LIMIT;
    });
    if (pageCount) pageField.max = String(pageCount);
    else pageField.removeAttribute("max");
    form.setAttribute("aria-busy", String(pending));
    zoom.refresh();
  }

  function clearPdf() {
    if (task) void task.destroy().catch(() => {});
    task = undefined;
  }

  async function document() {
    if (!task) {
      const { loadBookPdf } = await import("./portfolioBookPdf");
      const file = pdfField.files?.[0];
      const source = file ? new Uint8Array(await file.arrayBuffer())
        : portfolioBookMediaUrl(portfolioId, pdfAsset!.id, true);
      task = loadBookPdf(source);
    }
    try { return await task.promise; }
    catch {
      clearPdf();
      throw new Error("PDFを開けません。パスワードを解除し、PDFを書き出し直してください。");
    }
  }

  async function makeCover(pageNumber: number) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount)
      throw new Error("表紙のページ番号を確認してください。");
    const { renderBookPdfPage } = await import("./portfolioBookPdf");
    const pdf = await document();
    const page = await pdf.getPage(pageNumber);
    const canvas = window.document.createElement("canvas");
    try {
      await renderBookPdfPage(page, canvas, 2100, 2100).promise;
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        blob => blob?.size ? resolve(blob) : reject(new Error("表紙画像を作成できませんでした。")), "image/png"));
    } finally {
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  }

  function cancelArtwork() {
    for (const render of renders) render.cancel();
    renders = [];
    return ++artworkVersion;
  }

  function replaceArtwork(canvases: HTMLCanvasElement[]) {
    for (const canvas of artwork.querySelectorAll("canvas")) canvas.width = canvas.height = 0;
    artwork.replaceChildren(...canvases);
    zoom.refresh();
  }

  function orderedPages() {
    const numbers = displayedPages();
    return directionField.value === "right" ? [...numbers].reverse() : numbers;
  }

  async function renderArtwork(pdf: PDFDocumentProxy, ordered: number[]) {
    const version = cancelArtwork();
    const { renderBookViewportPage } = await import("./portfolioBookPdf");
    const width = (layoutStage.clientWidth - 12) / ordered.length;
    const height = layoutStage.clientHeight - 12;
    if (width < 1 || height < 1) return;
    const magnification = zoom.scale;
    try {
      const canvases = await Promise.all(ordered.map(async number => {
        const { pdfPage, blankIndex } = bookPageAt(number, blanks);
        const page = await pdf.getPage(pdfPage);
        if (version !== artworkVersion) return;
        const canvas = window.document.createElement("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", blankIndex === undefined ? `PDF ${pdfPage}ページ` : "白紙");
        try {
          const render = renderBookViewportPage(page, canvas, width, height, magnification, blankIndex !== undefined);
          if (render) { renders.push(render); await render.promise; }
          return canvas;
        } finally { page.cleanup(); }
      }));
      if (version === artworkVersion) {
        renders = [];
        replaceArtwork(canvases.filter(canvas => canvas !== undefined));
      }
    } catch (error) {
      if (version === artworkVersion) { cancelArtwork(); throw error; }
    }
  }

  function refineLayout() {
    if (layout.hidden || pending || !task) return;
    void task.promise.then(pdf => renderArtwork(pdf, orderedPages())).catch(() => {});
  }
  new ResizeObserver(refineLayout).observe(layoutStage);

  function paintLayout() {
    if (layout.hidden) return;
    zoom.reset();
    void run("ページを描画しています…", async () => {
      const pdf = await document();
      const numbers = displayedPages();
      const ordered = orderedPages();
      await renderArtwork(pdf, ordered);
      const pages = ordered.map(number => {
        const { pdfPage, blankIndex } = bookPageAt(number, blanks);
        const label = blankIndex === undefined ? `PDF ${pdfPage}ページ` : "白紙";
        const item = window.document.createElement("div");
        const caption = window.document.createElement("p");
        caption.textContent = label;
        const button = window.document.createElement("button");
        button.type = "button";
        button.textContent = blankIndex === undefined ? "後ろに白紙を挿入" : "白紙を削除";
        button.setAttribute("aria-label", blankIndex === undefined ? `${label}の後ろに白紙を挿入` : `${number}ページの白紙を削除`);
        if (blankIndex === undefined) button.dataset.bookInsertBlank = "";
        button.addEventListener("click", () => {
          if (pending) return;
          if (blankIndex === undefined) {
            if (blanks.length >= PORTFOLIO_BOOK_BLANK_LIMIT) return;
            blanks.push(pdfPage);
            blanks.sort((a, b) => a - b);
            activePage = pdfPage + blanks.lastIndexOf(pdfPage) + 1;
          } else {
            blanks.splice(blankIndex, 1);
            activePage = Math.min(number, pageCount + blanks.length);
          }
          paintLayout();
        });
        item.append(caption, button);
        return item;
      });
      layoutPages.replaceChildren(...pages);
      layoutPosition.textContent = `${numbers.join("–")} / ${pageCount + blanks.length}`;
      status.textContent = "";
    });
  }

  async function run(message: string, action: () => Promise<void>) {
    if (pending) return;
    pending = true;
    status.textContent = message;
    controls();
    try { await action(); }
    catch (error) { status.textContent = apiErrorMessage(error); }
    finally { pending = false; controls(); }
  }

  async function upload<T>(kind: "pdf" | "cover", file: File | Blob) {
    if (file instanceof File && file.size > PORTFOLIO_BOOK_FILE_LIMIT) {
      if (kind === "pdf") {
        const { compressPortfolioPdf } = await import("./portfolioPdfCompression");
        file = await compressPortfolioPdf(file, await document(), message => { status.textContent = message; });
      } else {
        status.textContent = "表紙画像を圧縮しています…";
        const { compressPortfolioImage } = await import("./portfolioImageCompression");
        file = (await compressPortfolioImage(file)).file;
      }
    }
    status.textContent = kind === "pdf" ? "PDFをアップロードしています…" : "表紙をアップロードしています…";
    const data = new FormData();
    data.set("portfolioId", portfolioId);
    data.set("kind", kind);
    const content = new Blob([await file.arrayBuffer()], { type: file.type });
    data.set("file", content, file instanceof File ? file.name : "cover.png");
    const response = await fetch("/api/portfolio/books/upload", { method: "POST", body: data });
    const result = await readApiResponse(response);
    if (!response.ok || !result.asset) throw new Error(result.message || "アップロードに失敗しました。");
    return result.asset as T;
  }

  function existingCover() {
    return book && portfolioBookMediaUrl(portfolioId, book.coverId, true);
  }

  pdfField.addEventListener("change", () => {
    const file = pdfField.files?.[0];
    if (!file) return;
    clearPdf();
    pdfAsset = undefined;
    pageCount = 0;
    blanks = [];
    activePage = 1;
    showLayout(false);
    pageField.value = "1";
    filename.textContent = file.name;
    if (mode.value === "page") showPreview();
    void run("PDFを読み込んでいます…", async () => {
      if (file.size > PORTFOLIO_PDF_SOURCE_LIMIT) throw new Error("PDFは200MB以下のファイルを選択してください。");
      if (!/\.pdf$/i.test(file.name)) throw new Error("InDesignの原稿はPDFに書き出してから選択してください。");
      pageCount = (await document()).numPages;
      filename.textContent = `${file.name} · ${pageCount}ページ`;
      if (mode.value === "page") showPreview(undefined, await makeCover(1));
      status.textContent = file.size > PORTFOLIO_BOOK_FILE_LIMIT ? "20MBを超えるPDFは、反映時に圧縮します。" : "PDFを選択しました。";
    });
  });

  mode.addEventListener("change", () => {
    controls();
    if (mode.value === "image") {
      const file = imageField.files?.[0];
      if (file) showPreview(undefined, file);
      else showPreview(book?.coverPage === null ? existingCover() : undefined);
    } else if (book?.coverPage === Number(pageField.value) && book?.pdfId === pdfAsset?.id) {
      showPreview(existingCover());
    } else showPreview();
  });
  pageField.addEventListener("input", () => showPreview());
  imageField.addEventListener("change", () => {
    const file = imageField.files?.[0];
    if (file) showPreview(undefined, file);
  });
  previewPage.addEventListener("click", () => void run("表紙を作成しています…", async () => {
    showPreview(undefined, await makeCover(Number(pageField.value)));
    status.textContent = "表紙のプレビューを表示しました。";
  }));
  layoutButton.addEventListener("click", () => {
    showLayout(layout.hidden);
    if (!layout.hidden) paintLayout();
  });
  layoutField.addEventListener("change", paintLayout);
  directionField.addEventListener("change", paintLayout);
  for (const button of layoutNavigation) button.addEventListener("click", () => {
    const numbers = displayedPages();
    switch (button.dataset.bookLayoutGo) {
      case "first": activePage = 1; break;
      case "previous": activePage = numbers[0] - 1; break;
      case "next": activePage = numbers.at(-1)! + 1; break;
      case "last": activePage = pageCount + blanks.length; break;
    }
    paintLayout();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (pending) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    clearPdf();
    showPreview();
    showLayout(false);
    window.document.documentElement.classList.remove("portfolio-photo-editing");
    if (!accepted) opener?.focus({ preventScroll: true });
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    void run("ブックを準備しています…", async () => {
      if (!pageCount) throw new Error("閲覧用PDFを選択してください。");
      const coverPage = mode.value === "page" ? Number(pageField.value) : null;
      const selectedImage = imageField.files?.[0];
      const reusedCover = book && book.coverPage === coverPage &&
        (coverPage === null ? !selectedImage : book.pdfId === pdfAsset?.id) ? book : undefined;
      const coverFile = reusedCover ? null : coverPage === null ? selectedImage : await makeCover(coverPage);
      if (!reusedCover && !coverFile) throw new Error("表紙画像を選択してください。");
      pdfAsset ??= await upload<PdfAsset>("pdf", pdfField.files![0]);
      const cover = reusedCover ? { id: reusedCover.coverId, width: reusedCover.width, height: reusedCover.height }
        : await upload<CoverAsset>("cover", coverFile!);
      const metadata = Object.fromEntries(photoMetadataFields.map(key => [key, field(key).value.trim()])) as PhotoMetadata;
      accepted = true;
      dialog.close();
      apply({ id: book?.id ?? crypto.randomUUID(), pdfId: pdfAsset.id, pdfName: pdfAsset.name, pageCount: pdfAsset.pageCount,
        coverId: cover.id, width: cover.width, height: cover.height, coverPage, direction: directionField.value as BookDirection, metadata,
        pageLayout: layoutField.value as BookPageLayout, blankPagesAfter: [...blanks] });
    });
  });

  return {
    open(trigger: HTMLElement, existing?: PortfolioBookDetails) {
      form.reset();
      book = existing;
      opener = trigger;
      accepted = false;
      pdfAsset = existing && { id: existing.pdfId, name: existing.pdfName, pageCount: existing.pageCount };
      pageCount = existing?.pageCount ?? 0;
      activePage = 1;
      blanks = [...existing?.blankPagesAfter ?? []];
      filename.textContent = existing ? `${existing.pdfName} · ${existing.pageCount}ページ` : "";
      status.textContent = "";
      mode.value = existing?.coverPage === null ? "image" : "page";
      pageField.value = String(existing?.coverPage ?? 1);
      directionField.value = existing?.direction ?? "left";
      layoutField.value = existing?.pageLayout ?? "spread";
      for (const key of photoMetadataFields) field(key).value = existing?.metadata[key] ?? "";
      dialog.querySelector("h2")!.textContent = existing ? "ブックを編集" : "ブックを追加";
      showPreview(existingCover());
      controls();
      dialog.showModal();
      window.document.documentElement.classList.add("portfolio-photo-editing");
      dialog.querySelector(".photo-editor-body")!.scrollTop = 0;
    },
  };
}
