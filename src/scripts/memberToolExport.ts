import type { ToolResults } from "../lib/memberToolTypes";
import { toolLabels } from "../lib/memberToolTypes";
import { canCopyAppImage, copyAppImage } from "./mobileBridge";
export type ExportAsset = {
  id: string;
  name: string;
  mime: string;
  url: string;
};
const width = 1200,
  height = 1600,
  margin = 64,
  lineHeight = 44;
const font = '"Zen Kurenaido", "Noto Sans JP", sans-serif';
export function wrapToolText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && ctx.measureText(line + segment).width > maxWidth) {
        lines.push(line);
        line = segment;
      } else line += segment;
    }
    lines.push(line);
  }
  return lines;
}
async function loadImage(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      "画像を読み込めませんでした。権限や公開期間を確認してください。",
    );
  const blob = await response.blob();
  const src = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(src);
  }
}
export async function renderToolResultPages(
  results: ToolResults,
  assets: ExportAsset[],
) {
  await document.fonts.ready;
  const pages: Blob[] = [];
  const canvas = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D, y: number;
  const flush = async () => {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("画像を作成できませんでした。")),
        "image/png",
      ),
    );
    pages.push(blob);
  };
  // Reuse one canvas so hundreds of long submissions do not retain a full
  // uncompressed bitmap per page in the browser.
  const begin = () => {
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fffefb";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#353530";
    ctx.font = `34px ${font}`;
    ctx.fillText(`${toolLabels[results.kind]} · 結果`, margin, 72);
    ctx.font = `24px ${font}`;
    ctx.fillText(
      `${results.respondentCount}人が回答　${pages.length + 1}ページ`,
      margin,
      height - 30,
    );
    ctx.font = `30px ${font}`;
    y = 130;
  };
  const ensure = async (h: number) => {
    if (y + h > height - 90) {
      await flush();
      begin();
    }
  };
  const text = async (value: string, bold = false) => {
    ctx.font = `${bold ? "bold " : ""}30px ${font}`;
    for (const line of wrapToolText(ctx, value, width - margin * 2)) {
      await ensure(lineHeight);
      ctx.font = `${bold ? "bold " : ""}30px ${font}`;
      ctx.fillText(line, margin, y);
      y += lineHeight;
    }
    ctx.font = `30px ${font}`;
  };
  const gap = () => {
    y += 22;
  };
  const image = async (id: string) => {
    const a = assets.find((a) => a.id === id);
    if (!a)
      throw new Error(
        "添付画像の情報が不足しています。結果を更新してください。",
      );
    const image = await loadImage(a.url);
    const scale = Math.min(
      (width - margin * 2) / image.width,
      480 / image.height,
      1,
    );
    const w = image.width * scale,
      h = image.height * scale;
    await ensure(h + 25);
    ctx.drawImage(image, margin, y, w, h);
    y += h + 25;
  };
  begin();
  await text(results.question, true);
  gap();
  if (results.kind === "poll")
    for (const o of results.options) {
      const voters = results.responses.filter((r) => r.choices.includes(o.id));
      await text(o.text, true);
      await text(
        `${voters.length}票（${results.respondentCount ? Math.round((voters.length / results.respondentCount) * 100) : 0}%）`,
      );
      if (o.imageId) await image(o.imageId);
      await text(
        "回答者：" +
          (voters.map((r) => (r.anonymous ? "匿名" : r.name)).join("、") ||
            "なし"),
      );
      gap();
    }
  else if (results.kind === "schedule") {
    // Candidate blocks retain a readable grid even with many dates and long names.
    for (const o of results.options) {
      await text(
        [o.date, o.text, [o.start, o.end].filter(Boolean).join("〜")]
          .filter(Boolean)
          .join(" "),
        true,
      );
      await text(
        ["yes", "maybe", "no", ""]
          .map(
            (v, i) =>
              `${["○", "△", "×", "未回答"][i]} ${results.responses.filter((r) => (r.dates[o.id] || "") === v).length}人`,
          )
          .join("　"),
      );
      for (const r of results.responses) {
        const answer =
          ({ yes: "○", maybe: "△", no: "×" } as Record<string, string>)[
            r.dates[o.id]
          ] || "未回答";
        await text(`${r.anonymous ? "匿名" : r.name}　│　${answer}`);
      }
      gap();
    }
  } else
    for (const [i, r] of results.responses.entries()) {
      await text(`投稿 ${i + 1}　${r.anonymous ? "匿名" : r.name}`, true);
      await text(r.body);
      gap();
      for (const id of r.assetIds) {
        const a = assets.find((a) => a.id === id);
        if (!a) throw new Error("添付情報を取得できませんでした。");
        await text(`添付：${a.name}`);
        if (a.mime.startsWith("image/")) await image(id);
      }
      gap();
    }
  if (!results.responses.length) await text("まだ回答がありません。");
  await flush();
  canvas.width = canvas.height = 1;
  return pages;
}

export async function exportToolResults(
  dialog: HTMLDialogElement,
  results: ToolResults,
  assets: ExportAsset[],
) {
  const blobs = await renderToolResultPages(results, assets),
    container = dialog.querySelector("[data-export-pages]")!;
  container.replaceChildren();
  const urls: string[] = [];
  for (const [i, blob] of blobs.entries()) {
    const section = document.createElement("section");
    section.className = "tool-export-page";
    const title = document.createElement("h4");
    title.textContent = `${i + 1} / ${blobs.length}ページ`;
    section.append(title);
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.loading = "lazy";
    image.alt = `結果画像 ${i + 1}ページ`;
    section.append(image);
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "admin-button";
    copy.textContent = "この画像をコピー";
    copy.addEventListener("click", async () => {
      try {
        if (canCopyAppImage()) await copyAppImage(blob);
        else if (
          navigator.clipboard?.write &&
          typeof ClipboardItem !== "undefined"
        )
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
        else throw new Error("unsupported");
        status.textContent = "画像をコピーしました。";
      } catch {
        status.textContent =
          "この端末ではコピーできません。PNGで保存をご利用ください。";
      }
    });
    const download = document.createElement("a");
    download.href = url;
    download.download = `${toolLabels[results.kind]}-結果-${i + 1}.png`;
    download.className = "admin-button tool-secondary";
    download.textContent = "PNGで保存";
    const actions = document.createElement("div");
    actions.className = "tool-export-actions";
    actions.append(copy, download);
    section.append(actions, status);
    container.append(section);
  }
  dialog.addEventListener(
    "close",
    () => urls.forEach((url) => URL.revokeObjectURL(url)),
    { once: true },
  );
  dialog.showModal();
}
