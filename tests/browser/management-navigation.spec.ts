import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
async function login(page: Page, id: string) {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers: { Origin: origin },
        data: {
          email: `${id}@example.invalid`,
          password: "fixture-password-123",
        },
      })
    ).status(),
  ).toBe(200);
}
const labels = async (page: Page) =>
  (
    await page
      .locator("#header-nav > a, #header-nav > button")
      .allTextContents()
  ).map((v) => v.trim());
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    // Keep production typography, without running external analytics/font scripts.
    const fontAsset =
      ["font", "stylesheet"].includes(route.request().resourceType()) &&
      [
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "use.typekit.net",
        "p.typekit.net",
      ].includes(host);
    return host === "127.0.0.1" || fontAsset ? route.continue() : route.abort();
  });
});

test("public and member headers keep five destinations and header logout supports retry", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/Portfolio");
  expect(await labels(page)).toEqual([
    "About us",
    "Activity",
    "Gallery",
    "Portfolio",
    "Contact",
  ]);
  for (const route of [
    "/Management",
    "/Management/",
    "/Dashboard",
    "/Dashboard/",
  ]) {
    const response = await page.request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toContain("/Login?next=");
  }
  await login(page, "other");
  await page.goto("/Portfolio");
  expect(await labels(page)).toEqual([
    "Activity",
    "Gallery",
    "Portfolio",
    "Member",
    "Log out",
  ]);
  await expect(page.locator(".user-welcome")).toHaveAttribute(
    "href",
    "/Member",
  );
  for (const route of ["/Management", "/Dashboard", "/Member/manage"])
    expect((await page.request.get(route, { maxRedirects: 0 })).status()).toBe(
      403,
    );
  await expect(page.locator("footer .member-links")).not.toContainText(
    "Management",
  );
  await page
    .locator("#header")
    .screenshot({ path: info.outputPath("member-header.png") });
  let attempts = 0;
  await page.route("**/api/auth/logout", async (route) => {
    attempts++;
    await route.fulfill({ status: 503, json: { ok: false } });
  });
  const logout = page.locator("#header-logout");
  await logout.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(logout).toBeEnabled();
  await expect(page.locator("#logout-status")).toContainText(
    "ログアウトできませんでした",
  );
  expect(attempts).toBe(1);
  await page.unroute("**/api/auth/logout");
  await logout.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(origin + "/");
  await expect(page.locator(".user-welcome")).toHaveCount(0);
  expect(
    (await page.request.get("/Member", { maxRedirects: 0 })).status(),
  ).toBe(302);
  expect(await labels(page)).toEqual([
    "About us",
    "Activity",
    "Gallery",
    "Portfolio",
    "Contact",
  ]);
});

test("staff Dashboard offers only authorized destinations and Management preserves old links", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [id, executive] of [
    ["planner", false],
    [`photo-executive-${info.project.name}`, true],
    ["admin", true],
  ] as const) {
    await login(page, id);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/Portfolio");
    expect(await labels(page)).toEqual([
      "Activity",
      "Gallery",
      "Portfolio",
      "Member",
      "Dashboard",
    ]);
    await expect(page.locator("#header-nav a[href='/Admin']")).toHaveCount(0);
    await expect(page.locator(".user-welcome")).toHaveAttribute(
      "href",
      "/Dashboard",
    );
    await page.locator(".user-welcome").click();
    await expect(page).toHaveURL(origin + "/Dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".dashboard-links a")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
    ).toEqual(
      executive
        ? ["/Admin", "/Management", "/Member"]
        : ["/Management", "/Member"],
    );
    const response = await page.request.get("/Dashboard");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(
      (await page.request.get("/Admin", { maxRedirects: 0 })).status(),
    ).toBe(executive ? 200 : 403);
    if (id === "admin")
      await page.screenshot({
        path: info.outputPath("dashboard-desktop.png"),
        fullPage: true,
      });
    await page
      .locator(".dashboard-links")
      .getByRole("link", { name: "Management", exact: true })
      .click();
    await expect(page).toHaveURL(origin + "/Management");
    await expect(
      page.getByRole("heading", { name: "Management", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "班分け自動生成ツール", exact: true }),
    ).toBeVisible();
    const legacy = await page.request.get("/Member/manage?deleted=1", {
      maxRedirects: 0,
    });
    expect(legacy.status()).toBe(302);
    expect(legacy.headers().location).toBe("/Management?deleted=1");
    await page.goto("/Member/manage/notifications");
    await expect(
      page.getByRole("heading", { name: "Management", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".member-back")).toHaveAttribute(
      "href",
      "/Management",
    );
    for (const route of ["/Management", "/Dashboard", "/Member"]) {
      await page.goto(route);
      for (const width of [320, 390, 768, 800, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${id} ${route} ${width}`,
        ).toBeTruthy();
      }
    }
    await expect(
      page.locator(".member-page > p > a[href='/Management']"),
    ).toHaveCount(0);
    await expect(
      page.locator(".member-page > p > a[href='/Member/manage']"),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".user-welcome")).toBeVisible();
    await page.locator(".user-welcome").click();
    await expect(page).toHaveURL(origin + "/Dashboard");
    if (id === "admin")
      await page.screenshot({
        path: info.outputPath("dashboard-mobile.png"),
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
});

test("mobile footer stacks legal links, divides member destinations, and matches the hamburger menu", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const [id, links] of [
    ["other", ["Member", "My Portfolio"]],
    ["planner", ["Management", "Member", "My Portfolio"]],
    ["admin", ["Admin", "Management", "Member", "My Portfolio"]],
    ["site-manager", ["Admin", "Management", "Member"]],
  ] as const) {
    await login(page, id);
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("/Portfolio");
    const footer = page.locator("body > footer");
    expect(
      (await footer.locator(".member-links a").allTextContents()).map((s) =>
        s.trim(),
      ),
    ).toEqual([...links]);
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await footer.evaluate((el) => {
          const disclaimer = el
              .querySelector("a[href='/Disclaimer']")!
              .getBoundingClientRect(),
            errors = el
              .querySelector("a[href='/Errors']")!
              .getBoundingClientRect();
          return (
            disclaimer.bottom <= errors.top + 1 &&
            Math.abs(disclaimer.left - errors.left) < 1 &&
            el.scrollWidth <= el.clientWidth + 1
          );
        }),
      ).toBeTruthy();
      await expect(footer.locator(".member-links a").nth(1)).toHaveCSS(
        "border-left-width",
        "1px",
      );
      if (links.length > 2)
        await expect(footer.locator(".member-links a").nth(2)).toHaveCSS(
          "border-top-width",
          "1px",
        );
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await footer.screenshot({
      path: info.outputPath(`${id}-footer-mobile.png`),
    });
    await page
      .getByRole("button", { name: "メニューを開く", exact: true })
      .click();
    const menu = page.locator("#site-menu .member-buttons");
    expect(
      (await menu.locator("a").allTextContents()).map((s) => s.trim()),
    ).toEqual([...links]);
    if (id !== "other") {
      const management = menu.getByRole("link", {
        name: "Management",
        exact: true,
      });
      await expect(management).toHaveAttribute("href", "/Management");
      await management.click();
      await expect(page).toHaveURL(origin + "/Management");
      if (id === "planner")
        await page.screenshot({
          path: info.outputPath("management-mobile.png"),
          fullPage: true,
        });
    } else await page.keyboard.press("Escape");
  }
});
