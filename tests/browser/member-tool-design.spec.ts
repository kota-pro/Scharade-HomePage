import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
async function login(page: Page, id: string) {
  const r = await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: origin },
    data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(r.ok()).toBeTruthy();
}
async function action(
  request: APIRequestContext,
  id: string,
  p: Record<string, unknown>,
) {
  const current = await (await request.get(`/api/member/tools/${id}`)).json();
  const response = await request.post(`/api/member/tools/${id}`, {
    headers: { Origin: origin },
    data: {
      revision: current.tool.revision,
      answerRevision: current.tool.answerRevision,
      ...p,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).tool;
}
async function tool(
  request: APIRequestContext,
  kind: string,
  question: string,
) {
  const created = await request.post("/api/member/tools", {
    headers: { Origin: origin },
    data: { kind },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  const dates = Array.from({ length: 7 }, (_, i) => ({
    date: `2027-01-${String(i + 10).padStart(2, "0")}`,
    text: i % 2 ? "午後" : "午前",
    start: i % 2 ? "13:00" : "10:00",
    end: i % 2 ? "17:00" : "12:00",
  }));
  await action(request, id, {
    action: "save",
    question,
    recipientIds: ["member", "other"],
    options:
      kind === "schedule"
        ? dates
        : [
            { text: "海辺と夕景を撮る" },
            { text: "街並みと喫茶店を巡る" },
            { text: "森の中で季節を探す" },
          ],
    settings: { anonymous: false, multiple: true },
  });
  return action(request, id, { action: "publish" });
}
test("tool pages reuse the site design and remain readable across desktop and mobile", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const marker = `デザイン確認 ${info.project.name}`;
  await login(page, "planner");
  const poll = await tool(
    page.request,
    "poll",
    `${marker}：次の撮影会で訪れたい場所を教えてください。`,
  );
  const schedule = await tool(
    page.request,
    "schedule",
    `${marker}：撮影会に参加できる日程を教えてください。`,
  );
  const box = await tool(
    page.request,
    "box",
    `${marker}：これからの活動へのアイデアや、やってみたいことをお聞かせください。`,
  );
  const context = await browser.newContext();
  const member = await context.newPage();
  await login(member, "other");
  await action(member.request, poll.id, {
    action: "respond",
    choices: [poll.options[0].id, poll.options[1].id],
  });
  await action(member.request, schedule.id, {
    action: "respond",
    dates: Object.fromEntries(
      schedule.options.map((o: any, i: number) => [
        o.id,
        i % 3 === 0 ? "yes" : i % 3 === 1 ? "maybe" : "no",
      ]),
    ),
  });
  await action(member.request, box.id, {
    action: "respond",
    body:
      "フィルムカメラを持ち寄って、ゆっくり街を歩く撮影会をしてみたいです。\n撮った写真を見せ合う時間もあると、みんなの視点がわかって楽しそうです。\n\n" +
      "作品の感想を交換する時間を作れたらと思います。\n".repeat(16),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/Member/manage/tools");
  await page.locator("[data-tool-search]").fill(marker);
  await expect(page.locator("[data-tool-list-item]:visible")).toHaveCount(3);
  await page.locator("[data-tool-filter]").selectOption("schedule");
  await expect(page.locator("[data-tool-list-item]:visible")).toHaveCount(1);
  await page.locator("[data-tool-filter]").selectOption("");
  await page.screenshot({
    path: info.outputPath("01-list-desktop.png"),
    fullPage: true,
  });
  await page.goto(`/Member/manage/tools/${poll.id}`);
  await expect(page.locator("[data-publication-settings]")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.locator("[data-tool-options] .tool-option-edit"),
  ).toHaveCount(3);
  expect(
    await page
      .locator(".tool-editor-grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(2);
  await page.screenshot({
    path: info.outputPath("02-poll-editor-desktop.png"),
    fullPage: true,
  });
  await page.getByText("回答の設定（省略できます）", { exact: true }).click();
  const checkbox = await page.locator("[name=anonymous]").boundingBox();
  expect(checkbox!.width).toBeLessThanOrEqual(24);
  await page.getByText("回答の設定（省略できます）", { exact: true }).click();
  await page
    .getByRole("button", { name: "保存して内容を確認", exact: true })
    .click();
  await expect(page.locator("[data-tool-preview]")).toBeVisible();
  expect(
    await page
      .locator("[data-tool-preview] .activity-confirm-footer")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThan(180);
  await page
    .locator("[data-tool-preview]")
    .screenshot({ path: info.outputPath("03-confirm-desktop.png") });
  await page
    .getByRole("button", { name: "確認画面を閉じる", exact: true })
    .click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("04-poll-editor-mobile.png"),
    fullPage: true,
  });
  await page.goto(`/Member/manage/tools/${schedule.id}`);
  expect(
    await page
      .locator(".tool-calendar-grid")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBeTruthy();
  await page
    .locator(".tool-calendar")
    .screenshot({ path: info.outputPath("05-calendar-mobile.png") });
  await page.goto(`/Member/manage/tools/${box.id}`);
  await page.locator("[data-publication-settings] > summary").click();
  await expect(page.locator("[data-publication-members]")).toBeHidden();
  await page.locator("[name=audience]").selectOption("selected");
  await expect(page.locator("[data-publication-members]")).toBeVisible();
  await page.locator("[name=audience]").selectOption("recipients");
  await page.locator("[name=start]").selectOption("date");
  await expect(page.locator("[data-publication-date]")).toBeVisible();
  await page.locator("[name=start]").selectOption("always");
  await page.locator("[name=boxMode]").selectOption("all");
  await expect(page.locator("[data-publication-posts]")).toBeHidden();
  await page.locator("[name=paused]").uncheck();
  await page.getByRole("button", { name: "結果の公開設定を保存" }).click();
  await expect(page.locator("[data-tool-status]")).toContainText(
    "公開設定を保存",
  );
  for (const t of [poll, schedule, box]) {
    await member.setViewportSize({ width: 390, height: 844 });
    await member.goto(`/Member/tools/${t.id}`);
    await expect(member.locator("[data-tool-results]")).not.toBeEmpty();
    expect(
      await member.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await member.screenshot({
      path: info.outputPath(`06-${t.kind}-answer-mobile.png`),
      fullPage: true,
    });
    if (t.kind === "schedule") {
      expect(
        (await member.locator(".tool-results th").first().boundingBox())!.width,
      ).toBeGreaterThanOrEqual(140);
      const scroll = member.locator(".tool-results-scroll");
      expect(
        await scroll.evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBeTruthy();
    }
    if (t.kind === "box") {
      await expect(
        member.locator("[data-tool-results] .tool-response-detail"),
      ).not.toHaveAttribute("open", "");
      await member
        .locator("[data-tool-results] .tool-response-detail > summary")
        .click();
      await expect(
        member.locator("[data-tool-results] .tool-response-detail"),
      ).toHaveAttribute("open", "");
    }
  }
  await member.getByRole("button", { name: "結果を画像でコピー" }).click();
  await expect(member.locator("[data-tool-export]")).toBeVisible();
  expect(
    await member
      .locator("[data-tool-export]")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBeTruthy();
  await member
    .locator("[data-tool-export]")
    .screenshot({ path: info.outputPath("07-export-mobile.png") });
  await member.locator(".tool-export-actions").scrollIntoViewIfNeeded();
  await member
    .locator("[data-tool-export]")
    .screenshot({ path: info.outputPath("07-export-actions-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/Member/tools/${poll.id}`);
  await expect(page.locator(".tool-poll-result")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("08-poll-results-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await context.close();
});
