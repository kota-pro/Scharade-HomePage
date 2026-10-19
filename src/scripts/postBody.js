const container = document.getElementById("post-back-link");
  if (container) {
    try {
      const map = JSON.parse(container.dataset.map ?? "{}");
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      const link = from && map[from];
      if (link) {
        if (!container.querySelector("a")) {
          const anchor = document.createElement("a");
          anchor.href = link.href;
          anchor.textContent = link.label;
          container.appendChild(anchor);
        }
        container.hidden = false;
      } else {
        container.hidden = true;
      }
    } catch (error) {
      console.error("Failed to render back link", error);
    }
  }

  const postBody = document.querySelector(".post-body");
  if (postBody instanceof HTMLElement) {
    const images = Array.from(postBody.querySelectorAll("img"));

    images.forEach((img) => {
      const wrapper = img.closest("figure") || img.parentElement;

      if (!(wrapper instanceof HTMLElement)) return;
      if (wrapper.classList.contains("taped-image")) return;

      const tapeNum = Math.floor(Math.random() * 70) + 1;
      const rotateDeg = Math.floor(Math.random() * 41) * 0.5 - 10;

      wrapper.classList.add("taped-image");
      wrapper.style.setProperty(
        "--tape-url",
        `url(/images/tapes/asset${tapeNum}.svg)`,
      );
      wrapper.style.setProperty("--tape-rotate", `${rotateDeg}deg`);
    });
  }
