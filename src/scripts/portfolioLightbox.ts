import "../styles/PortfolioLightbox.css";

// Adapt the existing Lightbox2 viewer for Portfolio and Gallery on phones. The vendor file
// and its navigation, counter, loading indicator and desktop behavior stay intact.
interface Lightbox {
  options: { disableScrolling: boolean; fadeDuration: number };
  album: { link: string }[];
  currentImageIndex: number;
  $outerContainer: { stop(clearQueue: boolean, jumpToEnd: boolean): void };
  start(link: { 0?: Element }): void;
  sizeContainer(width: number, height: number): void;
  end(): void;
}

const gallery = document.querySelector<HTMLElement>(".justified-grid");
if (gallery) initializeMobileLightbox(gallery);

function initializeMobileLightbox(gallery: HTMLElement) {
  let installed = false;

  function install() {
    const lightbox = (window as Window & { lightbox?: Lightbox }).lightbox;
    if (installed || !lightbox) return;
    installed = true;
    const originalStart = lightbox.start;
    const originalSize = lightbox.sizeContainer;
    const originalEnd = lightbox.end;
    let active = false;
    let previousScrolling = lightbox.options.disableScrolling;
    let lastRatio = 1;
    let cleanupTimer = 0;
    let resizeFrame = 0;
    let opener: HTMLElement | null = null;

    function removeClasses() {
      const viewer = document.getElementById("lightbox");
      viewer?.classList.remove("portfolio-mobile-lightbox", "portfolio-landscape-photo");
      viewer?.style.removeProperty("--portfolio-viewer-center");
      document.getElementById("lightboxOverlay")?.classList.remove("portfolio-mobile-overlay");
    }

    lightbox.start = function (link) {
      window.clearTimeout(cleanupTimer);
      removeClasses();
      active = window.matchMedia("(max-width: 768px)").matches && gallery.contains(link[0] ?? null);
      opener = active && link[0] instanceof HTMLElement ? link[0] : null;
      previousScrolling = this.options.disableScrolling;
      if (active) {
        this.options.disableScrolling = true;
        document.getElementById("lightbox")?.classList.add("portfolio-mobile-lightbox");
        document.getElementById("lightboxOverlay")?.classList.add("portfolio-mobile-overlay");
      }
      originalStart.call(this, link);
    };

    lightbox.sizeContainer = function (width, height) {
      if (!active) return originalSize.call(this, width, height);
      const viewer = document.getElementById("lightbox");
      const image = viewer?.querySelector<HTMLImageElement>(".lb-image");
      if (!viewer || !image) return originalSize.call(this, width, height);
      // Gallery appends photos after its first page; resolve against current DOM.
      const currentUrl = new URL(this.album[this.currentImageIndex].link, document.baseURI).href;
      const photo = [...gallery.querySelectorAll<HTMLAnchorElement>(".photo-wrapper")]
        .find(photo => photo.href === currentUrl);
      const thumbnail = photo?.querySelector("img");
      const ratio = Number(photo?.dataset.aspectRatio) ||
        (thumbnail && thumbnail.naturalWidth / thumbnail.naturalHeight) || width / height;
      lastRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const rotate = lastRatio > 1 && viewportHeight > viewportWidth;
      // Leave room for the existing image counter / close button and safe edges.
      const availableWidth = Math.max(1, viewportWidth - 32 - 8);
      const availableHeight = Math.max(1, viewportHeight - 112 - 8);
      const maxWidth = rotate ? availableHeight : availableWidth;
      const maxHeight = rotate ? availableWidth : availableHeight;
      const imageHeight = Math.min(maxHeight, maxWidth / lastRatio);
      const imageWidth = imageHeight * lastRatio;
      image.style.width = `${imageWidth}px`;
      image.style.height = `${imageHeight}px`;
      viewer.classList.toggle("portfolio-landscape-photo", rotate);
      viewer.style.setProperty("--portfolio-viewer-center", `${(viewport?.offsetTop ?? 0) + viewportHeight / 2}px`);
      originalSize.call(this, rotate ? imageHeight : imageWidth, rotate ? imageWidth : imageHeight);
    };

    lightbox.end = function () {
      const wasActive = active;
      // Finish pending resize callbacks before restoring focus. Otherwise a
      // rotation animation can focus the hidden viewer after it has closed.
      if (wasActive) this.$outerContainer.stop(true, true);
      active = false;
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      originalEnd.call(this);
      if (!wasActive) return;
      this.options.disableScrolling = previousScrolling;
      opener?.focus({ preventScroll: true });
      cleanupTimer = window.setTimeout(removeClasses, this.options.fadeDuration + 20);
    };

    const resize = () => {
      if (!active || resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const image = document.querySelector<HTMLImageElement>("#lightbox .lb-image");
        if (active && image?.complete && image.getAttribute("src") === lightbox.album[lightbox.currentImageIndex]?.link) {
          lightbox.sizeContainer(lastRatio, 1);
        }
      });
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
  }

  // Lightbox is a deferred vendor script. Install before its delegated body
  // click handler, even when a visitor taps before the window load event.
  install();
  document.addEventListener("DOMContentLoaded", install, { once: true });
  gallery.addEventListener("click", install, { capture: true });
}
