(() => {
    const carousels = Array.from(
      document.querySelectorAll(".photo-carousel-contents"),
    );

    if (carousels.length === 0) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    const minWidth = 140;
    const maxWidth = 240;
    const aspectRatio = 2 / 3;
    const speedPxPerSec = 30;

    const attachCarousel = (carousel) => {
      const originalList = carousel.querySelector("ul");

      if (!originalList) return;

      // clone作成
      const clonedList = originalList.cloneNode(true);
      carousel.appendChild(clonedList);

      const lists = [originalList, clonedList];

      let listWidth = 0;
      let offset = 0;
      let lastTime = 0;
      let rafId = 0;
      let gap = 0;

      const updateItemSize = () => {
        const containerWidth = carousel.clientWidth || window.innerWidth;

        const itemWidth = Math.round(
          Math.max(minWidth, Math.min(maxWidth, containerWidth * 0.28)),
        );

        const itemHeight = Math.round(itemWidth * aspectRatio);

        carousel.querySelectorAll(".photo-carousel-list").forEach((node) => {
          if (!(node instanceof HTMLElement)) return;

          node.style.width = `${itemWidth}px`;
          node.style.height = `${itemHeight}px`;
        });

        carousel.querySelectorAll("ul li").forEach((node) => {
          if (!(node instanceof HTMLElement)) return;

          node.style.width = `${itemWidth}px`;
          node.style.minWidth = `${itemWidth}px`;
        });
      };

      const measure = () => {
        const styles = getComputedStyle(carousel);

        gap = parseFloat(styles.columnGap || styles.gap || "0");

        listWidth = originalList.scrollWidth;
      };

      const render = () => {
        lists[0].style.transform = `translateX(${offset}px)`;

        lists[1].style.transform = `translateX(${offset + listWidth + gap}px)`;
      };

      const step = (timestamp) => {
        if (prefersReducedMotion.matches) return;

        if (!lastTime) lastTime = timestamp;

        const delta = (timestamp - lastTime) / 1000;

        lastTime = timestamp;

        offset -= speedPxPerSec * delta;

        if (listWidth > 0 && Math.abs(offset) >= listWidth + gap) {
          offset = 0;
        }

        render();

        rafId = requestAnimationFrame(step);
      };

      const refresh = () => {
        updateItemSize();
        measure();

        offset = 0;
        lastTime = 0;

        render();
      };

      refresh();

      if (!prefersReducedMotion.matches) {
        rafId = requestAnimationFrame(step);
      }

      window.addEventListener("resize", refresh);

      if (typeof prefersReducedMotion.addEventListener === "function") {
        prefersReducedMotion.addEventListener("change", () => {
          cancelAnimationFrame(rafId);

          lastTime = 0;

          if (!prefersReducedMotion.matches) {
            rafId = requestAnimationFrame(step);
          }
        });
      }
    };

    carousels.forEach((carousel) => {
      if (carousel instanceof HTMLElement) {
        attachCarousel(carousel);
      }
    });
  })();
