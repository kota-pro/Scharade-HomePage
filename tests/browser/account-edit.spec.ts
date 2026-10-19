import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fixtureLogin,fixtureMfaCode } from "./fixture-auth";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(request: APIRequestContext, email: string) {
  const response = await fixtureLogin(request, "/api/auth/login", {
    headers,
    data: { email, password: "fixture-password-123" },
  });
  expect(response.status()).toBe(200);
}
async function registration(page: Page) {
  return page.locator("#account-editor").evaluate((node: HTMLFormElement) => ({
    revision: node.dataset.revision,
    ...Object.fromEntries(new FormData(node).entries()),
  })) as Promise<{
    name: string;
    email: string;
    portfolioName: string;
    role: string;
    revision: string;
  }>;
}
async function openEditor(page: Page) {
  await page.locator(".admin-account-editor > summary").click();
  await expect(
    page.getByRole("button", { name: "登録内容を保存", exact: true }),
  ).toBeEnabled();
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "登録内容を保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\?saved=1$/);
  await expect(
    page.getByRole("region", { name: "登録内容", exact: true }).getByRole("status").filter({ hasText: "登録内容を保存しました。" }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

test("admin edits registration with validation, conflict detection and protected API; email changes invalidate member sessions", async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const endpoint = "/api/admin/accounts/other";
  expect((await request.post(endpoint, { headers, data: {} })).status()).toBe(
    401,
  );
  const memberContext = await browser.newContext({ baseURL: origin });
  await login(memberContext.request, "other@example.invalid");
  expect(
    (
      await memberContext.request.post(endpoint, { headers, data: {} })
    ).status(),
  ).toBe(403);
  await login(page.request, "admin@example.invalid");
  await page.goto("/Admin/accounts/other");
  const original = await registration(page);
  try {
    expect(
      (
        await page.request.post(endpoint, {
          headers: { Origin: "https://elsewhere.invalid" },
          data: original,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(endpoint, {
          headers,
          data: { ...original, role: "owner" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post(endpoint, {
          headers,
          data: { ...original, email: "bad" },
        })
      ).status(),
    ).toBe(400);
    await openEditor(page);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("#account-email")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
    await page.locator("#account-email").fill("ADMIN@EXAMPLE.INVALID");
    await page
      .getByRole("button", { name: "登録内容を保存", exact: true })
      .click();
    await expect(page.locator("#account-editor-status")).toContainText(
      "別のアカウントで使用",
    );
    await expect(page.locator("#account-email")).toHaveValue(
      "ADMIN@EXAMPLE.INVALID",
    );
    await page.locator("#account-email").fill(original.email);
    await page.locator("#account-name").fill("管理画面から変更した名前");
    await page.route("**/api/admin/accounts/other", (route) => route.abort());
    await page
      .getByRole("button", { name: "登録内容を保存", exact: true })
      .click();
    await expect(page.locator("#account-editor-status")).toHaveAttribute(
      "data-error",
      "true",
    );
    await expect(page.locator("#account-name")).toHaveValue(
      "管理画面から変更した名前",
    );
    await page.unroute("**/api/admin/accounts/other");
    await page.locator("#account-portfolio-name").fill("登録名の訂正");
    await save(page);
    await expect(page.locator(".admin-account-details")).toContainText(
      "管理画面から変更した名前",
    );
    await expect(page.locator(".admin-account-details")).toContainText(
      "登録名の訂正",
    );
    const current = await registration(page);
    expect(
      (
        await memberContext.request.get("/Portfolio/edit", { maxRedirects: 0 })
      ).status(),
    ).toBe(200);
    await openEditor(page);
    expect(
      (
        await page.request.post(endpoint, {
          headers,
          data: { ...current, name: "別の管理操作による変更" },
        })
      ).status(),
    ).toBe(200);
    await page.locator("#account-name").fill("競合する変更");
    await page
      .getByRole("button", { name: "登録内容を保存", exact: true })
      .click();
    await expect(page.locator("#account-editor-status")).toContainText(
      "ほかの操作で",
    );
    await expect(page.locator("#account-name")).toHaveValue("競合する変更");
    await page.reload();
    await expect(page.locator(".admin-account-details")).toContainText(
      "別の管理操作による変更",
    );
    await openEditor(page);
    await page.locator("#account-email").fill("Changed.Member@EXAMPLE.INVALID");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".admin-account-editor")
      .screenshot({ path: testInfo.outputPath("account-edit-mobile.png") });
    await save(page);
    await expect(page.locator(".admin-account-details")).toContainText(
      "changed.member@example.invalid",
    );
    expect(
      (
        await memberContext.request.get("/Portfolio/edit", { maxRedirects: 0 })
      ).status(),
    ).toBe(302);
    expect(
      (
        await fixtureLogin(memberContext.request, "/api/auth/login", {
          headers,
          data: { email: original.email, password: "fixture-password-123" },
        })
      ).status(),
    ).toBe(400);
    await login(memberContext.request, "changed.member@example.invalid");
    expect(
      (
        await memberContext.request.get("/Portfolio/edit", { maxRedirects: 0 })
      ).status(),
    ).toBe(200);
    await page.goto("/Admin/accounts?q=changed.member%40example.invalid");
    await expect(page.locator(".admin-account-row")).toHaveCount(1);
  } finally {
    await page.goto("/Admin/accounts/other");
    const current = await registration(page);
    const restored = await page.request.post(endpoint, {
      headers,
      data: { ...original, revision: current.revision },
    });
    expect(restored.status()).toBe(200);
    await memberContext.close();
  }
});

test("administrator can rename their own account and change their email with a clear return to login", async ({
  page,
}) => {
  const directory=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8')).directory;
  if(!directory.startsWith(path.join(os.tmpdir(),'scharade-browser-')))throw new Error('Invalid synthetic directory');
  const file=path.join(directory,'users.json'),originalUser=JSON.parse(fs.readFileSync(file,'utf8')).find((u:any)=>u.id==='admin');
  try{
  await login(page.request, "admin@example.invalid");
  await page.goto("/Admin/accounts/admin");
  const original = await registration(page);
  await openEditor(page);
  await page.locator("#account-name").fill("新しい管理者名");
  await save(page);
  await expect(page.locator(".user-welcome")).toContainText(
    "新しい管理者名さん、ようこそ。",
  );
  await openEditor(page);
  await page.locator("#account-email").fill("admin-updated@example.invalid");
  await page
    .getByRole("button", { name: "登録内容を保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\/Login\?reason=email-updated&next=/);
  await expect(page.locator('.auth-note[role="status"]')).toContainText(
    "新しいメールアドレスでログイン",
  );
  await page.locator("#login-email").fill("admin-updated@example.invalid");
  await page.locator("#login-password").fill("fixture-password-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/Mfa$/);
  await page.locator('#mfa-code').fill(fixtureMfaCode('admin-updated@example.invalid'));
  const verified=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/mfa'&&r.request().method()==='POST');
  await page.locator('#mfa-form button[type="submit"]').click();expect((await verified).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/Mfa$/);
  await page.goto("/Admin/accounts/admin?saved=1");
  await expect(page).toHaveURL(/\/Admin\/accounts\/admin\?saved=1$/);
  await openEditor(page);
  await page.locator("#account-name").fill(original.name);
  await page.locator("#account-email").fill(original.email);
  await page
    .getByRole("button", { name: "登録内容を保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\/Login\?reason=email-updated&next=/);
  }finally{
    const users=JSON.parse(fs.readFileSync(file,'utf8')).map((u:any)=>u.id==='admin'?originalUser:u);
    fs.writeFileSync(file,JSON.stringify(users),{mode:0o600});
  }
});
