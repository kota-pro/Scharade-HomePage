import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { fixtureLogin } from "./fixture-auth";
const headers = { Origin: "http://127.0.0.1:4329" };
const login = async (page: Page, email = "planner@example.invalid") =>
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: { email, password: "fixture-password-123" },
      })
    ).ok(),
  ).toBe(true);
test("staff correct submitted content, photos, counts and series layouts through a Contact-style review, preserving independent drafts", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await login(page);
  const command = async (data: Record<string, unknown>) => {
    const r = await page.request.post("/api/member/exhibitions", {
      headers,
      data,
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).exhibition;
  };
  let e = await command({
    action: "create",
    title: `運営による修正 ${info.project.name}`,
  });
  const id = e.id,
    endpoint = `/api/exhibitions/${id}`,
    adminEndpoint = `/api/member/exhibitions/${id}`,
    iso = (d: number) => new Date(Date.now() + d).toISOString();
  const get = async () => await (await page.request.get(adminEndpoint)).json();
  const sectionId = e.schemas[0].sections[0].id,
    fieldId = crypto.randomUUID(),
    checkboxId = crypto.randomUUID();
  e = await command({
    action: "schema",
    exhibitionId: id,
    revision: e.revision,
    schema: {
      ...e.schemas[0],
      fields: [
        {
          id: fieldId,
          label: "展示方法の希望",
          description: "任意",
          type: "paragraph",
          scope: "work",
          required: false,
          options: [],
        },
        {
          id: checkboxId,
          label: "展示オプション",
          description: "",
          type: "checkbox",
          scope: "work",
          required: true,
          kinds: ["series"],
          options: ["額装", "直貼り"],
        },
      ],
    },
  });
  e = await command({
    action: "settings",
    exhibitionId: id,
    revision: e.revision,
    title: e.title,
    status: "open",
    gallery: "staff",
    opensAt: iso(-60000),
    closesAt: iso(3600000),
    voteOpensAt: iso(-60000),
    voteClosesAt: iso(3600000),
    recipientIds: ["member"],
  });
  await command({
    action: "participation.publish",
    exhibitionId: id,
    revision: e.revision,
  });
  await expect
    .poll(async () => (await get()).exhibition.participation.state)
    .toBe("published");
  e = (await get()).exhibition;
  await command({
    action: "participation.attendance.set",
    exhibitionId: id,
    revision: e.revision,
    userId: "member",
    vote: "attending",
  });
  await login(page, "member@example.invalid");
  const begin = await (
    await page.request.post(endpoint, { headers, data: { action: "begin" } })
  ).json();
  const bytes = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#5a8d84" },
    })
      .png()
      .toBuffer(),
    assets = [] as string[];
  for (const name of ["作品1.png", "作品2.png"]) {
    const assetId = crypto.randomUUID();
    const r = await page.request.post(`${endpoint}/upload`, {
      headers,
      multipart: {
        token: "",
        assetId,
        file: { name, mimeType: "image/png", buffer: bytes },
      },
    });
    expect(r.status()).toBe(200);
    assets.push(assetId);
  }
  const content = {
    ...begin.submission.draft,
    name: "佐藤 花子",
    grade: "2年",
    authorName: "花子",
    notes: "元の備考",
    sections: [
      {
        sectionId,
        singles: 0,
        series: 1,
        books: 0,
        seriesPhotoCounts: [2],
        fields: {},
      },
    ],
    works: [
      {
        id: crypto.randomUUID(),
        sectionId,
        kind: "series",
        title: "夜にほどける街",
        caption: "元の説明",
        location: "",
        equipment: "",
        settings: "",
        details: {
          place: "六本木",
          prefecture: "東京都",
          region: "",
          camera: "カメラ",
          lens: "レンズ",
          film: "",
          shutterSpeed: "1/250秒",
          iso: "400",
          fNumber: "2.8",
        },
        fields: { [fieldId]: "額装", [checkboxId]: ["額装"] },
        photos: assets.map((assetId, i) => ({
          assetId,
          x: i * 220,
          y: 0,
          width: 210,
          height: 297,
          rotation: 0,
        })),
      },
    ],
  };
  let r = await page.request.post(endpoint, {
    headers,
    data: { action: "submit", revision: begin.submission.revision, content },
  });
  expect(r.status(), await r.text()).toBe(200);
  let submitted = await r.json();
  const draft = { ...content, notes: "出展者が作成中の備考" };
  r = await page.request.post(endpoint, {
    headers,
    data: {
      action: "save",
      revision: submitted.submission.revision,
      content: draft,
    },
  });
  expect(r.status()).toBe(200);
  // The public upload route never becomes a way to edit someone else's closed form.
  expect(
    (
      await page.request.post(`${adminEndpoint}/upload`, {
        headers,
        multipart: {
          submissionId: begin.submission.id,
          revision: 1,
          exhibitionRevision: 1,
          assetId: crypto.randomUUID(),
          file: { name: "拒否.png", mimeType: "image/png", buffer: bytes },
        },
      })
    ).status(),
  ).toBe(403);
  await login(page);
  e = (await get()).exhibition;
  await command({
    action: "settings",
    exhibitionId: id,
    revision: e.revision,
    title: e.title,
    status: "closed",
    gallery: "staff",
    opensAt: e.opensAt,
    closesAt: e.closesAt,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/Member/manage/exhibitions/${id}/submissions`);
  await page.getByRole("tab", { name: "提出状況", exact: true }).click();
  await page.locator("[data-submission-detail]").first().click();
  const modal = page.locator(".submission-editor-dialog");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("heading", { name: "Submission", exact: true }),
  ).toBeVisible();
  await expect(modal.locator("[data-se-next]")).toBeDisabled();
  await expect(modal.locator("[data-series-review] image")).toHaveCount(2);
  const edit = async (label: string) => {
    await modal
      .getByRole("button", { name: label + "を修正", exact: true })
      .click();
  };
  await edit("作品タイトル");
  await modal.locator('[data-work-key="title"]').fill("夜の輪郭");
  await edit("キャプション");
  await modal.locator('[data-work-key="caption"]').fill("あ".repeat(155) + "i");
  await expect(
    modal.locator("[data-text-counter]").filter({ hasText: "（8pt）" }),
  ).toBeVisible();
  await edit("学年");
  await modal.locator('[data-common="grade"]').selectOption("修士1年");
  await edit("撮影場所");
  await modal.locator('[data-work-detail="place"]').fill("新宿");
  await modal.locator('[data-work-detail="prefecture"]').selectOption("東京都");
  await edit("展示方法の希望");
  await modal.locator(`[data-se-field="${fieldId}"]`).fill("壁面に額装");
  await edit("展示オプション（必須）");
  await modal.getByLabel("直貼り", { exact: true }).check();
  await expect(modal.getByLabel("額装", { exact: true })).toBeChecked();
  await edit("その他ご意見、ご要望など");
  await modal.locator('[data-common="notes"]').fill("運営が修正した備考\n末尾");
  await modal.locator('[data-se-upload="0"]').setInputFiles({
    name: "差し替えた作品.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(modal.locator(".se-photo-row").first()).toContainText(
    "差し替えた作品.png",
  );
  await expect(modal.locator(".se-photo-row").first()).toContainText("KB");
  await modal
    .getByRole("button", { name: "配置・サイズを修正", exact: true })
    .click();
  const popup = page.locator(".series-editor-dialog");
  await expect(popup.locator("[data-series-editor]")).toBeVisible();
  await popup.locator('[data-series-dimensions="0"] summary').click();
  await popup.locator('[data-series-paper="0"]').selectOption("A4");
  await popup.locator('[data-series-orientation="0"]').selectOption("landscape");
  await popup.locator('[data-series-dimensions="1"] summary').click();
  await popup.locator('[data-series-index="1"][data-series-photo-key="x"]').fill("320");
  await popup.locator('[data-series-index="1"][data-series-photo-key="x"]').press("Tab");
  await popup.locator("[data-series-dialog-close]").first().click();
  await expect(modal.locator('[data-series-review-photo="1"]')).toHaveAttribute(
    "data-photo-x",
    "320",
  );
  await modal.getByRole("button", { name: "枚数を修正", exact: true }).click();
  await modal.locator('[data-se-count="books"]').fill("1");
  await modal.locator('[data-se-count="books"]').press("Tab");
  await modal
    .getByRole("button", { name: "提出内容に戻る", exact: true })
    .click();
  const bookId = await modal
    .locator("[data-se-work] option")
    .last()
    .getAttribute("value");
  await modal.locator("[data-se-work]").selectOption(bookId!);
  await edit("作品タイトル");
  await modal.locator('[data-work-key="title"]').fill("追加した本");
  await modal.locator("[data-se-work]").selectOption(content.works[0].id);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true);
    const footer = (await modal.locator(".se-footer").boundingBox())!,
      dialog = (await modal.boundingBox())!;
    expect(footer.height).toBeLessThan(120);
    expect(footer.y + footer.height).toBeLessThanOrEqual(
      dialog.y + dialog.height,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await modal.screenshot({
      path: info.outputPath(`staff-edit-${width}.png`),
    });
  }
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await modal.locator("[data-se-next]").click();
  await expect(
    modal.getByRole("heading", { name: "Confirm", exact: true }),
  ).toBeVisible();
  await expect(modal.locator(".se-changes")).toContainText("夜の輪郭");
  await expect(modal.locator(".se-changes")).toContainText(
    "差し替えた作品.png",
  );
  await expect(modal.locator(".se-changes")).toContainText("追加した本");
  await expect(modal).toContainText(
    "出展者が保存中の未提出の下書きは保持します",
  );
  await modal.screenshot({ path: info.outputPath("staff-edit-confirm.png") });
  await modal.locator("[data-se-save]").click();
  await expect(page.locator(".exhibition-status")).toContainText(
    "提出内容の修正を保存しました",
  );
  await expect(
    modal.getByRole("heading", { name: "Submission", exact: true }),
  ).toBeVisible();
  const saved = await get(),
    s = saved.submissions[0];
  expect(s.versions).toHaveLength(2);
  expect(s.versions[1].source).toBe("staff");
  expect(s.content.works[0].title).toBe("夜の輪郭");
  expect(s.content.works[0].photos[0].width).toBe(297);
  expect(s.content.works[0].photos[1].x).toBe(320);
  expect(s.content.works[0].location).toBe("新宿 / 東京都");
  expect(s.content.sections[0].books).toBe(1);
  expect(s.content.works[0].fields[fieldId]).toBe("壁面に額装");
  expect(s.content.works[0].fields[checkboxId]).toEqual(["額装", "直貼り"]);
  expect(s.content.grade).toBe("修士1年");
  expect(s.draft.notes).toBe("出展者が作成中の備考");
  expect(s.draft.works[0].title).toBe("夜にほどける街");
  await modal.locator('[data-se-tab="history"]').click();
  await expect(modal).toContainText("運営による修正");
  await modal
    .getByText("保存中の下書き（未提出の変更）", { exact: true })
    .click();
  await expect(modal).toContainText("出展者が作成中の備考");
  await modal.locator('[data-se-tab="qr"]').click();
  await expect(modal).toContainText("最新の提出内容");
  await expect(modal.locator(".exhibition-qr img")).toBeVisible();
  await modal.locator('[data-se-tab="content"]').click();
  // A same-name replacement alone must enable saving and keep the old asset in history.
  const priorAsset = s.content.works[0].photos[0].assetId;
  await modal.locator('[data-se-upload="0"]').setInputFiles({
    name: "差し替えた作品.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(modal.locator("[data-se-next]")).toBeEnabled();
  await modal.locator("[data-se-next]").click();
  await expect(modal.locator(".se-after")).toContainText(
    "差し替えた作品.png（画像を差し替え）",
  );
  await modal.locator("[data-se-save]").click();
  await expect(
    modal.getByRole("heading", { name: "Submission", exact: true }),
  ).toBeVisible();
  const replacement = (await get()).submissions[0];
  expect(replacement.versions).toHaveLength(3);
  expect(replacement.content.works[0].photos[0].assetId).not.toBe(priorAsset);
  expect(replacement.draft.notes).toBe("出展者が作成中の備考");
  // A conflicting change keeps the local correction and refuses a stale save.
  await edit("名前");
  await modal.locator('[data-common="name"]').fill("未保存の修正");
  const fresh = await get();
  await command({
    action: "submission.edit",
    exhibitionId: id,
    revision: fresh.exhibition.revision,
    submissionId: s.id,
    submissionRevision: fresh.submissions[0].revision,
    content: { ...fresh.submissions[0].content, notes: "他の運営による変更" },
  });
  await modal.locator("[data-se-next]").click();
  await modal.locator("[data-se-save]").click();
  await expect(modal.locator("[data-se-message]")).toContainText(
    "別の画面で変更",
  );
  await expect(modal.locator(".se-after")).toContainText(["未保存の修正"]);
  page.once("dialog", (d) => d.accept());
  await modal.locator("[data-submission-detail-close]").click();
  await expect(modal).toHaveCount(0);
  const anonymous = await browser.newContext();
  try {
    expect(
      (
        await anonymous.request.post(
          `http://127.0.0.1:4329${adminEndpoint}/upload`,
          {
            headers,
            multipart: {
              file: { name: "拒否.png", mimeType: "image/png", buffer: bytes },
            },
          },
        )
      ).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});
