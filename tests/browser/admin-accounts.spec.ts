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
    // The deliberate 404 below may report its error; it must not change any account data.
    if (request.method() !== "GET" && !request.url().endsWith("/api/error-reports")) writes.push(request.url());
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
  await expect(page.locator(".admin-account-row")).toHaveCount(Math.min(30, total - 30));
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
  await expect(page.getByRole("alert")).toContainText("SITE-006");
  expect(writes).toEqual([]);
});

test("account administrators set Portfolio offices in a fixed order and can clear them", async ({ page, browser }) => {
  const headers = { Origin: "http://127.0.0.1:4329" };
  const saveOffice = (id: string, office: string, previousOffice = "", portfolioId = id) =>
    page.request.post(`/api/admin/accounts/${id}/portfolio-office`, {
      headers,
      data: { portfolioId, office, previousOffice },
    });

  expect((await saveOffice("other", "会計")).status()).toBe(401);
  const executivePage = await browser.newPage({ baseURL: headers.Origin });
  try {
    await login(executivePage, "photo-executive-chromium");
    await executivePage.goto("/Admin/accounts?q=other%40example.invalid");
    await expect(executivePage.getByRole("link", { name: /Portfolioの役職を設定/ })).toHaveCount(0);
    await executivePage.goto("/Admin/accounts/other");
    await expect(executivePage.locator("#portfolio-office")).toHaveCount(0);
    const denied = await executivePage.request.post("/api/admin/accounts/other/portfolio-office", {
      headers,
      data: { portfolioId: "other", office: "幹事長", previousOffice: "" },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await executivePage.close();
  }

  await login(page);
  await page.goto("/Admin/accounts?q=other%40example.invalid");
  await expect(page.getByRole("link", { name: /Portfolioの役職を設定/ })).toHaveCount(0);
  await page.getByRole("link", { name: "別の会員の登録内容を確認" }).click();
  await expect(page).toHaveURL(/\/Admin\/accounts\/other$/);
  const form = page.locator("#portfolio-office-form");
  const select = form.getByLabel("掲載する役職");
  await expect(select.locator("option")).toHaveText(["設定なし", "幹事長", "副幹事長", "会計"]);
  await expect(select).toHaveValue("");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(select).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await saveOffice("other", "旧副幹事長")).status()).toBe(400);
  expect((await saveOffice("legacy", "会計")).status()).toBe(404);
  expect((await saveOffice("other", "会計", "", "member")).status()).toBe(409);
  try {
    await select.selectOption("会計");
    await form.getByRole("button", { name: "役職を保存" }).click();
    await expect(form.getByRole("status")).toHaveText("Portfolioの役職を保存しました。");
    expect((await saveOffice("other", "幹事長")).status()).toBe(409);
    expect((await saveOffice("other", "会計")).status()).toBe(200);
    expect((await saveOffice("admin", "副幹事長")).status()).toBe(200);
    expect((await saveOffice("member", "幹事長")).status()).toBe(200);

    await page.reload();
    await expect(select).toHaveValue("会計");
    await expect(page.locator(".admin-account-details")).toContainText("一般会員");
    await page.goto("/Portfolio/edit?id=other");
    await expect(page.locator("#field-name")).toBeVisible();
    await expect(page.locator("#field-generation, #field-role, #field-display-order, #field-executive")).toHaveCount(0);
    const legacy = await page.request.post("/api/portfolio/update", {
      headers,
      data: { portfolioId: "other", name: "別の会員", generation: 98, role: "幹事長", displayOrder: 0, isExecutive: true },
    });
    expect(legacy.status()).toBe(200);
    await page.goto("/Portfolio/other");
    await expect(page.locator(".profile-icon")).toBeVisible();
    await expect(page.getByText(/期生/)).toHaveCount(0);

    await page.goto("/Portfolio");
    const cards = page.locator(".executive-section .member-card");
    await expect(cards.locator(".member-grade")).toHaveText(["幹事長", "副幹事長", "会計"]);
    const all = page.locator('details[data-portfolio-grade="All"] .member-card');
    for (const [i, id] of ["member", "admin", "other"].entries()) {
      await expect(cards.nth(i)).toHaveAttribute("href", `/Portfolio/${id}`);
      await expect(all.nth(i)).toHaveAttribute("href", `/Portfolio/${id}`);
    }

    await page.goto("/Admin/accounts/other#portfolio-office");
    await select.selectOption("");
    await form.getByRole("button", { name: "役職を保存" }).click();
    await expect(form.getByRole("status")).toHaveText("Portfolioの役職を保存しました。");
    await page.goto("/Portfolio");
    await expect(cards.locator(".member-grade")).toHaveText(["幹事長", "副幹事長"]);
  } finally {
    await saveOffice("member", "", "幹事長");
    await saveOffice("admin", "", "副幹事長");
    await saveOffice("other", "", "会計");
  }
});
