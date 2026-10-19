const ITEMS_PER_PAGE = Number(document.querySelector(".tab")?.dataset.pageSize) || 10;
  const tabInputs = Array.from(document.querySelectorAll(".tab-input"));
  const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

  function setActiveTab(index) {
    tabPanels.forEach((panel, panelIndex) => {
      panel.classList.toggle("is-active", panelIndex === index);
    });
  }

  tabInputs.forEach((input, index) => {
    input.addEventListener("change", () => {
      if (input.checked) setActiveTab(index);
    });
  });

  const initialActiveIndex = tabInputs.findIndex((input) => input.checked);
  setActiveTab(initialActiveIndex >= 0 ? initialActiveIndex : 0);

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const totalPages = parseInt(panel.getAttribute("data-total-pages") || "1");
    const totalPosts = parseInt(panel.getAttribute("data-total-posts") || "0");

    if (totalPosts === 0) return;

    let currentPage = 1;

    const posts = panel.querySelectorAll(".Activity-item");
    const inputTop = panel.querySelector(".page-input-top");
    const numbersContainer = panel.querySelector(".tab-posts-numbers");

    const btnFirst = panel.querySelector(".first-btn");
    const btnPrev = panel.querySelector(".prev-btn");
    const btnNext = panel.querySelector(".next-btn");
    const btnLast = panel.querySelector(".last-btn");

    const btnPrevTop = panel.querySelector(".prev-btn-top");
    const btnNextTop = panel.querySelector(".next-btn-top");

    const renderPage = (page) => {
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;
      currentPage = page;

      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;

      posts.forEach((post, index) => {
        if (index >= startIndex && index < endIndex) {
          post.style.display = "block";
        } else {
          post.style.display = "none";
        }
      });

      if (inputTop) inputTop.value = currentPage.toString();
      updatePaginationNumbers();
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
        .filter((p) => p >= 1 && p <= totalPages)
        .sort((a, b) => a - b);

      let prevPage = 0;
      sortedPages.forEach((p) => {
        if (prevPage > 0 && p - prevPage > 1) {
          const dots = document.createElement("span");
          dots.className = "separate-slash";
          dots.textContent = "...";
          numbersContainer.appendChild(dots);
        }

        const a = document.createElement("a");
        a.className = "tab-posts-number";
        a.textContent = p.toString();
        a.href = "#";

        if (p === currentPage) {
          a.style.textDecoration = "underline";
          a.style.textDecorationThickness = "0.5px";
          a.style.textUnderlineOffset = "4px";
        }

        a.addEventListener("click", (e) => {
          e.preventDefault();
          renderPage(p);
        });

        numbersContainer.appendChild(a);
        prevPage = p;
      });
    };

    if (inputTop) {
      inputTop.addEventListener("change", (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) renderPage(val);
      });
    }

    btnPrevTop?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(currentPage - 1);
    });

    btnNextTop?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(currentPage + 1);
    });

    btnFirst?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(1);
    });

    btnPrev?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(currentPage - 1);
    });

    btnNext?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(currentPage + 1);
    });

    btnLast?.addEventListener("click", (e) => {
      e.preventDefault();
      renderPage(totalPages);
    });

    renderPage(1);
  });
