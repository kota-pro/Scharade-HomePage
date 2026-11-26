import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import sharp from "sharp";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
async function login(page: Page, id = "planner") {
  const r = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: origin },
    data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(r.ok()).toBeTruthy();
}
async function action(request: APIRequestContext, id: string, p: object) {
  const current = await (await request.get(`/api/member/tools/${id}`)).json();
  const r = await request.post(`/api/member/tools/${id}`, {
    headers: { Origin: origin },
    data: {
      revision: current.tool.revision,
      answerRevision: current.tool.answerRevision,
      ...p,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).tool;
}
async function create(
  request: APIRequestContext,
  kind = "poll",
  settings = {},
) {
  const r = await request.post("/api/member/tools", {
    headers: { Origin: origin },
    data: { kind },
  });
  expect(r.ok()).toBeTruthy();
  const { id } = await r.json();
  let tool = await action(request, id, {
    action: "save",
    question: `架空の${kind}`,
    recipientIds: ["member", "other"],
    options:
      kind === "schedule"
        ? [
            { date: "2027-01-01", text: "午前" },
            { date: "2027-01-02", text: "午後" },
          ]
        : [{ text: "選択肢A" }, { text: "選択肢B" }],
    settings: { ...settings },
  });
  tool = await action(request, id, { action: "publish" });
  return tool;
}
test("poll draft preview, publishing, voting, anonymous permission and PNG", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/Member/manage/tools");
  await page.getByRole("button", { name: "投票を作成", exact: true }).click();
  await expect(page).toHaveURL(/manage\/tools\/[a-f0-9-]+/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("textbox", { name: "質問内容", exact: true }).fill("架空の好きな撮影場所");
  await page.locator("[name=optionText]").nth(0).fill("海");
  await page.locator("[name=optionText]").nth(1).fill("山");
  const png = await sharp({
    create: { width: 60, height: 40, channels: 3, background: "#99ccff" },
  })
    .png()
    .toBuffer();
  await page
    .locator("[name=optionImage]")
    .first()
    .setInputFiles({ name: "選択肢.png", mimeType: "image/png", buffer: png });

  await page.getByText("回答の設定（省略できます）").click();
  await page.locator("[name=anonymous]").check();
  await page.locator("[name=publicQuestion]").check();
  await page
    .locator("[data-tool-editor] [data-select-recipients=none]")
    .click();
  await page.locator("[name=recipientIds][value=member]").check();
  await page
    .getByRole("button", { name: "保存して内容を確認", exact: true })
    .click();
  await expect(page.locator("[data-tool-preview]")).toBeVisible();
  await expect(page.locator("[data-preview-content]")).toContainText("海");
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.locator("[data-reception-status]")).toContainText("受付中");
  const guest = await browser.newContext();
  const gp = await guest.newPage();
  await gp.goto(`/Member/tools/${id}`);
  await expect(
    gp.getByText("架空の好きな撮影場所", { exact: true }),
  ).toBeVisible();
  await expect(
    gp.getByRole("link", { name: "ログインして回答" }),
  ).toBeVisible();
  expect(
    (await gp.request.get(`/api/member/tools/${id}/results`)).status(),
  ).toBe(401);
  await guest.close();
  const member = await browser.newContext();
  const mp = await member.newPage();
  await login(mp, "member");
  await mp.goto(`/Member/tools/${id}`);
  await mp.getByLabel("海", { exact: true }).check();
  await mp.getByRole("button", { name: "回答する", exact: true }).click();
  await expect(mp.locator("[data-tool-status]")).toContainText("回答を保存");
  await expect(mp.locator("[data-results-message]")).toContainText(
    "回答者 1人",
  );
  const result = await (
    await mp.request.get(`/api/member/tools/${id}/results`)
  ).json();
  expect(result.results.responses[0].name).toBe("匿名");
  expect(result.results.responses[0].userId).toBeUndefined();
  await page.getByRole("button", { name: "結果を更新" }).click();
  await expect(
    page.getByRole("button", { name: "匿名回答の名前を確認" }),
  ).toHaveCount(0);
  await mp.getByRole("button", { name: "結果を画像でコピー" }).click();
  await expect(mp.locator("[data-tool-export]")).toBeVisible();
  await expect(mp.locator("[data-export-pages] img")).toHaveCount(1);
  expect(
    await mp
      .locator("[data-export-pages] img")
      .evaluate((i: HTMLImageElement) => i.naturalWidth),
  ).toBe(1200);
  await mp.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0].getType("image/png");
          (window as any).__copiedToolPng = {
            type: blob.type,
            size: blob.size,
          };
        },
      },
    }),
  );
  await mp.getByRole("button", { name: "この画像をコピー" }).click();
  await expect(mp.locator("[data-export-pages]")).toContainText(
    "画像をコピーしました。",
  );
  expect(await mp.evaluate(() => (window as any).__copiedToolPng.type)).toBe(
    "image/png",
  );
  await mp.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await mp.getByRole("button", { name: "この画像をコピー" }).click();
  await expect(mp.locator("[data-export-pages]")).toContainText(
    "PNGで保存をご利用ください",
  );
  const download = mp.waitForEvent("download");
  await mp.getByRole("link", { name: "PNGで保存", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await member.close();
});
test("calendar selection supports slots and schedule answers survive edits", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/Member/manage/tools");
  await page
    .getByRole("button", { name: "日程調整を作成", exact: true })
    .click();
  await expect(page).toHaveURL(/manage\/tools\/[a-f0-9-]+/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("textbox", { name: "質問内容", exact: true }).fill("架空の日程調整");
  await page.locator("[data-calendar-days] button").nth(0).click();
  await page.locator("[data-calendar-days] button").nth(0).click();
  await expect(page.locator("[name=optionDate]")).toHaveCount(2);
  await page.locator("[name=optionText]").nth(0).fill("午前");
  await page.locator("[name=optionText]").nth(1).fill("午後");
  await page
    .locator("[data-tool-editor] [data-select-recipients=none]")
    .click();
  await page.locator("[name=recipientIds][value=member]").check();
  await page
    .getByRole("button", { name: "保存して内容を確認", exact: true })
    .click();
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  const member = await browser.newContext();
  const mp = await member.newPage();
  await login(mp, "member");
  await mp.goto(`/Member/tools/${id}`);
  await mp.locator("[data-tool-answer] select").nth(0).selectOption("yes");
  await mp.locator("[data-tool-answer] select").nth(1).selectOption("maybe");
  await mp.getByRole("button", { name: "回答する", exact: true }).click();
  await expect(mp.locator("[data-results-message]")).toContainText(
    "回答者 1人",
  );
  await page.reload();
  await page.locator("[name=optionText]").nth(0).fill("朝の時間");
  await page
    .getByRole("button", { name: "保存して内容を確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "確認画面を閉じる", exact: true })
    .click();
  await mp.reload();
  await expect(mp.locator("[data-tool-answer] select").nth(0)).toHaveValue(
    "yes",
  );
  await mp.getByRole("button", { name: "結果を画像でコピー" }).click();
  await expect(mp.locator("[data-tool-export]")).toBeVisible();
  await member.close();
});
test("box attachments stay private; selected publishing, long export and responsive view", async ({
  page,
  browser,
}) => {
  await login(page);
  const tool = await create(page.request, "box", { anonymous: true });
  const member = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mp = await member.newPage();
  await login(mp, "member");
  await mp.goto(`/Member/tools/${tool.id}`);
  await mp
    .getByLabel("回答（20,000文字以内）")
    .fill(
      "架空の長文です。URL https://example.invalid\n".repeat(130) +
        "末尾の確認",
    );
  await mp.getByLabel("添付ファイル", { exact: true }).setInputFiles({
    name: "メモ.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("架空の添付"),
  });
  await mp.getByRole("button", { name: "投稿する", exact: true }).click();
  await expect(mp.locator("[data-tool-status]")).toContainText("投稿を保存");
  const own = (
    await (await mp.request.get(`/api/member/tools/${tool.id}`)).json()
  ).tool.own[0];
  const other = await browser.newContext();
  const op = await other.newPage();
  await login(op, "other");
  expect(
    (
      await op.request.get(
        `/api/member/tools/${tool.id}/assets/${own.assetIds[0]}`,
      )
    ).status(),
  ).toBe(403);
  await page.goto(`/Member/manage/tools/${tool.id}`);
  await page.locator("[data-publication-settings] > summary").click();
  await expect(page.locator("[name=audience]")).toHaveValue("recipients");
  await expect(page.locator("[name=audience] option")).toHaveCount(6);
  await expect(page.locator("[name=responseIds]")).toHaveCount(1);
  await page.locator("[name=responseIds]").check();
  await page.locator("[name=paused]").uncheck();
  await page.getByRole("button", { name: "結果の公開設定を保存" }).click();
  await expect(page.locator("[data-tool-status]")).toContainText(
    "公開設定を保存",
  );
  await op.goto(`/Member/tools/${tool.id}`);
  await expect(op.locator("[data-tool-results]")).toContainText("末尾の確認");
  expect(
    (
      await op.request.get(
        `/api/member/tools/${tool.id}/assets/${own.assetIds[0]}`,
      )
    ).status(),
  ).toBe(200);
  await op.getByRole("button", { name: "結果を画像でコピー" }).click();
  await expect(op.locator("[data-tool-export]")).toBeVisible();
  expect(await op.locator("[data-export-pages] img").count()).toBeGreaterThan(
    1,
  );
  await mp.getByRole("button", { name: "編集", exact: true }).click();
  await mp.getByLabel("回答（20,000文字以内）").fill("公開後に編集");
  await mp.getByRole("button", { name: "変更を保存" }).click();
  await expect
    .poll(
      async () =>
        (await (await mp.request.get(`/api/member/tools/${tool.id}`)).json())
          .tool.own[0]?.body,
    )
    .toBe("公開後に編集");
  await op.reload();
  await expect(op.locator("[data-tool-results]")).not.toContainText(
    "公開後に編集",
  );
  expect(
    await mp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await mp.screenshot({
    path: "/private/tmp/notification-tools-20261104/box-mobile.png",
    fullPage: true,
  });
  await other.close();
  await member.close();
});

test("management permission and anonymous identities remain separate; native image copy never includes revealed names", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    userAgent: "Mozilla/5.0 ScharadeApp/1",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as any;
    w.__nativePackets = [];
    w.__canvasText = [];
    w.__scharadeAppChallenge = "00000000-0000-4000-8000-000000000001";
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: undefined,
    });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      w.__canvasText.push(text);
      return original.call(this, text, x, y, max);
    };
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const m = JSON.parse(raw);
        w.__nativePackets.push(m);
        if (
          ["file-start", "file-chunk", "file-end", "copy-text"].includes(m.type)
        )
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent("scharade:native", {
                detail: {
                  version: 1,
                  nonce: m.nonce,
                  challenge: m.challenge,
                  id: m.id,
                  command: "native-result",
                  ok: true,
                },
              }),
            ),
          );
      },
    };
  });
  await login(page, "admin");
  const tool = await create(page.request, "poll", { anonymous: true });
  const memberContext = await browser.newContext();
  const mp = await memberContext.newPage();
  await login(mp, "other");
  await action(mp.request, tool.id, {
    action: "respond",
    choices: [tool.options[0].id],
  });
  const staffContext = await browser.newContext();
  const sp = await staffContext.newPage();
  await login(sp);
  expect(
    (await sp.request.get(`/api/member/tools/${tool.id}/results`)).status(),
  ).toBe(403);
  await page.goto(`/Member/manage/tools/${tool.id}`);
  await page.locator(".tool-result-voters > summary").first().click();
  await page.getByRole("button", { name: "匿名回答の名前を確認" }).click();
  await expect(page.locator("[data-tool-results]")).toContainText("別の会員");
  await page.getByRole("button", { name: "結果を画像でコピー" }).click();
  await expect(page.locator("[data-tool-export]")).toBeVisible();
  const rendered = await page.evaluate(() =>
    (window as any).__canvasText.join("\n"),
  );
  expect(rendered).toContain("匿名");
  expect(rendered).not.toContain("別の会員");
  await page.getByRole("button", { name: "この画像をコピー" }).click();
  await expect(page.locator("[data-export-pages]")).toContainText(
    "画像をコピーしました。",
  );
  const packets = await page.evaluate(() => (window as any).__nativePackets);
  expect(packets.find((p: any) => p.type === "file-start")).toMatchObject({
    mime: "image/png",
    action: "copy",
  });
  await action(page.request, tool.id, {
    action: "permissions",
    staffResults: true,
    staffIdentity: true,
  });
  const rows = await (
    await sp.request.get(`/api/member/tools/${tool.id}/results`)
  ).json();
  const identity = await sp.request.post(
    `/api/member/tools/${tool.id}/identity`,
    {
      headers: { Origin: origin },
      data: { responseId: rows.results.responses[0].id },
    },
  );
  expect((await identity.json()).name).toBe("別の会員");
  await staffContext.close();
  await memberContext.close();
  await context.close();
});
