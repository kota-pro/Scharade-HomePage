import { seriesReviewGapRows, seriesReviewSvg } from "../lib/exhibitionSeriesReview.ts";
import type { Work } from "../lib/exhibitionTypes.ts";

export function bindSeriesReviews(scope: HTMLElement, getWork: (review: HTMLElement) => Work | undefined, assetUrl: (id: string) => string) {
  const reviews = [...scope.querySelectorAll<HTMLElement>("[data-series-review]")];
  if (!reviews.length) return () => {};
  const widths = new WeakMap<HTMLElement, number>();
  const paint = (review: HTMLElement) => {
    const work = getWork(review), diagram = review.querySelector<HTMLElement>("[data-series-review-diagram]");
    if (!work || !diagram || diagram.clientWidth < 1 || widths.get(review) === diagram.clientWidth) return;
    widths.set(review, diagram.clientWidth);
    diagram.innerHTML = seriesReviewSvg(work.photos, assetUrl, diagram.clientWidth);
    const failures = new Set<string>(), message = review.querySelector<HTMLElement>("[data-series-review-image-status]");
    if (message) { message.textContent = ""; message.hidden = true; }
    diagram.querySelectorAll<SVGImageElement>("image").forEach(image => {
      image.addEventListener("load", () => { image.dataset.seriesImageLoaded = "true"; }, {once:true});
      image.addEventListener("error", () => {
        const index = Number(image.closest<SVGGElement>("[data-series-review-photo]")?.dataset.seriesReviewPhoto ?? 0) + 1;
        failures.add(`写真 ${index}`);
        if (message) { message.textContent = `${[...failures].join("、")}の画像を読み込めませんでした。配置・間隔は保存済みの数値で表示しています。`; message.hidden = false; message.dataset.error = "true"; }
      }, {once:true});
    });
  };
  const observer = new ResizeObserver(entries => entries.forEach(entry => paint(entry.target as HTMLElement)));
  const cleanups: (() => void)[] = [];
  for (const review of reviews) {
    observer.observe(review); paint(review);
    const select = review.querySelector<HTMLSelectElement>("[data-series-review-reference]");
    const change = () => { const work = getWork(review), body = review.querySelector("[data-series-review-gaps]"); if (work && body) body.innerHTML = seriesReviewGapRows(work.photos, Number(select?.value)); };
    select?.addEventListener("change", change);
    cleanups.push(() => select?.removeEventListener("change", change));
  }
  return () => { observer.disconnect(); cleanups.forEach(cleanup => cleanup()); };
}
