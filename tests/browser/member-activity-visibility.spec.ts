import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fixtureLogin } from "./fixture-auth";
import { defaultRules, emptyActivities, type ActivityEvent, type ActivityStore, type MemberNotification } from "../../src/lib/activityTypes";
import type { ExhibitionStore } from "../../src/lib/exhibitionTypes";
import { defaultShiftConfig, type ExhibitionShiftStore } from "../../src/lib/exhibitionShiftTypes";

const headers = { Origin: "http://127.0.0.1:4329" };
test("ended events and exhibitions stay in the calendar while ordinary lists, notices and unread totals exclude them", async ({ page }, info) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  expect(directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))).toBe(true);
  const read = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString(), day = (delta: number) => new Date(now + delta * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
  const prefix = `期限確認 ${info.project.name}`;
  const event = (ended: boolean): ActivityEvent => ({ id: crypto.randomUUID(), title: `${prefix} ${ended ? "終了企画" : "開催中企画"}`, status: "published", revision: 1, description: "期限確認", startsAt: iso(ended ? -41 * 86400000 : -86400000), endsAt: iso(ended ? -40 * 86400000 : 86400000), deadline: iso(ended ? -42 * 86400000 : -2 * 86400000), meeting: "集合場所", itinerary: "行程", fee: "無料", theme: "撮影", ownerId: "planner", ownerName: "運営", recipientIds: ["member"], createdAt: iso(-2 * 86400000), updatedAt: iso(-2 * 86400000), votes: {}, rules: defaultRules(), groupHistory: [] });
  const ended = event(true), active = event(false);
  const exhibitions = read<ExhibitionStore>("exhibitions.json");
  const exhibition = (done: boolean) => ({ ...structuredClone(exhibitions.exhibitions[0]), id: crypto.randomUUID(), title: `${prefix} ${done ? "終了写真展" : "開催前写真展"}`, opensAt: iso(-10 * 86400000), closesAt: iso(-86400000), openingSchedule: { startDate: day(done ? -4 : 4), endDate: day(done ? -3 : 5), regular: { open: "10:00", close: "17:00" } }, participation: { state: "published" as const, opensAt: iso(-12 * 86400000), closesAt: iso(-11 * 86400000), recipientIds: ["member"], votes: {} }, notices: [] });
  const oldExhibition = exhibition(true), nextExhibition = exhibition(false);
  exhibitions.exhibitions.push(oldExhibition, nextExhibition); write("exhibitions.json", exhibitions);
  const shifts: ExhibitionShiftStore = fs.existsSync(path.join(directory, "exhibition-shifts.json")) ? read("exhibition-shifts.json") : { version: 1, records: [] };
  for (const e of [oldExhibition, nextExhibition]) shifts.records.push({ exhibitionId: e.id, revision: 1, config: { ...defaultShiftConfig(), state: "open", opensAt: iso(-10 * 86400000), closesAt: iso(-86400000) }, responses: [], guests: [], plan: { revision: 0, assignments: [], sourceKey: "" }, history: [], sync: { revision: 0, delivered: 0, attempts: 0, nextAttemptAt: 0 }, notices: [] });
  write("exhibition-shifts.json", shifts);
  const data = fs.existsSync(path.join(directory, "member-activities.json")) ? read<ActivityStore>("member-activities.json") : emptyActivities();
  data.events.push(ended, active);
  const notice = (title: string, relation: Partial<MemberNotification> = {}): MemberNotification => ({ id: crypto.randomUUID(), title, body: "期限確認", senderId: "planner", senderName: "運営", recipientIds: ["member"], createdAt: iso(-86400000), readBy: {}, ...relation });
  const visible = [notice(active.title, { eventId: active.id }), notice(nextExhibition.title, { exhibitionId: nextExhibition.id }), ...Array.from({ length: 11 }, (_, i) => notice(`${prefix} 一般のお知らせ${i}`))];
  const hidden = [notice(ended.title, { eventId: ended.id }), notice(oldExhibition.title, { exhibitionId: oldExhibition.id }), notice(`${prefix} 終了シフト通知`, { exhibitionId: oldExhibition.id, kind: "exhibition-shift" })];
  data.notifications.push(...visible, ...hidden); write("member-activities.json", data);
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "member@example.invalid", password: "fixture-password-123" } })).status()).toBe(200);
  const all: { id: string }[] = [];
  let total = 0, unread = 0;
  for (let offset = 0; offset === 0 || offset < total; offset += 30) {
    const response = await page.request.get(`/api/member/activities?offset=${offset}`); expect(response.status()).toBe(200);
    const body = await response.json(); total = body.total; unread = body.unread; all.push(...body.notifications);
  }
  expect(all).toHaveLength(total);
  for (const n of hidden) expect(all.some(value => value.id === n.id)).toBe(false);
  for (const n of visible) expect(all.some(value => value.id === n.id)).toBe(true);
  expect((await (await page.request.get("/api/member/app-context")).json()).unread).toBe(unread);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ["list", "calendar"]) {
      await page.goto(`/Member?view=${view}&month=${day(0).slice(0, 7)}`);
      const notices = page.locator('[aria-labelledby="notification-heading"]');
      await expect(notices.locator("h2 .activity-badge")).toHaveText(`未読 ${unread}`);
      for (const n of hidden) await expect(notices.getByText(n.title, { exact: true })).toHaveCount(0);
      const section = page.getByRole("region", { name: "企画", exact: true });
      if (view === "list") {
        await expect(section).not.toContainText(ended.title); await expect(section).not.toContainText(oldExhibition.title);
        await expect(page.locator(".member-dashboard")).not.toContainText(oldExhibition.title);
        await expect(section).toContainText(active.title); await expect(section).toContainText(nextExhibition.title);
      } else {
        for (const entry of [{ startsAt: ended.startsAt, title: ended.title, href: `/Member/events/${ended.id}` }, { startsAt: oldExhibition.opensAt, title: `写真展・フォーム入力：${oldExhibition.title}`, href: `/Member/exhibitions/${oldExhibition.id}` }]) {
          const month = new Date(Date.parse(entry.startsAt) + 9 * 3600000).toISOString().slice(0, 7);
          await page.goto(`/Member?view=calendar&month=${month}`);
          await expect(section.locator(`.activity-calendar-bar[href="${entry.href}"]`).first()).toBeVisible();
          await expect(section.locator(".activity-month-events").getByRole("link", { name: entry.title, exact: true })).toBeVisible();
          const share = section.locator(".activity-month-events").getByRole("button", { name: `${entry.title}を共有`, exact: true });
          await share.click();
          await expect(page.locator("#activity-share-url")).toHaveValue(`https://scharade.jp${entry.href}`);
          await page.getByRole("button", { name: "共有画面を閉じる" }).click();
          for (const n of hidden) await expect(notices.getByText(n.title, { exact: true })).toHaveCount(0);
          await expect(notices.locator("h2 .activity-badge")).toHaveText(`未読 ${unread}`);
          await expect(page.locator(".member-dashboard > section").filter({ has: page.getByRole("heading", { name: "展示シフト", exact: true }) })).not.toContainText(oldExhibition.title);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
  await page.goto("/Member?notices=9999");
  const list = page.locator('[aria-labelledby="notification-heading"] .activity-list > li');
  expect(await list.count()).toBe(total % 10 || 10);
  await expect(page.getByRole("link", { name: "以前の通知", exact: true })).toHaveCount(0);
  expect(read<ActivityStore>("member-activities.json").notifications).toHaveLength(data.notifications.length);
  expect(read<ExhibitionStore>("exhibitions.json").exhibitions.some(e => e.id === oldExhibition.id)).toBe(true);
  for (const url of [`/Member/events/${ended.id}`, `/Member/notifications/${hidden[0].id}`, `/Member/exhibitions/${oldExhibition.id}`]) expect((await page.request.get(url)).status()).toBe(200);
});
