import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";

const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(request: APIRequestContext, id = "admin") {
  expect((await fixtureLogin(request, "/api/auth/login", { headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).status()).toBe(200);
}
async function change(page: Page, data: unknown) {
  return page.evaluate(async data => {
    const response = await fetch("/api/auth/admin-view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }, data);
}
async function mutation(page: Page, url: string, data: unknown) {
  return page.evaluate(async ({ url, data }) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }, { url, data });
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#ccc"/></svg>' });
    return route.abort();
  });
});

test("dedicated site account is absent from member search and recipients while personal administrators remain", async ({ page }) => {
  await login(page.request);
  await page.goto("/Admin/accounts?q=site-manager");
  await expect(page.locator(".admin-account-row")).toHaveCount(0);
  await page.goto("/Admin/accounts?q=admin%40example.invalid");
  await expect(page.locator('.admin-account-row a[href="/Admin/accounts/admin"]').first()).toBeVisible();
  await page.goto("/Member/manage/notifications");
  await expect(page.locator('[data-recipient-id="site-manager"]')).toHaveCount(0);
  await expect(page.locator('[data-recipient-id="admin"]')).toHaveCount(1);
  await restoreFixtureRoster(page.request);
  await page.goto("/Admin/grouping-roster");
  await expect(page.locator('[data-roster-user="site-manager"]')).toHaveCount(0);
  await expect(page.locator('[data-roster-user="admin"]')).toHaveCount(1);
  await expect(page.locator('a[href="/Admin/accounts/site-manager"]')).toHaveCount(0);
});

test("account proxy saves as the target, blocks stale tabs and forbidden privileges, and restores the administrator", async ({ page, context, request }, info) => {
  test.setTimeout(90000);
  const target = `photo-owner-${info.project.name}`;
  await login(page.request); await login(request);
  const stale = await context.newPage(); await stale.goto("/Admin");
  await page.goto(`/Admin/accounts/${target}`);
  await page.getByRole("button", { name: "このアカウントでログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/Member$/);
  await expect(page.locator("[data-admin-view-banner]")).toContainText("代理ログイン中");
  expect((await request.get("/Admin/content/home")).status()).toBe(200);
  const staleSave = await mutation(stale, "/api/portfolio/update", { self_introduction: "stale" });
  expect(staleSave.status).toBe(409);
  expect((await mutation(page, "/api/portfolio/update", { portfolioId: "other", self_introduction: "forbidden" })).status).toBe(403);
  expect((await mutation(page, "/api/portfolio/update", { generation: 99 })).status).toBe(403);
  expect((await mutation(page, "/api/auth/password", {})).status).toBe(403);
  expect((await mutation(page, "/api/member/tools", { kind: "poll" })).status).toBe(403);
  expect((await page.request.get("/api/admin/accounts/other")).status()).toBe(403);
  await page.goto("/Portfolio/edit");
  await expect(page.locator(".admin-portfolio-fields")).toHaveCount(0);
  await expect(page.locator("[data-introduction-editor]")).toHaveAttribute("data-introduction-ready", "true");
  const text = `代理編集の保存確認 ${info.project.name}`;
  await page.getByRole("textbox", { name: "Self introduction", exact: true }).fill(text);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/Portfolio/${target}$`));
  await expect(page.locator(".self-introduction")).toContainText(text);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const banner = await page.locator("[data-admin-view-banner]").boundingBox();
    const header = await page.locator("body > header").boundingBox();
    expect(banner!.y).toBeGreaterThanOrEqual(header!.height - 1);
    await expect(page.getByRole("button", { name: "管理者へ戻る", exact: true })).toBeVisible();
    if (width !== 320) await page.screenshot({ path: info.outputPath(`proxy-${width}.png`) });
  }
  // A tab from the proxy identity also becomes stale when another tab stops it.
  const oldProxy = await context.newPage(); await oldProxy.goto(`/Portfolio/${target}`);
  await page.getByRole("button", { name: "管理者へ戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/Admin\/view$/);
  await expect(page.locator("[data-admin-view-banner]")).toHaveCount(0);
  expect((await mutation(oldProxy, "/api/portfolio/update", { self_introduction: "stale after exit" })).status).toBe(409);
  expect((await page.request.get("/Admin/content/home")).status()).toBe(200);
});

test("four role previews use role permissions, reject all writes, and always allow a return", async ({ page }, info) => {
  test.setTimeout(90000); await login(page.request);
  for (const [role, label, home, staffStatus, adminStatus] of [
    ["executive", "幹部", "/Admin", 200, 200], ["staff", "運営", "/Management", 200, 403],
    ["member", "一般会員", "/Member", 403, 403], ["guest", "未ログイン", "/", 401, 401],
  ] as const) {
    await page.goto("/Admin/view");
    await page.locator(`[data-admin-view-role="${role}"]`).click();
    await expect(page).toHaveURL(origin + home);
    await expect(page.locator("[data-admin-view-banner]")).toContainText(`${label}として表示確認中`);
    expect((await page.request.get("/api/member/exhibitions")).status()).toBe(staffStatus);
    expect((await page.request.get("/api/admin/accounting")).status()).toBe(adminStatus);
    for (const url of ["/api/portfolio/update", "/api/member/activities", "/api/admin/home-photos", "/api/auth/signup", "/api/member/push-devices"]) {
      expect((await mutation(page, url, {})).status, `${role}: ${url}`).toBe(403);
    }
    // Read-only photo state is POST by existing design and still renders the gallery.
    expect((await mutation(page, "/api/photos/state", {})).status).not.toBe(403);
    expect((await (await page.request.get("/api/auth/session")).json()).authenticated).toBe(true);
    await page.goto("/Admin/content/home");
    await expect(page).toHaveURL(role === "guest" ? /\/Login\?/ : /\/Admin\/view\?notice=permission/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (role === "guest") await page.screenshot({ path: info.outputPath("guest-preview.png") });
    await page.getByRole("button", { name: "管理者へ戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/Admin\/view$/);
    await expect(page.locator("[data-admin-view-banner]")).toHaveCount(0);
  }
});

test("ordinary users cannot invoke impersonation; target administrator permissions and proxy logout work", async ({ page }, info) => {
  await login(page.request, `photo-owner-${info.project.name}`);
  await page.goto("/Member");
  expect((await change(page, { action: "account", userId: "admin" })).status).toBe(403);
  expect((await change(page, { action: "role", role: "executive" })).status).toBe(403);
  await login(page.request);
  await page.goto("/Admin/accounts/site-manager");
  await page.getByRole("button", { name: "このアカウントでログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/Member$/);
  await page.goto("/Admin/content/home");
  await expect(page.locator("[data-admin-view-banner]")).toContainText("サイト管理 として代理ログイン中");
  expect((await mutation(page, "/api/auth/logout", {})).status).toBe(200);
  await page.goto("/Admin/view");
  await expect(page.locator("[data-admin-view-banner]")).toHaveCount(0);
  // A staff proxy can also create new records with that account's permissions.
  expect((await change(page, { action: "account", userId: `photo-staff-${info.project.name}` })).status).toBe(200);
  await page.goto("/Management");
  const created = await mutation(page, "/api/member/tools", { kind: "poll" });
  expect(created.status).toBe(200);
  expect((await page.request.get(`/api/member/tools/${created.body.id}`)).status()).toBe(200);
  await page.getByRole("button", { name: "管理者へ戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/Admin\/view$/);
  const rejected = await page.request.post("/api/auth/admin-view", { headers: { Origin: "https://foreign.invalid" }, data: { action: "role", role: "guest" } });
  expect(rejected.status()).toBe(403);
});

for (const actorRole of ["executive", "staff"] as const) {
  test(`${actorRole} previews only lower roles from its own entry and returns safely`, async ({ page, context }, info) => {
    test.setTimeout(90000);
    await login(page.request, `photo-${actorRole}-${info.project.name}`);
    const home = actorRole === "executive" ? "/Admin" : "/Management";
    const entry = `${home}/view`;
    const returnLabel = actorRole === "executive" ? "幹部へ戻る" : "運営へ戻る";
    const roles = actorRole === "executive" ? ["staff", "member", "guest"] : ["member", "guest"];
    await page.goto(home);
    await page.locator(`.admin-link-list a[href="${entry}"]`).click();
    await expect(page).toHaveURL(origin + entry);
    expect(await page.locator('[data-admin-view-role]').evaluateAll(buttons => buttons.map(b => (b as HTMLElement).dataset.adminViewRole))).toEqual(roles);
    if (actorRole === "staff") {
      await expect(page.getByRole("heading", { name: "アカウントへの代理ログイン" })).toHaveCount(0);
      expect((await page.request.get('/Admin/view', { maxRedirects: 0 })).status()).toBe(403);
      expect((await change(page, { action: "account", userId: "admin" })).status).toBe(403);
      expect((await change(page, { action: "role", role: "staff" })).status).toBe(403);
    }
    expect((await change(page, { action: "role", role: "executive" })).status).toBe(403);
    for (const role of roles) {
      const stale = await context.newPage(); await stale.goto(home);
      await page.goto(entry);
      await page.locator(`[data-admin-view-role="${role}"]`).click();
      await expect(page).toHaveURL(origin + (role === "guest" ? "/" : role === "staff" ? "/Management" : "/Member"));
      await expect(page.locator('[data-admin-view-banner]')).toContainText('閲覧専用');
      expect((await mutation(stale, '/api/member/tools', { kind: 'poll' })).status).toBe(409);
      for (const url of ['/api/portfolio/update', '/api/member/tools', '/api/member/activities', '/api/auth/signup'])
        expect((await mutation(page, url, {})).status).toBe(403);
      await page.getByRole('link', { name: '表示の切り替え', exact: true }).click();
      await expect(page).toHaveURL(origin + entry);
      expect(await page.locator('[data-admin-view-role]').count()).toBe(roles.length);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect(page.getByRole('button', { name: returnLabel, exact: true })).toBeVisible();
        if (role === 'guest') await page.screenshot({ path: info.outputPath(`${actorRole}-view-${width}.png`) });
      }
      await page.getByRole('button', { name: returnLabel, exact: true }).click();
      await expect(page).toHaveURL(origin + entry);
      await expect(page.locator('[data-admin-view-banner]')).toHaveCount(0);
      await stale.close();
    }
    expect((await change(page, { action: "role", role: "guest" })).status).toBe(200);
    await page.goto('/');
    expect((await mutation(page, '/api/auth/logout', {})).status).toBe(200);
    expect((await (await page.request.get('/api/auth/session')).json()).authenticated).toBe(true);
    await page.goto(entry); await expect(page.locator('[data-admin-view-banner]')).toHaveCount(0);
  });
}

test('executive proxies members, staff, peers and administrators with target writes and original actor control', async ({ page }, info) => {
  test.setTimeout(90000);
  const executive = `photo-executive-${info.project.name}`;
  const owner = `photo-owner-${info.project.name}`;
  await login(page.request, executive);
  for (const target of [owner, `photo-staff-${info.project.name}`, executive, 'admin', 'site-manager']) {
    await page.goto(`/Admin/accounts/${target}`);
    await page.getByRole('button', { name: 'このアカウントでログイン', exact: true }).click();
    await expect(page).toHaveURL(/\/Member$/);
    await expect(page.locator('[data-admin-view-banner]')).toContainText('代理ログイン中');
    if (target === owner) {
      expect((await mutation(page, '/api/portfolio/update', { self_introduction: `幹部の代理編集 ${info.project.name}` })).status).toBe(200);
      await page.goto(`/Portfolio/${target}`);
      await expect(page.locator('.self-introduction')).toContainText('幹部の代理編集');
    }
    if (target.includes('staff')) {
      const created = await mutation(page, '/api/member/tools', { kind: 'poll' });
      expect(created.status).toBe(200);
      expect((await page.request.get(`/api/member/tools/${created.body.id}`)).status()).toBe(200);
    }
    if (target === 'admin' || target === 'site-manager') {
      expect((await page.request.get('/Admin/content/home')).status()).toBe(200);
      expect((await change(page, { action: 'role', role: 'executive' })).status).toBe(403);
    }
    expect((await mutation(page, '/api/auth/password', {})).status).toBe(403);
    await page.getByRole('button', { name: '幹部へ戻る', exact: true }).click();
    await expect(page).toHaveURL(/\/Admin\/view$/);
    await expect(page.locator('[data-admin-view-banner]')).toHaveCount(0);
  }
  // Dedicated accounts remain absent from searches, but are selectable only here.
  await page.locator('summary').filter({ hasText: '管理専用アカウント' }).click();
  await expect(page.locator('a[href="/Admin/accounts/site-manager"]')).toBeVisible();
});
