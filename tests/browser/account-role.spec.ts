import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(page: Page, who: string) {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: {
          email: `${who}@example.invalid`,
          password: "fixture-password-123",
        },
      })
    ).status(),
  ).toBe(200);
}
async function payload(page: Page) {
  return page.locator("#account-editor").evaluate((form: HTMLFormElement) => ({
    ...Object.fromEntries(new FormData(form)),
    revision: form.dataset.revision,
  }));
}
async function editRole(page: Page, who: string, role: string) {
  await page.goto(`/Admin/accounts/${who}`);
  await page.locator(".admin-account-editor > summary").click();
  await page.getByLabel("権限", { exact: true }).selectOption(role);
  await page
    .getByRole("button", { name: "登録内容を保存", exact: true })
    .click();
}
test("role promotion and demotion enforce real access, revoke sessions and keep one approved administrator", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  const other = await context.newPage();
  for (const p of [page, other])
    await p.route("**/*", (r) =>
      new URL(r.request().url()).hostname === "127.0.0.1"
        ? r.continue()
        : r.abort(),
    );
  await login(page, "admin");
  await login(other, "other");
  // Every synthetic administrator must be included when exercising the last-admin guard.
  const extraAdmins = ["site-manager", ...["chromium", "firefox", "webkit"].map(engine => `session-admin-${engine}`)];
  for (const id of extraAdmins) {
    await editRole(page, id, "staff");
    await expect(page).toHaveURL(/saved=1$/);
  }
  await page.goto("/Admin/accounts/other");
  const initial = await payload(page);
  expect(
    (
      await other.request.post("/api/admin/accounts/other", {
        headers,
        data: { ...initial, role: "admin" },
      })
    ).status(),
  ).toBe(403);
  await editRole(page, "other", "admin");
  await expect(page).toHaveURL(/saved=1$/);
  expect(
    (await other.request.get("/Admin", { maxRedirects: 0 })).status(),
  ).toBe(302);
  await login(other, "other");
  expect((await other.goto("/Admin"))?.status()).toBe(200);
  expect((await other.goto("/Portfolio/edit?id=member"))?.status()).toBe(200);
  await editRole(page, "admin", "member");
  await expect(page).toHaveURL(/\/Login\?reason=role-updated&next=%2F$/);
  await expect(page.locator('.auth-note[role="status"]')).toContainText("権限を変更しました");
  await page.locator("#login-email").fill("admin@example.invalid");
  await page.locator("#login-password").fill("fixture-password-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  expect((await page.request.get("/Admin")).status()).toBe(403);
  expect((await page.request.get("/Portfolio/edit?id=other")).status()).toBe(
    403,
  );
  await editRole(other, "other", "member");
  await expect(other.locator("#account-editor-status")).toContainText(
    "最後の承認済み管理者",
  );
  expect((await other.request.get("/Admin")).status()).toBe(200);
  // Restore fixture roles for the next browser.
  await editRole(other, "admin", "admin");
  await expect(other).toHaveURL(/saved=1$/);
  await login(page, "admin");
  await editRole(page, "other", "member");
  await expect(page).toHaveURL(/saved=1$/);
  expect(
    (await other.request.get("/Admin", { maxRedirects: 0 })).status(),
  ).toBe(302);
  await login(other, "other");
  expect((await other.request.get("/Admin")).status()).toBe(403);
  expect((await other.request.get("/Portfolio/edit")).status()).toBe(200);
  for (const id of extraAdmins) {
    await editRole(page, id, "admin");
    await expect(page).toHaveURL(/saved=1$/);
  }
  await context.close();
});
