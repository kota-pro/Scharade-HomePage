import { layoutBounds, layoutDescription } from "./exhibitionGeometry.ts";
import { photoGaps } from "./exhibitionEditing.ts";
import type { PhotoLayout, Work } from "./exhibitionTypes.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mm = (value: number) => (Math.abs(value) < .05 ? 0 : value).toFixed(1);
type Measurement = { a: number; b: number; axis: "x" | "y"; gap: number; x1: number; y1: number; x2: number; y2: number };

/** Same rotated bounding edges and nearest-neighbour rule as the submission tool. */
export function seriesReviewModel(photos: PhotoLayout[], reference = 0) {
  const bounds = layoutBounds(photos), boxes = photos.map(p => layoutBounds([p])), measurements: Measurement[] = [];
  boxes.forEach((a, i) => {
    const others = boxes.map((b, j) => ({ b, j })).filter(item => item.j !== i);
    const right = others.filter(({ b }) => b.x >= a.x + a.width - .05 && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)).sort((u, v) => u.b.x - v.b.x)[0];
    if (right) {
      const y = (Math.max(a.y, right.b.y) + Math.min(a.y + a.height, right.b.y + right.b.height)) / 2;
      measurements.push({ a: i, b: right.j, axis: "x", gap: photoGaps(photos[i], photos[right.j]).x, x1: a.x + a.width, y1: y, x2: right.b.x, y2: y });
    }
    const below = others.filter(({ b }) => b.y >= a.y + a.height - .05 && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)).sort((u, v) => u.b.y - v.b.y)[0];
    if (below) {
      const x = (Math.max(a.x, below.b.x) + Math.min(a.x + a.width, below.b.x + below.b.width)) / 2;
      measurements.push({ a: i, b: below.j, axis: "y", gap: photoGaps(photos[i], photos[below.j]).y, x1: x, y1: a.y + a.height, x2: x, y2: below.b.y });
    }
  });
  const selected = Math.max(0, Math.min(photos.length - 1, Math.floor(reference) || 0));
  return { bounds, boxes, measurements, reference: selected, gaps: photos.flatMap((photo, index) => index === selected ? [] : [{ index, ...photoGaps(photos[selected], photo) }]) };
}

export function seriesReviewSvg(photos: PhotoLayout[], assetUrl: (id: string) => string, availableWidth = 800) {
  if (!photos.length) return "";
  const model = seriesReviewModel(photos), bounds = model.bounds, width = Math.max(220, Math.min(1000, availableWidth)), padding = 42;
  const scale = Math.min((width - padding * 2) / Math.max(1, bounds.width), 330 / Math.max(1, bounds.height));
  const height = Math.max(180, bounds.height * scale + padding * 2), dx = (width - bounds.width * scale) / 2 - bounds.x * scale, dy = (height - bounds.height * scale) / 2 - bounds.y * scale;
  const x = (v: number) => v * scale + dx, y = (v: number) => v * scale + dy;
  const pictures = photos.map((photo, index) => `<g data-series-review-photo="${index}" data-photo-x="${photo.x}" data-photo-y="${photo.y}" data-photo-rotation="${photo.rotation}" transform="translate(${photo.x} ${photo.y}) rotate(${photo.rotation})"><title>写真${index + 1}：X ${mm(photo.x)} mm、Y ${mm(photo.y)} mm、幅 ${mm(photo.width)} mm、高さ ${mm(photo.height)} mm、回転 ${mm(photo.rotation)}°</title><rect width="${photo.width}" height="${photo.height}" fill="#edf1ef"/>${photo.assetId ? `<image href="${escape(assetUrl(photo.assetId))}" width="${photo.width}" height="${photo.height}" preserveAspectRatio="xMidYMid meet"/>` : ""}<rect class="series-review-frame" width="${photo.width}" height="${photo.height}" vector-effect="non-scaling-stroke"/></g>`).join("");
  const numbers = model.boxes.map((box, index) => `<g class="series-review-number" transform="translate(${x(box.x) + 13} ${y(box.y) - 16})"><rect x="-13" y="-11" width="26" height="22" rx="3"/><text text-anchor="middle" y="5">${index + 1}</text></g>`).join("");
  const distances = model.measurements.filter(m=>Math.abs(m.gap)>=.05).map(m => {
    const x1 = x(m.x1), y1 = y(m.y1), x2 = x(m.x2), y2 = y(m.y2), tx = (x1 + x2) / 2 + (m.axis === "y" ? 8 : 0), ty = (y1 + y2) / 2 - (m.axis === "x" ? 8 : 0);
    const tick = m.axis === "x" ? `M${x1} ${y1 - 4}v8M${x2} ${y2 - 4}v8` : `M${x1 - 4} ${y1}h8M${x2 - 4} ${y2}h8`;
    return `<g class="series-review-measurement" data-series-review-gap="${m.axis}" data-gap-mm="${m.gap}" aria-label="写真${m.a + 1}と写真${m.b + 1}の${m.axis === "x" ? "横" : "縦"}の間隔 ${mm(m.gap)} mm"><path d="M${x1} ${y1}L${x2} ${y2}${tick}"/><text x="${tx}" y="${ty}" text-anchor="${m.axis === "x" ? "middle" : "start"}">${mm(m.gap)} mm</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="組写真の配置と写真間隔（mm）"><g transform="translate(${dx} ${dy}) scale(${scale})">${pictures}</g>${distances}${numbers}</svg>`;
}

export function seriesReviewGapRows(photos: PhotoLayout[], reference = 0) {
  return seriesReviewModel(photos, reference).gaps.map(gap => `<tr><th scope="row">写真 ${gap.index + 1}</th><td>${mm(gap.x)}</td><td>${mm(gap.y)}</td></tr>`).join("") || '<tr><td colspan="3">間隔を確認するには写真が2枚以上必要です。</td></tr>';
}

export function seriesReviewHtml(work: Work, submissionId: string, version: "submitted" | "draft", assetUrl: (id: string) => string) {
  if (work.kind !== "series") return "";
  if (!work.photos.length) return '<p class="exhibition-muted">組写真の配置はまだ入力されていません。</p>';
  return `<section class="series-review" data-series-review data-series-work-id="${escape(work.id)}" data-series-submission-id="${escape(submissionId)}" data-series-content="${version}"><h5>組写真の配置・間隔</h5><p>全体：${escape(layoutDescription(work.photos))}</p><div class="series-review-diagram" data-series-review-diagram>${seriesReviewSvg(work.photos, assetUrl)}</div><p class="submission-drive-error" data-series-review-image-status role="status" hidden></p><p class="exhibition-muted">写真番号は下の一覧と対応します。X・Yは組写真ツールで設定した写真の左上の座標、幅・高さは回転前の寸法です。間隔はツールと同じく、回転後の外接枠の端から測ります。</p>
    <div class="submission-table-scroll"><table class="submission-summary-table series-review-positions"><caption>各写真の位置・サイズ（mm）と回転角</caption><thead><tr><th scope="col">写真</th><th scope="col">X（mm）</th><th scope="col">Y（mm）</th><th scope="col">幅（mm）</th><th scope="col">高さ（mm）</th><th scope="col">回転（°）</th></tr></thead><tbody>${work.photos.map((photo, index) => `<tr><th scope="row">写真 ${index + 1}</th>${[photo.x, photo.y, photo.width, photo.height, photo.rotation].map(value => `<td>${mm(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <label class="series-review-reference">間隔の基準にする写真<select data-series-review-reference>${work.photos.map((_, index) => `<option value="${index}">写真 ${index + 1}</option>`).join("")}</select></label><div class="submission-table-scroll"><table class="submission-summary-table"><caption>基準写真からの横・縦の間隔（mm）</caption><thead><tr><th scope="col">相手の写真</th><th scope="col">横の間隔（mm）</th><th scope="col">縦の間隔（mm）</th></tr></thead><tbody data-series-review-gaps>${seriesReviewGapRows(work.photos)}</tbody></table></div><p class="exhibition-muted">負の間隔は、その方向で外接枠が重なっていることを示します。配置や数値はこの画面では変更しません。</p></section>`;
}
