import { test, expect, type Page } from "@playwright/test";

async function expectPhotoRows(page: Page, finalPair = true) {
  await expect.poll(() => page.locator(".justified-grid").evaluate((grid, finalPair) => {
    if ((grid as HTMLElement).dataset.layout !== "justified") return false;
    const bounds = grid.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).getPropertyValue("--photo-gap"));
    const photos = [...grid.querySelectorAll<HTMLElement>(".photo-wrapper")].filter(el => !el.hidden);
    const [a, b] = photos.slice(-2).map(el => el.getBoundingClientRect());
    if (finalPair && !window.matchMedia("(max-width: 768px)").matches && (Math.abs(a.top - b.top) > 0.1 || Math.abs(b.left - a.right - gap) > 0.1)) return false;
    const rows: DOMRect[][] = [];
    for (const el of photos) {
      const r = el.getBoundingClientRect();
      const img = el.querySelector("img")!;
      const ratio = Number(el.dataset.aspectRatio) || img.naturalWidth / img.naturalHeight || 1.5;
      if (r.width <= 0 || r.height <= 0 || r.left < bounds.left - 0.1 ||
          r.right > bounds.right + 0.1 || Math.abs(r.width / r.height - ratio) > 0.02 ||
          getComputedStyle(img).objectFit !== "contain" || Math.abs(parseFloat(img.sizes) - r.width) > 1.1) return false;
      const previousRow = rows.at(-1);
      if (previousRow && Math.abs(previousRow[0].top - r.top) < 0.1) {
        if (Math.abs(r.left - previousRow.at(-1)!.right - gap) > 0.1 ||
            Math.abs(r.height - previousRow[0].height) > 0.1) return false;
        previousRow.push(r);
      } else {
        if (previousRow && Math.abs(r.top - previousRow[0].bottom - gap) > 0.1) return false;
        if (Math.abs(r.left - bounds.left) > 0.1) return false;
        rows.push([r]);
      }
    }
    if (window.matchMedia("(max-width: 768px)").matches && !rows.every(row => row.length === 1)) return false;
    if (!rows.every(row => rows.length === 1 || Math.abs(row.at(-1)!.right - bounds.right) < 0.1)) return false;
    return Math.abs(rows.at(-1)![0].bottom - bounds.bottom) < 0.1;
  }, finalPair), "rows have equal-height uncropped photos, consistent gutters, aligned edges and reserved container height").toBe(true);
}

test("Portfolio uses one photo per mobile row and balanced desktop rows before and after loading", async ({ page }) => {
  let releaseImages!: () => void;
  const imagesReady = new Promise<void>(resolve => { releaseImages = resolve; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("microcms-assets.io")) return route.abort();
    await imagesReady;
    const dimensions = url.pathname.match(/portrait-(\d+)x(\d+)/);
    const [width, height] = dimensions ? dimensions.slice(1) : [640, 480];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#aaa"/></svg>`,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto("/Portfolio/member", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".photo-wrapper")).toHaveCount(35);
    // The regression occurs before lazy images load, using CMS dimensions alone.
    await expectPhotoRows(page);
  } finally {
    releaseImages();
  }
  // Complete every image to exercise the load-triggered second layout as well.
  await page.locator(".photo-wrapper img").evaluateAll(images => {
    images.forEach(img => { (img as HTMLImageElement).loading = "eager"; });
  });
  await expect.poll(() => page.locator(".photo-wrapper img").evaluateAll(images =>
    images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)
  )).toBe(true);
  for (const width of [390, 320, 360, 375, 393, 414, 430, 768, 769, 844, 1024, 1440, 1920, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectPhotoRows(page);
  }
  await page.locator(".photo-wrapper").last().click();
  await expect(page.locator(".lb-number")).toHaveText("Image 35 of 35");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".lb-number")).toHaveText("Image 34 of 35");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).not.toBeVisible();
});


test("mixed photos handle pagination, failed images, absent metadata and container-only resizing", async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("microcms-assets.io")) return route.abort();
    if (url.pathname.endsWith("-103.jpg")) return route.abort();
    const dimensions = url.pathname.match(/mixed-(\d+)x(\d+)/);
    const [width, height] = dimensions ? dimensions.slice(1) : [640, 480];
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#aaa"/></svg>` });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Portfolio/photo-layout");
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await expectPhotoRows(page, false);
  await page.locator(".next-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(5);
  const firstImage = page.locator(".photo-wrapper:visible img").first();
  await firstImage.scrollIntoViewIfNeeded();
  await expect.poll(() => firstImage.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expectPhotoRows(page, false);
  await expect(page.locator(".page-input-top")).toHaveValue("2");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expectPhotoRows(page, false);
  }
  await page.locator(".gallery-container-inner").evaluate(el => { (el as HTMLElement).style.width = "63%"; });
  await expectPhotoRows(page, false);
  await page.locator(".prev-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await expectPhotoRows(page, false);
});

test("mobile landscape enlargement rotates only in portrait screens and keeps navigation and close usable", async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("microcms-assets.io")) return route.abort();
    const dimensions = url.pathname.match(/mixed-(\d+)x(\d+)/);
    const [width, height] = dimensions ? dimensions.slice(1) : [640, 480];
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#aaa"/></svg>` });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Portfolio/photo-layout");
  await page.locator(".photo-wrapper").first().click();
  const viewer = page.locator("#lightbox");
  const image = viewer.locator(".lb-image");
  const fits = async () => {
    await expect.poll(() => viewer.evaluate(viewer => {
      const image = viewer.querySelector(".lb-image")!.getBoundingClientRect();
      const close = viewer.querySelector(".lb-close")!.getBoundingClientRect();
      const screen = window.visualViewport;
      const width = screen?.width ?? innerWidth, height = screen?.height ?? innerHeight;
      return image.width > 0 && image.height > 0 && image.left >= 0 && image.right <= width &&
        image.top >= 0 && image.bottom <= height && close.width > 0 && close.height > 0 &&
        close.left >= 0 && close.right <= width && close.top >= 0 && close.bottom <= height;
    })).toBe(true);
  };
  await expect(viewer.locator(".lb-number")).toHaveText("Image 1 of 105");
  await expect(viewer).toHaveClass(/portfolio-landscape-photo/);
  await expect(image).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);
  await fits();
  await expect(page.locator("body")).toHaveClass(/lb-disable-scrolling/);

  await viewer.locator(".lb-next").click();
  await expect(viewer.locator(".lb-number")).toHaveText("Image 2 of 105");
  await expect(viewer).not.toHaveClass(/portfolio-landscape-photo/);
  await fits();
  await viewer.locator(".lb-prev").click();
  await expect(viewer.locator(".lb-number")).toHaveText("Image 1 of 105");
  await expect(viewer).toHaveClass(/portfolio-landscape-photo/);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(viewer).not.toHaveClass(/portfolio-landscape-photo/);
  await fits();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(viewer).toHaveClass(/portfolio-landscape-photo/);
  await fits();
  await viewer.locator(".lb-close").click();
  await expect(viewer).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/lb-disable-scrolling/);

  await page.locator(".photo-wrapper").nth(4).click();
  await expect(viewer.locator(".lb-number")).toHaveText("Image 5 of 105");
  await expect(viewer).not.toHaveClass(/portfolio-landscape-photo/);
  await fits();
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".photo-wrapper").first().click();
  await expect(viewer.locator(".lb-number")).toHaveText("Image 1 of 105");
  await expect(viewer).not.toHaveClass(/portfolio-mobile-lightbox/);
  await expect(image).toHaveCSS("transform", "none");
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  expect(errors).toEqual([]);
});
