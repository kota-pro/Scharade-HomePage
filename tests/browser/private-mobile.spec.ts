import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
import { activityRosterUrl } from "../../src/lib/activityRoster";
import { addShape } from "./layout-tools-helper";

const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
async function login(request: APIRequestContext, id: string) {
  expect((await fixtureLogin(request, "/api/auth/login", { headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).status()).toBe(200);
}
async function command(request: APIRequestContext, endpoint: string, data: Record<string, unknown>) {
  const response = await request.post(endpoint, { headers, data });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
function fixtureDirectory() {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Synthetic fixture directory required");
  return directory as string;
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
async function fit(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth + 1, overflow: document.documentElement.scrollWidth <= innerWidth + 1 ? [] : [...document.querySelectorAll("main *")].map(el => { const r = el.getBoundingClientRect(); return { element: `${el.tagName}.${el.className}`, x: r.x, right: r.right, width: r.width }; }).filter(r => r.width && r.right > innerWidth + 1).slice(0, 12) }));
  expect(metrics.fits, `${page.viewportSize()!.width}: ${label}: ${JSON.stringify(metrics.overflow)}`).toBe(true);
  const content = await page.locator(".admin-page").boundingBox();
  expect(content!.x, label).toBeGreaterThanOrEqual(15);
  expect(content!.x + content!.width, label).toBeLessThanOrEqual(page.viewportSize()!.width - 15);
  // A control or text can escape its card while the document itself still fits.
  const clipped = await page.locator('.admin-page').evaluate(root => {
    const issues: string[] = [];
    for (const control of root.querySelectorAll('input:not([type="hidden"]),select,textarea,time')) {
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height || control.closest('dialog:not([open])')) continue;
      let container = control.parentElement;
      while (container && (getComputedStyle(container).display === 'contents' || !container.getBoundingClientRect().width)) container = container.parentElement;
      if (!container) continue;
      const parent = container.getBoundingClientRect();
      if (box.left < parent.left - 2 || box.right > parent.right + 2) issues.push(`${control.tagName}:${control.getAttribute('data-setting') || control.getAttribute('name') || control.textContent?.slice(0, 30)}`);
    }
    return issues;
  });
  expect(clipped, `${label}: fields must fit their own container`).toEqual([]);
}

test("all 32 page templates share mobile typography and fit five phone widths", async ({ page, browser }, info) => {
  test.setTimeout(300000);
  const admin = await browser.newContext({ baseURL: origin });
  await login(admin.request, "admin");
  await restoreFixtureRoster(admin.request);
  await login(page.request, "planner");
  const { eventId } = await command(page.request, "/api/member/activities", { action: "event.save", title: `スマホ配置確認 ${info.project.name}`, description: "長い説明文でも同じ左端から自然に折り返すことを確認します。", startsAt: new Date(Date.now() + 8 * 86400000).toISOString(), endsAt: new Date(Date.now() + 9 * 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(), ownerId: "planner", recipientIds: ["member"], meeting: "駅の中央改札前", itinerary: "街歩き", fee: "なし", theme: "秋" });
  await command(page.request, "/api/member/activities", { action: "event.publish", eventId, revision: 1 });
  const dataPath = path.join(fixtureDirectory(), "member-activities.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const noticeId = data.notifications.find((n: { eventId?: string }) => n.eventId === eventId).id;
  const { runId } = await command(page.request, "/api/member/grouping", { action: "run.save", title: `縦に並ぶ班カード ${info.project.name}`, participantIds: data.roster.records.slice(0, 8).map((r: { key: string }) => r.key), previousRunId: "" });
  await command(page.request, "/api/member/grouping", { action: "groups.rules", runId, revision: 1, rules: { count: 2, min: 4, max: 4, leaders: [data.roster.records[0].key, data.roster.records[2].key], together: [], apart: [] } });
  await command(page.request, "/api/member/grouping", { action: "groups.generate", runId, revision: 2 });
  const { previewId } = await command(admin.request, "/api/member/activities", { action: "roster.preview", url: activityRosterUrl, revision: data.roster.revision });
  const deleteId = randomUUID(), deletionFile = path.join(fixtureDirectory(), "account-deletion-requests.json");
  const deletion = fs.existsSync(deletionFile) ? JSON.parse(fs.readFileSync(deletionFile, "utf8")) : { version: 1, requests: [], challenges: {}, limits: {} };
  deletion.requests.push({ id: deleteId, userId: "other", email: "other@example.invalid", name: "削除申請の表示確認", portfolioId: "other", createdAt: Date.now(), dueAt: Date.now() + 7 * 86400000, status: "pending" });
  fs.writeFileSync(deletionFile, JSON.stringify(deletion));
  const suffix = ["chromium", "firefox", "webkit"].indexOf(info.project.name) + 1;
  const exhibition = `f1000000-0000-4000-8000-00000000000${suffix}`;
  const cases: [string, string, string[]][] = [
    ["member", "member", ["/Member", "/Member/profile", "/Member/security", "/Member/advance", "/Member/account-deletion", `/Member/events/${eventId}`, `/Member/notifications/${noticeId}`, `/Member/exhibitions/${exhibition}`]],
    ["planner", "staff", ["/Member/manage", "/Member/manage/notifications", "/Member/manage/events/new", `/Member/manage/events/${eventId}`, "/Member/manage/grouping", `/Member/manage/grouping/${runId}`, "/Member/manage/exhibitions", ...["", "/form", "/layout", "/participants", "/submissions"].map(end => `/Member/manage/exhibitions/${exhibition}${end}`)]],
    ["admin", "admin", ["/Admin", "/Admin/accounts", "/Admin/accounts/other", "/Admin/content/home", "/Admin/grouping-roster", `/Admin/grouping-roster/preview?id=${previewId}`, "/Admin/notifications", "/Admin/portfolios", "/Admin/account-deletion-requests", `/Admin/account-deletion-requests/${deleteId}`, "/Member/manage/profiles", `/Member/manage/roster-preview?id=${previewId}`]],
  ];
  expect(cases.reduce((total, row) => total + row[2].length, 0)).toBe(32);
  const writes: { path: string; action: string }[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && !request.url().includes("/api/auth/")) writes.push({ path: new URL(request.url()).pathname, action: request.postDataJSON()?.action }); });
  try {
    for (const [user, area, routes] of cases) {
      await login(page.request, user);
      for (const width of [320, 375, 390, 430, 768]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of routes) {
          expect((await page.goto(route))?.status(), `${width}: ${route}`).toBe(200);
          await expect(page.locator("body")).toHaveAttribute("data-member-area", area);
          await expect(page.locator(".admin-page")).toHaveCSS("font-family", /Zen Kurenaido/);
          await expect(page.locator(".admin-title h1")).toHaveCSS("font-family", /linotype-didot/);
          await expect(page.locator(".admin-page h2").first()).toHaveCSS("font-family", /Zen Old Mincho/);
          await fit(page, route);
          if (route === "/Member/advance") {
            const label = (await page.locator(".advance-account-row .advance-label").boundingBox())!;
            const name = (await page.locator("#advance-account").boundingBox())!;
            expect(name.x).toBeGreaterThan(label.x + label.width);
          }
          const nav = page.getByRole("navigation", { name: "会員ページのメニュー" });
          await expect(nav).toBeVisible();
          await expect(nav.locator("a")).toHaveCount(user === "admin" ? 5 : user === "planner" ? 4 : 3);
          await expect(page.locator("#header-logo img")).toHaveAttribute("src", "/icons/logo.svg");
          if (width === 390) await page.screenshot({ path: info.outputPath(`${area}-${routes.indexOf(route)}.png`), fullPage: false });
        }
      }
    }
    // Existing notice reads and collaboration presence are expected when their screens are visited.
    expect(writes.filter(w => !(w.path === "/api/member/activities" && w.action === "notification.read") && !(/\/layout$/.test(w.path) && w.action === "join") && !(/\/layout\/presence$/.test(w.path) && ["leave", "presence", "release"].includes(w.action)))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await admin.close(); }
});

test("navigation anchors, role gates, expanded editor links and keyboard remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request, "member");
  await page.goto("/Member");
  const nav = page.getByRole("navigation", { name: "会員ページのメニュー" });
  await nav.getByRole("link", { name: "企画", exact: true }).click();
  await expect(nav.locator('[data-private-nav-key="events"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#events-heading")).toBeInViewport();
  await nav.getByRole("link", { name: "マイページ" }).click();
  await expect(nav.locator('[data-private-nav-key="account"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#my-page")).toBeInViewport();
  expect((await page.request.get("/Member/manage")).status()).toBe(403);
  expect((await page.request.get("/Admin")).status()).toBe(403);
  await login(page.request, "planner");
  await page.goto("/Member/manage");
  await expect(nav.locator('[data-private-nav-key="staff"]')).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[data-private-nav-key="admin"]')).toHaveCount(0);
  await login(page.request, "admin");
  await page.goto("/Admin");
  await page.locator(".admin-mobile-more summary").click();
  for (const key of ["gallery", "portfolio", "contact", "disclaimer"]) await expect(page.locator(`.admin-mobile-more a[href="/Admin/content/${key}"]`)).toBeVisible();
  await page.goto("/Admin/accounts");
  // Model the visual viewport shrink delivered by an OS keyboard; focus alone must not hide navigation.
  await page.locator("#account-query").focus();
  await expect(nav).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, "height", { configurable: true, value: innerHeight - 300 });
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(nav).toBeHidden();
  await page.evaluate(() => {
    delete (visualViewport as unknown as Record<string, unknown>).height;
    (document.activeElement as HTMLElement).blur();
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(nav).toBeVisible();
});

test("fullscreen room editing gives canvas and inspector separate rows and clears the global nav", async ({ page }, info) => {
  await login(page.request, "planner");
  // Each editing scenario needs its own exhibition so another test's collaboration lease cannot block it.
  const { exhibition } = await command(page.request, "/api/member/exhibitions", { action: "create", title: `スマホ編集の確認 ${info.project.name}` });
  await page.goto(`/Member/manage/exhibitions/${exhibition.id}/layout`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-open-room-editor="floor"]').click();
  const dialog = page.locator(".room-edit-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-layout-sync-status]")).toHaveText("保存済み");
  await dialog.locator("[data-room-add]").click();
  await expect.poll(async () => (await (await page.request.get(`/api/member/exhibitions/${exhibition.id}`)).json()).exhibition.rooms.length).toBe(1);
  await expect(page.locator("[data-layout-sync-status]")).toHaveText("保存済み");
  await expect(page.locator(".private-mobile-nav")).toBeHidden();
  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const tools = (await dialog.locator(".layout-tools").boundingBox())!;
    const stage = (await dialog.locator(".layout-stage").boundingBox())!;
    const sidebar = (await dialog.locator(".layout-sidebar").boundingBox())!;
    expect(stage.y).toBeGreaterThanOrEqual(tools.y + tools.height);
    expect(sidebar.y).toBeGreaterThanOrEqual(stage.y + stage.height);
    expect(stage.width).toBeGreaterThan(width - 40);
    expect(stage.height).toBeGreaterThanOrEqual(140);
    await expect(dialog.locator("[data-layout-save]")).toBeInViewport();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const expandedHeight = (await dialog.locator(".layout-stage").boundingBox())!.height;
  await dialog.locator("[data-layout-panel-toggle]").click();
  expect((await dialog.locator(".layout-stage").boundingBox())!.height).toBeGreaterThan(expandedHeight);
  await dialog.locator("[data-layout-panel-toggle]").click();
  await dialog.screenshot({ path: info.outputPath("room-layout-mobile.png") });
  const annotations = await dialog.locator('[data-layout-kind="annotation"]').count();
  await addShape(page, "rect", 1000, 1000);
  await expect(dialog.locator('[data-layout-kind="annotation"]')).toHaveCount(annotations + 1);
  await dialog.locator("[data-layout-undo]").click();
  await expect(dialog.locator('[data-layout-kind="annotation"]')).toHaveCount(annotations);
  await dialog.locator("[data-layout-redo]").click();
  await expect(dialog.locator('[data-layout-kind="annotation"]')).toHaveCount(annotations + 1);
  await dialog.locator("[data-layout-save]").click();
  await expect(page.locator("[data-layout-sync-status]")).toHaveText("保存済み");
  await dialog.locator('[data-room-modal-close]').click();
  await expect(page.locator(".private-mobile-nav")).toBeVisible();
});

test("desktop and public pages keep their type sizes and app WebViews reuse the native navigation", async ({ page, browser }) => {
  await login(page.request, "admin");
  for (const width of [769, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/Member", "/Member/manage", "/Admin", "/Admin/accounts"]) {
      await page.goto(route);
      await expect(page.locator(".private-mobile-nav")).toBeHidden();
      if (await page.locator('.admin-title-wide').count()) {
        // Management/Dashboard already use responsive headings to fit long labels.
        const size = await page.locator('.admin-title h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(48); expect(size).toBeLessThanOrEqual(96);
        if (width < 1200) expect(size).toBeLessThan(96);
      } else await expect(page.locator(".admin-title h1")).toHaveCSS("font-size", "96px");
      await expect(page.locator(".admin-page")).toHaveCSS("letter-spacing", "2.4px");
      await expect(page.locator(".member-menu-icon").first()).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/About_us", "/Gallery", "/Portfolio", "/Errors"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toHaveAttribute("data-member-area");
    await expect(page.locator(".private-mobile-nav")).toHaveCount(0);
  }
  const app = await browser.newContext({ baseURL: origin, userAgent: "Mozilla/5.0 ScharadeApp/1", viewport: { width: 390, height: 844 } });
  try {
    await login(app.request, "member");
    const appPage = await app.newPage();
    await appPage.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
    await appPage.goto("/Member");
    await expect(appPage.locator("body")).toHaveAttribute("data-app-client", "1");
    await expect(appPage.locator(".private-mobile-nav")).toHaveCount(0);
    await expect(appPage.locator(".admin-page")).toHaveCSS("font-size", "16px");
    await expect(appPage.locator(".admin-title h1")).toHaveCSS("font-family", /linotype-didot/);
    await fit(appPage, "app WebView");
  } finally { await app.close(); }
});
