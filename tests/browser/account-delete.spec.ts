import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:4329",
  headers = { Origin: origin };
async function login(page: Page) {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: {
          email: "admin@example.invalid",
          password: "fixture-password-123",
        },
      })
    ).status(),
  ).toBe(200);
}
async function confirmation(page: Page) {
  return page
    .locator("#account-delete-form")
    .evaluate((f: HTMLElement) => ({
      revision: f.dataset.revision,
      confirmationEmail: f.dataset.email,
    }));
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

test("deletion confirmation is accessible, cancellable and protected from unauthorized or self deletion", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const endpoint = "/api/admin/accounts/other";
  expect((await request.delete(endpoint, { headers, data: {} })).status()).toBe(
    401,
  );
  const member = await browser.newContext({ baseURL: origin });
  await fixtureLogin(member.request, "/api/auth/login", {
    headers,
    data: { email: "member@example.invalid", password: "fixture-password-123" },
  });
  expect(
    (await member.request.delete(endpoint, { headers, data: {} })).status(),
  ).toBe(403);
  await member.close();
  await login(page);
  await page.goto("/Admin/accounts/other");
  const payload = await confirmation(page);
  expect(
    (
      await page.request.delete(endpoint, {
        headers: { Origin: "https://elsewhere.invalid" },
        data: payload,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.delete(endpoint, {
        headers,
        data: { ...payload, confirmationEmail: "wrong@example.invalid" },
      })
    ).status(),
  ).toBe(400);
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE") mutations.push(r.url());
  });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole("button", { name: "アカウントを削除", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "アカウントの削除確認" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("#account-delete-cancel")).toBeFocused();
    await expect(dialog).toContainText("other@example.invalid");
    await expect(page.locator("#account-delete-submit")).toBeDisabled();
    await page.locator("#account-delete-email").fill("wrong@example.invalid");
    await expect(page.locator("#account-delete-submit")).toBeDisabled();
    await page.locator("#account-delete-email").fill("other@example.invalid");
    await expect(page.locator("#account-delete-submit")).toBeEnabled();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    if (width === 390)
      await dialog.screenshot({
        path: testInfo.outputPath("delete-confirm-mobile.png"),
      });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#account-delete-open")).toBeFocused();
    await page.locator("#account-delete-open").click();
    await expect(page.locator("#account-delete-email")).toHaveValue("");
    await page.locator("#account-delete-cancel").click();
    await expect(dialog).not.toBeVisible();
  }
  expect(mutations).toEqual([]);
  await page.goto("/Admin/accounts/admin");
  await expect(page.locator("#account-delete-open")).toHaveCount(0);
  await expect(
    page.getByText("ログイン中の管理者自身は削除できません。"),
  ).toBeVisible();
  expect(
    (
      await page.request.delete("/api/admin/accounts/admin", {
        headers,
        data: {
          revision: "unused",
          confirmationEmail: "admin@example.invalid",
        },
      })
    ).status(),
  ).toBe(403);
});

test("confirmed deletion removes the account and Portfolio after a retry and invalidates login and cached public links", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const id = `delete-${testInfo.project.name}`,
    email = `${id}@example.invalid`;
  const member = await browser.newContext({ baseURL: origin });
  expect(
    (
      await fixtureLogin(member.request, "/api/auth/login", {
        headers,
        data: { email, password: "fixture-password-123" },
      })
    ).status(),
  ).toBe(200);
  await login(page);
  await page.goto(`/Admin/accounts/${id}`);
  expect((await page.request.get(`/Portfolio/${id}`)).status()).toBe(200);
  expect(await (await page.request.get("/Portfolio")).text()).toContain(
    `/Portfolio/${id}`,
  );
  await page.request.get("/sitemap.xml");
  await page.locator("#account-delete-open").click();
  await page.locator("#account-delete-email").fill(email);
  // Fixture's first upstream DELETE fails without deleting either record.
  await page.locator("#account-delete-submit").click();
  await expect(page.locator("#account-delete-status")).toContainText(
    "アカウントは残しています",
  );
  expect((await page.request.get(`/Admin/accounts/${id}`)).status()).toBe(200);
  expect((await page.request.get(`/Portfolio/${id}`)).status()).toBe(200);
  expect(
    (await member.request.get("/Portfolio/edit", { maxRedirects: 0 })).status(),
  ).toBe(200);
  await page.locator("#account-delete-submit").click();
  await expect(page).toHaveURL(/\/Admin\/accounts\?deleted=1$/);
  await expect(page.locator('main p[role="status"]')).toContainText("削除が完了");
  expect((await page.request.get(`/Admin/accounts/${id}`)).status()).toBe(404);
  expect((await page.request.get(`/Portfolio/${id}`)).status()).toBe(404);
  expect(await (await page.request.get("/Portfolio")).text()).not.toContain(
    `/Portfolio/${id}`,
  );
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(
    `/Portfolio/${id}`,
  );
  expect(
    (await member.request.get("/Portfolio/edit", { maxRedirects: 0 })).status(),
  ).toBe(302);
  expect(
    (
      await fixtureLogin(member.request, "/api/auth/login", {
        headers,
        data: { email, password: "fixture-password-123" },
      })
    ).status(),
  ).toBe(400);
  await page.goto(`/Admin/accounts?q=${encodeURIComponent(email)}`);
  // Search is partial: app-delete-* fixtures can still match delete-* emails.
  await expect(page.locator(`.admin-account-row a[href="/Admin/accounts/${id}"]`)).toHaveCount(0);
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await member.close();
});
