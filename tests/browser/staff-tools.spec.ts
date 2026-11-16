import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
const origin = "http://127.0.0.1:4329",
  headers = { Origin: origin };
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
async function submit(page: Page, action: string, label: string) {
  const next = page.waitForEvent("domcontentloaded");
  await page
    .locator(`form[data-activity-action="${action}"]`)
    .getByRole("button", { name: label, exact: true })
    .click();
  await next;
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});
test("staff can review and delete an event and its notices; member access and stale deletion are denied", async ({
  page,
  browser,
}, info) => {
  await login(page.request, "planner");
  const member = await browser.newContext({ baseURL: origin });
  try {
    await login(member.request, "activity-0");
    await page.goto("/Member/manage");
    await expect(
      page.getByRole("heading", { name: "Management", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "管理・運営", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "班分け自動生成ツール", exact: true }),
    ).toBeVisible();
    const response = await page.request.post("/api/member/activities", {
      headers,
      data: {
        action: "event.save",
        title: `削除確認 ${info.project.name}`,
        description: "削除対象",
        startsAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 9 * 86400000).toISOString(),
        deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
        meeting: "",
        itinerary: "",
        fee: "",
        theme: "",
        ownerId: "planner",
        recipientIds: ["activity-0"],
      },
    });
    expect(response.status()).toBe(200);
    const id = (await response.json()).eventId;
    expect(
      (
        await page.request.post("/api/member/activities", {
          headers,
          data: { action: "event.publish", eventId: id, revision: 1 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await member.request.post("/api/member/activities", {
          headers,
          data: {
            action: "event.delete",
            eventId: id,
            revision: 2,
            confirmation: "delete",
          },
        })
      ).status(),
    ).toBe(403);
    await page.goto(`/Member/manage/events/${id}`);
    const dialog = page.getByRole("dialog", {
      name: "企画を削除",
      exact: true,
    });
    await page.getByRole("button", { name: "企画を削除", exact: true }).click();
    await expect(dialog).toContainText(`削除確認 ${info.project.name}`);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect((await member.request.get(`/Member/events/${id}`)).status()).toBe(
      200,
    );
    await page.getByRole("button", { name: "企画を削除", exact: true }).click();
    // A vote after opening the dialog must prevent deleting a newer revision.
    expect(
      (
        await member.request.post("/api/member/activities", {
          headers,
          data: { action: "vote", eventId: id, vote: "attending" },
        })
      ).status(),
    ).toBe(200);
    await dialog.getByLabel("この企画を削除します").check();
    await dialog
      .getByRole("button", { name: "削除を確定", exact: true })
      .click();
    await expect(dialog.locator("[data-status]")).toContainText(
      "ほかの操作で更新",
    );
    await dialog.getByRole("button", { name: "戻る", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "企画を削除", exact: true }).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        )
        .toBe(true);
    }
    await dialog.getByLabel("この企画を削除します").check();
    await submit(page, "event.delete", "削除を確定");
    await expect(page).toHaveURL(/\/Management\?deleted=1/);
    await expect(page.getByRole("status").filter({ hasText: "企画と関連する通知を削除しました。" })).toBeVisible();
    expect((await member.request.get(`/Member/events/${id}`)).status()).toBe(
      404,
    );
    expect(
      (await page.request.get(`/Member/manage/events/${id}`)).status(),
    ).toBe(404);
    const notices = await (
      await member.request.get("/api/member/activities")
    ).json();
    expect(
      notices.notifications.some((n: { eventId: string }) => n.eventId === id),
    ).toBe(false);
    await page.goto("/Member");
    await expect(
      page.getByRole("heading", { name: "Member", exact: true }),
    ).toBeVisible();
  } finally {
    await member.close();
  }
});
test("standalone grouping uses the Google roster, supports conditions and edits, and keeps its own history without notifying members", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  const admin = await browser.newContext({ baseURL: origin });
  const member = await browser.newContext({ baseURL: origin });
  try {
    await login(admin.request, "admin");
    await restoreFixtureRoster(admin.request);
    await login(page.request, "planner");
    await login(member.request, "activity-0");
    const rosterPage = await admin.request.get("/Admin/grouping-roster");
    const revision = Number(
      (await rosterPage.text()).match(
        /data-activity-action="roster.sync" data-revision="(\d+)"/,
      )?.[1] || 0,
    );
    expect(
      (
        await admin.request.post("/api/member/activities", {
          headers,
          data: { action: "roster.sync", revision },
        })
      ).status(),
    ).toBe(200);
    expect((await member.request.get("/Member/manage/grouping")).status()).toBe(
      403,
    );
    expect(
      (
        await member.request.post("/api/member/grouping", {
          headers,
          data: { action: "run.save" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/member/grouping", {
          data: { action: "run.save" },
        })
      ).status(),
    ).toBe(403);
    const notices = await (
      await member.request.get("/api/member/activities")
    ).json();
    await page.goto("/Member/manage/grouping");
    await page
      .getByLabel("班分け名", { exact: true })
      .fill(`単独班分け ${info.project.name}`);
    for (const person of await page.locator('[name="participantIds"]:not([value^="guest-"])').all()) await person.check();
    const ids = await page
      .locator('[name="participantIds"]:checked')
      .evaluateAll((elements) =>
        elements.map((e) => (e as HTMLInputElement).value),
      );
    expect(ids.length).toBe(8);
    await submit(page, "run.save", "参加者を保存して班分けへ");
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const rules = page.locator('form[data-activity-action="groups.rules"]');
    await rules.getByLabel("班の数", { exact: true }).fill("2");
    await rules.getByLabel("班の数", { exact: true }).blur();
    await rules
      .getByLabel("1班のリーダー", { exact: true })
      .selectOption(ids[0]);
    await rules
      .getByLabel("2班のリーダー", { exact: true })
      .selectOption(ids[4]);
    for (const [type, a, b] of [
      ["together", 0, 1],
      ["apart", 0, 4],
    ] as const) {
      const section = rules.locator(`[data-pairs="${type}"]`);
      await section.getByRole("button", { name: "ペアを追加" }).click();
      const search = section.locator("[data-person-search]").first();
      await search.fill(`LINE${a}`);
      await expect(
        section.locator("select").first().locator("option"),
      ).toHaveCount(2);
      await expect(section.locator("select").first()).toContainText(
        `（line${a}）`,
      );
      await section.locator("select").nth(0).selectOption(ids[a]);
      await search.fill("一致しない名前");
      await expect(section.locator("select").first()).toHaveValue(ids[a]);
      await expect(
        section.locator("[data-person-matches]").first(),
      ).toContainText("0人が一致");
      await search.fill("");
      await section.locator("select").nth(1).selectOption(ids[b]);
      await section.getByRole("button", { name: "ペアを追加" }).click();
      await expect(section.locator("[data-pair-title]")).toHaveText([
        "ペア1",
        "ペア2",
      ]);
      await section
        .locator("[data-pair]")
        .nth(1)
        .locator("select")
        .nth(0)
        .selectOption(ids[a]);
      await section
        .locator("[data-pair]")
        .nth(1)
        .locator("select")
        .nth(1)
        .selectOption(ids[b]);
      await section.locator("[data-remove-pair]").first().click();
      await expect(section.locator("[data-pair-title]")).toHaveText(["ペア1"]);
      await expect(section.locator("select").nth(0)).toHaveValue(ids[a]);
      await expect(section.locator("select").nth(1)).toHaveValue(ids[b]);
      await expect(section).not.toContainText("メンバー1");
      await expect(section).not.toContainText("メンバー2");
    }
    await submit(page, "groups.rules", "条件を保存");
    await expect(rules.locator("[data-pair-title]")).toHaveText([
      "ペア1",
      "ペア1",
    ]);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      if (width === 390 || width === 1440) {
        const pairs = rules.locator('[data-pairs="together"]');
        await pairs.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await pairs.screenshot({
          path: info.outputPath(`pair-picker-${width}.png`),
        });
      }
    }
    // Filtering a saved pair must preserve the selected person and not mark rules as edited.
    await rules.locator("[data-person-search]").first().fill("line0");
    await expect(rules.locator("[data-person-select]").first()).toHaveValue(
      ids[0],
    );
    await submit(page, "groups.generate", "班を自動生成");
    const draft = page.locator('form[data-activity-action="groups.save"]');
    await expect(draft.locator("[data-group-summary]")).toContainText(
      "必須条件を満たしています",
    );
    await expect(draft).not.toContainText("テスト大学");
    await expect(
      draft.locator(`[data-person-id="${ids[0]}"] .group-person-name`),
    ).toContainText("（line0）");
    await expect(draft.locator(".group-color-legend")).not.toContainText("#");
    for (const [index, leader] of [
      [0, ids[0]],
      [1, ids[4]],
    ] as const) {
      await expect(
        draft.locator(`[data-group-index="${index}"] [data-person-id]`).first(),
      ).toHaveAttribute("data-person-id", leader);
    }
    await expect(
      draft.locator(`[data-person-id="${ids[0]}"] .group-name-initial`),
    ).toHaveCSS("color", "rgb(255, 153, 255)");
    await expect(
      draft.locator(`[data-person-id="${ids[2]}"] .group-name-initial`),
    ).toHaveCSS("color", "rgb(153, 204, 255)");
    await expect(
      draft.locator(`[data-person-id="${ids[0]}"] .group-person-name`),
    ).toHaveCSS("text-decoration-color", "rgb(242, 242, 176)");
    await expect(draft.locator(".group-grade-key").first()).toHaveText(
      "4年以上",
    );
    for (const index of [0, 1]) {
      expect(
        (
          await draft
            .locator(`[data-group-index="${index}"] .group-person-meta`)
            .allTextContents()
        )
          .slice(1)
          .map((text) => text.trim()),
      ).toEqual(["2年生", "2年生", "1年生"]);
    }
    const before = await draft
      .locator(`[data-assignment="${ids[2]}"]`)
      .inputValue();
    const target =
      (await draft.locator(`[data-assignment="${ids[6]}"]`).inputValue()) !==
      before
        ? ids[6]
        : ids[7];
    await draft.locator(`[data-person-id="${ids[2]}"]`).click();
    await expect(draft.locator(`[data-person-id="${ids[2]}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await draft.locator(`[data-person-id="${target}"]`).click();
    await expect(
      draft.locator(`[data-assignment="${ids[2]}"]`),
    ).not.toHaveValue(before);
    await expect(draft.locator("[data-swap-status]")).toContainText(
      "入れ替えました",
    );
    await submit(page, "groups.save", "班案を保存・再確認");
    await submit(page, "groups.publish", "班を確定して保存");
    await expect(
      page.getByRole("heading", { name: "確定済みの班（第1版）", exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
    }
    await page.screenshot({
      path: info.outputPath("standalone-groups.png"),
      fullPage: true,
    });
    expect(
      (await member.request.get(`/Member/manage/grouping/${id}`)).status(),
    ).toBe(403);
    expect(
      (
        await member.request.get(`/api/member/activities?eventId=${id}`)
      ).status(),
    ).toBe(404);
    expect(
      (await (await member.request.get("/api/member/activities")).json()).total,
    ).toBe(notices.total);
    await page.goto("/Member/manage/grouping");
    await expect(page.getByLabel("前回の班分け", { exact: true })).toHaveValue(
      id,
    );
    const created = await page.request.post("/api/member/grouping", {
      headers,
      data: {
        action: "run.save",
        title: "表示と警告の検証",
        participantIds: ids,
        previousRunId: id,
      },
    });
    expect(created.status()).toBe(200);
    const followup = (await created.json()).runId;
    await page.goto(`/Member/manage/grouping/${followup}`);
    const newRules = {
      count: 2,
      min: 4,
      max: 4,
      leaders: [ids[0], ids[4]],
      together: [[ids[0], ids[1]]],
      apart: [[ids[0], ids[1]]],
    };
    const setRules = await page.request.post("/api/member/grouping", {
      headers,
      data: {
        action: "groups.rules",
        runId: followup,
        revision: Number(await rules.getAttribute("data-revision")),
        rules: newRules,
      },
    });
    expect(setRules.status()).toBe(200);
    await page.reload();
    await submit(page, "groups.generate", "班を自動生成");
    // Priorities split this pair even though it was requested together.
    await expect(draft.locator("[data-warning-list]")).toContainText(
      "同班指定を満たしていません",
    );
    await expect(draft.locator("[data-warning-list]")).not.toContainText(
      "別班指定を満たしていません",
    );
    await expect(draft.locator("[data-warning-list]")).toContainText(
      "前回も同じ班でした",
    );
    await expect(draft.locator("[data-preference-warnings]")).toHaveCSS(
      "color",
      "rgb(253, 239, 242)",
    );
    await expect(
      draft.locator("[data-preference-warnings] svg"),
    ).toHaveAttribute("viewBox", "0 0 24 24");
    await expect(draft.locator(`[data-person-id="${ids[1]}"]`)).toHaveCSS(
      "background-color",
      "rgb(253, 239, 242)",
    );
    await draft.locator(`[data-person-id="${ids[1]}"]`).hover();
    await expect(draft.locator(`[data-person-id="${ids[1]}"]`)).toHaveCSS(
      "background-color",
      "rgb(253, 239, 242)",
    );
    // Swap by keyboard and update the warning immediately; first selection can be cancelled.
    await draft.locator(`[data-person-id="${ids[1]}"]`).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(draft.locator(`[data-person-id="${ids[1]}"]`)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.keyboard.press("Enter");
    await draft.locator(`[data-person-id="${ids[5]}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(draft.locator("[data-warning-list]")).toContainText(
      "別班指定を満たしていません",
    );
    await expect(draft.locator("[data-warning-list]")).not.toContainText(
      "同班指定を満たしていません",
    );
    await submit(page, "groups.save", "班案を保存・再確認");
    await submit(page, "groups.publish", "班を確定して保存");
    await expect(
      page.getByRole("heading", { name: "確定済みの班（第1版）", exact: true }),
    ).toBeVisible();
    await draft
      .locator("[data-group-board]")
      .screenshot({ path: info.outputPath("group-board-warnings.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await draft
      .locator("[data-group-board]")
      .screenshot({ path: info.outputPath("group-board-warnings-mobile.png") });
    await page.goto("/Member/manage/grouping");

    await page
      .getByRole("link", {
        name: `単独班分け ${info.project.name}`,
        exact: true,
      })
      .click();
    await page.getByText("参加者・参照する履歴を変更", { exact: true }).click();
    await page.getByRole("button", { name: "全解除", exact: true }).click();
    await page
      .locator('form[data-activity-action="groups.generate"]')
      .getByRole("button", { name: "班を自動生成" })
      .click();
    await expect(
      page.locator(
        'form[data-activity-action="groups.generate"] [data-status]',
      ),
    ).toContainText("編集中の参加者");
    await page.goto("/Member/manage/grouping");
    const deleteButton = page.getByRole("button", {
      name: `単独班分け ${info.project.name}を削除`,
      exact: true,
    });
    const deleteDialog = page.getByRole("dialog", {
      name: "保存した班分けを削除",
      exact: true,
    });
    await deleteButton.click();
    await expect(deleteDialog).toContainText(`単独班分け ${info.project.name}`);
    await page.keyboard.press("Escape");
    await expect(deleteDialog).not.toBeVisible();
    await deleteButton.click();
    await deleteDialog
      .getByRole("button", { name: "削除を確定", exact: true })
      .click();
    await expect(deleteDialog).toBeVisible();
    expect(
      (
        await member.request.post("/api/member/grouping", {
          headers,
          data: {
            action: "run.delete",
            runId: id,
            revision: 1,
            confirmation: "delete",
          },
        })
      ).status(),
    ).toBe(403);
    await expect
      .poll(() =>
        deleteDialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      .toBe(true);
    await deleteDialog.screenshot({
      path: info.outputPath("delete-grouping-mobile.png"),
    });
    await deleteDialog.getByLabel("この班分けを削除します").check();
    const deleted = page.waitForEvent("domcontentloaded");
    await deleteDialog
      .getByRole("button", { name: "削除を確定", exact: true })
      .click();
    await deleted;
    await expect(page).toHaveURL(/\/Member\/manage\/grouping\?deleted=1/);
    await expect(page.getByRole("status").filter({ hasText: "班分けを削除しました。" })).toBeVisible();
    expect(
      (await page.request.get(`/Member/manage/grouping/${id}`)).status(),
    ).toBe(404);
    await expect(
      page
        .locator('select[name="previousRunId"] option')
        .filter({ hasText: `単独班分け ${info.project.name}` }),
    ).toHaveCount(0);
    await page.goto(`/Member/manage/grouping/${followup}`);
    await expect(page.locator('select[name="previousRunId"]')).toHaveValue(id);
    await expect(page.locator('select[name="previousRunId"]')).toContainText(
      "削除済み・参照履歴",
    );
    await expect(draft.locator("[data-warning-list]")).toContainText(
      "前回も同じ班でした",
    );
    expect(
      (await (await member.request.get("/api/member/activities")).json()).total,
    ).toBe(notices.total);
  } finally {
    await admin.close();
    await member.close();
  }
});
