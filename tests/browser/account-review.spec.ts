import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const origin = "http://127.0.0.1:4329";
function directory() {
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");
  return directory as string;
}
function read(name: string) { return JSON.parse(fs.readFileSync(path.join(directory(), name), "utf8")); }
function signedReview(userId: string, action: "approve" | "reject") {
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const sig = crypto.createHmac("sha256", "fixture-review-secret-at-least-32-characters").update(`${action}:${userId}:${expires}`).digest("hex");
  return `/ReviewAccount?${new URLSearchParams({ action, userId, expires, sig })}`;
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
test("Approve email link works without login; confirmation sends Origin without leaking its signed URL", async ({ page }, info) => {
  const target = `pending-${28 + ["chromium", "firefox", "webkit"].indexOf(info.project.name)}`;
  const previous = read("users.json").find((user: any) => user.id === target), link = signedReview(target, "approve");
  try {
    await page.goto(link); await expect(page).toHaveURL(origin + link); await expect(page.getByRole("button", { name: "確定する", exact: true })).toBeVisible();
    expect(read("users.json").find((user: any) => user.id === target).approved).toBe(false);
    const confirmationPage = await page.request.get(link); expect(confirmationPage.headers()["referrer-policy"]).toBe("no-referrer");
    const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/review" && response.request().method() === "POST");
    await page.getByRole("button", { name: "確定する", exact: true }).click();
    const response = await posted, headers = await response.request().allHeaders();
    expect(response.status(), JSON.stringify({ origin: headers.origin, referer: headers.referer })).toBe(303);
    expect(headers.origin).toBe(origin); expect(headers.referer).toBeUndefined();
    await expect(page).toHaveURL(origin + "/ReviewAccount?result=updated");
    await expect(page.locator('[data-review-result="success"]')).toBeVisible();
    const changed = read("users.json").find((user: any) => user.id === target);
    expect(changed.approved).toBe(true); expect(changed.approvalNotifiedAt).toBeTruthy();
    expect(read("synthetic-mail.json")[previous.email]).toContain("開設が完了しました");
  } finally {
    const users = read("users.json").map((user: any) => user.id === target ? previous : user);
    fs.writeFileSync(path.join(directory(), "users.json"), JSON.stringify(users), { mode: 0o600 });
  }
});
test("signed review rejects foreign Origin, missing, expired and tampered signatures without login", async ({ page }, info) => {
  const target = `pending-${1 + ["chromium", "firefox", "webkit"].indexOf(info.project.name)}`;
  const fields = Object.fromEntries(new URL(signedReview(target, "reject"), origin).searchParams);
  for (const foreign of ["https://evil.invalid", "null"]) {
    expect((await page.request.post("/api/auth/review", { headers: { Origin: foreign }, form: fields })).status()).toBe(403);
  }
  for (const form of [{}, { ...fields, sig: "0".repeat(64) }, { ...fields, expires: "2000-01-01T00:00:00.000Z" }, { ...fields, action: "approve" }]) {
    const response = await page.request.post("/api/auth/review", { headers: { Origin: origin }, form, maxRedirects: 0 });
    expect(response.status()).toBe(303); expect(response.headers().location).toBe("/ReviewAccount?result=invalid");
  }
  expect(read("users.json").find((user: any) => user.id === target).approvalReviewedAt).toBeUndefined();
});
test("confirmation keeps a failed request on screen and permits a successful Reject retry", async ({ page }, info) => {
  const target = `pending-${25 + ["chromium", "firefox", "webkit"].indexOf(info.project.name)}`;
  const previous = read("users.json").find((user: any) => user.id === target), link = signedReview(target, "reject");
  try {
    await page.goto(link);
    await page.route("**/api/auth/review", route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, message: "このサイトの画面から操作してください" }) }));
    const button = page.getByRole("button", { name: "確定する", exact: true });
    await button.click();
    await expect(page.locator("#review-status")).toHaveText("このサイトの画面から操作してください");
    await expect(button).toBeEnabled(); await expect(page).toHaveURL(origin + link);
    expect(read("users.json").find((user: any) => user.id === target).approvalReviewedAt).toBeUndefined();
    await page.unroute("**/api/auth/review");
    await button.click(); await expect(page).toHaveURL(origin + "/ReviewAccount?result=updated");
    await expect(page.locator('[data-review-result="success"]')).toBeVisible();
    const changed = read("users.json").find((user: any) => user.id === target);
    expect(changed.approved).toBe(false); expect(changed.approvalReviewAction).toBe("reject");
    expect(changed.approvalNotifiedAt).toBeUndefined(); expect(read("synthetic-mail.json")[previous.email]).toBeUndefined();
  } finally {
    const users = read("users.json").map((user: any) => user.id === target ? previous : user);
    fs.writeFileSync(path.join(directory(), "users.json"), JSON.stringify(users), { mode: 0o600 });
  }
});
