import { fixtureLogin } from "./fixture-auth";
import { test, expect } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io"))
      return route.fulfill({
        path: path.resolve("public/media/site/activity/Photo1-480.webp"),
        contentType: "image/webp",
      });
    return route.abort();
  });
});

for (const account of ["other", "member"]) {
  test(`breadcrumbs and ${account} welcome align and adapt to available space`, async ({ page }) => {
    await page.goto("/Login");
    const login = await fixtureLogin(page.request, "/api/auth/login", {
      headers: { Origin: "http://127.0.0.1:4329" },
      data: { email: `${account}@example.invalid`, password: "fixture-password-123" },
    });
    expect(login.status()).toBe(200);
    const article = "/posts/" + encodeURIComponent("暗室の使い方①　〜導入編〜");
    for (const route of ["/Portfolio", article, "/Portfolio/edit"]) {
      await page.goto(route);
      const welcome = page.locator(".user-welcome");
      await expect(welcome).toHaveAttribute("href", "/Member");
      await expect(page.locator("header .user-welcome")).toHaveCount(0);
      // Resize both ways without reloading, including the logo's 430px breakpoint.
      for (const width of [1920, 1440, 768, 431, 430, 390, 320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => {
          const logo = document.querySelector(".header-logo")!.getBoundingClientRect();
          const nav = document.querySelector(".breadcrumbs")!.getBoundingClientRect();
          const link = document.querySelector(".user-welcome")!.getBoundingClientRect();
          // The greeting and notification bell share the right-edge space.
          const greetingGroup = document.querySelector(".welcome-notification-group")!.getBoundingClientRect();
          const first = document.querySelector(".breadcrumbs li")!.getBoundingClientRect();
          return Math.abs(nav.left - logo.left) < 1 &&
            Math.abs(nav.left - (document.documentElement.clientWidth - greetingGroup.right)) < 1 &&
            Math.abs(first.top - link.top) < 3 &&
            nav.right + 8 <= link.left &&
            document.documentElement.scrollWidth <= window.innerWidth + 1;
        }), `${account} ${route} ${width}px`).toBe(true);
        if (route === "/Portfolio") {
          if (account === "member" && width <= 430) {
            await expect(welcome.locator(".welcome-short")).toBeVisible();
            await expect(welcome.locator(".welcome-full")).not.toBeVisible();
          }
          if (account === "other" || width >= 1440) {
            await expect(welcome.locator(".welcome-full")).toBeVisible();
            await expect(welcome.locator(".welcome-short")).not.toBeVisible();
          }
        } else if (route === article && width <= 390) {
          await expect(welcome.locator(".welcome-short")).toBeVisible();
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/Portfolio");
    await page.locator(".user-welcome").click();
    await expect(page).toHaveURL(/\/Member$/);
    await page.screenshot({ path: test.info().outputPath(`${account}-390.png`) });
  });
}
