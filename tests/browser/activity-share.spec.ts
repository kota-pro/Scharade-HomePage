import { fixtureLogin } from "./fixture-auth";
import { test, expect, type APIRequestContext } from "@playwright/test";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(request: APIRequestContext, id: string) {
  expect((await fixtureLogin(request, "/api/auth/login", { headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).status()).toBe(200);
}
async function command(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/member/activities", { headers, data });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
test("events and notices share canonical URLs from title rows, without QR, with public events and private notices", async ({ page, request, browser, context, browserName }, info) => {
  const errors: string[] = [], qr: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (r.url().includes("portfolioQr")) qr.push(r.url()); });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedLink = text; } } }));
  await login(page.request, "planner");
  const title = `秋の撮影会：とても長い企画名も折り返してシェアできます ${info.project.name}`;
  const { eventId } = await command(page.request, { action: "event.save", title, description: "企画共有のテストです。", startsAt: "2027-04-02T09:00:00+09:00", endsAt: "2027-04-02T18:00:00+09:00", deadline: "2027-04-01T18:00:00+09:00", meeting: "駅前", itinerary: "撮影", fee: "無料", theme: "秋", ownerId: "planner", recipientIds: ["activity-0"] });
  await page.goto(`/Member/manage/events/${eventId}`);
  await expect(page.locator("[data-activity-share-open]")).toHaveCount(0);
  expect((await page.request.get(`/Member/events/${eventId}`)).status()).toBe(404);
  await command(page.request, { action: "event.publish", eventId, revision: 1 });
  const noticeId = crypto.randomUUID();
  await command(page.request, { action: "notification.send", id: noticeId, title: "持ち物のお知らせ <共有>", body: "明日の準備をお願いします。", recipientIds: ["activity-0"] });
  for (const path of [`/Member/manage/events/${eventId}?saved=1`, "/Member/manage", "/Member/manage/notifications"]) {
    await page.goto(path);
    const trigger = page.locator("[data-activity-share-open]").first();
    await trigger.click();
    await expect(page.locator("#activity-share-url")).toHaveValue(new RegExp(`^https://scharade.jp/Member/(events|notifications)/[a-f0-9-]+$`));
    await page.getByRole("button", { name: "共有画面を閉じる" }).click();
  }
  await login(page.request, "activity-0");
  for (const path of ["/Member", "/Member?view=calendar&month=2027-04", `/Member/events/${eventId}?utm_source=test#vote`, `/Member/notifications/${noticeId}`]) {
    await page.goto(path);
    const trigger = page.locator("[data-activity-share-open]").first();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(trigger).toBeVisible();
      expect(await trigger.evaluate(el => {
        const row = el.parentElement!.getBoundingClientRect(), button = el.getBoundingClientRect(), title = el.previousElementSibling!.getBoundingClientRect();
        return Math.abs(row.right - button.right) < 1 && title.right <= button.left && button.top < title.bottom;
      })).toBe(true);
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.locator("#activity-share-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("img, canvas")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "共有画面を閉じる" })).toBeFocused();
      const expectedURL = await trigger.getAttribute("data-share-url");
      await page.getByRole("button", { name: "リンクをコピー", exact: true }).click();
      await expect(dialog.locator(".portfolio-share-status")).toHaveText("リンクをコピーしました。");
      expect(await page.evaluate(async native => native ? navigator.clipboard.readText() : (window as any).copiedLink, browserName === "chromium")).toBe(expectedURL);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(dialog).toHaveCSS("opacity", "1");
      if (path.includes("/events/") && width === 390) await page.screenshot({ path: info.outputPath("event-share-mobile.png") });
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    if (path.includes("/events/")) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: info.outputPath("event-title-desktop.png") });
    }
  }
  await page.locator("[data-activity-share-open]").click();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.locator("#activity-share-url").click();
  await expect(page.locator("#activity-share-dialog .portfolio-share-status")).toContainText("コピーできませんでした");
  await expect(page.locator("#activity-share-url")).toHaveValue(`https://scharade.jp/Member/notifications/${noticeId}`);
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined }); document.execCommand = () => false; });
  await page.getByRole("button", { name: "リンクをコピー", exact: true }).click();
  await expect(page.locator("#activity-share-dialog .portfolio-share-status")).toContainText("コピーできませんでした");
  const outsider = await browser.newContext({ baseURL: origin });
  try {
    await login(outsider.request, "activity-outsider");
    for (const path of [`/Member/events/${eventId}`, `/Member/notifications/${noticeId}`]) {
      const anonymous = await request.get(path, { maxRedirects: 0 });
      if (path.includes("/events/")) {
        expect(anonymous.status()).toBe(200);
        expect(await anonymous.text()).toContain("ログインして投票");
        expect((await outsider.request.get(path)).status()).toBe(200);
      } else {
        expect(anonymous.status()).toBe(302);
        expect(anonymous.headers().location).toBe(`/Login?next=${encodeURIComponent(path)}`);
        expect((await outsider.request.get(path)).status()).toBe(404);
      }
      const permitted = await page.request.get(path);
      expect(permitted.status()).toBe(200);
      expect(permitted.headers()["cache-control"]).toContain("no-store");
    }
  } finally { await outsider.close(); }
  expect(qr).toEqual([]);
  expect(errors).toEqual([]);
});
