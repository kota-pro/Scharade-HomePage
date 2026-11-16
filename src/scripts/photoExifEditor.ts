import { photoFieldLabels, photoShootingFields, type PhotoMetadata } from "../types/photos";
import { normalizePhotoMetadataLens } from "../lib/photoMetadata";
import type { Work, PhotoLayout } from "../lib/exhibitionTypes";
const fields = photoShootingFields;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function photoExifDefaults(work: Work, photo: PhotoLayout, automatic: PhotoMetadata = {}) {
  const common = Object.fromEntries(fields.filter(key => work.details?.[key]).map(key => [key, work.details![key]]));
  return normalizePhotoMetadataLens({ ...automatic, ...common, ...photo.metadata });
}
export function photoExifEditor(work: Work, photo: PhotoLayout, index: number, automatic: PhotoMetadata = {}) {
  if (!photo.assetId) return "";
  const values = photoExifDefaults(work, photo, automatic);
  return `<details class="photo-exif-editor"><summary>この写真の撮影情報（任意）</summary><p>空欄の項目は写真の詳細に表示しません。</p>${fields.map(key => `<label>${photoFieldLabels[key]}<input type="text" maxlength="1000" data-photo-exif-work="${escape(work.id)}" data-photo-exif-index="${index}" data-photo-exif-field="${key}" value="${escape(values[key] ?? "")}" /></label>`).join("")}</details>`;
}
export function bindPhotoExifEditor(root: HTMLElement, getWork: (id: string) => Work | undefined, changed: () => void, disabled: () => boolean, automatic: (assetId: string) => PhotoMetadata = () => ({})) {
  for (const input of root.querySelectorAll<HTMLInputElement>("[data-photo-exif-field]")) input.addEventListener("input", () => {
    if (disabled()) return;
    const work = getWork(input.dataset.photoExifWork!), photo = work?.photos[Number(input.dataset.photoExifIndex)];
    if (!work || !photo) return;
    if (!photo.metadata) {
      photo.metadata = photoExifDefaults(work, photo, automatic(photo.assetId));
      // Keep the work's film editable until this photograph has its own value.
      delete photo.metadata.film;
    }
    photo.metadata[input.dataset.photoExifField as keyof PhotoMetadata] = input.value;
    changed();
  });
}
