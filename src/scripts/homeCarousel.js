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

      // Animation copies forward to originals without becoming extra photographs.
      const clonedList = originalList.cloneNode(true);
      clonedList.setAttribute("aria-hidden", "true");
      const originalLinks = originalList.querySelectorAll("a");
      clonedList.querySelectorAll("a").forEach((link, index) => {
        link.removeAttribute("data-lightbox");
        link.removeAttribute("data-photo-ref");
        link.removeAttribute("data-photo-group");
        link.removeAttribute("data-home-photo-id");
        link.tabIndex = -1;
        link.addEventListener("click", (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (event.detail > 0) link.blur();
          originalLinks[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, detail: event.detail }));
        });
      });
      carousel.appendChild(clonedList);

      const lists = [originalList, clonedList];
      const film = carousel.closest(".photo-carousel") || carousel;
      // Repeat each perforation strip so it can move without exposing an empty edge.
      const filmHoles = Array.from(
        film.querySelectorAll(".upper-film-hole, .lower-film-hole"),
      ).flatMap((strip) => {
        const original = strip.querySelector("img");
        if (!original) return [];
        const copy = original.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        copy.setAttribute("alt", "");
        strip.appendChild(copy);
        return [{ images: [original, copy], width: 0, offset: 0 }];
      });

      let listWidth = 0;
      let offset = 0;
      let lastTime = 0;
      let rafId = 0;
      let gap = 0;
      let focused = false;
      let velocity = -speedPxPerSec;
      let pointer = null;
      let lastWheelTime = -Infinity;
      let suppressClickUntil = 0;
      const photoDialog = document.querySelector("#photo-dialog");
      carousel.addEventListener("focusin", () => { focused = true; });
      carousel.addEventListener("focusout", (event) => { focused = event.relatedTarget instanceof Node && carousel.contains(event.relatedTarget); });

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

        // Styles can still report "normal" during the first layout on a slow load.
        gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;

        listWidth = originalList.scrollWidth;
        filmHoles.forEach((strip) => {
          strip.width = strip.images[0].getBoundingClientRect().width;
        });
      };

      const render = () => {
        lists[0].style.transform = `translateX(${offset}px)`;

        lists[1].style.transform = `translateX(${offset + listWidth + gap}px)`;
        filmHoles.forEach((strip) => {
          strip.images.forEach((image) => {
            image.style.transform = `translateX(${strip.offset}px)`;
          });
        });
      };

      const wrap = (value, width) => width > 0 ? ((value % width) - width) % width : 0;
      const move = (distance) => {
        offset = wrap(offset + distance, listWidth + gap);
        filmHoles.forEach((strip) => { strip.offset = wrap(strip.offset + distance, strip.width); });
        render();
      };
      const releaseFocus = () => {
        if (document.activeElement instanceof HTMLElement && film.contains(document.activeElement)) document.activeElement.blur();
      };
      const inStrip = (target) => target instanceof Element && !!target.closest(".photo-carousel-contents, .upper-film-hole, .lower-film-hole");
      const setVelocity = (distance, elapsed) => {
        velocity = Math.max(-3000, Math.min(3000, distance / Math.max(8, elapsed) * 1000));
      };

      film.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0 || !inStrip(event.target) || photoDialog?.hasAttribute("open")) return;
        suppressClickUntil = 0;
        lastWheelTime = -Infinity;
        pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, time: performance.now(), dragging: false };
      });
      window.addEventListener("pointermove", (event) => {
        if (!pointer || event.pointerId !== pointer.id) return;
        const now = performance.now();
        if (!pointer.dragging) {
          const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
          if (Math.abs(dy) > Math.abs(dx)) { pointer = null; return; }
          pointer.dragging = true;
          film.setPointerCapture(event.pointerId);
          film.setAttribute("data-dragging", "");
          releaseFocus();
        }
        if (event.cancelable) event.preventDefault();
        const distance = event.clientX - pointer.x;
        setVelocity(distance, now - pointer.time);
        move(distance);
        pointer.x = event.clientX;
        pointer.time = now;
        lastTime = now;
      }, { passive: false });
      const finishDrag = (event) => {
        if (!pointer || event.pointerId !== pointer.id) return;
        const ended = pointer;
        pointer = null;
        film.removeAttribute("data-dragging");
        if (ended.dragging) {
          suppressClickUntil = performance.now() + 400;
          if (event.type !== "pointerup" || performance.now() - ended.time > 100) velocity = -speedPxPerSec;
        }
        if (film.hasPointerCapture(event.pointerId)) film.releasePointerCapture(event.pointerId);
      };
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
      film.addEventListener("lostpointercapture", finishDrag);
      film.addEventListener("dragstart", (event) => { if (inStrip(event.target)) event.preventDefault(); });
      film.addEventListener("click", (event) => {
        if (event.detail > 0 && performance.now() < suppressClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      film.addEventListener("wheel", (event) => {
        if (!inStrip(event.target) || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || photoDialog?.hasAttribute("open")) return;
        event.preventDefault();
        releaseFocus();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? carousel.clientWidth : 1;
        const distance = -event.deltaX * unit;
        const now = performance.now(), elapsed = now - lastWheelTime;
        setVelocity(distance, elapsed > 100 ? 16 : elapsed);
        lastWheelTime = now;
        lastTime = now;
        move(distance);
      }, { passive: false });

      const step = (timestamp) => {
        if (prefersReducedMotion.matches) return;
        if (focused || photoDialog?.hasAttribute("open")) {
          velocity = -speedPxPerSec;
          lastTime = timestamp;
          rafId = requestAnimationFrame(step);
          return;
        }
        // Follow gesture events directly; do not add automatic motion between them.
        if (pointer?.dragging || timestamp - lastWheelTime < 80) {
          lastTime = timestamp;
          rafId = requestAnimationFrame(step);
          return;
        }

        if (!lastTime) lastTime = timestamp;

        const delta = (timestamp - lastTime) / 1000;

        lastTime = timestamp;

        // Exponential easing preserves the release speed and settles back to auto-scroll.
        const friction = 4.5, decay = Math.exp(-friction * delta);
        const extraVelocity = velocity + speedPxPerSec;
        move(-speedPxPerSec * delta + extraVelocity * (1 - decay) / friction);
        velocity = -speedPxPerSec + extraVelocity * decay;

        rafId = requestAnimationFrame(step);
      };

      const refresh = () => {
        updateItemSize();
        measure();

        offset = 0;
        filmHoles.forEach((strip) => { strip.offset = 0; });
        lastTime = 0;
        velocity = -speedPxPerSec;
        lastWheelTime = -Infinity;

        render();
      };

      refresh();

      if (!prefersReducedMotion.matches) {
        rafId = requestAnimationFrame(step);
      }

      window.addEventListener("resize", refresh);
      // Re-measure when late styles/images establish their actual dimensions.
      // Transforms do not resize these boxes, so animation does not retrigger this.
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(refresh);
        observer.observe(carousel);
        observer.observe(originalList);
        filmHoles.forEach((strip) => observer.observe(strip.images[0]));
      }
      window.addEventListener("load", refresh, { once: true });

      if (typeof prefersReducedMotion.addEventListener === "function") {
        prefersReducedMotion.addEventListener("change", () => {
          cancelAnimationFrame(rafId);

          lastTime = 0;
          velocity = -speedPxPerSec;

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
