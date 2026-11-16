import type { SubmissionContent } from "../lib/exhibitionTypes.ts";
import { formatExhibitionError } from "../lib/exhibitionErrors.ts";
import { readExhibitionResponse } from "./exhibitionResponse.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** View saved submission cards without creating output files or changing the submission. */
export function openSubmissionBoardPreview(options: {
  exhibitionId: string;
  content: SubmissionContent;
  sections: { id: string; title: string }[];
  trigger: HTMLButtonElement;
}) {
  if (!options.content.works.length || document.querySelector(".submission-board-preview-dialog[open]")) return;
  const { content, sections } = structuredClone({ content: options.content, sections: options.sections });
  const dialog = document.createElement("dialog"), previousOverflow = document.body.style.overflow;
  dialog.className = "exhibition-confirm-dialog exhibition-page board-preview-dialog submission-board-preview-dialog";
  dialog.setAttribute("aria-label", `${content.name}さんのタイトルボードのプレビュー`);
  dialog.innerHTML = `<header class="exhibition-confirm-header"><h2>Title board</h2><button type="button" class="layout-close" data-board-preview-close aria-label="プレビューを閉じる"><span></span><span></span></button></header><p>${escape(content.name)}さんの保存済みの最新提出内容を表示します。編集中の変更は保存後に反映されます。</p><label class="exhibition-field">確認する作品<select data-board-preview-work>${content.works.map((work, index) => `<option value="${escape(work.id)}">${index + 1}. ${escape(sections.find(section => section.id === work.sectionId)?.title ?? "以前の展示")} ／ ${escape(work.title || "無題")}</option>`).join("")}</select></label><div class="exhibition-actions board-preview-navigation"><button type="button" class="secondary" data-board-preview-prev>前の作品</button><span data-board-preview-position></span><button type="button" class="secondary" data-board-preview-next>次の作品</button></div><p data-board-preview-status role="status" aria-live="polite"></p><figure class="board-preview-card"><img data-board-preview-image alt="タイトルボード" hidden/><figcaption data-board-preview-caption></figcaption></figure><ul class="board-preview-issues" data-board-preview-issues role="alert" hidden></ul><div class="exhibition-actions"><button type="button" class="secondary" data-board-preview-refresh>プレビューを更新</button><button type="button" data-board-preview-close>提出詳細に戻る</button></div>`;
  const select = dialog.querySelector<HTMLSelectElement>("[data-board-preview-work]")!;
  const image = dialog.querySelector<HTMLImageElement>("[data-board-preview-image]")!;
  const status = dialog.querySelector<HTMLElement>("[data-board-preview-status]")!;
  const issues = dialog.querySelector<HTMLElement>("[data-board-preview-issues]")!;
  const refresh = dialog.querySelector<HTMLButtonElement>("[data-board-preview-refresh]")!;
  let pending: AbortController | undefined, imageUrl = "";
  const clearImage = () => {
    image.hidden = true; image.removeAttribute("src");
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = "";
  };
  const show = async () => {
    pending?.abort(); const controller = new AbortController(); pending = controller;
    const work = content.works.find(work => work.id === select.value);
    if (!work) return;
    const index = select.selectedIndex;
    dialog.querySelector("[data-board-preview-position]")!.textContent = `${index + 1} / ${select.options.length}`;
    dialog.querySelector<HTMLButtonElement>("[data-board-preview-prev]")!.disabled = index === 0;
    dialog.querySelector<HTMLButtonElement>("[data-board-preview-next]")!.disabled = index === select.options.length - 1;
    clearImage(); issues.replaceChildren(); issues.hidden = true; refresh.disabled = true;
    dialog.querySelector("[data-board-preview-caption]")!.textContent = "";
    status.textContent = "プレビューを作成しています…";
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const url = `/api/member/exhibitions/${encodeURIComponent(options.exhibitionId)}/output?kind=board-preview&workId=${encodeURIComponent(work.id)}`;
      const response = await fetch(`${url}&status=1`, { signal: controller.signal, cache: "no-store" });
      const result = await readExhibitionResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message ?? formatExhibitionError("", "EXH-016"));
      const picture = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!picture.ok) {
        const problem = await readExhibitionResponse(picture);
        throw new Error(problem.message ?? formatExhibitionError("", "EXH-016"));
      }
      if (picture.headers.get("Content-Type")?.split(";")[0] !== "image/png") throw new Error("プレビュー画像を読み込めませんでした。");
      const blob = await picture.blob();
      if (controller.signal.aborted || !dialog.isConnected) return;
      imageUrl = URL.createObjectURL(blob); image.src = imageUrl; image.alt = `「${work.title || "無題"}」のタイトルボード`;
      await image.decode();
      if (controller.signal.aborted || !dialog.isConnected) return;
      image.hidden = false;
      dialog.querySelector("[data-board-preview-caption]")!.textContent = `${sections.find(section => section.id === work.sectionId)?.title ?? "以前の展示"} ／ ${work.title || "無題"}`;
      for (const warning of result.issues ?? []) {
        const item = document.createElement("li"); item.textContent = String(warning); issues.append(item);
      }
      issues.hidden = !issues.childElementCount;
      status.textContent = "105 × 74.25 mm（A4の8分の1）の仕上がりイメージです。";
    } catch (error) {
      if (pending !== controller || !dialog.isConnected) return;
      clearImage();
      status.textContent = controller.signal.aborted ? "プレビューの読み込みがタイムアウトしました。再度お試しください。" : error instanceof Error ? error.message : "プレビューを作成できませんでした。";
    } finally {
      window.clearTimeout(timeout);
      if (pending === controller && dialog.isConnected) refresh.disabled = false;
    }
  };
  select.addEventListener("change", () => void show());
  for (const [direction, step] of [["prev", -1], ["next", 1]] as const) dialog.querySelector(`[data-board-preview-${direction}]`)!.addEventListener("click", () => { select.selectedIndex += step; void show(); });
  refresh.addEventListener("click", () => void show());
  dialog.querySelectorAll("[data-board-preview-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => {
    pending?.abort(); clearImage(); dialog.remove(); document.body.style.overflow = previousOverflow;
    if (options.trigger.isConnected) options.trigger.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog); document.body.style.overflow = "hidden"; dialog.showModal(); void show();
}
