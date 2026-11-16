import { readApiResponse, apiErrorMessage } from "./apiResponse";
import type { HomePhoto } from "../lib/homePhotos";

export function homePhotoPicker(options: {
  read: () => string[]; change: (ids: string[]) => void; busy: () => boolean;
}) {
  const dialog = document.querySelector<HTMLDialogElement>("#home-photo-picker");
  if (!dialog) return null;
  const grid = dialog.querySelector<HTMLElement>("#home-photo-picker-grid")!;
  const status = dialog.querySelector<HTMLElement>("#home-photo-picker-status")!;
  const count = dialog.querySelector<HTMLElement>("#home-photo-picker-count")!;
  const search = dialog.querySelector<HTMLInputElement>("#home-photo-search")!;
  const filter = dialog.querySelector<HTMLSelectElement>("#home-photo-filter")!;
  const retry = dialog.querySelector<HTMLButtonElement>("#home-photo-retry")!;
  const apply = dialog.querySelector<HTMLButtonElement>("#home-photo-apply")!;
  const prev = dialog.querySelector<HTMLButtonElement>("#home-photo-prev")!;
  const next = dialog.querySelector<HTMLButtonElement>("#home-photo-next")!;
  const pageText = dialog.querySelector<HTMLElement>("#home-photo-page")!;
  let photos: HomePhoto[] | null = null;
  let loading = false, failed = false, page = 1;
  let selected = new Set<string>();
  let summary: HTMLElement | undefined;
  let opener: HTMLButtonElement | undefined;
  const pageSize = 36;
  const refreshSummary = () => { if (summary) summary.textContent = `除外設定：${options.read().length}枚。公開Portfolioの横長写真から、メインに最大3枚・フィルムに最大20枚をランダムに表示します。`; };

  function render() {
    const query = search.value.trim().normalize("NFKC").toLocaleLowerCase("ja");
    const matched = (photos ?? []).filter(photo => photo.portfolioName.normalize("NFKC").toLocaleLowerCase("ja").includes(query) &&
      (filter.value === "all" || selected.has(photo.id) === (filter.value === "excluded")));
    const pages = Math.max(1, Math.ceil(matched.length / pageSize));
    page = Math.min(page, pages);
    const knownExclusions = (photos ?? []).filter(photo => selected.has(photo.id)).length;
    count.textContent = photos ? `表示候補 ${(photos.length - knownExclusions).toLocaleString()}枚 ／ 除外中 ${knownExclusions.toLocaleString()}枚　（検索結果 ${matched.length.toLocaleString()}枚）` : "";
    if (photos && selected.size > knownExclusions) count.textContent += ` ※現在一覧にない${selected.size - knownExclusions}枚の除外設定も保持します。`;
    const fragment = document.createDocumentFragment();
    for (const photo of matched.slice((page - 1) * pageSize, page * pageSize)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.photoId = photo.id;
      button.setAttribute("aria-pressed", String(selected.has(photo.id)));
      button.setAttribute("aria-label", `${photo.portfolioName}の写真 ${photo.position}を除外`);
      const image = document.createElement("img");
      image.src = photo.url; image.alt = ""; image.loading = "lazy"; image.decoding = "async";
      image.width = photo.width; image.height = photo.height;
      const name = document.createElement("span");
      name.textContent = `${photo.portfolioName} · ${photo.position}`;
      const state = document.createElement("span");
      state.className = "home-photo-state";
      state.textContent = selected.has(photo.id) ? "✓ 除外中" : "表示候補";
      button.append(image, name, state);
      button.addEventListener("click", () => {
        if (!selected.has(photo.id) && selected.size >= 5000) {
          status.textContent = "除外設定は最大5,000枚です。不要な設定を解除してください。"; return;
        }
        selected.has(photo.id) ? selected.delete(photo.id) : selected.add(photo.id);
        render();
        (grid.querySelector<HTMLButtonElement>(`[data-photo-id="${photo.id}"]`) ?? grid.querySelector("button") ?? apply).focus({ preventScroll: true });
      });
      fragment.append(button);
    }
    grid.replaceChildren(fragment);
    if (!loading && !failed) status.textContent = matched.length ? "" : photos?.length ? "条件に合う写真はありません。" : "現在、公開Portfolioの表示対象となる写真はありません。";
    prev.disabled = loading || page === 1; next.disabled = loading || page === pages;
    pageText.textContent = `${page} / ${pages}`;
    apply.disabled = loading || failed || !photos;
  }

  async function load() {
    if (loading) return;
    loading = true; failed = false; retry.hidden = true;
    status.textContent = "写真一覧を読み込んでいます…";
    render();
    try {
      const response = await fetch("/api/admin/home-photos", { signal: AbortSignal.timeout(30000) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok || !Array.isArray(result.photos)) throw new Error(result.message || "写真一覧を取得できませんでした。");
      photos = result.photos;
    } catch (error) {
      failed = true; retry.hidden = false; status.textContent = apiErrorMessage(error);
    } finally { loading = false; render(); }
  }
  for (const control of [search, filter]) control.addEventListener("input", () => { page = 1; render(); });
  for (const [button, delta] of [[prev, -1], [next, 1]] as const) button.addEventListener("click", () => {
    page += delta; render(); dialog.querySelector(".home-photo-picker-scroll")!.scrollTop = 0;
  });
  retry.addEventListener("click", () => void load());
  dialog.querySelectorAll("[data-home-photo-cancel]").forEach(button => button.addEventListener("click", () => dialog.close()));
  // Search inputs otherwise consume the first Escape to clear their text.
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.close(); }
  }, true);
  dialog.addEventListener("close", () => opener?.focus({ preventScroll: true }));
  apply.addEventListener("click", () => {
    if (loading || failed || !photos || options.busy()) return;
    options.change([...selected]); refreshSummary(); dialog.close();
  });
  return {
    field() {
      const section = document.createElement("section"); section.className = "admin-field";
      const heading = document.createElement("h3"); heading.textContent = "メイン写真・フィルム写真の除外設定";
      summary = document.createElement("p"); summary.className = "admin-help"; refreshSummary();
      opener = document.createElement("button"); opener.type = "button"; opener.textContent = "写真の除外設定を開く";
      opener.setAttribute("aria-haspopup", "dialog"); opener.setAttribute("aria-controls", dialog.id);
      opener.addEventListener("click", () => {
        if (options.busy()) return;
        selected = new Set(options.read()); page = 1; search.value = ""; filter.value = "all";
        render(); dialog.showModal(); search.focus();
        // Refresh on every open so added/deleted Portfolio photos are picked up.
        void load();
      });
      section.append(heading, summary, opener); return section;
    },
  };
}
