import "../styles/Exhibitions.css";
import { createSeriesDialog } from "./exhibitionSeriesDialog";
import { layoutBounds } from "../lib/exhibitionGeometry";
import { optimizeMicrocmsImage } from "../utils/microcmsImage";
import { photoMetadataFields, type PhotoMetadata, type PortfolioSeries } from "../types/photos";
import type { Work } from "../lib/exhibitionTypes";

type Options = {
  pictures: string[];
  series: PortfolioSeries[];
  sizes: Record<string, { width: number; height: number }>;
  title: (url: string) => string | undefined;
  apply: (series: PortfolioSeries, progress: (message: string) => void) => void | Promise<void>;
  close: () => void;
  message: (text: string, error?: boolean) => void;
};

export function createPortfolioSeriesEditor(dialog: HTMLDialogElement, options: Options) {
  const form = dialog.querySelector("form")!;
  const picks = dialog.querySelector("[data-portfolio-series-picks]")!;
  const status = dialog.querySelector("[data-portfolio-series-count]")!;
  const placement = dialog.querySelector<HTMLButtonElement>("[data-portfolio-series-layout]")!;
  const apply = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const fields = Object.fromEntries(photoMetadataFields.map(key => [key, form.elements.namedItem(key)])) as Record<keyof PhotoMetadata, HTMLInputElement | HTMLTextAreaElement>;
  let work: Work | undefined, opener: HTMLElement | undefined;
  let applied = false, saving = false;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-series-cancel]")!;
  const thumbnail = (url: string, width: number) => url.startsWith("blob:") ? url : optimizeMicrocmsImage(url, { width, quality: 75 });
  const layout = createSeriesDialog({
    getWork: id => work?.id === id ? work : undefined,
    assetUrl: url => thumbnail(url, 480),
    width: () => dialog.clientWidth,
    busy: () => false,
    change: () => {},
    fixedPhotos: true,
    message: options.message,
  });
  function updateCount() {
    const count = work?.photos.length ?? 0;
    status.textContent = count < 2 ? `${count}枚を選択中 · 2枚以上選択してください。` : `${count}枚を選択中 · ページ下部で保存すると公開されます。`;
    apply.disabled = placement.disabled = saving || count < 2;
  }
  function addPhoto(active: Work, url: string, width = 120, height = 80) {
    const dimensions = options.sizes[url];
    const w = dimensions?.width || width, h = dimensions?.height || height;
    const scale = 120 / Math.max(w, h);
    const bounds = layoutBounds(active.photos);
    active.photos.push({ assetId: url, x: active.photos.length ? Math.round(bounds.x + bounds.width + 10) : 0, y: active.photos.length ? bounds.y : 0,
      width: Math.max(.1, Math.round(w * scale * 10) / 10), height: Math.max(.1, Math.round(h * scale * 10) / 10), rotation: 0 });
  }
  function renderPicks(urls: string[]) {
    const active = work!;
    const assigned = new Set(options.series.filter(group => group.id !== active.id).flatMap(group => group.photos.map(photo => photo.assetId)));
    picks.replaceChildren(...urls.map((url, index) => {
      const label = document.createElement("label");
      const image = document.createElement("img");
      image.src = thumbnail(url, 240);
      image.alt = "";
      image.loading = "lazy";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const title = options.title(url) || `写真 ${index + 1}`;
      checkbox.setAttribute("aria-label", title);
      checkbox.checked = active.photos.some(photo => photo.assetId === url);
      checkbox.disabled = assigned.has(url);
      const name = document.createElement("span");
      name.textContent = checkbox.disabled ? `${title}（別の組で使用中）` : title;
      label.append(checkbox, image, name);
      checkbox.addEventListener("change", () => {
        if (!checkbox.checked) active.photos = active.photos.filter(photo => photo.assetId !== url);
        else if (active.photos.length < 100) {
          addPhoto(active, url, image.naturalWidth || 120, image.naturalHeight || 80);
        } else {
          checkbox.checked = false;
          options.message("組写真に選べる写真は100枚までです。", true);
        }
        layout.reset(active.id);
        updateCount();
      });
      return label;
    }));
  }
  placement.addEventListener("click", () => {
    if (!work || work.photos.length < 2) return;
    work.title = fields.title.value;
    layout.open(work.id, placement);
  });
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    if (work) layout.reset(work.id);
    work = undefined;
    options.close();
    document.documentElement.classList.remove("portfolio-photo-editing");
    if (!applied && opener?.isConnected) opener.focus({ preventScroll: true });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !work || work.photos.length < 2) return;
    const metadata = Object.fromEntries(photoMetadataFields.map(key => [key, fields[key].value])) as PhotoMetadata;
    const series = { id: work.id, metadata, photos: work.photos };
    saving = true;
    cancel.disabled = true;
    const editable = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not(:disabled),textarea:not(:disabled)")];
    editable.forEach(element => { element.disabled = true; });
    updateCount();
    try {
      await options.apply(series, message => { status.textContent = message; });
      applied = true;
      dialog.close();
    } catch (error) {
      status.textContent = (error as Error).message || "組写真を追加できませんでした。";
    } finally {
      saving = cancel.disabled = false;
      editable.forEach(element => { element.disabled = false; });
      apply.disabled = placement.disabled = (work?.photos.length ?? 0) < 2;
    }
  });
  return {
    open(trigger: HTMLElement, group?: PortfolioSeries, staged: string[] = []) {
      opener = trigger;
      applied = false;
      work = { id: group?.id ?? crypto.randomUUID(), kind: "series", title: "", sectionId: "", caption: "", location: "", equipment: "", settings: "", fields: {}, photos: structuredClone(group?.photos ?? []) };
      for (const key of photoMetadataFields) fields[key].value = group?.metadata[key] ?? "";
      for (const url of staged) addPhoto(work, url);
      renderPicks(staged.length ? staged : options.pictures);
      updateCount();
      dialog.showModal();
      document.documentElement.classList.add("portfolio-photo-editing");
      dialog.querySelector(".photo-editor-body")!.scrollTop = 0;
    },
  };
}
