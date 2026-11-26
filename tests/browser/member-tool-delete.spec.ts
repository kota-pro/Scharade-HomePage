import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import crypto from "node:crypto";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
const headers = { Origin: origin };
async function login(page: Page, user = "planner") {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: {
          email: `${user}@example.invalid`,
          password: "fixture-password-123",
        },
      })
    ).ok(),
  ).toBeTruthy();
}
async function create(
  request: APIRequestContext,
  kind: string,
  publish = true,
) {
  const response = await request.post("/api/member/tools", {
    headers,
    data: { kind },
  });
  const { id } = await response.json();
  expect(response.ok()).toBeTruthy();
  let tool = (await (await request.get(`/api/member/tools/${id}`)).json()).tool;
  if (publish) {
    for (const data of [
      {
        action: "save",
        question: `削除確認 ${kind}`,
        recipientIds: ["member"],
        settings: { publicQuestion: true },
        options:
          kind === "schedule"
            ? [{ date: "2027-01-01", text: "午前" }]
            : [{ text: "候補" }],
      },
      { action: "publish" },
    ]) {
      const saved = await request.post(`/api/member/tools/${id}`, {
        headers,
        data: { ...data, revision: tool.revision },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      tool = (await saved.json()).tool;
    }
  }
  return tool;
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === "127.0.0.1" ||
      ["data:", "blob:"].includes(url.protocol)
    )
      return route.continue();
    if (
      ["font", "stylesheet"].includes(route.request().resourceType()) &&
      /(^|\.)(typekit\.net|googleapis\.com|gstatic\.com)$/.test(url.hostname)
    )
      return route.continue();
    return route.abort();
  });
});
test("staff delete draft, open and closed tools from the list and editor; member, guest and cross-origin deletes are denied", async ({
  page,
  browser,
}, info) => {
  await login(page);
  const member = await browser.newContext();
  const mp = await member.newPage();
  await login(mp, "member");
  const guest = await browser.newContext();
  for (const [index, kind] of ["poll", "schedule", "box"].entries()) {
    let tool = await create(page.request, kind, index !== 0);
    const endpoint = `/api/member/tools/${tool.id}`;
    const data = { confirmation: "delete", revision: tool.revision };
    expect(
      (await mp.request.delete(endpoint, { headers, data })).status(),
    ).toBe(403);
    expect(
      (
        await guest.request.delete(origin + endpoint, { headers, data })
      ).status(),
    ).toBe(401);
    expect(
      (
        await page.request.delete(endpoint, {
          headers: { Origin: "https://other.invalid" },
          data,
        })
      ).status(),
    ).toBe(403);
    if (kind === "box") {
      const response = await mp.request.post(endpoint, {
        headers,
        data: {
          action: "respond",
          answerRevision: tool.answerRevision,
          responseRevision: 0,
          body: "架空の回答",
          assetIds: [],
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const closed = await page.request.post(endpoint, {
        headers,
        data: { action: "reception", closed: true, revision: tool.revision },
      });
      expect(closed.ok()).toBeTruthy();
      tool = (await closed.json()).tool;
    }
    await page.goto(
      index === 1 ? `/Member/manage/tools/${tool.id}` : "/Member/manage/tools",
    );
    if (index === 1) {
      // Saving must also refresh the deletion revision without reloading the page.
      await page.getByRole("textbox", { name: "質問内容", exact: true }).fill("編集後の日程調整");
      await page
        .getByRole("button", { name: "保存して内容を確認", exact: true })
        .click();
      await expect(page.locator("[data-tool-preview]")).toBeVisible();
      await page
        .getByRole("button", { name: "確認画面を閉じる", exact: true })
        .click();
    }
    const trigger = page.locator(`[data-delete-item="${tool.id}"]`);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: /を削除/ });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "戻る", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect((await page.request.get(endpoint)).ok()).toBeTruthy();
    await trigger.click();
    await dialog
      .getByRole("button", { name: "削除を確定", exact: true })
      .click();
    await expect(dialog).toBeVisible(); // Required confirmation prevents an accidental deletion.
    await dialog.getByRole("checkbox").check();
    if (index === 1)
      await page.screenshot({
        path: info.outputPath("schedule-delete-desktop.png"),
        fullPage: false,
      });
    await dialog
      .getByRole("button", { name: "削除を確定", exact: true })
      .click();
    await expect(page).toHaveURL(/\/Member\/manage\/tools\?deleted=1$/);
    await expect(page.locator("[data-tool-status]")).toContainText(
      "削除しました",
    );
    await expect(page.locator(`[data-delete-item="${tool.id}"]`)).toHaveCount(
      0,
    );
    expect((await page.request.get(endpoint)).status()).toBe(404);
    expect(
      (await mp.request.get(`/api/member/tools/${tool.id}/results`)).status(),
    ).toBe(404);
    expect(
      (await guest.request.get(origin + `/Member/tools/${tool.id}`)).status(),
    ).toBe(404);
    const notices = await (
      await mp.request.get("/api/member/activities")
    ).json();
    expect(notices.notifications.some((n: any) => n.toolId === tool.id)).toBe(
      false,
    );
  }
  await member.close();
  await guest.close();
});
test("delete confirmation survives errors, prevents duplicate submissions and fits small screens", async ({
  page,
}, info) => {
  await login(page);
  const tool = await create(page.request, "poll");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/Member/manage/tools/${tool.id}`);
  const endpoint = `/api/member/tools/${tool.id}`;
  let attempts = 0;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "試験用の削除エラー" }),
      });
    return route.continue();
  });
  await page.locator("[data-delete-item]").click();
  const dialog = page.locator("[data-management-delete-dialog]");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "削除を確定" }).click();
  await expect(dialog.getByRole("alert")).toContainText("SITE-011");
  expect((await page.request.get(endpoint)).ok()).toBeTruthy();
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("tool-delete-mobile.png"),
    fullPage: false,
  });
  await dialog.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(page).toHaveURL(/\?deleted=1$/);
  expect(attempts).toBe(2);
});
test("sent notifications can be deleted without deleting their source tool, including older pages", async ({
  page,
  browser,
}, info) => {
  await login(page);
  const tool = await create(page.request, "poll");
  const member = await browser.newContext();
  const mp = await member.newPage();
  await login(mp, "member");
  const notices = (
    await (await mp.request.get("/api/member/activities")).json()
  ).notifications;
  const notice = notices.find((n: any) => n.toolId === tool.id);
  const data = {
    action: "notification.delete",
    id: notice.id,
    confirmation: "delete",
  };
  expect(
    (
      await mp.request.post("/api/member/activities", { headers, data })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/member/activities", {
        headers,
        data: { ...data, confirmation: "" },
      })
    ).status(),
  ).toBe(400);
  for (let i = 0; i < 30; i++) {
    const response = await page.request.post("/api/member/activities", {
      headers,
      data: {
        action: "notification.send",
        id: crypto.randomUUID(),
        title: `ページ分け確認 ${i}`,
        body: "架空の本文",
        recipientIds: ["member"],
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/Member/manage/notifications");
  await expect(page.locator(`[data-delete-item="${notice.id}"]`)).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "次のページ" }).click();
  const trigger = page.locator(`[data-delete-item="${notice.id}"]`);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "通知を削除", exact: true });
  await expect(dialog).toContainText("内容や回答は残ります");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.screenshot({
    path: info.outputPath("notification-delete-mobile.png"),
    fullPage: false,
  });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "削除を確定" }).click();
  await expect(page).toHaveURL(/notifications\?deleted=1$/);
  await expect(
    page.getByRole("status").filter({ hasText: "通知を削除しました。" }),
  ).toBeVisible();
  expect(
    (await page.request.get(`/api/member/tools/${tool.id}`)).status(),
  ).toBe(200);
  expect(
    (await mp.request.get(`/Member/notifications/${notice.id}`)).status(),
  ).toBe(404);
  expect((await mp.request.get(`/Member/tools/${tool.id}`)).status()).toBe(200);
  await member.close();
});
