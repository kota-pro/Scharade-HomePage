import { createPhotoCard } from "./photoCards";
import { justifiedRows } from "../utils/justifiedGallery";

const gallery = document.querySelector<HTMLElement>(".justified-grid");
if (gallery) initializeGallery(gallery);

function initializeGallery(gallery: HTMLElement) {
  const scope = gallery.closest(".gallery-detail-wrapper") ?? gallery.closest(".gallery-container-inner")!;
  const items = [...gallery.querySelectorAll<HTMLElement>(".photo-wrapper")];
  const albumId = gallery.dataset.albumId;
  const pageSize = Number(gallery.dataset.pageSize) || 100;
  let totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const mobileScreen = window.matchMedia("(max-width: 768px)");
  const saved = history.state?.scharadePhotoGallery;
  let currentPage = Number.isSafeInteger(saved?.page) ? saved.page as number : 1;
  let restoreScroll = Number.isFinite(saved?.scroll) ? saved.scroll as number : undefined;
  let cursor = gallery.dataset.nextCursor;
  let visible: HTMLElement[] = [], layoutReady = false, jumpToTop = false;
  let frame = 0, generation = 0, lastWidth = 0, preparedPage = 0;
  let preserveScroll = false, navigationSequence = 0;
  let continuation: Promise<void> | undefined, continuationTimer: number | undefined;
  let continuationScheduled = false;

  function layoutImages() {
    const width = gallery.getBoundingClientRect().width;
    if (!width || !layoutReady) return;
    if (width === lastWidth && gallery.dataset.layout === "justified") { scrollAfterLayout(); return; }
    const anchor = preserveScroll && restoreScroll === undefined && !jumpToTop ? visibleScrollAnchor() : undefined;
    preserveScroll = false;
    lastWidth = width;
    const gap = parseFloat(getComputedStyle(gallery).getPropertyValue("--photo-gap"));
    const ratios = visible.map(item => Number(item.dataset.aspectRatio) || 1.5);
    const rows = justifiedRows(ratios, width, gap, mobileScreen.matches);
    let top = 0;
    for (const row of rows) {
      let left = 0;
      row.widths.forEach((photoWidth, index) => {
        const item = visible[row.start + index];
        Object.assign(item.style, {
          left: `${left}px`, top: `${top}px`,
          width: `${photoWidth}px`, height: `${row.height}px`,
        });
        // Let srcset select an image for the actual tile width and device DPI.
        const responsiveImage = item.querySelector<HTMLImageElement>("img[srcset]");
        if (responsiveImage) responsiveImage.sizes = `${Math.ceil(photoWidth)}px`;
        left += photoWidth + gap;
      });
      top += row.height + gap;
    }
    gallery.style.height = `${Math.max(0, top - gap)}px`;
    gallery.dataset.layout = "justified";
    if (anchor) {
      const offset = anchor.card.getBoundingClientRect().top - anchor.top;
      if (Math.abs(offset) >= 1) window.scrollBy({ top: offset, behavior: "instant" });
    }
    scrollAfterLayout();
  }

  function visibleScrollAnchor() {
    for (const card of visible) {
      if (!card.style.height) continue;
      const { top, bottom } = card.getBoundingClientRect();
      if (top >= innerHeight) break;
      if (bottom > 0) return { card, top };
    }
  }

  function scrollAfterLayout() {
    if (restoreScroll !== undefined) {
      window.scrollTo({ top: restoreScroll, behavior: "instant" });
      restoreScroll = undefined;
    } else if (jumpToTop) {
      (scope.querySelector(".panel-top") ?? gallery).scrollIntoView({ block: "start", behavior: "instant" });
    }
    jumpToTop = false;
  }

  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layoutImages();
    });
  }
  async function measurePage(cards: HTMLElement[], revision: number) {
    let pending = cards.filter(item => !Number(item.dataset.aspectRatio)).map(item => ({ item, image: item.querySelector("img")! }));
    for (const { image } of pending) image.loading = "eager";
    const deadline = performance.now() + 10_000;
    while (pending.length && revision === generation && performance.now() < deadline) {
      pending = pending.filter(({ item, image }) => {
        if (image.naturalWidth && image.naturalHeight) {
          item.dataset.aspectRatio = String(image.naturalWidth / image.naturalHeight);
          return false;
        }
        return !image.complete || !image.currentSrc;
      });
      if (pending.length) await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (revision !== generation) return;
    layoutReady = true;
    layoutImages();
  }
  function recordRatio(card: HTMLElement, image: HTMLImageElement) {
    if (!image.naturalWidth || !image.naturalHeight) return false;
    const ratio = image.naturalWidth / image.naturalHeight;
    const previous = Number(card.dataset.aspectRatio);
    if (previous && Math.abs(previous - ratio) < 0.005) return false;
    card.dataset.aspectRatio = String(ratio);
    return true;
  }
  if (albumId) gallery.addEventListener("load", ({ target }) => {
    if (!(target instanceof HTMLImageElement)) return;
    const card = target.closest<HTMLElement>(".photo-wrapper");
    if (!card) return;
    if (!card.hidden) continueAfterImage();
    if (target.matches(".gallery-image") && recordRatio(card, target) && !card.hidden) {
      preserveScroll = true;
      lastWidth = 0;
      scheduleLayout();
    }
  }, true);
  window.addEventListener("resize", scheduleLayout);
  document.addEventListener("photo:layout-changed", () => { lastWidth = 0; scheduleLayout(); });
  if (typeof ResizeObserver !== "undefined") {
    let previousWidth = 0;
    new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      scheduleLayout();
    }).observe(gallery);
  }
  const inputTop = scope.querySelector<HTMLInputElement>(".page-input-top");
  const numbersContainer = scope.querySelector(".tab-posts-numbers");
  const btnFirst = scope.querySelector(".first-btn");
  const btnPrev = scope.querySelector(".prev-btn");
  const btnNext = scope.querySelector(".next-btn");
  const btnLast = scope.querySelector(".last-btn");
  const btnPrevTop = scope.querySelector(".prev-btn-top");
  const btnNextTop = scope.querySelector(".next-btn-top");


  const renderPage = (page: number, jump = false) => {
    totalPages = Math.max(1, Math.ceil((items.length + Number(Boolean(cursor))) / pageSize));
    const targetPage = Math.max(1, cursor && (albumId || !jump) ? page : Math.min(totalPages, page));
    if (jump && targetPage !== currentPage) { jumpToTop = true; restoreScroll = undefined; }
    currentPage = targetPage;
    const start = (currentPage - 1) * pageSize;
    const next = items.slice(start, start + pageSize);
    if (inputTop) { inputTop.value = String(currentPage); inputTop.max = String(totalPages); }
    const count = scope.querySelector(".picture-count-value");
    const pages = scope.querySelector(".total-pages-value");
    if (count) count.textContent = String(items.length);
    if (pages) pages.textContent = String(totalPages);
    scope.querySelector(".panel-bottom")?.classList.toggle("panel-hidden", totalPages <= 1);
    scope.querySelector(".pagination-controls")?.classList.toggle("pagination-controls-hidden", totalPages <= 1);
    updatePaginationNumbers();
    if (cursor && !next.length) {
      ++generation;
      visible = [];
      preparedPage = 0;
      layoutReady = false;
      preserveScroll = false;
      gallery.dataset.layout = "loading";
      gallery.style.removeProperty("height");
      return;
    }
    if (preparedPage === currentPage && visible.length === next.length && next.every((item, index) => visible[index] === item)) {
      if (layoutReady) scrollAfterLayout();
      return;
    }
    preserveScroll = Boolean(albumId && layoutReady && preparedPage === currentPage);
    visible = next;
    preparedPage = currentPage;
    items.forEach((item, index) => { item.hidden = index < start || index >= start + pageSize; });
    if (albumId) {
      for (const card of next) {
        const image = card.querySelector<HTMLImageElement>("img.gallery-image");
        if (image?.complete) recordRatio(card, image);
      }
      lastWidth = 0;
      layoutReady = true;
      layoutImages();
      return;
    }
    layoutReady = false;
    gallery.dataset.layout = "loading";
    gallery.style.removeProperty("height");
    void measurePage(next, ++generation);
  };

  function goToPage(page: number) {
    ++navigationSequence;
    renderPage(page, true);
    if (cursor && page > 1) void startContinuation();
  }

  const updatePaginationNumbers = () => {
    if (!numbersContainer) return;
    numbersContainer.innerHTML = "";

    const pagesSet = new Set([
      1,
      2,
      totalPages - 1,
      totalPages,
      currentPage - 1,
      currentPage,
      currentPage + 1,
    ]);

    const sortedPages = Array.from(pagesSet)
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);

    let prevPage = 0;
    sortedPages.forEach((page) => {
      if (prevPage > 0 && page - prevPage > 1) {
        const dots = document.createElement("span");
        dots.className = "separate-slash";
        dots.textContent = "...";
        numbersContainer.appendChild(dots);
      }

      const link = document.createElement("a");
      link.className = "tab-posts-number";
      link.textContent = page.toString();
      link.href = "#";

      if (page === currentPage) {
        link.style.textDecoration = "underline";
        link.style.textDecorationThickness = "0.5px";
        link.style.textUnderlineOffset = "4px";
      }

      link.addEventListener("click", (event) => {
        event.preventDefault();
        goToPage(page);
      });

      numbersContainer.appendChild(link);
      prevPage = page;
    });
  };

  inputTop?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const value = parseInt(target.value, 10);
    if (Number.isSafeInteger(value)) goToPage(value);
  });

  btnPrevTop?.addEventListener("click", (event) => {
    event.preventDefault();
    goToPage(currentPage - 1);
  });

  btnNextTop?.addEventListener("click", (event) => {
    event.preventDefault();
    goToPage(currentPage + 1);
  });

  btnFirst?.addEventListener("click", (event) => {
    event.preventDefault();
    goToPage(1);
  });

  btnPrev?.addEventListener("click", (event) => {
    event.preventDefault();
    goToPage(currentPage - 1);
  });

  btnNext?.addEventListener("click", (event) => {
    event.preventDefault();
    goToPage(currentPage + 1);
  });

  btnLast?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!cursor) { goToPage(totalPages); return; }
    const sequence = ++navigationSequence;
    void startContinuation().then(() => {
      if (sequence === navigationSequence) renderPage(totalPages, true);
    });
  });

  renderPage(currentPage);
  window.addEventListener("pagehide", () => {
    history.replaceState({ ...history.state, scharadePhotoGallery: { page: currentPage, scroll: scrollY } }, "");
  });
  // Lightroom supplies later pages using signed cursors. Append them to the
  // same layout and pagination without waiting for every lazy image to load.
  async function fetchRemainingPhotos() {
    const seen = new Set<string>();
    try {
      while (cursor) {
        if (seen.has(cursor)) throw new Error("Repeated gallery cursor");
        seen.add(cursor);
        const response = await fetch(`/api/gallery/${encodeURIComponent(albumId!)}?view=works&cursor=${encodeURIComponent(cursor)}`);
        if (!response.ok) throw new Error("Gallery unavailable");
        const data = await response.json();
        for (const photo of data.photos) {
          const link = createPhotoCard({ source: "gallery", containerId: albumId!, imageId: photo.id, proof: new URL(photo.full, location.href).searchParams.get("proof")! }, photo.src, photo.full, photo.name, photo.series);
          link.hidden = true;
          if (!photo.series && photo.width > 0 && photo.height > 0) link.dataset.aspectRatio = String(photo.width / photo.height);
          items.push(link);
          gallery.appendChild(link);
        }
        cursor = data.nextCursor;
        gallery.dataset.nextCursor = cursor || "";
        renderPage(currentPage);
        document.dispatchEvent(new Event("photo:added"));
      }
      document.dispatchEvent(new Event("photo:loaded"));
    } catch {
      cursor = undefined;
      gallery.dataset.nextCursor = "";
      renderPage(currentPage);
      document.dispatchEvent(new Event("photo:loaded"));
      const status = scope.querySelector(".gallery-load-status");
      if (status) { status.textContent = "写真の続きを取得できません。ページを再読み込みしてください。"; status.setAttribute("data-error", "true"); }
    }
  }
  function startContinuation() {
    window.clearTimeout(continuationTimer);
    return continuation ??= fetchRemainingPhotos();
  }
  function continueAfterImage() {
    if (!cursor || continuation || continuationScheduled) return;
    continuationScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { void startContinuation(); }));
  }
  const pageOf = (id: string) => {
    const index = items.findIndex(item => item.dataset.photoSeriesMembers?.split(" ").includes(id) || JSON.parse(item.dataset.photoRef ?? "{}").imageId === id);
    return index < 0 ? undefined : Math.floor(index / pageSize) + 1;
  };
  document.addEventListener("photo:reveal", ((event: CustomEvent<{ imageId: string }>) => {
    const page = pageOf(event.detail.imageId);
    if (page) { ++navigationSequence; renderPage(page); }
  }) as EventListener);
  document.addEventListener("photo:list-return", ((event: CustomEvent<{ imageId: string; scroll: number }>) => {
    const page = pageOf(event.detail.imageId);
    if (!page) return;
    event.preventDefault();
    restoreScroll = event.detail.scroll;
    renderPage(page);
  }) as EventListener);
  if (albumId) document.addEventListener("photo:load-album", ((event: CustomEvent<{ waitFor: (completion: Promise<void>) => void }>) => {
    if (cursor) event.detail.waitFor(startContinuation());
  }) as EventListener);
  if (!cursor) queueMicrotask(() => document.dispatchEvent(new Event("photo:loaded")));
  else if (currentPage > 1 || new URLSearchParams(location.search).has("photo")) void startContinuation();
  else {
    continuationTimer = window.setTimeout(() => { void startContinuation(); }, 1000);
    if (visible.some(card => [...card.querySelectorAll("img")].some(image => image.complete && image.naturalWidth))) continueAfterImage();
  }
}
