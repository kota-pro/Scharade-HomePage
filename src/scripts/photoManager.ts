import type { PhotoRanking, RankedPhoto } from "../lib/photoRanking";
import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { createPhotoLikers } from "./photoLikers";
const manager = document.querySelector<HTMLElement>("#photo-manager");
if (manager) setupPhotoManager(manager);
function setupPhotoManager(manager: HTMLElement) {
  const select = manager.querySelector<HTMLSelectElement>("#photo-container")!, list = manager.querySelector<HTMLOListElement>("[data-photo-manager-list]")!, status = manager.querySelector<HTMLElement>("[data-photo-manager-status]")!;
  const refresh = manager.querySelector<HTMLButtonElement>("[data-photo-ranking-refresh]")!;
  const spinner = manager.querySelector<HTMLElement>("[data-photo-ranking-loading]")!;
  const pagination = manager.querySelector<HTMLElement>(".photo-ranking-pagination")!;
  const pageNumbers = pagination.querySelector<HTMLElement>("[data-photo-ranking-pages]")!;
  const first = pagination.querySelector<HTMLAnchorElement>("[data-photo-manager-first]")!;
  const previous = pagination.querySelector<HTMLAnchorElement>("[data-photo-manager-prev]")!;
  const next = pagination.querySelector<HTMLAnchorElement>("[data-photo-manager-next]")!;
  const last = pagination.querySelector<HTMLAnchorElement>("[data-photo-manager-last]")!;
  const format = (value: number) => value.toLocaleString("ja-JP");
  let page = 1, pages = 1, version = 0, controller: AbortController | undefined;
  const text = (tag: string, value: string, className = "") => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
  function pageUrl(target: number, scope: string) {
    const url = new URL(location.href);
    if (target > 1) url.searchParams.set("page", String(target));
    else url.searchParams.delete("page");
    if (scope) url.searchParams.set("container", scope);
    else url.searchParams.delete("container");
    return url;
  }
  function renderPagination(scope: string) {
    const hadFocus = pagination.contains(document.activeElement);
    pagination.hidden = pages <= 1;
    if (pagination.hidden) {
      if (hadFocus) refresh.focus({ preventScroll: true });
      return;
    }

    function setArrow(link: HTMLAnchorElement, target: number, disabled: boolean) {
      if (disabled) {
        link.removeAttribute("href");
        link.setAttribute("role", "link");
        link.setAttribute("aria-disabled", "true");
      } else {
        link.href = pageUrl(target, scope).href;
        link.removeAttribute("role");
        link.removeAttribute("aria-disabled");
      }
    }
    setArrow(first, 1, page === 1);
    setArrow(previous, page - 1, page === 1);
    setArrow(next, page + 1, page === pages);
    setArrow(last, pages, page === pages);

    const numbers = [...new Set([1, 2, pages - 1, pages, page - 1, page, page + 1])]
      .filter(number => number >= 1 && number <= pages)
      .sort((a, b) => a - b);
    pageNumbers.replaceChildren();
    for (const [index, number] of numbers.entries()) {
      if (index > 0 && number - numbers[index - 1] > 1) {
        const ellipsis = text("span", "...");
        ellipsis.setAttribute("aria-hidden", "true");
        pageNumbers.append(ellipsis);
      }
      const link = document.createElement("a");
      link.href = pageUrl(number, scope).href;
      link.textContent = String(number);
      link.setAttribute("aria-label", `${number}ページ目`);
      if (number === page) link.setAttribute("aria-current", "page");
      pageNumbers.append(link);
    }
    if (hadFocus && !pagination.querySelector("a[href]:focus")) {
      pageNumbers.querySelector<HTMLAnchorElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    }
  }
  function row(photo: RankedPhoto) {
    const item = document.createElement("li"), article = document.createElement("article"); article.className = "photo-ranking-row"; article.dataset.photoRank = String(photo.rank);
    const rank = text("span", `${photo.rank}`, "photo-ranking-position"); rank.setAttribute("aria-label", `${photo.rank}位`);
    const link = document.createElement("a"), image = document.createElement("img"); link.href = photo.href; link.className = "photo-ranking-thumbnail"; link.setAttribute("aria-label", `${photo.title || "写真"}を見る`);
    image.src = photo.src; image.alt = photo.title || "写真"; image.loading = "lazy"; image.width = 160; image.height = 120; link.append(image);
    const detail = document.createElement("div"); detail.className = "photo-ranking-detail";
    const title = document.createElement("h4"), titleLink = document.createElement("a"); titleLink.href = photo.href; titleLink.textContent = photo.title || "無題の写真"; title.append(titleLink);
    const author = photo.author?.name && photo.author.name !== photo.containerName ? `${photo.author.name} · ${photo.containerName}` : photo.containerName;
    detail.append(text("p", photo.sourceLabel, "photo-ranking-source"), title, text("p", author, "photo-ranking-author"));
    if (photo.caption) detail.append(text("p", photo.caption, "photo-ranking-caption"));
    const equipment = [photo.camera, photo.lens].filter(Boolean).join(" / ");
    if (equipment) detail.append(text("p", equipment, "photo-ranking-equipment"));
    const settings = [photo.fNumber ? `f${photo.fNumber}` : "", photo.shutterSpeed ? `SS ${photo.shutterSpeed}` : "", photo.iso ? `ISO ${photo.iso}` : ""].filter(Boolean).join(" · ");
    if (settings) detail.append(text("p", settings, "photo-ranking-equipment"));
    if (photo.likers?.length) detail.append(createPhotoLikers(photo.likers, photo.count ?? 0));
    const count = document.createElement("div"); count.className = "photo-ranking-likes";
    count.append(text("span", format(photo.count ?? 0)), text("small", "いいね"));
    article.append(rank, link, detail, count); item.append(article); return item;
  }
  function clear() {
    list.replaceChildren(); pagination.hidden = true;
    manager.querySelectorAll<HTMLElement>("[data-photo-summary]").forEach(node => { node.textContent = "—"; });
    manager.querySelector<HTMLElement>("[data-photo-ranking-updated]")!.textContent = "";
  }
  async function load(targetPage = 1, reset = false) {
    const current = ++version; controller?.abort(); controller = new AbortController();
    if (reset) clear();
    const scope = select.value;
    spinner.hidden = list.childElementCount > 0; status.textContent = ""; status.dataset.error = "false";
    manager.setAttribute("aria-busy", "true"); refresh.disabled = true;
    try {
      const response = await fetch(`/api/admin/photos?${new URLSearchParams({ container: scope, page: String(targetPage) })}`, { signal: controller.signal });
      const data = await readApiResponse(response) as PhotoRanking & { ok: boolean; message?: string };
      if (current !== version) return;
      if (!response.ok || !data.ok) throw new Error(data.message || "ランキングを取得できませんでした。");
      page = data.page; pages = data.pages;
      list.replaceChildren(...data.photos.map(row));
      for (const [key, value] of Object.entries(data.summary)) manager.querySelector<HTMLElement>(`[data-photo-summary="${key}"]`)!.textContent = format(value);
      manager.querySelector<HTMLElement>("[data-photo-ranking-scope]")!.textContent = data.scope.label;
      manager.querySelector<HTMLElement>("[data-photo-ranking-updated]")!.textContent = `${new Date(data.generatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 更新`;
      refresh.disabled = false;
      renderPagination(scope);
      history.replaceState(history.state, "", pageUrl(page, scope));
      list.start = (page - 1) * data.pageSize + 1;
      status.textContent = data.unavailable ? "一部の写真は現在表示できません。表示できた写真を集計しています。" : data.photos.length ? "いいね数の多い順です。同じ件数は同順位で表示します。" : "この掲載先には、まだいいねの付いた写真がありません。";
    } catch (error) {
      if (current !== version || (error instanceof DOMException && error.name === "AbortError")) return;
      status.textContent = `${apiErrorMessage(error)}${list.childElementCount ? " 前回の結果を表示しています。" : "「更新する」から再試行できます。"}`; status.dataset.error = "true";
    } finally {
      if (current === version) { spinner.hidden = true; manager.setAttribute("aria-busy", "false"); refresh.disabled = false; }
    }
  }
  select.addEventListener("change", () => { page = pages = 1; void load(1, true); });
  pagination.addEventListener("click", event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = Number(new URL(link.href).searchParams.get("page") ?? "1");
    if (manager.getAttribute("aria-busy") !== "true" && target !== page) void load(target);
  });
  refresh.addEventListener("click", () => void load(page));
  const params = new URLSearchParams(location.search);
  const scope = params.get("container") ?? "";
  if ([...select.options].some(option => option.value === scope)) select.value = scope;
  const requestedPage = params.get("page") ?? "1";
  void load(/^[1-9]\d{0,5}$/.test(requestedPage) ? Number(requestedPage) : 1, true);
}
