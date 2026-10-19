import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validNewPassword, PASSWORD_REQUIREMENTS } from "../../src/lib/passwordPolicy";

const origin = "http://127.0.0.1:4329";
function directory() {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  return directory as string;
}
function read(name: string) { return JSON.parse(fs.readFileSync(path.join(directory(), name), "utf8")); }
function write(name: string, value: unknown) { fs.writeFileSync(path.join(directory(), name), JSON.stringify(value), { mode: 0o600 }); }

test.beforeEach(async ({ page }, info) => {
  await page.context().setExtraHTTPHeaders({ "X-Real-IP": `192.0.2.${220 + ["chromium", "firefox", "webkit"].indexOf(info.project.name)}` });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test("signup and reset enforce the same seven-character composition and explain it on narrow screens", async ({ page }) => {
  for (const [url, selector, description] of [["/Signup", "#signup-password", "#signup-password-requirements"], ["/ResetPassword?token=synthetic-invalid", "#new-password", "#reset-password-requirements"]]) {
    await page.goto(url);
    await expect(page.locator(description)).toHaveText(PASSWORD_REQUIREMENTS);
    const input = page.locator(selector);
    await expect(input).toHaveAttribute("minlength", "7"); await expect(input).toHaveAttribute("maxlength", "1024");
    for (const value of ["Ab1!xyz", "Ab1!xy", "ab1!xyz", "AB1!XYZ", "Abc!xyz", "Ab1wxyz", "Ab1 xyz", "Ab1。あいう", "Ab1!😀x", "Ab1!😀xy"]) {
      await input.fill(value);
      expect(await input.evaluate((element: HTMLInputElement) => element.checkValidity()), value).toBe(validNewPassword(value));
    }
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await expect(page.locator(description)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});

test("reset API rejects bypassed constraints, then a seven-character password works and invalidates the old session", async ({ page }, info) => {
  const id = `password-policy-${info.project.name}`, email = `${id}@example.invalid`, token = crypto.randomBytes(32).toString("base64url");
  const user = { ...read("users.json").find((u: any) => u.id === "member"), id, email, portfolioId: null };
  write("users.json", [...read("users.json"), user]);
  const tokenEntry = { tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  const tokenPath = path.join(directory(), "password-reset-tokens.json");
  write("password-reset-tokens.json", [...(fs.existsSync(tokenPath) ? read("password-reset-tokens.json") : []), tokenEntry]);
  try {
    const login = (password: string) => page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email, password } });
    expect((await login("fixture-password-123")).status()).toBe(200);
    const reset = (password: string, requestOrigin = origin) => page.request.post("/api/auth/password-reset/confirm", { headers: { Origin: requestOrigin }, data: { token, password, passwordConfirm: password } });
    expect((await reset("Ab1!xyz", "https://evil.invalid")).status()).toBe(403);
    for (const password of ["Ab1!xy", "ab1!xyz", "AB1!XYZ", "Abc!xyz", "Ab1wxyz", "Ab1 xyz"]) {
      const response = await reset(password); expect(response.status()).toBe(400); expect((await response.json()).message).toContain(PASSWORD_REQUIREMENTS);
      expect(read("users.json").find((u: any) => u.id === id).passwordHash).toBe(user.passwordHash);
    }
    expect((await page.request.get(`/api/auth/password-reset/confirm?token=${token}`)).status()).toBe(200);
    await page.goto(`/ResetPassword?token=${token}`);
    await page.locator("#new-password").fill("Ab1!xyz"); await page.locator("#new-password-confirm").fill("Ab1!xyz");
    await page.getByRole("button", { name: "パスワードを変更", exact: true }).click(); await expect(page).toHaveURL(origin + "/Login");
    expect((await page.request.get("/api/member/activities")).status()).toBe(401);
    expect((await login("Ab1!xyz")).status()).toBe(200); expect((await reset("Ab1!xyz")).status()).toBe(410);
    expect(read("users.json").find((u: any) => u.id === id).passwordHash).toMatch(/^scrypt-v2\$/);
  } finally {
    write("users.json", read("users.json").filter((u: any) => u.id !== id));
    write("sessions.json", read("sessions.json").filter((s: any) => s.userId !== id));
    write("password-reset-tokens.json", read("password-reset-tokens.json").filter((t: any) => t.userId !== id));
  }
});
