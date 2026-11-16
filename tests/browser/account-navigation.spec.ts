import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
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
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});
test("only the dedicated management account has no personal Portfolio navigation, and the footer logs each role out", async ({
  page,
}, info) => {
  for (const [id, expected] of [
    ["site-manager", ["Admin", "Management", "Member"]],
    ["admin", ["Admin", "Management", "Member", "My Portfolio"]],
    ["other", ["Member", "My Portfolio"]],
  ] as const) {
    await page.setViewportSize({ width: 390, height: 1000 });
    await login(page, id);
    await page.goto("/");
    const footer = page.locator("footer");
    expect(
      (await footer.locator(".member-links a").allTextContents())
        .map((x) => x.trim())
        .sort(),
    ).toEqual([...expected].sort());
    await page
      .getByRole("button", { name: "メニューを開く", exact: true })
      .click();
    const menu = page.locator("#site-menu .member-buttons");
    expect(
      (await menu.locator("a").allTextContents()).map((x) => x.trim()).sort(),
    ).toEqual([...expected].sort());
    await expect(
      menu.getByRole("button", { name: "Log out", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    for (const width of [320, 390, 800, 1024, 1200, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          footer.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth + 1 &&
              el.scrollWidth <= el.clientWidth + 1
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(() =>
          footer.evaluate((el) => {
            const logo = el
              .querySelector(".footer-logo")!
              .getBoundingClientRect();
            return [
              ...el.querySelectorAll(".member-links a,.footer-logout button"),
            ].every((e) => {
              const r = e.getBoundingClientRect();
              return (
                r.bottom <= logo.top ||
                r.right <= logo.left ||
                r.left >= logo.right
              );
            });
          }),
        )
        .toBe(true);
    }
    if (id === "site-manager") {
      await footer.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await footer.screenshot({
        path: info.outputPath("management-footer.png"),
      });
      await page.goto("/Member");
      await expect(page.locator(".member-action-list")).not.toContainText(
        "My Portfolio",
      );
      await page.goto("/Portfolio/edit?id=other");
      await expect(page.locator("#portfolio-form")).toBeVisible();
    }
    await footer.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(origin + "/");
    await expect(page.locator(".user-welcome")).toHaveCount(0);
    await expect(page.locator("#footer-logout")).toHaveCount(0);
    await expect(
      footer
        .locator(".member-links")
        .getByRole("link", { name: "Log in", exact: true }),
    ).toBeVisible();
    expect(
      (await page.request.get("/Member", { maxRedirects: 0 })).status(),
    ).toBe(302);
  }
});
test("footer logout shows failure, permits retry and prevents duplicate requests", async ({
  page,
}) => {
  await login(page, "other");
  await page.goto("/");
  let attempts = 0;
  await page.route("**/api/auth/logout", async (route) => {
    attempts++;
    await route.fulfill({ status: 503, json: { ok: false } });
  });
  const button = page.locator("#footer-logout");
  await button.evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(page.locator("#footer-logout-status")).toContainText(
    "ログアウトできませんでした",
  );
  expect(attempts).toBe(1);
  await expect(button).toBeEnabled();
  await page.unroute("**/api/auth/logout");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#footer-logout")).toHaveCount(0);
  expect(
    (await page.request.get("/Member", { maxRedirects: 0 })).status(),
  ).toBe(302);
});
