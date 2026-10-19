import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const response = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:4329" },
    data: { email: "admin@example.invalid", password: "fixture-password-123" },
  });
  expect(response.status()).toBe(200);
});

async function jump(page: Page, href: string) {
  await page.locator(`#editor-toc a[href="${href}"]`).click();
  await expect(page.locator(href)).toBeFocused();
  await expect.poll(() => page.locator(href).evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const headerBottom = document.querySelector("#header")!.getBoundingClientRect().bottom;
    return rect.top >= headerBottom && rect.top < window.innerHeight - 40;
  })).toBe(true);
}

test("editor contents navigate all seven pages below the fixed header on mobile and desktop", async ({ page }) => {
  test.setTimeout(90000);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const key of ["common", "home", "about", "gallery", "portfolio", "contact", "disclaimer"]) {
      expect((await page.goto(`/Admin/content/${key}`))?.status()).toBe(200);
      await expect(page.getByRole("navigation", { name: "目次", exact: true })).toBeVisible();
      await expect(page.locator(".admin-intro > h2 + #editor-toc")).toHaveCount(1);
      expect(await page.locator("#editor-toc a").evaluateAll((links) =>
        links.every((link) => {
          const href = link.getAttribute("href")!;
          return href.startsWith("#") && document.querySelectorAll(href).length === 1;
        }),
      )).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const sections = page.locator("#editor-toc-list > li > a");
      await jump(page, (await sections.nth(await sections.count() - 2).getAttribute("href"))!);
      await jump(page, "#editor-actions");
      if (key === "about") {
        const equipment = page.locator('#editor-toc details[data-section="equipment"]');
        await equipment.locator("summary").click();
        await jump(page, (await equipment.locator("a").last().getAttribute("href"))!);
      }
    }
  }
  expect(posts).toEqual([]);
});

test("editor contents follow renamed, reordered, added and deleted items and remain valid after saving", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Admin/content/home");
  const details = page.locator('#editor-toc details[data-section="activities"]');
  const group = page.locator("#editor-section-activities");
  const cards = group.locator(":scope > div > .admin-list-item");
  const count = await cards.count();
  const originalTitle = await cards.first().getByLabel("見出し", { exact: true }).inputValue();
  await details.locator("summary").click();
  await cards.first().getByLabel("見出し", { exact: true }).fill("目次の変更確認");
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator("a").first()).toHaveText("1. 目次の変更確認");
  await cards.first().getByRole("button", { name: "下へ", exact: true }).click();
  await expect(details.locator("a").nth(1)).toHaveText("2. 目次の変更確認");
  await jump(page, "#editor-section-activities-2");
  await expect(cards.nth(1).getByLabel("見出し", { exact: true })).toHaveValue("目次の変更確認");
  await cards.nth(1).getByRole("button", { name: "上へ", exact: true }).click();
  await cards.first().getByLabel("見出し", { exact: true }).fill(originalTitle);

  await group.getByRole("button", { name: "活動紹介カードを追加", exact: true }).click();
  await expect(details.locator("a")).toHaveCount(count + 1);
  await jump(page, `#editor-section-activities-${count + 1}`);
  page.once("dialog", (dialog) => dialog.accept());
  await cards.last().getByRole("button", { name: "この項目を削除", exact: true }).click();
  await expect(details.locator("a")).toHaveCount(count);
  await expect(details.locator("summary")).toHaveText(`各項目（${count}件）`);
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.locator("#editor-status")).toContainText("下書きを保存しました");
  await expect(details).toHaveAttribute("open", "");
  await jump(page, "#editor-section-activities-1");
  await expect(cards.first().getByLabel("見出し", { exact: true })).toHaveValue(originalTitle);
});
