import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
const fixtureImage = "public/media/site/activity/Photo1-480.webp";
async function saveDraft(page: Page) {
  const loaded = page.waitForEvent("domcontentloaded");
  await page
    .getByRole("button", { name: "下書きを保存して確認", exact: true })
    .click();
  await loaded;
  await expect(page.getByRole("dialog", { name: "Confirm" })).toBeVisible();
}

test("event confirmation saves a draft, supports editing, images and links, and publishes only the reviewed content", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "images.microcms-assets.io")
      return route.fulfill({ path: fixtureImage, contentType: "image/webp" });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  const member = await browser.newContext({ baseURL: origin });
  try {
    for (const [request, user] of [
      [page.request, "planner"],
      [member.request, "activity-0"],
    ] as const) {
      expect(
        (
          await fixtureLogin(request, "/api/auth/login", {
            headers,
            data: {
              email: `${user}@example.invalid`,
              password: "fixture-password-123",
            },
          })
        ).status(),
      ).toBe(200);
    }
    const notices = async () =>
      (await (await member.request.get("/api/member/activities")).json()).total;
    const initialNotices = await notices();
    expect(
      (
        await member.request.post("/api/member/event-image/upload", {
          headers,
          multipart: {
            file: {
              name: "x.webp",
              mimeType: "image/webp",
              buffer: Buffer.from("invalid"),
            },
          },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/member/event-image/upload", {
          headers,
          multipart: {
            file: {
              name: "x.webp",
              mimeType: "image/webp",
              buffer: Buffer.from("invalid"),
            },
          },
        })
      ).status(),
    ).toBe(400);
    await page.goto("/Member/manage/events/new");
    await page
      .getByLabel("企画名", { exact: true })
      .fill(`画像付き企画 ${info.project.name}`);
    const description =
      "案内 https://example.com/details?q=1&b=2。\n<img src=x onerror=alert(1)> javascript:alert(1)";
    await page.getByLabel("企画内容", { exact: true }).fill(description);
    const date = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("開始日時（日本時間）").fill(`${date(8)}T09:00`);
    await page.getByLabel("終了日時（日本時間）").fill(`${date(8)}T18:00`);
    await page.getByLabel("参加投票期日（日本時間）").fill(`${date(3)}T21:00`);
    await page
      .getByLabel("集合場所", { exact: true })
      .fill("駅前 https://maps.example/place_(park)");
    await page
      .getByLabel("行程", { exact: true })
      .fill("行程 https://example.com/plan");
    await page.getByRole("button", { name: "全解除", exact: true }).click();
    await page.locator('[name="recipientIds"][value="activity-0"]').check();
    const upload = page.waitForResponse("**/api/member/event-image/upload");
    await page
      .getByLabel("画像を選択", { exact: true })
      .setInputFiles(fixtureImage);
    expect((await upload).status()).toBe(200);
    await expect(page.locator("[data-image-status]")).toContainText(
      "画像を選択しました",
    );
    await saveDraft(page);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const dialog = page.getByRole("dialog", { name: "Confirm" });
    await expect(
      dialog.locator('[data-preview-value="description"]'),
    ).toHaveText(description);
    await expect(
      dialog.locator('a[href="https://example.com/details?q=1&b=2"]'),
    ).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      await dialog
        .locator('[data-preview-value] img, a[href^="javascript:"]')
        .count(),
    ).toBe(0);
    await expect(dialog.locator(".activity-eyecatch img")).toBeVisible();
    expect(
      await dialog
        .locator(".activity-eyecatch")
        .evaluate((el) => getComputedStyle(el, "::after").backgroundImage),
    ).toContain("/images/tapes/");
    expect(await notices()).toBe(initialNotices);
    expect((await member.request.get(`/Member/events/${id}`)).status()).toBe(
      404,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[name="headerImage"]')).toHaveValue(
      /microcms-assets/,
    );
    // An upload failure retains the previous selected image and the draft text.
    await page.route("**/api/member/event-image/upload", (route) =>
      route.fulfill({
        status: 502,
        json: { ok: false, message: "画像の保存に失敗しました" },
      }),
    );
    await page
      .getByLabel("画像を選択", { exact: true })
      .setInputFiles(fixtureImage);
    await expect(page.locator("[data-image-status]")).toHaveText(
      "画像の保存に失敗しました",
    );
    await expect(page.locator('[name="headerImage"]')).toHaveValue(
      /microcms-assets/,
    );
    await page.unroute("**/api/member/event-image/upload");
    await saveDraft(page);
    await dialog.locator('[data-preview-value="meeting"]').focus();
    await page.keyboard.press("Enter");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel("集合場所", { exact: true })).toBeFocused();
    await page
      .getByLabel("集合場所", { exact: true })
      .fill("変更した駅 https://maps.example/new");
    await saveDraft(page);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await dialog
        .getByRole("button", { name: "企画を公開して通知" })
        .scrollIntoViewIfNeeded();
      await dialog.evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect
        .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity))
        .toBe("1");
      await page.screenshot({ path: info.outputPath(`confirm-${width}.png`) });
    }
    // Focus cannot escape to the underlying form; retry stays in the dialog.
    await dialog.getByRole("button", { name: "戻って編集" }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.route("**/api/member/activities", (route) =>
      route.request().postDataJSON()?.action === "event.publish"
        ? route.fulfill({
            status: 409,
            json: { ok: false, message: "ほかの操作で更新されています。" },
          })
        : route.continue(),
    );
    await dialog.getByRole("button", { name: "企画を公開して通知" }).click();
    await expect(dialog.locator("[data-status]")).toContainText(
      "ほかの操作で更新",
    );
    await expect(dialog).toBeVisible();
    expect(await notices()).toBe(initialNotices);
    await page.unroute("**/api/member/activities");
    const publish = page.waitForEvent("domcontentloaded");
    await dialog.getByRole("button", { name: "企画を公開して通知" }).click();
    await publish;
    expect(await notices()).toBe(initialNotices + 1);
    await expect(dialog).not.toBeVisible();
    await page.goto(`/Member/events/${id}`);
    await expect(page.locator(".activity-eyecatch img")).toBeVisible();
    await expect(
      page.locator('.activity-details a[href="https://maps.example/new"]'),
    ).toHaveText("https://maps.example/new");
    await page.screenshot({
      path: info.outputPath("event-mobile.png"),
      fullPage: true,
    });
    await page.goto(`/Member/manage/events/${id}`);
    await page.getByText("企画の詳細を編集", { exact: true }).click();
    await page.getByLabel("企画名", { exact: true }).fill("変更後のタイトル");
    await page.getByRole("button", { name: "画像を外す", exact: true }).click();
    await page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    await expect(dialog.locator('[data-preview-value="title"]')).toHaveText(
      "変更後のタイトル",
    );
    await expect(dialog.getByText("画像なし", { exact: true })).toBeVisible();
    expect(await notices()).toBe(initialNotices + 1);
    const update = page.waitForEvent("domcontentloaded");
    await dialog
      .getByRole("button", { name: "変更を公開して通知", exact: true })
      .click();
    await update;
    const final = await (
      await member.request.get(`/api/member/activities?eventId=${id}`)
    ).json();
    expect(final.event.title).toBe("変更後のタイトル");
    expect(final.event.headerImage).toBe("");
    expect(await notices()).toBe(initialNotices + 2);
    expect(errors).toEqual([]);
  } finally {
    await member.close();
  }
});
