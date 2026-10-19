import { justifiedRows } from "../utils/justifiedGallery";

const gallery = document.querySelector<HTMLElement>(".justified-grid");
if (gallery) initializeGallery(gallery);

function initializeGallery(gallery: HTMLElement) {
  const scope = gallery.closest(".gallery-detail-wrapper") ?? gallery.closest(".gallery-container-inner")!;
  const items = [...gallery.querySelectorAll<HTMLAnchorElement>(".photo-wrapper")];
  const pageSize = Number(gallery.dataset.pageSize) || 100;
  let totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const mobileScreen = window.matchMedia("(max-width: 768px)");
  let frame = 0;

  function layoutImages() {
    const width = gallery.getBoundingClientRect().width;
    if (!width) return;
    const visible = items.filter(item => !item.hidden);
    const gap = parseFloat(getComputedStyle(gallery).getPropertyValue("--photo-gap"));
    const ratios = visible.map(item => {
      const img = item.querySelector("img")!;
      return Number(item.dataset.aspectRatio) || img.naturalWidth / img.naturalHeight || 1.5;
    });
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
        item.querySelector("img")!.sizes = `${Math.ceil(photoWidth)}px`;
        left += photoWidth + gap;
      });
      top += row.height + gap;
    }
    gallery.style.height = `${Math.max(0, top - gap)}px`;
    gallery.dataset.layout = "justified";
  }

  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layoutImages();
    });
  }
  // CMS dimensions reserve space immediately. Only missing metadata needs a
  // second layout when that particular image arrives; never wait for all lazy images.
  function watchImage(item: HTMLAnchorElement) {
    if (!Number(item.dataset.aspectRatio)) {
      item.querySelector("img")?.addEventListener("load", scheduleLayout);
    }
  }
  items.forEach(watchImage);
  window.addEventListener("resize", scheduleLayout);
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


  let currentPage = 1;
  const renderPage = (page: number) => {
    totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    currentPage = Math.max(1, Math.min(totalPages, page));
    const start = (currentPage - 1) * pageSize;
    items.forEach((item, index) => { item.hidden = index < start || index >= start + pageSize; });
    if (inputTop) { inputTop.value = String(currentPage); inputTop.max = String(totalPages); }
    const count = scope.querySelector(".picture-count-value");
    const pages = scope.querySelector(".total-pages-value");
    if (count) count.textContent = String(items.length);
    if (pages) pages.textContent = String(totalPages);
    scope.querySelector(".panel-bottom")?.classList.toggle("panel-hidden", totalPages <= 1);
    scope.querySelector(".pagination-controls")?.classList.toggle("pagination-controls-hidden", totalPages <= 1);
    updatePaginationNumbers();
    layoutImages();
  };

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
        renderPage(page);
      });

      numbersContainer.appendChild(link);
      prevPage = page;
    });
  };

  inputTop?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const value = parseInt(target.value, 10);
    if (!Number.isNaN(value)) renderPage(value);
  });

  btnPrevTop?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(currentPage - 1);
  });

  btnNextTop?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(currentPage + 1);
  });

  btnFirst?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(1);
  });

  btnPrev?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(currentPage - 1);
  });

  btnNext?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(currentPage + 1);
  });

  btnLast?.addEventListener("click", (event) => {
    event.preventDefault();
    renderPage(totalPages);
  });

  if (items.length > 0) {
    renderPage(1);
  }
  // Lightroom supplies later pages using signed cursors. Append them to the
  // same layout and pagination without waiting for every lazy image to load.
  async function fetchRemainingPhotos() {
    let cursor = gallery.dataset.nextCursor;
    const seen = new Set<string>();
    try {
      while (cursor) {
        if (seen.has(cursor)) throw new Error("Repeated gallery cursor");
        seen.add(cursor);
        const response = await fetch(`/api/gallery/${encodeURIComponent(gallery.dataset.albumId!)}?cursor=${encodeURIComponent(cursor)}`);
        if (!response.ok) throw new Error("Gallery unavailable");
        const data = await response.json();
        for (const photo of data.photos) {
          const link = document.createElement("a");
          link.className = "photo-wrapper photo-trigger";
          link.href = photo.full;
          link.dataset.lightbox = "album";
          link.hidden = true;
          const img = document.createElement("img");
          img.className = "gallery-image";
          img.src = photo.src;
          img.alt = photo.name;
          img.decoding = "async";
          img.loading = "lazy";
          link.appendChild(img);
          watchImage(link);
          items.push(link);
          gallery.appendChild(link);
        }
        cursor = data.nextCursor;
        renderPage(currentPage);
      }
    } catch {
      const status = scope.querySelector(".gallery-load-status");
      if (status) status.textContent = "写真の続きを取得できません。ページを再読み込みしてください。";
    }
  }
  if (gallery.dataset.albumId) void fetchRemainingPhotos();
}
