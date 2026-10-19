import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const origin = "http://127.0.0.1:4329";
function fixtureFile(name: "users.json" | "synthetic-mail.json") {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
}
function emailCode(email: string) { return fixtureFile("synthetic-mail.json")[email].match(/確認コード：(\d{6})/)[1] as string; }
async function fillSignup(page: import("@playwright/test").Page, email: string) {
  await page.locator("#signup-name").fill("メール確認の架空申請者");
  await page.locator("#signup-portfolio-name").fill("メール確認の架空Portfolio");
  await page.locator("#signup-email").fill(email);
  await page.locator("#signup-password").fill("Ab1!xyz");
  await page.locator("#signup-password-confirm").fill("Ab1!xyz");
}
test.beforeEach(async ({ page }, info) => {
  const caseIndex = info.title.startsWith("signup UI") ? 1 : info.title.startsWith("public signup") ? 2 : 3;
  await page.context().setExtraHTTPHeaders({ "X-Real-IP": `192.0.2.${180 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 + caseIndex}` });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
test("signup UI proves mailbox ownership before creating an unapproved account and rejects code replay", async ({ page }, info) => {
  const email = `signup-ui-${info.project.name}@example.invalid`, errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/Signup?next=https%3A%2F%2Fevil.invalid"); await fillSignup(page, email);
  await expect(page.locator("#signup-code")).toBeHidden();
  const requested = page.waitForResponse(response => response.url().endsWith("/api/auth/signup"));
  await page.getByRole("button", { name: "確認コードを送信", exact: true }).click();
  const response = await requested, data = await response.json(); expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ action: "request-code", email });
  await expect(page.locator("#signup-code")).toBeVisible(); await expect(page.locator("#signup-email")).toHaveAttribute("readonly", "");
  expect(fixtureFile("users.json").some((user: any) => user.email === email)).toBe(false);
  const code = emailCode(email), wrong = code === "000000" ? "000001" : "000000";
  await page.locator("#signup-code").fill(wrong); await page.getByRole("button", { name: "確認して登録を申請", exact: true }).click();
  await expect(page.locator("#signup-message")).toHaveText("確認コードが正しくありません。");
  expect(fixtureFile("users.json").some((user: any) => user.email === email)).toBe(false);
  await page.locator("#signup-code").fill(code); await page.getByRole("button", { name: "確認して登録を申請", exact: true }).click();
  await expect(page).toHaveURL(origin + "/Login?next=%2F");
  const user = fixtureFile("users.json").find((user: any) => user.email === email);
  expect(user.approved).toBe(false); expect(user.role).toBe("member"); expect(user.passwordHash).toMatch(/^scrypt-v2\$/); expect(user.portfolioId).toMatch(/^signup-/);
  const replay = await page.request.post("/api/auth/signup", { headers: { Origin: origin }, data: { action: "complete", verificationToken: data.verificationToken, code, email, name: "架空", portfolioName: "架空", password: "Ab1!xyz", passwordConfirm: "Ab1!xyz" } });
  expect(replay.status()).toBe(410); expect(errors).toEqual([]);
});
test("public signup requests have the same response for existing and new email; duplicate guidance follows ownership proof", async ({ page }, info) => {
  const email = "member@example.invalid", original = fixtureFile("users.json").find((user: any) => user.email === email);
  const requestCode = (email: string) => page.request.post("/api/auth/signup", { headers: { Origin: origin }, data: { action: "request-code", email } });
  const known = await requestCode(email), unknown = await requestCode(`signup-unconfirmed-${info.project.name}@example.invalid`);
  expect(known.status()).toBe(200); expect(unknown.status()).toBe(200);
  const a = await known.json(), b = await unknown.json(); expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); expect(a.message).toEqual(b.message); expect(a.verificationRequired).toBe(true);
  const complete = await page.request.post("/api/auth/signup", { headers: { Origin: origin }, data: { action: "complete", verificationToken: a.verificationToken, code: emailCode(email), email, name: "架空", portfolioName: "架空", password: "Ab1!xyz", passwordConfirm: "Ab1!xyz" } });
  expect(complete.status()).toBe(409); expect((await complete.json()).message).toContain("登録済み");
  expect(fixtureFile("users.json").find((user: any) => user.email === email)).toEqual(original);
});
test("verification UI supports editing and resend, with no code token in URLs or browser storage", async ({ page }, info) => {
  const email = `signup-edit-${info.project.name}@example.invalid`;
  await page.goto("/Signup"); await fillSignup(page, email);
  await page.getByRole("button", { name: "確認コードを送信", exact: true }).click(); await expect(page.locator("#signup-code")).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("#signup-code")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator("#signup-code").evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect.poll(async () => {
    const box = await page.locator("#signup-code").boundingBox();
    return !!box && box.y >= 100 && box.y + box.height <= 800;
  }).toBe(true);
  await page.screenshot({ path: `/private/tmp/scharade-signup-verification-${info.project.name}.png` });
  await page.locator("#signup-edit").click(); await expect(page.locator("#signup-code")).toBeHidden();
  expect(await page.locator("#signup-email").getAttribute("readonly")).toBeNull(); await expect(page.locator("#signup-password")).toHaveValue("Ab1!xyz");
  await page.locator("#signup-email").fill(`signup-changed-${info.project.name}@example.invalid`);
  await page.getByRole("button", { name: "確認コードを送信", exact: true }).click(); await expect(page.locator("#signup-code")).toBeVisible();
  expect(page.url()).toBe(origin + "/Signup");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});
