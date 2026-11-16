import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(request: APIRequestContext, user: string) {
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
async function command(
  request: APIRequestContext,
  data: Record<string, unknown>,
) {
  const response = await request.post("/api/member/activities", {
    headers,
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function submit(page: Page, action: string, button: string) {
  const form = page.locator(`form[data-activity-action="${action}"]`);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/member/activities") &&
      r.request().postDataJSON()?.action === action,
  );
  // A same-URL save emits a history event before the actual reload.
  const navigation = page.waitForEvent("domcontentloaded");
  await form.getByRole("button", { name: button, exact: true }).click();
  expect((await response).status()).toBe(200);
  await navigation;
  await page.waitForLoadState("domcontentloaded");
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

test("staff publishes an event, members vote, staff generates and edits groups, and participants receive the final plan", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const member = await browser.newContext({ baseURL: origin });
  const outsider = await browser.newContext({ baseURL: origin });
  const admin = await browser.newContext({ baseURL: origin });
  const adminPage = await admin.newPage();
  await adminPage.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const memberPage = await member.newPage();
  memberPage.setDefaultTimeout(10000);
  await memberPage.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  try {
    await login(admin.request, "admin");
    await restoreFixtureRoster(admin.request);
    await adminPage.goto("/Admin/grouping-roster");
    await submit(adminPage, "roster.sync", "Google名簿から更新");
    await submit(adminPage, "roster.link", "対応を確認して連携を保存");
    await login(page.request, "planner");
    await login(member.request, "activity-0");
    await login(outsider.request, "activity-outsider");
    expect(
      (await page.request.get("/Admin", { maxRedirects: 0 })).status(),
    ).toBe(403);
    expect(
      (
        await member.request.get("/Member/manage", { maxRedirects: 0 })
      ).status(),
    ).toBe(403);
    expect(
      (
        await member.request.post("/api/member/activities", {
          headers,
          data: { action: "notification.send" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/member/activities", {
          data: { action: "notification.send" },
        })
      ).status(),
    ).toBe(403);
    await page.goto("/Member/manage/events/new");
    const title = `秋の撮影合宿 ${info.project.name}`;
    await page.getByLabel("企画名", { exact: true }).fill(title);
    await page
      .getByLabel("企画内容", { exact: true })
      .fill("紅葉を撮影します。<img src=x onerror=alert(1)>");
    const start = new Date(Date.now() + 7 * 86400000 + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.now() + 8 * 86400000 + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const deadline = new Date(Date.now() + 3 * 86400000 + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("開始日時（日本時間）").fill(`${start}T09:00`);
    await page.getByLabel("終了日時（日本時間）").fill(`${end}T18:00`);
    await page.getByLabel("参加投票期日（日本時間）").fill(`${deadline}T21:00`);
    await page.getByLabel("集合場所", { exact: true }).fill("駅の東口");
    await page
      .getByLabel("行程", { exact: true })
      .fill("集合 → 撮影 → 宿泊 → 解散");
    await page.getByLabel("徴収費", { exact: true }).fill("1,000円");
    await page.getByLabel("企画のテーマ").fill("秋の光");
    await page.getByRole("button", { name: "全解除" }).click();
    for (let i = 0; i < 8; i++)
      await page
        .locator(`input[name="recipientIds"][value="activity-${i}"]`)
        .check();
    await page
      .getByRole("button", { name: "下書きを保存して確認", exact: true })
      .click();
    await expect(page).toHaveURL(
      /\/Member\/manage\/events\/[a-f0-9-]+\?saved=1/,
    );
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await submit(page, "event.publish", "企画を公開して通知");
    expect((await outsider.request.get(`/Member/events/${id}`)).status()).toBe(
      200,
    );
    expect((await outsider.request.post("/api/member/activities", { headers, data: { action: "vote", eventId: id, vote: "attending" } })).status()).toBe(403);
    await memberPage.goto("/Member");
    const notice = memberPage.getByRole("link", {
      name: `未読 企画のご案内：${title}`,
    });
    await notice.click();
    await expect(
      memberPage.getByRole("heading", { name: `企画のご案内：${title}` }),
    ).toBeVisible();
    await memberPage.getByRole("link", { name: "企画の詳細を見る" }).click();
    await expect(memberPage.locator(".activity-details")).toContainText(
      "秋の光",
    );
    expect(await memberPage.locator(".activity-details img").count()).toBe(0);
    await memberPage
      .getByLabel("回答", { exact: true })
      .selectOption("attending");
    await submit(memberPage, "vote", "投票する");
    await expect(memberPage.locator(".activity-counts")).toContainText(
      "参加：1人",
    );
    await memberPage.goto("/Member/profile");
    await expect(memberPage.locator(".activity-details")).toContainText("女性");
    expect(await memberPage.locator("select").count()).toBe(0);
    await page.goto("/Admin/grouping-roster");
    expect(await page.locator("form[data-activity-action]").count()).toBe(0);
    await page.goto(`/Member/manage/events/${id}`);
    for (let i = 1; i < 8; i++) {
      const form = page.locator(
        `form[data-activity-action="attendance.set"][data-user-id="activity-${i}"]`,
      );
      await form.locator("select").selectOption("attending");
      const response = page.waitForResponse("**/api/member/activities");
      const revision = await form.getAttribute("data-revision");
      await form.getByRole("button", { name: "回答を修正" }).click();
      expect((await response).status()).toBe(200);
      await expect(form).not.toHaveAttribute("data-revision", revision!);
    }
    await page.getByText("企画の詳細を編集", { exact: true }).click();
    const past = new Date(Date.now() - 3600000 + 9 * 3600000)
      .toISOString()
      .slice(0, 16);
    await page.getByLabel("参加投票期日（日本時間）").fill(past);
    await page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    const savedChange = page.waitForEvent("domcontentloaded");
    await page
      .getByRole("button", { name: "変更を公開して通知", exact: true })
      .click();
    await savedChange;
    await expect(
      page.getByRole("heading", { name: "班分け（参加 8人）" }),
    ).toBeVisible();
    const rules = page.locator('form[data-activity-action="groups.rules"]');
    await rules.getByLabel("班の数", { exact: true }).fill("2");
    await rules.getByLabel("班の数", { exact: true }).blur();
    await rules
      .getByLabel("1班のリーダー", { exact: true })
      .selectOption("activity-0");
    await rules
      .getByLabel("2班のリーダー", { exact: true })
      .selectOption("activity-4");
    await rules.locator('[data-pairs="together"] [data-add-pair]').click();
    await rules
      .locator('[data-pairs="together"] select')
      .nth(0)
      .selectOption("activity-0");
    await rules
      .locator('[data-pairs="together"] select')
      .nth(1)
      .selectOption("activity-1");
    await submit(page, "groups.rules", "条件を保存");
    await submit(page, "groups.generate", "班を自動生成");
    const groupForm = page.locator('form[data-activity-action="groups.save"]');
    await expect(groupForm.locator("[data-group-summary]")).toContainText(
      "必須条件を満たしています",
    );
    await page
      .locator("#grouping")
      .screenshot({ path: info.outputPath("group-editor-desktop.png") });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath("groups-mobile.png"),
      fullPage: true,
    });
    await groupForm.locator('[data-person-id="activity-1"]').click();
    await groupForm.locator('[data-move-to="1"]').click();
    await expect(groupForm.locator("[data-group-summary]")).toContainText(
      "要修正",
    );
    const repairWarnings = groupForm.locator("[data-group-errors]");
    await expect(repairWarnings).toBeVisible();
    await expect(repairWarnings).toHaveCSS("color", "rgb(253, 239, 242)");
    await expect(repairWarnings.locator(":scope > svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    await expect(
      repairWarnings.locator("[data-group-error-list]"),
    ).toContainText("1年生が1人");
    await repairWarnings.screenshot({
      path: info.outputPath("group-repair-warning.png"),
    });

    await submit(page, "groups.save", "班案を保存・再確認");
    await expect(
      page.getByRole("button", { name: "班を確定・公開", exact: true }),
    ).toBeDisabled();
    await groupForm.locator('[data-person-id="activity-1"]').click();
    await groupForm.locator('[data-move-to="0"]').click();
    await expect(repairWarnings).toBeHidden();
    await expect(groupForm.locator("[data-group-valid]")).toBeVisible();
    await submit(page, "groups.save", "班案を保存・再確認");
    const beforeSwap = await groupForm
      .locator('[data-assignment="activity-2"]')
      .inputValue();
    let swapTarget = "";
    for (const id of ["activity-3", "activity-6", "activity-7"]) {
      if (
        (await groupForm.locator(`[data-assignment="${id}"]`).inputValue()) !==
        beforeSwap
      ) {
        swapTarget = id;
        break;
      }
    }
    expect(swapTarget).not.toBe("");
    await groupForm.locator('[data-person-id="activity-2"]').click();
    await groupForm.locator(`[data-person-id="${swapTarget}"]`).click();
    await expect(
      groupForm.locator('[data-assignment="activity-2"]'),
    ).not.toHaveValue(beforeSwap);
    await submit(page, "groups.save", "班案を保存・再確認");
    await submit(page, "groups.publish", "班を確定・公開");
    await memberPage.goto(`/Member/events/${id}`);
    await expect(
      memberPage.getByRole("heading", { name: "公開された班分け" }),
    ).toBeVisible();
    await expect(memberPage.locator(".activity-group")).toHaveCount(2);
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage
      .locator(".activity-group-grid")
      .screenshot({ path: info.outputPath("published-groups-mobile.png") });
    const html = await memberPage.content();
    for (const privateField of [
      "data-people",
      "data-rules",
      "女性",
      "同じ班にする",
      "passwordHash",
    ])
      expect(html).not.toContain(privateField);
    expect(
      (
        await member.request.post("/api/member/activities", {
          headers,
          data: { action: "vote", eventId: id, vote: "absent" },
        })
      ).status(),
    ).toBe(409);
    await memberPage.goto(`/Member?view=calendar&month=${start.slice(0, 7)}`);
    await expect(memberPage.getByRole("table")).toBeVisible();
    await expect(memberPage.locator(".activity-month-events")).toContainText(
      title,
    );
    const bars = memberPage.locator(".activity-calendar a").filter({ hasText: title });
    const crossesMonday = new Date(`${start}T00:00:00Z`).getUTCDay() === 0 && start.slice(0, 7) === end.slice(0, 7);
    await expect(bars).toHaveCount(crossesMonday ? 2 : 1);
    await expect(bars.first()).toHaveAttribute("data-calendar-start", String(Number(start.slice(-2))));
    for (const width of [1440, 390, 320]) {
      await memberPage.setViewportSize({ width, height: 900 });
      expect(
        await memberPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await memberPage.screenshot({
      path: info.outputPath("calendar-mobile.png"),
      fullPage: true,
    });
    const calendarLinkHeight = await memberPage
      .locator(".activity-calendar a")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(calendarLinkHeight).toBeLessThanOrEqual(48);
    await memberPage
      .locator(".activity-calendar")
      .screenshot({ path: info.outputPath("calendar-grid-mobile.png") });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([
      admin.close().catch(() => {}),
      member.close().catch(() => {}),
      outsider.close().catch(() => {}),
    ]);
  }
});

test("ordinary notices can target one member and cannot be read by others", async ({
  page,
  browser,
}, info) => {
  await login(page.request, "planner");
  const member = await browser.newContext({ baseURL: origin });
  const outsider = await browser.newContext({ baseURL: origin });
  try {
    await login(member.request, "activity-0");
    await login(outsider.request, "activity-outsider");
    await page.goto("/Member/manage/notifications");
    await page
      .getByLabel("件名", { exact: true })
      .fill(`個別連絡 ${info.project.name}`);
    const message = "持ち物を確認してください。";
    const editor = page.getByRole("textbox", { name: "本文", exact: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await editor.fill(message);
    await editor.press("ControlOrMeta+A");
    await page.getByLabel("文字サイズ", { exact: true }).selectOption("5");
    await editor.press("ControlOrMeta+A");
    await page.getByLabel("文字色", { exact: true }).evaluate((input: HTMLInputElement) => {
      input.value = "#c42b48";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const toolbar = page.getByRole("group", { name: "本文の文字装飾" });
    for (const name of ["下線", "太字", "斜体"]) {
      await editor.press("ControlOrMeta+A");
      await toolbar.getByRole("button", { name, exact: true }).click();
    }
    const selectLinkText = () => editor.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent!.indexOf("確認");
        if (start < 0) continue;
        (el as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 2);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error("確認の文字がありません");
    });
    for (const path of ["original", "updated"]) {
      await selectLinkText();
      await toolbar.getByRole("button", { name: "リンク", exact: true }).click();
      await page.getByLabel("URL", { exact: true }).fill(`https://example.com/${path}`);
      await page.getByRole("button", { name: "設定する", exact: true }).click();
      const link = editor.getByRole("link", { name: "確認", exact: true });
      await expect(link).toHaveAttribute("href", `https://example.com/${path}`);
      await expect(editor.getByText("確認", { exact: true })).toHaveCSS("font-weight", "700");
      await expect(editor.getByText("確認", { exact: true })).toHaveCSS("font-size", "24px");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "全解除" }).click();
    await page
      .locator('input[name="recipientIds"][value="activity-0"]')
      .check();
    const id = await page
      .locator('form[data-activity-action="notification.send"]')
      .getAttribute("data-id");
    await submit(page, "notification.send", "お知らせを送信");
    const sent = page.locator(`[data-sent-notice="${id}"]`);
    await sent.locator("summary").click();
    await expect(sent.locator('[style*="font-size"]').first()).toHaveCSS("font-size", "24px");
    await expect(sent.locator('[style*="text-decoration"]').first()).toHaveCSS("text-decoration-line", "underline");
    const recipient = await member.newPage();
    await recipient.goto(`/Member/notifications/${id}`);
    await expect(recipient.locator('.activity-prose [style*="font-size"]').first()).toHaveCSS("font-size", "24px");
    await expect(recipient.locator('.activity-prose [style*="color:"]').first()).toHaveCSS("color", "rgb(196, 43, 72)");
    const prose = recipient.locator(".activity-prose");
    await expect(prose.locator('[style*="text-decoration"]').first()).toHaveCSS("text-decoration-line", "underline");
    await expect(prose.getByRole("link", { name: "確認", exact: true })).toHaveAttribute("href", "https://example.com/updated");
    await expect(prose.getByText("確認", { exact: true })).toHaveCSS("font-weight", "700");
    await expect(prose.getByText("確認", { exact: true })).toHaveCSS("font-style", "italic");
    expect(
      (await member.request.get(`/Member/notifications/${id}`)).status(),
    ).toBe(200);
    expect(
      (await outsider.request.get(`/Member/notifications/${id}`)).status(),
    ).toBe(404);
    const inbox = await (
      await member.request.get("/api/member/activities")
    ).json();
    const received = inbox.notifications.find(
      (n: { id: string }) => n.id === id,
    );
    expect(received.title).toBe(`個別連絡 ${info.project.name}`);
    expect(received.body).toBe(message);
    expect(received).not.toHaveProperty("recipientIds");
    expect(received).not.toHaveProperty("readBy");
    await command(member.request, { action: "notification.read", id });
    const readInbox = await (
      await member.request.get("/api/member/activities")
    ).json();
    expect(
      readInbox.notifications.find((n: { id: string }) => n.id === id).readAt,
    ).not.toBeNull();
    const otherInbox = await (
      await outsider.request.get("/api/member/activities")
    ).json();
    expect(
      otherInbox.notifications.some((n: { id: string }) => n.id === id),
    ).toBe(false);
    await sent.getByRole("link", { name: "通知を編集", exact: true }).click();
    const editForm = page.locator('form[data-activity-action="notification.edit"]');
    await expect(editForm.getByLabel("件名")).toHaveValue(received.title);
    await expect(editForm.locator('[data-intro-editable] [style*="text-decoration"]').first()).toHaveCSS("text-decoration-line", "underline");
    await editForm.getByLabel("件名").fill("配信後に訂正した件名");
    await editForm.getByRole("textbox", { name: "本文", exact: true }).fill("集合場所を変更しました。");
    await submit(page, "notification.edit", "変更を保存");
    await expect(page.getByRole("status").filter({ hasText: "通知の変更を保存しました。" })).toBeVisible();
    await expect(sent.locator("summary")).toHaveText("配信後に訂正した件名");
    await recipient.reload();
    await expect(recipient.getByRole("heading", { name: "配信後に訂正した件名", exact: true })).toBeVisible();
    await expect(prose).toHaveText("集合場所を変更しました。");
    expect((await outsider.request.get(`/Member/notifications/${id}`)).status()).toBe(404);
    const updatedInbox = await (await member.request.get("/api/member/activities")).json();
    expect(updatedInbox.total).toBe(inbox.total);
    expect(updatedInbox.notifications.find((n: { id: string }) => n.id === id).readAt)
      .toBe(readInbox.notifications.find((n: { id: string }) => n.id === id).readAt);
  } finally {
    await member.close();
    await outsider.close();
  }
});

test("only administrators can import/link the Google roster; members have read-only profiles", async ({
  page,
  browser,
}, info) => {
  await login(page.request, "admin");
  await restoreFixtureRoster(page.request);
  await page.goto("/Admin/grouping-roster");
  await expect(
    page.getByRole("link", { name: /2026年度後期/ }),
  ).toHaveAttribute("href", /docs.google.com\/spreadsheets\/d\/1thO/);
  await page.route("**/api/member/activities", (route) => route.abort());
  await page
    .getByRole("button", { name: "Google名簿から更新", exact: true })
    .click();
  await expect(
    page.locator('form[data-activity-action="roster.sync"] [data-status]'),
  ).toHaveAttribute("data-error", "true");
  await expect(
    page.getByRole("button", { name: "Google名簿から更新", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/member/activities");
  await submit(page, "roster.sync", "Google名簿から更新");
  await submit(page, "roster.link", "対応を確認して連携を保存");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
        timeout: 5000,
      })
      .toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({
    path: info.outputPath("roster-mobile.png"),
    fullPage: true,
  });
  const context = await browser.newContext({ baseURL: origin });
  try {
    for (const user of ["planner", "activity-0"]) {
      await login(context.request, user);
      for (const action of ["profile.save", "roster.sync", "roster.link"])
        expect(
          (
            await context.request.post("/api/member/activities", {
              headers,
              data: { action, revision: 0, gender: "male", grade: "6" },
            })
          ).status(),
        ).toBe(403);
      const response = await context.request.get("/Member/profile");
      expect(response.status()).toBe(200);
      expect(await response.text()).not.toContain(
        'data-activity-action="profile.save"',
      );
    }
  } finally {
    await context.close();
  }
});
