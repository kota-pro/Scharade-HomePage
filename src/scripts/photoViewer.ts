import { frameBlogPhotos } from "./blogPhotoFrames";
import "../styles/PhotoViewer.css";
import { operationNotice } from "./siteNotice";
import { createPhotoCard } from "./photoCards";
import { openPhotoLikers } from "./photoLikers";
import { photoSeriesFrameStyle, photoSeriesPreview } from "../utils/photoSeriesLayout";
import { photoEquipmentFields, photoMetadataFields, type PhotoRef, type PhotoSeries, type PhotoSeriesFrame, type PhotoShootingMetadata, type PhotoView } from "../types/photos";
import { apiErrorMessage } from "./apiResponse";
import type { BookReaderOptions } from "../types/portfolioBooks";

const dialog = document.querySelector<HTMLDialogElement>("#photo-dialog");
if (dialog) setupPhotoViewer(dialog);
function setupPhotoViewer(dialog: HTMLDialogElement) {
  const views = new Map<HTMLElement, PhotoView>(), refs = new Map<HTMLElement, PhotoRef>();
  const registered = new Set<HTMLElement>(), pendingLikes = new Set<string>(), detailed = new Set<HTMLElement>(), detailPending = new Set<HTMLElement>(), detailTimes = new Map<HTMLElement, number>(), detailErrors = new Map<HTMLElement, string>();
  const authors = new WeakMap<HTMLElement, string>();
  const image = dialog.querySelector<HTMLImageElement>("[data-photo-image]")!, status = dialog.querySelector<HTMLElement>("[data-photo-status]")!;
  const mediaLoader = dialog.querySelector<HTMLElement>("[data-photo-media-loading]")!;
  const viewport = dialog.querySelector<HTMLElement>("[data-photo-viewport]")!, information = dialog.querySelector<HTMLElement>("#photo-information")!, toggle = dialog.querySelector<HTMLButtonElement>("[data-photo-toggle]")!;
  const informationTitle = information.querySelector<HTMLHeadingElement>("[data-photo-title]")!;
  const shootingFields = information.querySelectorAll<HTMLElement>("[data-photo-camera], [data-photo-lens], [data-photo-film], [data-photo-settings]");
  const editButton = dialog.querySelector<HTMLButtonElement>("[data-photo-edit]");
  const bookButton = dialog.querySelector<HTMLButtonElement>("[data-open-book-reader]");
  let openEditor: ReturnType<typeof import("./galleryPhotoEditor").createGalleryPhotoEditor> | undefined;
  const spinner = dialog.querySelector<HTMLElement>("[data-photo-details-loading]")!, detailError = dialog.querySelector<HTMLElement>("[data-photo-detail-error]")!, retry = dialog.querySelector<HTMLButtonElement>("[data-photo-detail-retry]")!;
  const overview = dialog.querySelector<HTMLElement>("[data-photo-series-overview]")!;
  const seriesHelp = dialog.querySelector<HTMLElement>("[data-photo-series-help]")!;
  const seriesCanvas = dialog.querySelector<HTMLElement>("[data-photo-series-canvas]")!;
  const seriesBack = dialog.querySelector<HTMLButtonElement>("[data-photo-series-back]")!;
  const previous = dialog.querySelector<HTMLButtonElement>("[data-photo-prev]")!;
  const next = dialog.querySelector<HTMLButtonElement>("[data-photo-next]")!;
  const position = dialog.querySelector<HTMLElement>("[data-photo-position]")!;
  const galleryGrid = document.querySelector<HTMLElement>(".justified-grid[data-album-id]");
  let active: HTMLElement | undefined, opener: HTMLElement | undefined, previousOverflow = "", loading = false, refreshQueued = false, noticeRead = false, mutationSequence = 0;
  let informationRequested = false, openedWithPointer = true, lastInputWasKeyboard = false, photoRatio = 1, spinnerTimer = 0;
  let seriesOverview = false, series: PhotoSeries | undefined, drawnSeries: PhotoSeries | undefined;
  let mediaGeneration = 0, imageKey = "", imageFailed = false, openingScroll = 0, openingImageId: string | undefined;
  let imageLoad: AbortController | undefined;
  let requestedSeriesPhoto: string | undefined;
  let albumNavigationRequest = 0;
  const detachedSeriesCards = new Map<string, HTMLElement>();
  const parameters = new URLSearchParams(location.search);
  let deepLinkOpened = false;
  const allCards = () => [...document.querySelectorAll<HTMLElement>("[data-photo-ref]")];
  const photoLink = (card: HTMLElement) => card.matches("a.photo-open") ? card as HTMLAnchorElement : card.querySelector<HTMLAnchorElement>(".photo-open")!;
  const albumCards = (card: HTMLElement) => allCards().filter(item => item.dataset.photoGroup === card.dataset.photoGroup);
  function albumNavigationCard(card: HTMLElement) {
    if (!seriesOverview) return card;
    if (refs.get(card)?.source === "gallery") return opener?.closest<HTMLElement>("[data-photo-ref]") ?? card;
  }
  function updateNavigation(count: number, index?: number) {
    const moreAlbumPhotos = (seriesOverview || !series) && Boolean(galleryGrid?.dataset.nextCursor);
    previous.disabled = next.disabled = count <= 1 && !moreAlbumPhotos;
    position.textContent = index === undefined ? "" : `${index + 1} / ${count}`;
  }
  const linkAuthor = !/^\/Portfolio\/[^/]+\/?$/.test(location.pathname);
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || "処理できませんでした。時間をおいて再度お試しください。");
    return data;
  };
  function author(container: HTMLElement | null, value: PhotoView["author"], linkable: boolean) {
    if (!container) return;
    const signature = JSON.stringify([value, linkable]);
    if (authors.get(container) === signature) return;
    authors.set(container, signature);
    container.replaceChildren(); container.hidden = !value;
    if (!value) return;
    const avatar = document.createElement("img"); avatar.src = value.icon; avatar.alt = "";
    if (linkable && value.href && /^\/Portfolio\/[a-zA-Z0-9_-]+$/.test(value.href)) {
      const link = document.createElement("a"); link.href = value.href; link.setAttribute("aria-label", `${value.name}のPortfolioを見る`); link.append(avatar); container.append(link);
    } else container.append(avatar);
    const name = document.createElement("span"); name.textContent = `by ${value.name}`; container.append(name);
  }
  function paint(container: HTMLElement, view: PhotoView, ready = true) {
    const title = container.querySelector<HTMLElement>("[data-photo-title]");
    const titleText = container.dataset.photoSeriesTitle ?? view.title;
    if (title) { title.textContent = titleText ?? ""; title.hidden = !titleText; }
    container.querySelectorAll<HTMLElement>(".photo-author").forEach(element => author(element, view.author, linkAuthor));
    const shooting: PhotoShootingMetadata = container.dataset.photoSeries === "true"
      ? JSON.parse(container.dataset.photoSeriesShooting ?? "{}")
      : view;
    const equipment = container.querySelector<HTMLElement>("[data-photo-equipment]"), settings = container.querySelector<HTMLElement>("[data-photo-settings]");
    if (equipment) {
      for (const key of photoEquipmentFields) {
        const field = equipment.querySelector<HTMLElement>(`[data-photo-${key}]`);
        if (!field) continue;
        const value = shooting[key] ?? "";
        if (field.textContent !== value) field.textContent = value;
        field.hidden = !value;
      }
      equipment.hidden = !photoEquipmentFields.some(key => shooting[key]);
    }
    if (settings) {
      settings.textContent = [shooting.fNumber ? `f${shooting.fNumber.replace(/^f\/?\s*/i, "")}` : "", shooting.shutterSpeed ? `SS ${shooting.shutterSpeed}` : "", shooting.iso ? `ISO ${shooting.iso.replace(/^ISO\s*/i, "")}` : ""].filter(Boolean).join("\n");
      settings.hidden = !settings.textContent;
    }
    const exif = container.querySelector<HTMLElement>(".photo-exif");
    if (exif) exif.hidden = Boolean(equipment?.hidden && settings?.hidden);
    const like = container.querySelector<HTMLButtonElement>("[data-photo-like]");
    if (like) { like.disabled = !ready || pendingLikes.has(view.key); like.setAttribute("aria-pressed", String(view.liked)); like.setAttribute("aria-label", view.liked ? "いいねを取り消す" : "いいねする"); }
    const count = container.querySelector<HTMLElement>("[data-photo-count]");
    if (count) { count.hidden = view.count === undefined; count.textContent = view.count === undefined ? "" : String(view.count); count.setAttribute("aria-label", `いいね${view.count ?? 0}件、いいねした会員を見る`); }
  }
  function fallback(card: HTMLElement): PhotoView {
    const link = photoLink(card), thumbnail = link.querySelector("img")!;
    const ratio = Number(card.dataset.aspectRatio) || thumbnail.naturalWidth / thumbnail.naturalHeight;
    return { ref: refs.get(card)!, key: "", src: thumbnail.src, full: link.href, alt: card.dataset.photoSeriesTitle || thumbnail.alt, liked: false, ...(ratio > 0 ? { width: ratio, height: 1 } : {}) };
  }
  function updateViewport() {
    if (!dialog.open) return;
    const rotated = !seriesOverview && !series && matchMedia("(max-width:768px) and (orientation:portrait)").matches && photoRatio > 1;
    dialog.dataset.photoRotated = String(rotated);
    viewport.style.width = `${rotated ? dialog.clientHeight : dialog.clientWidth}px`;
    viewport.style.height = `${rotated ? dialog.clientWidth : dialog.clientHeight}px`;
    viewport.style.setProperty("--photo-rotation", rotated ? "90deg" : "0deg");
  }
  function hasInformation(view: PhotoView) {
    return photoMetadataFields.some(key => view[key]?.trim());
  }
  function informationView(view: PhotoView): PhotoView {
    if (!seriesOverview) return view;
    const work = { ...view, title: series?.title ?? active?.dataset.photoSeriesTitle };
    for (const key of photoMetadataFields) {
      if (key !== "title") work[key] = series?.metadata?.[key];
    }
    return work;
  }
  function fitInformationTitle() {
    if (!dialog.open || dialog.dataset.infoOpen !== "true" || informationTitle.hidden) return;

    informationTitle.style.removeProperty("font-size");
    informationTitle.removeAttribute("data-photo-title-wrap");
    const width = informationTitle.clientWidth;
    const textWidth = informationTitle.scrollWidth;
    if (!width || textWidth <= width) return;

    const preferredSize = parseFloat(getComputedStyle(informationTitle).fontSize);
    const visibleSizes = [...shootingFields].filter(field => !field.hidden)
      .map(field => parseFloat(getComputedStyle(field).fontSize));
    const minimumSize = visibleSizes.length ? Math.max(...visibleSizes) : 28 * 4 / 3;
    const fittedSize = Math.max(minimumSize, preferredSize * (width - 1) / textWidth);
    informationTitle.style.fontSize = `${fittedSize}px`;

    if (informationTitle.scrollWidth > width) {
      informationTitle.style.fontSize = `${minimumSize}px`;
      informationTitle.toggleAttribute("data-photo-title-wrap", informationTitle.scrollWidth > width);
    }
  }
  function updateInformation() {
    if (!active) return;
    const card = active, view = views.get(card) ?? fallback(card), ready = detailed.has(card), pending = detailPending.has(card), error = detailErrors.get(card);
    if (editButton) editButton.hidden = !ready || pending || !view.galleryEdit;
    const available = hasInformation(informationView(view));
    if (ready && !available && !error) informationRequested = false;
    const open = seriesOverview || informationRequested && (available || !ready || Boolean(error));
    dialog.dataset.infoOpen = String(open); information.inert = !open; information.setAttribute("aria-hidden", String(!open)); information.setAttribute("aria-busy", String(open && pending));
    toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-disabled", String(ready && !available && !error));
    toggle.setAttribute("aria-label", ready && !available && !error ? `${view.alt}の写真` : open ? "写真の情報を閉じる" : "写真の情報を表示");
    detailError.textContent = error ?? ""; detailError.hidden = !error; retry.hidden = !error;
    window.clearTimeout(spinnerTimer);
    if (!open || !pending) spinner.hidden = true;
    else if (spinner.hidden) spinnerTimer = window.setTimeout(() => {
      if (active === card && dialog.open && dialog.dataset.infoOpen === "true" && detailPending.has(card)) spinner.hidden = false;
    }, 150);
    if (open) fitInformationTitle();
  }
  function display(card: HTMLElement) {
    const changed = active !== card;
    active = card;
    const view = views.get(card) ?? fallback(card);
    dialog.toggleAttribute("data-photo-book", Boolean(card.dataset.bookReader));
    if (bookButton) bookButton.hidden = !card.dataset.bookReader;
    if (seriesOverview) {
      series ??= view.series;
      if (!series && detailed.has(card)) seriesOverview = false;
    }
    dialog.dataset.seriesOverview = String(seriesOverview);
    overview.hidden = !seriesOverview;
    seriesBack.hidden = !series || seriesOverview;
    const info = informationView(view);
    paint(dialog, info, views.has(card));
    const caption = dialog.querySelector<HTMLElement>("[data-photo-caption]")!;
    if (changed || caption.textContent !== (info.caption ?? "")) { caption.textContent = info.caption ?? ""; caption.scrollTop = 0; }
    caption.hidden = !info.caption;
    if (seriesOverview) {
      if (requestedSeriesPhoto && series) {
        const frame = series.photos.find(frame => frame.id === requestedSeriesPhoto);
        requestedSeriesPhoto = undefined;
        if (frame) { selectSeriesFrame(frame); return; }
      }
      showSeries();
      const albumCard = albumNavigationCard(card);
      updateNavigation(albumCard ? albumCards(albumCard).length : 0);
      updateInformation(); updateViewport();
      return;
    }
    image.alt = view.title || view.alt;
    const key = `${view.ref.source}:${view.ref.containerId}:${view.ref.imageId}`;
    const full = new URL(view.full, location.href).href;
    if (imageKey !== key || imageFailed && image.src !== full) {
      drawnSeries = undefined;
      imageKey = key;
      imageFailed = false;
      photoRatio = view.width && view.height ? view.width / view.height : 1;
      const generation = ++mediaGeneration;
      image.hidden = true;
      mediaLoader.hidden = false;
      status.textContent = "";
      imageLoad?.abort();
      const request = new AbortController();
      imageLoad = request;
      const failed = () => {
        request.abort();
        if (generation !== mediaGeneration || !dialog.open) return;
        imageFailed = true;
        mediaLoader.hidden = true;
        status.textContent = "写真を読み込めませんでした。時間をおいて再度お試しください。";
      };
      const loaded = () => {
        // A pending src can leave currentSrc pointing at the previous decoded photo.
        if (image.currentSrc !== full) return;
        request.abort();
        void image.decode().then(() => {
          if (generation !== mediaGeneration || !dialog.open) return;
          photoRatio = image.naturalWidth / image.naturalHeight || 1;
          image.hidden = false;
          mediaLoader.hidden = true;
          updateViewport();
          if (!noticeRead && active && parameters.get("photo") === refs.get(active)?.imageId && parameters.has("notice")) {
            noticeRead = true;
            void post("/api/member/photo-notifications", { action: "photo", key: parameters.get("notice"), through: Number(parameters.get("through")) }).then(() => document.dispatchEvent(new Event("photo:likes-changed"))).catch(error => { noticeRead = false; status.textContent = error.message; });
          }
        }, failed);
      };
      image.addEventListener("load", loaded, { signal: request.signal });
      image.addEventListener("error", failed, { signal: request.signal });
      image.src = full;
      if (image.complete && image.naturalWidth) loaded();
    }
    updateInformation(); updateViewport();
    const cards = series ? undefined : albumCards(card);
    const count = series ? series.photos.length : cards!.length;
    const index = series ? series.photos.findIndex(frame => frame.id === view.ref.imageId) : cards!.indexOf(card);
    updateNavigation(count, index);
    document.dispatchEvent(new CustomEvent("photo:reveal", { detail: { imageId: view.ref.imageId } }));
  }
  function showSeries() {
    const failed = Boolean(active && detailErrors.has(active));
    seriesHelp.textContent = series ? `組写真 · ${series.photos.length}枚　写真を選ぶと拡大できます。` : "";
    if (imageKey) { imageLoad?.abort(); imageKey = ""; ++mediaGeneration; image.hidden = true; }
    if (!series) {
      if (drawnSeries) {
        drawnSeries = undefined;
        ++mediaGeneration;
        seriesCanvas.replaceChildren();
        seriesCanvas.removeAttribute("aria-busy");
      }
      mediaLoader.hidden = failed;
      return;
    }
    if (drawnSeries === series) return;
    drawnSeries = series;
    const generation = ++mediaGeneration;
    mediaLoader.hidden = false;
    status.textContent = "";
    seriesCanvas.setAttribute("aria-busy", "true");
    seriesCanvas.replaceChildren();
    const { width, height, photos } = series;
    const decoded: Promise<void>[] = [];
    seriesCanvas.style.setProperty("--series-ratio", String(width / height));
    for (const [index, frame] of photos.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.photoSeriesFrame = frame.id;
      button.setAttribute("aria-label", `写真 ${index + 1} を拡大`);
      Object.assign(button.style, photoSeriesFrameStyle(frame, series));
      const thumbnail = document.createElement("img");
      thumbnail.src = frame.src;
      thumbnail.alt = "";
      thumbnail.decoding = "async";
      decoded.push(thumbnail.decode());
      button.append(thumbnail);
      button.addEventListener("click", () => {
        selectSeriesFrame(frame);
        toggle.focus({ preventScroll: true });
      });
      seriesCanvas.append(button);
    }
    void Promise.allSettled(decoded).then(() => {
      if (generation !== mediaGeneration || !dialog.open) return;
      seriesCanvas.removeAttribute("aria-busy");
      mediaLoader.hidden = true;
    });
  }
  function selectSeriesFrame(frame: PhotoSeriesFrame) {
    const { source, containerId } = refs.get(active!)!;
    const key = `${source}:${containerId}:${frame.id}`;
    let card = allCards().find(item => {
      const ref = refs.get(item);
      return ref?.source === source && ref.containerId === containerId && ref.imageId === frame.id;
    }) ?? detachedSeriesCards.get(key);
    if (!card) {
      const proof = source === "gallery" ? new URL(frame.full, location.href).searchParams.get("proof") : null;
      const ref: PhotoRef = { source, containerId, imageId: frame.id, ...(proof ? { proof } : {}) };
      card = createPhotoCard(ref, frame.src, frame.full, frame.name);
      refs.set(card, ref);
      detachedSeriesCards.set(key, card);
    }
    seriesOverview = false;
    informationRequested = false;
    display(card);
    void loadDetails(card);
  }
  function open(card: HTMLElement, keyboard = false, showGroup = false, target?: string) {
    ++albumNavigationRequest;
    opener = photoLink(card); openedWithPointer = !keyboard; informationRequested = false;
    series = undefined;
    seriesOverview = showGroup && card.dataset.photoSeries === "true";
    requestedSeriesPhoto = target;
    if (!dialog.open) {
      openingImageId = refs.get(card)?.imageId;
      openingScroll = scrollY;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();
    }
    display(card);
    if (showGroup) document.dispatchEvent(new CustomEvent("photo:reveal", { detail: { imageId: refs.get(card)!.imageId } }));
    if (!views.has(card)) void refresh();
    void loadDetails(card, true);
  }
  async function loadDetails(card: HTMLElement, refresh = false) {
    if (detailPending.has(card) || detailed.has(card) && (!refresh || Date.now() - (detailTimes.get(card) ?? 0) < 45_000)) return;
    const requestedAt = mutationSequence;
    detailPending.add(card); detailErrors.delete(card); if (active === card) updateInformation();
    try {
      const data = await post("/api/photos/state", { refs: [refs.get(card)], details: true }), result = data.results[0];
      if (!result.ok) throw new Error("写真の情報を読み込めませんでした。もう一度お試しください。");
      detailed.add(card); detailTimes.set(card, Date.now());
      const current = views.get(card);
      const view = current && (pendingLikes.has(current.key) || requestedAt !== mutationSequence) ? { ...result.photo, liked: current.liked, count: current.count, likers: current.likers } : result.photo;
      views.set(card, view); paint(card, view);
      if (active === card && dialog.open) {
        if (series && view.series) series = view.series;
        display(card);
      }
    } catch { detailErrors.set(card, "写真の情報を読み込めませんでした。再読み込みをお試しください。"); }
    finally {
      detailPending.delete(card);
      if (active === card && dialog.open) {
        if (seriesOverview && detailErrors.has(card)) display(card);
        else updateInformation();
      }
    }
  }
  async function toggleLike(card: HTMLElement) {
    const view = views.get(card); if (!view || pendingLikes.has(view.key)) return;
    mutationSequence++; pendingLikes.add(view.key); sync(view.key);
    try {
      const result = await post("/api/photos/like", { ref: view.ref, liked: !view.liked }); mutationSequence++;
      for (const [element, current] of views) if (current.key === view.key) views.set(element, { ...current, ...(current.ref.source === result.photo.ref.source && current.ref.containerId === result.photo.ref.containerId ? { ref: result.photo.ref, full: result.photo.full } : {}), liked: result.photo.liked, count: result.photo.count, likers: result.photo.likers });
      status.textContent = ""; document.dispatchEvent(new Event("photo:likes-changed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "いいねを変更できませんでした。";
      if (dialog.open) status.textContent = message;
      else { card.querySelector("[data-photo-like]")?.setAttribute("title", message); operationNotice(message, true, "photo-like"); }
    } finally { pendingLikes.delete(view.key); sync(view.key); }
  }
  function sync(key: string) {
    for (const [element, view] of views) if (view.key === key) paint(element, view);
    if (active && views.get(active)?.key === key && dialog.open) paint(dialog, informationView(views.get(active)!));
  }
  function register() {
    for (const card of allCards()) {
      if (registered.has(card)) continue;
      try { refs.set(card, JSON.parse(card.dataset.photoRef!)); } catch { continue; }
      registered.add(card);
      photoLink(card).addEventListener("click", event => { event.preventDefault(); open(card, lastInputWasKeyboard || (event as MouseEvent).detail === 0, true); });
      card.querySelector("[data-photo-like]")?.addEventListener("click", () => void toggleLike(card));
      card.querySelector<HTMLElement>("[data-photo-count]")?.addEventListener("click", event => { const view = views.get(card); if (view) openPhotoLikers(view, event.currentTarget as HTMLElement); });
      if (card.dataset.photoInlineControls !== "false") {
        card.addEventListener("mouseenter", () => void loadDetails(card), { once: true });
        card.addEventListener("focusin", () => void loadDetails(card), { once: true });
        // Closing a pointer-opened dialog must not leave its restored focus/hover painted.
        card.addEventListener("pointermove", () => { if (!dialog.open) card.removeAttribute("data-photo-hover-suppressed"); });
      }
    }
  }
  async function refresh() {
    register(); if (loading) { refreshQueued = true; return; }
    loading = true;
    try {
      const unloaded = allCards().filter(card => !views.has(card));
      for (let start = 0; start < unloaded.length; start += 100) {
        const requestedAt = mutationSequence;
        const batch = unloaded.slice(start, start + 100), result = await post("/api/photos/state", { refs: batch.map(card => refs.get(card)) });
        result.results.forEach((item: { ok: boolean; photo?: PhotoView }, index: number) => {
          if (!item.ok || !item.photo) return;
          const card = batch[index], existing = views.get(card);
          const view = existing && requestedAt !== mutationSequence ? { ...item.photo, liked: existing.liked, count: existing.count, likers: existing.likers } : detailed.has(card) && existing ? { ...existing, liked: item.photo.liked, count: item.photo.count, likers: item.photo.likers } : item.photo;
          views.set(card, view); paint(card, view); if (active === card && dialog.open) display(card);
        });
      }
    } catch (error) { if (dialog.open) status.textContent = error instanceof Error ? error.message : "写真情報を取得できませんでした。"; }
    finally { loading = false; checkDeepLink(); if (refreshQueued) { refreshQueued = false; void refresh(); } }
  }
  function checkDeepLink() {
    const target = parameters.get("photo");
    if (deepLinkOpened || !target) return;
    const cards = allCards();
    const group = cards.find(card => card.dataset.photoSeriesMembers?.split(" ").includes(target));
    const card = group ?? cards.find(card => refs.get(card)?.imageId === target);
    if (card) { deepLinkOpened = true; open(card, false, Boolean(group), group ? target : undefined); }
  }
  const navigate = (delta: number) => {
    if (!active) return;
    const request = ++albumNavigationRequest;
    if (series && !seriesOverview) {
      const id = refs.get(active)?.imageId;
      const index = series.photos.findIndex(frame => frame.id === id);
      if (series.photos.length > 1 && index >= 0) selectSeriesFrame(series.photos[(index + delta + series.photos.length) % series.photos.length]);
      return;
    }
    const card = albumNavigationCard(active);
    if (!card) return;
    const cards = albumCards(card), index = cards.indexOf(card);
    if (index < 0) return;
    if (galleryGrid?.dataset.nextCursor && (index + delta < 0 || index + delta >= cards.length)) {
      const current = active;
      let completion: Promise<void> | undefined;
      document.dispatchEvent(new CustomEvent("photo:load-album", {
        detail: { waitFor: (pending: Promise<void>) => { completion = pending; } },
      }));
      if (completion) {
        void completion.then(() => {
          if (dialog.open && active === current && albumNavigationRequest === request) navigate(delta);
        });
        return;
      }
    }
    if (cards.length <= 1) return;
    const target = cards[(index + delta + cards.length) % cards.length];
    series = undefined;
    seriesOverview = target.dataset.photoSeries === "true";
    opener = photoLink(target);
    informationRequested = false;
    display(target);
    const ref = refs.get(target);
    if (seriesOverview && ref?.source === "gallery") document.dispatchEvent(new CustomEvent("photo:reveal", { detail: { imageId: ref.imageId } }));
    void loadDetails(target);
  };
  seriesBack.addEventListener("click", () => {
    if (!series || !active) return;
    const id = refs.get(active)?.imageId;
    seriesOverview = true;
    informationRequested = false;
    updateInformation();
    display(active);
    [...seriesCanvas.querySelectorAll<HTMLButtonElement>("button")].find(button => button.dataset.photoSeriesFrame === id)?.focus({ preventScroll: true });
  });
  toggle.addEventListener("click", () => {
    if (!active) return;
    informationRequested = !informationRequested;
    if (informationRequested && !detailed.has(active)) void loadDetails(active);
    updateInformation();
  });
  retry.addEventListener("click", () => { if (active) { detailed.delete(active); void loadDetails(active, true); } });
  bookButton?.addEventListener("click", () => {
    if (!active?.dataset.bookReader || !dialog.open) return;
    const book = JSON.parse(active.dataset.bookReader) as BookReaderOptions;
    const title = views.get(active)?.title ?? photoLink(active).querySelector("img")?.alt ?? "";
    document.dispatchEvent(new CustomEvent("book:read", { detail: { book, title, opener: bookButton } }));
  });
  editButton?.addEventListener("click", async () => {
    const card = active, view = card && views.get(card);
    const editor = document.querySelector<HTMLDialogElement>("#gallery-photo-editor");
    if (!card || !view?.galleryEdit || !editor) return;
    editButton.disabled = true;
    try {
      openEditor ??= (await import("./galleryPhotoEditor")).createGalleryPhotoEditor(editor);
      if (active !== card || !dialog.open) return;
      await openEditor(view, editButton, async () => {
        detailed.delete(card);
        await loadDetails(card);
        const edited = views.get(card);
        if (edited?.series && view.galleryEdit?.kind === "series") updateGallerySeriesCard(edited.ref, edited.series);
        status.textContent = detailErrors.has(card) ? "保存しました。表示の更新にはページを再読み込みしてください。" : "写真情報を保存しました。";
      });
    } catch (error) { status.textContent = apiErrorMessage(error); }
    finally { editButton.disabled = false; }
  });

  function updateGallerySeriesCard(ref: PhotoRef, updated: PhotoSeries) {
    const group = allCards().find(item => refs.get(item)?.containerId === ref.containerId && item.dataset.photoSeriesMembers?.split(" ").includes(ref.imageId));
    const thumbnail = group?.querySelector<HTMLElement>(".photo-series-thumbnail");
    if (!group || !thumbnail) return;
    const preview = photoSeriesPreview(updated);
    group.dataset.photoSeriesTitle = preview.title;
    group.dataset.photoSeriesShooting = JSON.stringify(preview.shooting);
    group.dataset.photoSeriesMembers = preview.photos.map(frame => frame.id).join(" ");
    group.dataset.aspectRatio = String(preview.width / preview.height);
    photoLink(group).setAttribute("aria-label", `組写真「${preview.title}」を開く`);
    thumbnail.style.setProperty("--series-ratio", group.dataset.aspectRatio);
    thumbnail.replaceChildren(...preview.photos.map(frame => {
      const img = document.createElement("img");
      img.src = frame.src;
      img.alt = "";
      img.loading = "lazy";
      Object.assign(img.style, photoSeriesFrameStyle(frame, preview));
      return img;
    }));
    const badge = group.querySelector(".photo-series-badge");
    if (badge) badge.textContent = `組写真 · ${preview.photos.length}枚`;
    const state = views.get(group);
    if (state) paint(group, state);
    if (group !== active) detailed.delete(group);
    document.dispatchEvent(new Event("photo:layout-changed"));
  }
  dialog.querySelector("[data-photo-close]")!.addEventListener("click", () => dialog.close());
  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  dialog.querySelector("[data-photo-like]")!.addEventListener("click", () => { if (active) void toggleLike(active); });
  dialog.querySelector<HTMLElement>("[data-photo-count]")!.addEventListener("click", event => { const view = active && views.get(active); if (view) openPhotoLikers(view, event.currentTarget as HTMLElement); });
  dialog.addEventListener("keydown", event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    ++albumNavigationRequest;
    window.clearTimeout(spinnerTimer); spinner.hidden = true; document.body.style.overflow = previousOverflow;
    imageLoad?.abort();
    ++mediaGeneration; imageKey = ""; mediaLoader.hidden = true; image.hidden = true;
    image.removeAttribute("src");
    if (openedWithPointer) { for (const card of registered) card.setAttribute("data-photo-hover-suppressed", ""); opener?.blur(); }
    else opener?.focus({ preventScroll: true });
    seriesCanvas.replaceChildren();
    series = drawnSeries = undefined;
    seriesOverview = false;
    if (document.dispatchEvent(new CustomEvent("photo:list-return", { cancelable: true, detail: { imageId: openingImageId, scroll: openingScroll } }))) {
      window.scrollTo({ top: openingScroll, behavior: "instant" });
    }
  });
  document.addEventListener("pointerdown", () => { lastInputWasKeyboard = false; }, true);
  document.addEventListener("keydown", event => { lastInputWasKeyboard = true; if (event.key === "Tab" && !dialog.open) for (const card of registered) card.removeAttribute("data-photo-hover-suppressed"); }, true);
  new ResizeObserver(fitInformationTitle).observe(information);
  document.fonts.addEventListener("loadingdone", fitInformationTitle);
  window.addEventListener("resize", updateViewport); window.visualViewport?.addEventListener("resize", updateViewport);
  const blog = document.querySelector<HTMLElement>("[data-blog-id][data-blog-photos]");
  if (blog) frameBlogPhotos(blog);
  document.addEventListener("photo:added", () => {
    register();
    if (galleryGrid && active && dialog.open) display(active);
    checkDeepLink();
    void refresh();
  });
  document.addEventListener("photo:loaded", () => {
    register(); checkDeepLink();
    if (galleryGrid && active && dialog.open) display(active);
    if (parameters.has("photo") && !deepLinkOpened) {
      const message = document.createElement("p"); message.setAttribute("role", "status"); message.textContent = "指定された写真は削除されたか、現在公開されていません。"; document.querySelector(".body-contents")?.prepend(message);
    }
  });
  void refresh();
}
