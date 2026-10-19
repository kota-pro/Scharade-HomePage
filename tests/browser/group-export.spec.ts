import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
test("confirmed groups scroll horizontally, copy per-group images, export all groups and copy formatted TXT", async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => {
        if ((window as any).denyCopy) throw new Error("permission denied");
        (window as any).copiedText = text;
      },
      write: async (items: ClipboardItem[]) => {
        if ((window as any).denyCopy) throw new Error("permission denied");
        const blob = await items[0].getType("image/png");
        (window as any).copiedImage = { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
      },
    } });
  });
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } })).status()).toBe(200);
  const people = Array.from({ length: 24 }, (_, i) => ({ id: `guest-${crypto.randomUUID()}`, name: i === 0 ? "名前の長い参加者".repeat(8) : `氏名${i + 1}`, lineName: i === 2 ? "kota" : i === 0 ? "" : `LINE ${i + 1}`, grade: i < 2 ? "1" : i % 2 ? "3" : "4", gender: i < 2 ? "female" : "male" }));
  async function post(data: Record<string, unknown>) {
    const response = await page.request.post("/api/member/grouping", { headers, data });
    expect(response.status(), await response.text()).toBe(200); return response.json();
  }
  const created = await post({ action: "run.save", title: `画像出力検証 ${info.project.name}`, participantIds: people.map(p => p.id), extraParticipants: people });
  const runId = created.runId, path = `/Member/manage/grouping/${runId}`;
  const groups = Array.from({ length: 6 }, (_, i) => ({ leaderId: people[i * 4 + 2].id, memberIds: people.slice(i * 4, i * 4 + 4).map(p => p.id) }));
  await post({ action: "groups.rules", runId, revision: 1, rules: { count: 6, min: 4, max: 4, leaders: groups.map(g => g.leaderId), together: [], apart: [[people[0].id, people[1].id]] } });
  await post({ action: "groups.generate", runId, revision: 2 });
  await page.goto(path);
  await expect(page.locator("[data-group-export]")).toHaveCount(0);
  const source = await page.locator('form[data-activity-action="groups.save"]').getAttribute("data-source");
  await post({ action: "groups.save", runId, revision: 3, source, groups });
  await post({ action: "groups.publish", runId, revision: 4, source });
  // A later draft must never change the exported published version.
  await post({ action: "groups.save", runId, revision: 5, source, groups: [groups[1], groups[0], ...groups.slice(2)] });
  await page.goto(path);
  const board = page.locator("[data-group-export]"), scroller = board.locator(".group-board-grid");
  await expect(board.locator("[data-copy-group]")).toHaveCount(6);
  for (const width of [320,390,1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const ys = await board.locator("[data-copy-group]").evaluateAll(cards => cards.map(c => c.getBoundingClientRect().top));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  }
  await board.getByRole("button", { name: "TXTでコピー", exact: true }).click();
  await expect(board.locator("[data-group-export-status]")).toHaveText("全班の名簿をTXTでコピーしました。");
  const text = await page.evaluate(() => (window as any).copiedText as string);
  expect(text).toMatch(/^１班：\n◎kota、LINE 4、/);
  expect(text).toContain("\n\n６班：\n◎LINE 23、"); expect(text).toMatch(/\n\n◎：班長$/);
  expect(text.match(/◎/g)).toHaveLength(7); expect(text).not.toContain("氏名3（");
  await board.getByRole("button", { name: "1班の画像をコピー", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(board.locator("[data-group-export-status]")).toHaveText("1班の画像をコピーしました。");
  const image = await page.evaluate(() => (window as any).copiedImage);
  expect(image.type).toBe("image/png");
  const single = Buffer.from(image.bytes); fs.writeFileSync(info.outputPath("single-group.png"), single);
  const singleMeta = await sharp(single).metadata(); expect(singleMeta.width).toBe(832);
  await board.locator('[data-copy-group="1"] .group-person').first().click();
  await expect(board.locator("[data-group-export-status]")).toHaveText("2班の画像をコピーしました。");
  // The complete image includes groups outside the viewport and wraps after five columns.
  await page.setViewportSize({ width: 390, height: 844 });
  const downloadEvent = page.waitForEvent("download");
  await board.getByRole("button", { name: "PNGで出力", exact: true }).click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/\.png$/);
  await download.saveAs(info.outputPath("all-groups.png"));
  const all = await sharp(info.outputPath("all-groups.png")).metadata();
  expect(all.width).toBeGreaterThan(3000); expect(all.height).toBeGreaterThan(singleMeta.height!);
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await board.screenshot({ path: info.outputPath("horizontal-groups-mobile.png") });
  await page.evaluate(() => { (window as any).denyCopy = true; });
  await board.getByRole("button", { name: "6班の画像をコピー", exact: true }).click();
  await expect(board.locator("[data-group-download]")).toBeVisible();
  const fallbackDownload = page.waitForEvent("download"); await board.locator("[data-group-download]").click();
  expect((await fallbackDownload).suggestedFilename()).toMatch(/_6班\.png$/);
  await board.getByRole("button", { name: "TXTでコピー", exact: true }).click();
  await expect(board.getByRole("textbox", { name: "コピー用テキスト" })).toHaveValue(text);
  expect(errors).toEqual([]);
});
