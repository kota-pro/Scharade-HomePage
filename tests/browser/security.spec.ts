import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
function syntheticEmail(email: string) {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  return JSON.parse(fs.readFileSync(path.join(directory, "synthetic-mail.json"), "utf8"))[email] as string;
}
test("privileged login requires email codes on every login and members do not require MFA", async ({ page }, info) => {
  const email = `mfa-enroll-${info.project.name}@example.invalid`;
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/Login?next=%2FMember%2Fsecurity");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("fixture-password-123");
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/Mfa$/);
  expect((await page.request.get("/api/member/activities")).status()).toBe(401);
  expect((await page.context().cookies()).some(c => c.name === "session")).toBe(false);
  await expect(page.locator("#mfa-resend")).toBeDisabled();
  expect((await page.request.post("/api/auth/mfa", { headers: { Origin: origin }, data: { action: "resend" } })).status()).toBe(429);
  await expect(page.locator("#mfa-qr")).toHaveCount(0);
  await expect(page.getByText("mfa-enroll-" + info.project.name + "@example.invalid", { exact: true })).toHaveCount(0);
  const firstCode = syntheticEmail(email).match(/確認コード：(\d{6})/)![1];
  // Advance only the synthetic account's send timestamp; production has no test bypass.
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  const stateFile = path.join(directory, "auth-security.json"), state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.deliveries[`mfa-enroll-${info.project.name}`].lastSentAt -= 61_000;
  fs.writeFileSync(stateFile, JSON.stringify(state)); await page.reload();
  await expect(page.locator("#mfa-resend")).toBeEnabled(); await page.locator("#mfa-resend").click();
  await expect(page.locator("#mfa-message")).toContainText("再送しました");
  const latestCode = syntheticEmail(email).match(/確認コード：(\d{6})/)![1]; expect(latestCode).not.toBe(firstCode);
  await page.locator("#mfa-code").fill(firstCode); await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page.locator("#mfa-message")).toContainText("コードが正しくない");
  expect((await page.request.get("/api/member/activities")).status()).toBe(401);
  if (info.project.name === "chromium") await page.screenshot({ path: "/private/tmp/scharade-email-mfa-preview.png", fullPage: true });
  await page.locator("#mfa-code").fill(latestCode); await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/Member\/security$/);
  await expect(page.getByText("ログインごとに登録済みメールへの確認が必要", { exact: false })).toBeVisible();
  expect((await page.request.get("/api/member/activities")).status()).toBe(200);
  await page.request.post("/api/auth/logout", { headers: { Origin: origin } });
  const begin = await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email, password: "fixture-password-123" } });
  expect((await begin.json()).mfaRequired).toBe(true);
  const cookie = (await page.context().cookies()).find(c => c.name === "mfa")!;
  const secondCode = syntheticEmail(email).match(/確認コード：(\d{6})/)![1];
  await page.goto("/Mfa"); await page.locator("#mfa-code").fill(secondCode);
  await page.locator('#mfa-form button[type="submit"]').click(); await expect(page).toHaveURL(origin + "/");
  const replay = await page.request.post("/api/auth/mfa", { headers: { Origin: origin, Cookie: `mfa=${cookie.value}` }, data: { action: "verify", code: secondCode } });
  expect(replay.status()).toBe(410);
  const oldMethod = await page.request.post("/api/auth/mfa", { headers: { Origin: origin }, data: { action: "recover", code: "old-recovery-code" } }); expect(oldMethod.status()).toBe(400);
  await page.request.post("/api/auth/logout", { headers: { Origin: origin } });
  const memberLogin = await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email: "member@example.invalid", password: "fixture-password-123" } });
  expect(memberLogin.status()).toBe(200); expect((await memberLogin.json()).mfaRequired).toBeUndefined();
  expect((await page.request.get("/api/member/activities")).status()).toBe(200); expect(errors).toEqual([]);
});
test("CSP blocks injected inline JavaScript and private redirects/errors are uncached", async ({ page, request }) => {
  const response = await page.goto("/Login");
  const policy = response!.headers()["content-security-policy"];
  expect(policy).toContain("frame-ancestors 'self'");
  const scripts = policy.split(";").map(d => d.trim()).find(d => d.startsWith("script-src"))!;
  expect(scripts).toContain("'sha256-"); expect(scripts).not.toContain("'unsafe-inline'"); expect(scripts).not.toContain("'unsafe-eval'");
  await page.evaluate(() => { const script = document.createElement("script"); script.textContent = "window.__securityInjected = true"; document.head.appendChild(script); });
  expect(await page.evaluate(() => (window as any).__securityInjected)).toBeUndefined();
  for (const url of ["/Admin", "/Member"]) {
    const denied = await request.get(url, { maxRedirects: 0 }); expect(denied.status()).toBe(302);
    expect(denied.headers()["cache-control"]).toContain("no-store"); expect(denied.headers()["x-content-type-options"]).toBe("nosniff");
    expect(denied.headers()["content-security-policy"]).toContain("default-src 'none'");
  }
  const reset = await request.get("/ResetPassword?token=synthetic-invalid"); expect(reset.headers()["referrer-policy"]).toBe("no-referrer");
  const csrf = await request.post("/api/auth/logout", { headers: { Origin: "https://evil.invalid" } }); expect(csrf.status()).toBe(403);
});
test("authenticated image uploads reject active or disguised non-image data before CMS writes", async ({ page }) => {
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers: { Origin: origin }, data: { email: "member@example.invalid", password: "fixture-password-123" } })).status()).toBe(200);
  for (const [name, mimeType, buffer] of [
    ["active.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["disguised.jpg", "image/jpeg", Buffer.from("not-a-jpeg")],
    ["photo.avif", "image/avif", Buffer.from("synthetic-disallowed-container")],
  ] as const) {
    const response = await page.request.post("/api/portfolio/upload", { headers: { Origin: origin }, multipart: { file: { name, mimeType, buffer } } });
    expect(response.status()).toBe(400);
  }
});
