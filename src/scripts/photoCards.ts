import type { PhotoRef, PhotoSeriesPreview } from "../types/photos";
import { photoSeriesFrameStyle } from "../utils/photoSeriesLayout";

export function createPhotoCard(ref: PhotoRef, src: string, full: string, alt: string, series?: PhotoSeriesPreview) {
  const card = document.createElement("div"); card.className = "photo-wrapper"; card.dataset.photoRef = JSON.stringify(ref);
  card.innerHTML = '<a class="photo-open"><img class="gallery-image" loading="lazy" decoding="async" /></a><div class="photo-hover"><div class="photo-author" hidden></div><div class="photo-exif"><span data-photo-equipment><span data-photo-camera hidden></span>\n<span data-photo-lens hidden></span>\n<span data-photo-film hidden></span></span><span data-photo-settings></span></div></div><div class="photo-footer"><span class="photo-title" data-photo-title></span><div class="photo-like-controls"><button class="photo-like" type="button" data-photo-like aria-label="いいねする" aria-pressed="false" disabled><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 28S3 20 3 10a7 7 0 0 1 13-3 7 7 0 0 1 13 3c0 10-13 18-13 18Z" /></svg></button><button class="photo-like-count" type="button" data-photo-count aria-haspopup="dialog" aria-controls="photo-likers" aria-label="いいねした会員を見る" hidden></button></div></div>';
  const link = card.querySelector<HTMLAnchorElement>("a")!, image = card.querySelector<HTMLImageElement>("img")!;
  link.href = full;
  link.setAttribute("aria-label", series ? `組写真「${series.title}」を開く` : `${alt}を拡大`);
  if (series) {
    card.dataset.photoSeries = "true";
    card.dataset.photoSeriesMembers = series.photos.map(frame => frame.id).join(" ");
    card.dataset.photoSeriesTitle = series.title;
    card.dataset.photoSeriesShooting = JSON.stringify(series.shooting ?? {});
    card.dataset.aspectRatio = String(series.width / series.height);
    const preview = document.createElement("span");
    preview.className = "photo-series-thumbnail";
    preview.style.setProperty("--series-ratio", card.dataset.aspectRatio);
    preview.setAttribute("aria-hidden", "true");
    for (const frame of series.photos) {
      const thumbnail = image.cloneNode() as HTMLImageElement;
      thumbnail.src = frame.src;
      thumbnail.alt = "";
      Object.assign(thumbnail.style, photoSeriesFrameStyle(frame, series));
      preview.append(thumbnail);
    }
    const badge = document.createElement("span");
    badge.className = "photo-series-badge";
    badge.textContent = `組写真 · ${series.photos.length}枚`;
    link.replaceChildren(preview, badge);
  } else {
    image.src = src;
    image.alt = alt;
  }
  return card;
}
