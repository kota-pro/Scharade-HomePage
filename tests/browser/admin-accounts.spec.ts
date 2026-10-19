import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

async function login(page: Page, user = "admin") {
  const response = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:4329" },
    data: {
      email: `${user}@example.invalid`,
      password: "fixture-password-123",
    },
  });
  expect(response.status()).toBe(200);
}

test("account registration pages require administrator access", async ({
  page,
  request,
}) => {
  for (const url of [
    "/Admin/accounts",
    "/Admin/accounts/other",
    "/Admin/accounts/legacy",
  ]) {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toMatch(/^\/Login\?next=/);
    expect(await response.text()).not.toContain("other@example.invalid");
  }
  await login(page, "member");
  for (const url of [
    "/Admin/accounts",
    "/Admin/accounts/other",
    "/Admin/accounts/legacy",
  ]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(403);
    expect(await page.content()).not.toContain("other@example.invalid");
  }
  await page.goto("/Portfolio/edit");
  await expect(page.locator(".admin-portfolio-fields")).toHaveCount(0);
});

test("admin can search, page and inspect registration details without secret data or writes", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await login(page);
  // Another project may have legitimately edited this shared synthetic CMS row.
  expect((await page.request.post("/api/portfolio/update", { headers: { Origin: "http://127.0.0.1:4329" }, data: { portfolioId: "other", name: "別の会員" } })).status()).toBe(200);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/Admin");
  await expect(page.locator('a[href="/Admin/portfolios"]')).toHaveCount(0);
  await page.getByRole("link", { name: "アカウント一覧へ" }).click();
  const total = Number.parseInt(
    (await page
      .locator('.admin-section[aria-label="アカウントの検索と一覧"] > p')
      .first()
      .textContent())!,
  );
  await expect(page.locator(".admin-account-row")).toHaveCount(30);
  await expect(page.locator('.admin-account-pagination [aria-current="page"]')).toHaveText("1");
  await expect(page.getByRole("link", { name: "前へ", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("link", { name: "次へ", exact: true }).click();
  await expect(page.locator(".admin-account-row")).toHaveCount(total - 30);
  await expect(page.locator('.admin-account-pagination [aria-current="page"]')).toHaveText("2");
  await page.getByRole("link", { name: "1ページ目", exact: true }).click();
  await expect(page.locator(".admin-account-row")).toHaveCount(30);
  await page.locator("#account-query").fill("申請中の会員");
  await page.getByRole("button", { name: "検索する" }).click();
  await expect(page.locator(".admin-account-row")).toHaveCount(30);
  await page.getByRole("link", { name: "次へ", exact: true }).click();
  await expect(page.locator("#account-query")).toHaveValue("申請中の会員");
  await expect(page.locator(".admin-account-row")).toHaveCount(1);
  await page.goto("/Admin/accounts?q=OTHER%40EXAMPLE.INVALID&page=999");
  await expect(page.locator(".admin-account-row")).toHaveCount(1);
  const portfolioEdit = page.getByRole("link", { name: "別の会員のPortfolioを編集", exact: true });
  await expect(portfolioEdit).toHaveAttribute("href", "/Portfolio/edit?id=other");
  await portfolioEdit.click();
  await expect(page).toHaveURL(/\/Portfolio\/edit\?id=other$/);
  await expect(page.locator("#field-name")).toHaveValue("別の会員");
  await page.goBack();
  await page
    .getByRole("link", { name: "別の会員の登録内容を確認", exact: true })
    .click();
  await expect(page).toHaveURL(/\/Admin\/accounts\/other$/);
  await expect(page.locator(".admin-account-details")).toContainText(
    "登録時の別の会員",
  );
  await expect(page.locator(".admin-account-details")).toContainText(
    "@fixture_member",
  );
  await expect(page.locator(".admin-account-details")).toContainText(
    "2026/09/01 12:45",
  );
  await expect(
    page.locator('.admin-page a[href^="/Portfolio/"]'),
  ).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of [
      "/Admin/accounts",
      "/Admin/accounts/other",
      "/Admin/accounts/legacy",
      "/Admin/accounts/pending-1",
    ]) {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["cache-control"]).toBe("private, no-store");
      expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      const html = await response!.text();
      for (const secret of [
        "passwordHash",
        "authVersion",
        "private-instagram-id",
        "fixture-password-123",
      ])
        expect(html).not.toContain(secret);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${url} at ${width}`,
      ).toBe(true);
      if (url.endsWith("legacy")) {
        await expect(page.locator(".admin-account-details")).toContainText(
          "記録なし",
        );
        await expect(
          page.getByRole("link", { name: "Portfolioを見る", exact: true }),
        ).toHaveCount(0);
      }
      if (url.endsWith("pending-1"))
        await expect(page.locator(".admin-account-details")).toContainText(
          "未承認",
        );
      if (width === 390 && url.endsWith("other"))
        await page.screenshot({
          path: testInfo.outputPath("account-details-mobile.png"),
          fullPage: true,
        });
    }
  }
  await page.goto("/Admin/accounts?q=no-such-account");
  await expect(
    page.getByText("該当するアカウントはありません。"),
  ).toBeVisible();
  await page.goto("/Admin/accounts?q=legacy");
  await expect(page.locator('.admin-account-links a[href^="/Portfolio/edit"]')).toHaveCount(0);
  expect((await page.goto("/Admin/accounts/no-such-account"))?.status()).toBe(
    404,
  );
  await expect(page.getByRole("alert")).toContainText("見つかりませんでした");
  expect(writes).toEqual([]);
});

test("executive checkbox stays beside its label and persists using the existing save flow", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto("/Portfolio/edit?id=other");
  const checkbox = page.getByRole("checkbox", {
    name: "幹部として表示",
    exact: true,
  });
  const original = await checkbox.isChecked();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(checkbox).toBeVisible();
    const geometry = await checkbox.evaluate((input) => {
      const box = input.getBoundingClientRect();
      const text = document
        .querySelector(".admin-executive-option span")!
        .getBoundingClientRect();
      return {
        right: box.left >= text.right,
        aligned:
          Math.abs(box.top + box.height / 2 - text.top - text.height / 2) < 1,
        width: box.width,
        color: getComputedStyle(input).accentColor,
      };
    });
    expect(geometry).toEqual({
      right: true,
      aligned: true,
      width: 20,
      color: "rgb(0, 0, 0)",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.locator(".admin-executive-option span").click();
  expect(await checkbox.isChecked()).toBe(!original);
  await page
    .locator(".admin-portfolio-fields")
    .screenshot({ path: testInfo.outputPath("executive-fields.png") });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/Portfolio\/other$/);
  await page.goto("/Portfolio/edit?id=other");
  expect(await checkbox.isChecked()).toBe(!original);
  await checkbox.setChecked(original);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/Portfolio\/other$/);
});
