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
