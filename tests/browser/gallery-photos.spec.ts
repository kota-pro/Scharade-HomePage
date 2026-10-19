import { test, expect, type Page } from "@playwright/test";
async function rows(page: Page) {
  await expect.poll(() => page.locator(".justified-grid").evaluate(grid => {
    if ((grid as HTMLElement).dataset.layout !== "justified") return false;
    const bounds = grid.getBoundingClientRect(), mobile = innerWidth <= 768;
    return [...grid.querySelectorAll<HTMLElement>(".photo-wrapper")].filter(el => !el.hidden).every(el => {
      const img = el.querySelector("img")!, rect = el.getBoundingClientRect(), ratio = img.naturalWidth / img.naturalHeight || 1.5;
      return rect.width > 0 && rect.height > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
        Math.abs(rect.width / rect.height - ratio) < 0.02 && getComputedStyle(img).objectFit === "contain" &&
        (!mobile || Math.abs(rect.width - bounds.width) < 1);
    });
  })).toBe(true);
}
async function images(page: Page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const match = url.pathname.match(/^\/api\/images\/(?:full\/)?photo-(\d+)$/);
    if (!match) return route.continue();
    const portrait = Number(match[1]) % 2 === 1;
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="${portrait ? '#b8bfab' : '#9fb3c2'}"/></svg>` });
  });
}
test("Gallery uses Portfolio layout, pagination and mobile enlargement including appended photos", async ({ page }, info) => {
  await images(page);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Gallery/public-album");
  await expect(page.locator(".photo-wrapper")).toHaveCount(135);
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await expect(page.locator(".picture-count-value")).toHaveText("135");
  for (const width of [320, 390, 768, 769, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await rows(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("gallery-desktop.png") });
  await page.locator(".next-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(35);
  await expect(page.locator(".page-input-top")).toHaveValue("2");
  await page.locator(".photo-wrapper:visible img").evaluateAll(images => images.forEach(img => { (img as HTMLImageElement).loading = "eager"; }));
  await expect.poll(() => page.locator(".photo-wrapper:visible img").evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await rows(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await rows(page);
  await page.screenshot({ path: info.outputPath("gallery-mobile.png") });
  const photo = page.locator(".photo-wrapper:visible").first();
  await photo.click();
  const viewer = page.locator("#lightbox");
  await expect(viewer.locator(".lb-number")).toHaveText("Image 101 of 135");
  await expect(viewer).toHaveClass(/portfolio-mobile-lightbox/);
  await expect(viewer).toHaveClass(/portfolio-landscape-photo/);
  await expect.poll(() => viewer.evaluate(el => {
    const image = el.querySelector(".lb-image")!.getBoundingClientRect(), close = el.querySelector(".lb-close")!.getBoundingClientRect();
    return image.width > 0 && image.left >= 0 && image.right <= innerWidth && image.top >= 0 && image.bottom <= innerHeight && close.top >= 0 && close.bottom <= innerHeight;
  })).toBe(true);
  await expect(viewer.locator(".lb-image")).toHaveCSS("opacity", "1");
  await expect(viewer.locator(".lb-dataContainer")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("gallery-lightbox-mobile.png") });
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".lb-number")).toHaveText("Image 102 of 135");
  await expect(viewer).not.toHaveClass(/portfolio-landscape-photo/);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveClass(/portfolio-landscape-photo/);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(viewer).not.toHaveClass(/portfolio-landscape-photo/);
  await viewer.locator(".lb-close").click();
  await expect(viewer).not.toBeVisible();
  await expect(photo).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/lb-disable-scrolling/);
  await page.locator(".prev-btn-top").click();
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await rows(page);
  expect(errors).toEqual([]);
});
test("Gallery keeps initial photos usable after continuation failure", async ({ page }) => {
  await images(page);
  await page.route("**/api/gallery/**", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.route("**/api/images/photo-3?*", route => route.abort());
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/Gallery/public-album");
  await expect(page.locator(".gallery-load-status")).toContainText("写真の続きを取得できません");
  await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
  await rows(page);
  await page.locator(".photo-wrapper").first().click();
  await expect(page.locator(".lb-number")).toHaveText("Image 1 of 100");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).not.toBeVisible();
});
