import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
import { test, expect, type APIRequestContext } from "@playwright/test";
const origin = "http://127.0.0.1:4329";
async function login(request: APIRequestContext, account: string) {
  expect(
    (
      await fixtureLogin(request, "/api/auth/login", {
        headers: { Origin: origin },
        data: {
          email: `${account}@example.invalid`,
          password: "fixture-password-123",
        },
      })
    ).status(),
  ).toBe(200);
}
test("account roster details use confirmed links and remain administrator-only", async ({
  page,
  browser,
  request,
}, info) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const target = "/Admin/accounts/activity-0";
  expect((await request.get(target, { maxRedirects: 0 })).status()).toBe(302);
  await login(page.request, "admin");
  await restoreFixtureRoster(page.request);
  const command = async (action: string, extra = {}) => {
    await page.goto("/Admin/grouping-roster");
    const revision = Number(
      await page
        .locator('form[data-activity-action="roster.sync"]')
        .getAttribute("data-revision"),
    );
    const response = await page.request.post("/api/member/activities", {
      headers: { Origin: origin },
      data: { action, revision, ...extra },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  await command("roster.sync");
  await command("roster.link", {
    bindings: { "activity-0": "", "activity-1": "" },
  });
  await page.goto(target);
  await expect(page.locator(".admin-account-roster-status")).toContainText(
    "未連携",
  );
  await expect(page.locator(".admin-account-roster-field")).toHaveCount(0);
  await page.goto("/Admin/grouping-roster");
  // The matching name is only a suggestion until explicitly saved.
  const key = await page
    .locator('[data-roster-user="activity-0"]')
    .inputValue();
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  await command("roster.link", { bindings: { "activity-0": key } });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  await page.goto("/Admin/accounts?q=activity-0");
  await page
    .getByRole("link", {
      name: "撮影会員 activity-0の登録内容を確認",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(target + "$"));
  const fields = page.locator(".admin-account-roster-field");
  await expect(fields.locator("dd")).toHaveText([
    "撮影会員 activity-0",
    "line0",
    "テスト大学",
    "女性",
    "1年生",
    "継続する",
  ]);
  await expect(
    page
      .locator(".admin-account-roster-status")
      .locator("xpath=preceding-sibling::div[1]")
      .locator("dt"),
  ).toHaveText("アカウントID");
  expect(await page.content()).not.toContain(key);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(target);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width === 390)
      await page.screenshot({
        path: info.outputPath("account-roster-mobile.png"),
        fullPage: true,
      });
  }
  await page.goto("/Admin/accounts/activity-1");
  await expect(page.locator(".admin-account-roster-status")).toContainText(
    "未連携",
  );
  await expect(fields).toHaveCount(0);
  expect(writes).toEqual([]);
  for (const role of ["planner", "other"]) {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await login(context.request, role);
      const response = await context.request.get(target);
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain("line0");
    } finally {
      await context.close();
    }
  }
});
