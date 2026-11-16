import { photoMetadataFields, type PhotoMetadata, type PhotoView } from "../types/photos";
import type { Work } from "../lib/exhibitionTypes";
import type { createSeriesEditor } from "./exhibitionSeriesEditor";
import { apiErrorMessage, readApiResponse } from "./apiResponse";

export function createGalleryPhotoEditor(dialog: HTMLDialogElement) {
  const form = dialog.querySelector("form")!;
  const heading = dialog.querySelector("h2")!;
  const preview = dialog.querySelector<HTMLElement>("[data-gallery-editor-preview]")!;
  const image = preview.querySelector("img")!;
  const seriesRoot = preview.querySelector<HTMLElement>("[data-gallery-series-editor]")!;
  const book = preview.querySelector<HTMLElement>("[data-gallery-book-controls]")!;
  const previous = book.querySelector<HTMLButtonElement>('[data-gallery-page="previous"]')!;
  const next = book.querySelector<HTMLButtonElement>('[data-gallery-page="next"]')!;
  const position = book.querySelector<HTMLElement>("[data-gallery-book-position]")!;
  const close = dialog.querySelector<HTMLButtonElement>("[data-gallery-editor-close]")!;
  const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const fields = form.querySelector("fieldset")!;
  const status = dialog.querySelector<HTMLElement>("[data-gallery-editor-status]")!;
  const field = (key: keyof PhotoMetadata) => form.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement;

  let view: PhotoView | undefined, trigger: HTMLElement | undefined, onSaved: (() => Promise<void>) | undefined;
  let initial: PhotoMetadata, work: Work | undefined, initialLayout = "", page = 0, saving = false;
  let seriesEditor: ReturnType<typeof createSeriesEditor> | undefined;
  let start: { x: number; y: number } | undefined;

  function paintSeries() {
    if (!work || !seriesEditor) return;
    const controls = [...seriesRoot.querySelectorAll<HTMLElement>("button,input,select,figure,[data-series-gap-axis]")];
    const focus = controls.indexOf(document.activeElement as HTMLElement);
    seriesRoot.firstElementChild?.dispatchEvent(new Event("series:dispose"));
    seriesRoot.innerHTML = seriesEditor.html(work);
    seriesEditor.bind(seriesRoot);
    if (focus >= 0) seriesRoot.querySelectorAll<HTMLElement>("button,input,select,figure,[data-series-gap-axis]")[focus]?.focus({ preventScroll: true });
  }

  function turn(delta: number) {
    if (view?.galleryEdit?.kind !== "book") return;
    const { pages } = view.galleryEdit;
    page = Math.max(0, Math.min(pages.length - 1, page + delta));
    image.src = pages[page].src;
    image.alt = pages[page].name;
    previous.disabled = page === 0;
    next.disabled = page === pages.length - 1;
    position.textContent = pages.length === 1 ? "表紙のみ" : `${page + 1} / ${pages.length}`;
  }
  previous.addEventListener("click", () => turn(-1));
  next.addEventListener("click", () => turn(1));
  preview.addEventListener("keydown", event => {
    if (view?.galleryEdit?.kind !== "book" || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    turn(event.key === "ArrowLeft" ? -1 : 1);
  });
  image.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" && event.isPrimary) start = { x: event.clientX, y: event.clientY };
  });
  image.addEventListener("pointerup", event => {
    if (!start || !event.isPrimary) return;
    const x = event.clientX - start.x, y = event.clientY - start.y;
    start = undefined;
    if (Math.abs(x) >= 42 && Math.abs(x) > Math.abs(y) * 1.3) turn(x < 0 ? 1 : -1);
  });
  image.addEventListener("pointercancel", () => { start = undefined; });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    seriesRoot.firstElementChild?.dispatchEvent(new Event("series:dispose"));
    seriesRoot.replaceChildren();
    if (work) seriesEditor?.reset(work.id);
    work = undefined;
    image.removeAttribute("src");
    view = undefined;
    trigger?.focus({ preventScroll: true });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !view?.galleryEdit) return;
    const metadata: PhotoMetadata = {};
    for (const key of photoMetadataFields) {
      const value = field(key).value.trim();
      if (value !== (initial[key] ?? "")) metadata[key] = value;
    }
    const layout = work && JSON.stringify(work.photos) !== initialLayout ? work.photos : undefined;
    if (!Object.keys(metadata).length && !layout) { dialog.close(); return; }
    saving = fields.disabled = save.disabled = close.disabled = true;
    status.textContent = "保存しています…";
    try {
      const edit = view.galleryEdit;
      const response = await fetch("/api/photos/metadata", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: view.ref, metadata, ...(edit.kind !== "single" ? { scope: "work" } : {}), ...(edit.kind === "series" && layout ? { layout, layoutRevision: edit.layoutRevision } : {}) }),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message || "写真情報を保存できませんでした。");
      await onSaved?.();
      dialog.close();
    } catch (error) { status.textContent = apiErrorMessage(error); }
    finally { saving = fields.disabled = save.disabled = close.disabled = false; }
  });

  return async (photo: PhotoView, opener: HTMLElement, saved: () => Promise<void>) => {
    if (!photo.galleryEdit || dialog.open) return;
    const edit = photo.galleryEdit;
    if (edit.kind === "series" && !photo.series) return;
    if (edit.kind === "series" && !seriesEditor) {
      const [{ createSeriesEditor }] = await Promise.all([import("./exhibitionSeriesEditor"), import("../styles/Exhibitions.css")]);
      seriesEditor = createSeriesEditor({
        getWork: id => work?.id === id ? work : undefined,
        assetUrl: id => view?.series?.photos.find(frame => frame.id === id)?.src ?? "",
        change: paintSeries, message: message => { status.textContent = message; },
        busy: () => saving, width: () => seriesRoot.clientWidth + 48,
      });
    }
    if (!opener.closest("dialog")?.open || dialog.open) return;
    view = photo;
    trigger = opener;
    onSaved = saved;
    status.textContent = "";
    page = 0;
    start = undefined;
    initial = edit.kind === "series" ? { ...photo.series!.metadata, title: photo.series!.title } : photo;
    for (const key of photoMetadataFields) field(key).value = initial[key] ?? "";
    heading.textContent = edit.kind === "series" ? "組写真を編集" : edit.kind === "book" ? "ブックを編集" : "写真情報を編集";
    image.hidden = edit.kind === "series";
    seriesRoot.hidden = edit.kind !== "series";
    book.hidden = edit.kind !== "book";
    if (edit.kind === "series") {
      const photos = photo.series!.photos.map(({ id, x, y, width, height, rotation }) => ({ assetId: id, x, y, width, height, rotation }));
      work = { id: "gallery-edit", kind: "series", title: initial.title ?? "", sectionId: "", caption: "", location: "", equipment: "", settings: "", fields: {}, photos };
      initialLayout = JSON.stringify(photos);
    } else if (edit.kind === "book") turn(0);
    else { image.src = photo.full; image.alt = photo.alt; }
    dialog.showModal();
    paintSeries();
    dialog.querySelector(".gallery-editor-body")!.scrollTop = 0;
  };
}
