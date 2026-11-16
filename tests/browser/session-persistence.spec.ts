import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329", password = "fixture-password-123";
function fixtureFile(name: string) {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  return path.join(directory, name);
}
function changeSession(id: string, change: Record<string, string>) {
  const file = fixtureFile("sessions.json"), sessions = JSON.parse(fs.readFileSync(file, "utf8"));
  const session = sessions.find((s: any) => s.userId === id); if (!session) throw new Error("Synthetic session missing");
  Object.assign(session, change); fs.writeFileSync(file, JSON.stringify(sessions));
}
function sessionFor(id: string) {
  return JSON.parse(fs.readFileSync(fixtureFile("sessions.json"), "utf8")).find((s: any) => s.userId === id);
}
async function loginAs(page: any, id: string, remember = true) {
  await page.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers: { Origin: origin }, data: { email: `${id}@example.invalid`, password, remember } })).status()).toBe(200);
  await page.goto("/Member/security");
}
for (const role of ["member", "staff", "admin"]) {
  test(`${role} remember choice survives restored browser cookies; verified browsers skip MFA and new browsers require it`, async ({ page, browser }, info) => {
    const id = `session-${role}-${info.project.name}`;
    const headers = { Origin: origin, "X-Real-IP": `198.51.100.${1 + ["member", "staff", "admin"].indexOf(role) + 10 * ["chromium", "firefox", "webkit"].indexOf(info.project.name)}` };
    await loginAs(page, id);
    const cookies = await page.context().cookies(), session = cookies.find(c => c.name === "session")!;
    expect(session.httpOnly).toBe(true); expect(session.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400);
    const restored = await browser.newContext({ storageState: await page.context().storageState() });
    const restoredPage = await restored.newPage();
    try {
      await restoredPage.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await restoredPage.goto(`${origin}/Member/security`); await expect(restoredPage).toHaveURL(/\/Member\/security$/);
      expect((await restored.request.get(`${origin}/api/auth/session`)).status()).toBe(200);
      if (role !== "member") {
        const trust = cookies.find(c => c.name === "mfa-browser")!; expect(trust.httpOnly).toBe(true);
        await restored.clearCookies(); await restored.addCookies([trust]);
        const repeat = await restored.request.post(`${origin}/api/auth/login`, { headers, data: { email: `${id}@example.invalid`, password, remember: true } });
        expect(repeat.status()).toBe(200); expect((await repeat.json()).mfaRequired).toBeUndefined();
        const fresh = await browser.newContext();
        try {
          const initial = await fresh.request.post(`${origin}/api/auth/login`, { headers, data: { email: `${id}@example.invalid`, password, remember: true } });
          expect(initial.status()).toBe(200); expect((await initial.json()).mfaRequired).toBe(true);
        } finally { await fresh.close(); }
      }
    } finally { await restored.close(); }
  });
}
test("expiry warning renews the chosen lifetime without discarding an unfinished page", async ({ page }, info) => {
  const id = `session-popup-${info.project.name}`;
  await loginAs(page, id);
  await page.evaluate(() => { const input = document.createElement("textarea"); input.setAttribute("aria-label", "未保存の入力"); input.value = "保存前の原稿"; document.body.append(input); });
  changeSession(id, { expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("ログインを延長しますか？");
  await page.getByRole("button", { name: "ログインを延長する", exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(await page.getByLabel("未保存の入力").inputValue()).toBe("保存前の原稿");
  expect(Date.parse(sessionFor(id).expiresAt) - Date.now()).toBeGreaterThan(29 * 86400_000);
  expect((await page.request.get("/api/auth/session")).status()).toBe(200);
  if (info.project.name === "chromium") {
    changeSession(id, { expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(dialog).toBeVisible();
    await page.screenshot({ path: "/private/tmp/scharade-session-extension-20261030.png" });
  }
});
test("declining the warning logs out and an expired tab offers login without reviving its session", async ({ page }, info) => {
  const id = `session-decline-${info.project.name}`;
  await loginAs(page, id, false);
  expect((await page.context().cookies()).find(c => c.name === "session")!.expires - Date.now() / 1000).toBeLessThanOrEqual(8 * 3600);
  changeSession(id, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "ログアウトする", exact: true }).click(); await expect(page).toHaveURL(/\/Login$/);
  expect((await (await page.request.get("/api/auth/session")).json()).authenticated).toBe(false);
  const expired = `session-expired-${info.project.name}`; await loginAs(page, expired);
  changeSession(expired, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toContainText("ログインの確認が必要です");
  await expect(page.getByRole("button", { name: "ログインを延長する", exact: true })).not.toBeVisible();
  await expect(page.getByRole("link", { name: "新しいタブでログインする" })).toHaveAttribute("target", "_blank");
  expect((await page.request.post("/api/auth/session", { headers: { Origin: origin }, data: { action: "renew" } })).status()).toBe(401);
});
test("status polling leaves inactivity unchanged and actual foreground input refreshes it", async ({ page }, info) => {
  const id = `session-activity-${info.project.name}`; await loginAs(page, id);
  await page.clock.install();
  const before = new Date(Date.now() - 120_000).toISOString(); changeSession(id, { lastSeenAt: before });
  await page.request.get("/api/auth/session"); await page.clock.runFor(61_000);
  expect(sessionFor(id).lastSeenAt).toBe(before);
  const activity = page.waitForResponse(response => response.url().endsWith("/api/auth/session") && response.request().method() === "POST");
  await page.getByRole("heading", { name: "ログインの安全設定" }).click(); await activity;
  expect(Date.parse(sessionFor(id).lastSeenAt)).toBeGreaterThan(Date.parse(before));
});
