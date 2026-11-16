import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };

test("all exhibition entries share their destination from the list and calendar on desktop and mobile", async ({ page, context, browserName, request }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedLink = text; } } }));
  const login = async (id: string) => expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" } })).status()).toBe(200);
  await login("planner");
  const command = async (data: Record<string, unknown>) => {
    const response = await page.request.post("/api/member/exhibitions", { headers, data });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).exhibition;
  };
  const title = `長い写真展タイトルも企画欄からリンクでシェア ${info.project.name}`;
  let exhibition = await command({ action: "create", title, openingSchedule: { startDate: "2027-04-02", endDate: "2027-04-02", regular: { open: "10:00", close: "17:00" } } });
  const startsAt = "2027-04-01T00:00:00+09:00", endsAt = "2027-04-03T23:59:00+09:00";
  exhibition = await command({ action: "settings", exhibitionId: exhibition.id, revision: exhibition.revision, title, status: "open", gallery: "staff", voteOpensAt: startsAt, voteClosesAt: endsAt, opensAt: startsAt, closesAt: endsAt, recipientIds: ["member"] });
  await command({ action: "participation.publish", exhibitionId: exhibition.id, revision: exhibition.revision });
  await expect.poll(async () => (await (await page.request.get(`/api/member/exhibitions/${exhibition.id}`)).json()).exhibition.participation.state).toBe("published");
  const shift = await (await page.request.get(`/api/member/exhibitions/${exhibition.id}/shifts`)).json();
  const response = await page.request.post(`/api/member/exhibitions/${exhibition.id}/shifts`, { headers, data: { action: "settings", revision: shift.record.revision, config: { state: "open", opensAt: startsAt, closesAt: endsAt, rules: { together: [], apart: [] } } } });
  expect(response.status(), await response.text()).toBe(200);
  await login("member");
  for (const view of ["list", "calendar"]) {
    await page.goto(`/Member?view=${view}&month=2027-04&notices=2`);
    const section = page.getByRole("region", { name: "企画", exact: true });
    const buttons = section.locator("[data-activity-share-open]").filter({ has: page.locator("svg") });
    const targets = buttons.and(page.locator(`[data-share-title$="${title}"]`));
    await expect(targets).toHaveCount(3);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (let i = 0; i < 3; i++) {
        const trigger = targets.nth(i);
        const href = await trigger.locator("..").locator("a").getAttribute("href");
        const expectedURL = `https://scharade.jp${href}`;
        expect(href).toMatch(new RegExp(`^/Member/exhibitions/${exhibition.id}(/shifts)?$`));
        await expect(trigger).toHaveAttribute("data-share-url", expectedURL);
        await trigger.click();
        const dialog = page.locator("#activity-share-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("#activity-share-url")).toHaveValue(expectedURL);
        await expect(dialog.locator("#activity-share-help")).toContainText("ログインが必要");
        await expect(dialog.locator("img, canvas")).toHaveCount(0);
        await dialog.getByRole("button", { name: "リンクをコピー", exact: true }).click();
        await expect(dialog.locator(".portfolio-share-status")).toHaveText("リンクをコピーしました。");
        expect(await page.evaluate(async native => native ? navigator.clipboard.readText() : (window as any).copiedLink, browserName === "chromium")).toBe(expectedURL);
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        expect(await trigger.evaluate(el => {
          const row = el.parentElement!.getBoundingClientRect(), button = el.getBoundingClientRect(), title = el.previousElementSibling!.getBoundingClientRect();
          return Math.abs(row.right - button.right) < 1 && title.right <= button.left;
        })).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 390) await targets.first().locator("..").screenshot({ path: info.outputPath(`${view}-share-mobile.png`) });
    }
  }
  for (const path of [`/Member/exhibitions/${exhibition.id}`, `/Member/exhibitions/${exhibition.id}/shifts`]) {
    const anonymous = await request.get(path, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(302);
    expect(anonymous.headers().location).toBe(`/Login?next=${encodeURIComponent(path)}`);
    expect((await page.request.get(path)).status()).toBe(200);
  }
  expect(errors).toEqual([]);
});
