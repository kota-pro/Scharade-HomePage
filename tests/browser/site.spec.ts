import { fixtureLogin } from "./fixture-auth";
import { test, expect } from "@playwright/test";
import path from "node:path";
test("HTTPS reverse proxy preserves same-origin login and Secure cookies", async ({
  request,
}) => {
  const headers = {
    Host: "scharade.jp",
    "X-Forwarded-Proto": "https",
    Origin: "https://scharade.jp",
  };
  const response = await fixtureLogin(request, "/api/auth/login", {
    headers,
    data: { email: "admin@example.invalid", password: "fixture-password-123" },
  });
  expect(response.status()).toBe(200);
  const cookie = response.headers()["set-cookie"];
  expect(cookie).toMatch(/;\s*Secure/i);
  const rejected = await fixtureLogin(request, "/api/auth/login", {
    headers: { ...headers, Origin: "https://evil.invalid" },
    data: { email: "admin@example.invalid", password: "fixture-password-123" },
  });
  expect(rejected.status()).toBe(403);
  const logout = await request.post("/api/auth/logout", {
    headers: { ...headers, Cookie: cookie.split(";")[0] },
  });
  expect(logout.status()).toBe(200);
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io"))
      return route.fulfill({
        path: path.resolve("public/media/site/activity/Photo1-480.webp"),
        contentType: "image/webp",
      });
    return route.abort();
  });
});
async function login(page: any, account = "admin") {
  await page.goto("/Login");
  const response = await fixtureLogin(page.request, "/api/auth/login", {headers:{Origin:"http://127.0.0.1:4329"},data:{email:account+"@example.invalid",password:"fixture-password-123"}});
  expect(response.status()).toBe(200);
}
test("public pages: breadcrumbs and no horizontal overflow at 320, 390, 768, 1440, 1920", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/About_us",
      "/Activity",
      "/Gallery",
      "/Gallery/public-album",
      "/Portfolio",
      "/Portfolio/member",
      "/Contact",
      "/Login",
      "/Signup",
      "/ForgotPassword",
      "/ResetPassword",
      "/Disclaimer",
      "/SearchResult?q=撮影",
      "/sitemap",
      "/posts/test-post",
      "/404",
    ]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(route === "/404" ? 404 : 200);
      await expect(
        page.getByRole("navigation", { name: "パンくずリスト" }),
        route,
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      expect(overflow, route + " width " + width).toBe(false);
    }
  }
});
test("menu keyboard, welcome links, compact mobile greeting and logout", async ({
  page,
}) => {
  await login(page, "member");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const welcome = page.locator(".user-welcome");
  await expect(welcome).toHaveAttribute("href", "/Member");
  await expect(welcome).toContainText("さん、ようこそ。");
  await expect(welcome.locator(".welcome-short")).toBeVisible();
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(page.locator("#site-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#site-menu")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "メニューを開く" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.locator("#site-menu").getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator(".user-welcome")).toHaveCount(0);
});
test("member and anonymous access are separated, including private image URLs", async ({
  page,
  request,
}) => {
  await page.goto("/Gallery");
  await expect(
    page.getByText("非公開 会員の撮影会", { exact: false }),
  ).toHaveCount(0);
  expect((await request.get("/Gallery/private-album")).status()).toBe(404);
  expect((await request.get("/api/gallery/private-album")).status()).toBe(404);
  expect(
    (
      await request.post("/api/admin/content/home", {
        headers: { Origin: "http://127.0.0.1:4329" },
        data: { action: "publish", revision: 0 },
      })
    ).status(),
  ).toBe(401);
  await login(page, "member");
  await page.goto("/Gallery/private-album");
  await expect(page.locator(".justified-grid a")).toHaveCount(35);
  const photo = await page
    .locator(".justified-grid img")
    .first()
    .getAttribute("src");
  expect((await request.get(photo!)).status()).toBe(404);
  await expect(page.locator(".justified-grid a")).toHaveCount(35);
  await page.locator(".justified-grid a").first().click();
  await expect(page.locator("#lightbox")).toBeVisible();
  await expect(page.locator(".lb-image")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".lb-number")).toHaveText("Image 2 of 35");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).not.toBeVisible();
  expect((await page.goto("/Admin"))?.status()).toBe(403);
});
test("admin edits drafts, previews, publishes, restores and reaches every Portfolio", async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto("/Admin");
  await expect(page.locator(".user-welcome")).toHaveAttribute(
    "href",
    "/Member",
  );
  await page.goto("/Admin/content/home");
  await page
    .getByLabel("キャッチコピー", { exact: true })
    .fill("管理画面の下書き試験");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.locator("#editor-status")).toContainText(
    "下書きを保存しました",
  );
  await page.goto("/?preview=draft&editor=home");
  await expect(page.locator(".preview-banner")).toBeVisible();
  await expect(
    page.getByText("管理画面の下書き試験", { exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/?preview=draft")).text()).not.toContain(
    "管理画面の下書き試験",
  );
  const publish = async (action: string) =>
    page.evaluate(async (action) => {
      const raw = await (await fetch("/api/admin/content/home")).json();
      const doc = raw.document ?? raw;
      return (
        await fetch("/api/admin/content/home", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, revision: doc.revision }),
        })
      ).status;
    }, action);
  expect(await publish("publish")).toBe(200);
  expect(await (await request.get("/")).text()).toContain(
    "管理画面の下書き試験",
  );
  expect(await publish("restore")).toBe(200);
  await page.goto("/Portfolio/edit?id=other");
  await expect(page.getByLabel("期", { exact: true })).toBeVisible();
  await page.getByLabel("期", { exact: true }).fill("53");
  await page.locator("#field-name").fill("管理者が更新した会員");
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/portfolio/update") && r.method() === "POST")
      writes++;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/Portfolio\/other$/);
  await expect(page.locator(".user-name")).toHaveText("管理者が更新した会員");
  expect(writes).toBe(1);
});
test("contact confirmation is keyboard accessible and validates without sending real mail", async ({
  page,
}) => {
  await page.goto("/Contact");
  for (const [key, value] of Object.entries({
    name: "テスト",
    furigana: "テスト",
    institution: "テスト大学",
    faculty: "学部",
    email: "test@example.invalid",
    message: "見学希望",
  }))
    await page.locator(`[name="${key}"]`).fill(value);
  await page.locator("[name=grade][value=\"1年\"]").check();
  await page.getByLabel("見学・体験希望", { exact: true }).check();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator("#contact-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#contact-preview")).not.toBeVisible();
});

test("visual evidence and breadcrumb typography", async ({
  page,
}, testInfo) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/About_us", "/Contact"]) {
      await page.goto(route);
      if (route === "/") {
        const positions = await page.evaluate(() => ({
          steps: document.querySelector(".how-to-join")!.getBoundingClientRect()
            .bottom,
          footer: document.querySelector("footer")!.getBoundingClientRect().top,
          last: document
            .querySelector(".how-to-join>div:last-child")!
            .getBoundingClientRect().bottom,
        }));
        expect(positions.last).toBeLessThan(positions.footer);
        expect(positions.steps).toBeLessThan(positions.footer);
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `${route.replaceAll("/", "") || "home"}-${width}.png`,
        ),
        fullPage: true,
      });
      const typography = await page.locator(".breadcrumbs").evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          family: s.fontFamily,
          size: parseFloat(s.fontSize),
          color: s.color,
          weight: s.fontWeight,
          style: s.fontStyle,
        };
      });
      expect(typography.family).toContain("Zen Kurenaido");
      expect(typography.size).toBeGreaterThanOrEqual(12);
      expect(typography.size).toBeLessThanOrEqual(14);
      expect(typography.color).toBe("rgb(144, 144, 144)");
      expect(typography.weight).toBe("400");
      expect(typography.style).toBe("normal");
    }
  }
});
