import { photoMetadataFields, type PhotoMetadata } from "../types/photos";
import { optimizeMicrocmsImage } from "../utils/microcmsImage";

type Photo = { url: string; index: number; total: number; metadata: PhotoMetadata };
type Options = {
  inspect: (url: string) => Promise<PhotoMetadata | null>;
  apply: (url: string, metadata: PhotoMetadata) => void;
};

export function createPortfolioPhotoEditor(dialog: HTMLDialogElement, options: Options) {
  const form = dialog.querySelector<HTMLFormElement>("[data-photo-editor-form]")!;
  const preview = dialog.querySelector<HTMLImageElement>("[data-photo-editor-preview]")!;
  const status = dialog.querySelector<HTMLElement>("[data-photo-editor-status]")!;
  const loading = dialog.querySelector<HTMLElement>("[data-photo-editor-loading]")!;
  const retry = dialog.querySelector<HTMLButtonElement>("[data-photo-editor-retry]")!;
  const fields = Object.fromEntries(photoMetadataFields.map(key => [key, form.elements.namedItem(key)])) as Record<keyof Required<PhotoMetadata>, HTMLInputElement | HTMLTextAreaElement>;
  const cache = new Map<string, PhotoMetadata>();
  const touched = new Set<keyof PhotoMetadata>();
  let active: Photo | null = null, session = 0;
  let opener: HTMLElement | null = null;

  const close = () => { dialog.close(); };
  dialog.querySelectorAll<HTMLButtonElement>("[data-photo-editor-cancel]").forEach(button => button.addEventListener("click", close));
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => {
    session++;
    active = null;
    document.documentElement.classList.remove("portfolio-photo-editing");
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  let backdropPointer = false;
  dialog.addEventListener("pointerdown", event => { backdropPointer = event.target === dialog; });
  dialog.addEventListener("click", event => { if (backdropPointer && event.target === dialog) close(); backdropPointer = false; });
  for (const key of photoMetadataFields) fields[key].addEventListener("input", () => touched.add(key));
  // This dialog lives outside the Portfolio form: Enter only applies this photo.
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!active || !form.reportValidity()) return;
    const url = active.url;
    const metadata = Object.fromEntries(photoMetadataFields.map(key => [key, fields[key].value])) as PhotoMetadata;
    close();
    options.apply(url, metadata);
  });

  async function inspect() {
    if (!active) return;
    const photo = active, current = ++session;
    retry.hidden = true;
    loading.hidden = cache.has(photo.url);
    status.textContent = cache.has(photo.url) ? "" : "撮影情報を確認しています…";
    try {
      const automatic = cache.get(photo.url) ?? await options.inspect(photo.url);
      if (automatic) cache.set(photo.url, automatic);
      if (current !== session || !dialog.open) return;
      for (const key of ["camera", "lens", "fNumber", "shutterSpeed", "iso"] as const) {
        if (!Object.hasOwn(photo.metadata, key) && !touched.has(key) && automatic?.[key]) fields[key].value = automatic[key];
      }
      status.textContent = automatic ? "撮影情報は変更・削除できます。" : "この写真の撮影情報は手入力できます。";
    } catch {
      if (current !== session || !dialog.open) return;
      status.textContent = "撮影情報を読み込めませんでした。手入力もできます。";
      retry.hidden = false;
    } finally {
      if (current === session) loading.hidden = true;
    }
  }
  retry.addEventListener("click", () => { void inspect(); });

  return {
    open(photo: Photo, trigger: HTMLElement) {
      opener = trigger;
      active = { ...photo, metadata: { ...photo.metadata } };
      touched.clear();
      for (const key of photoMetadataFields) fields[key].value = photo.metadata[key] ?? "";
      preview.src = optimizeMicrocmsImage(photo.url, { width: 960, quality: 85 });
      preview.alt = photo.metadata.title || `作品 ${photo.index + 1}`;
      dialog.querySelector<HTMLElement>("[data-photo-editor-index]")!.textContent = `作品 ${String(photo.index + 1).padStart(2, "0")} / ${photo.total}`;
      dialog.showModal();
      document.documentElement.classList.add("portfolio-photo-editing");
      dialog.querySelector<HTMLElement>("h2")!.focus({ preventScroll: true });
      dialog.querySelector<HTMLElement>(".photo-editor-body")!.scrollTop = 0;
      void inspect();
    },
  };
}
