import { test } from "node:test";
import assert from "node:assert/strict";
import { eventHasEnded, exhibitionHasEnded, visibleMemberNotifications } from "../src/lib/memberActivityVisibility.ts";
import { defaultRules, type ActivityEvent, type MemberNotification } from "../src/lib/activityTypes.ts";
import type { Exhibition } from "../src/lib/exhibitionTypes.ts";

const now = Date.parse("2026-11-10T17:00:00+09:00");
const schedule = { startDate: "2026-11-08", endDate: "2026-11-10", regular: { open: "10:00", close: "17:00" } };
test("events disappear at the end instant, while future and unknown end times remain", () => {
  assert.equal(eventHasEnded({ endsAt: new Date(now - 1).toISOString() }, now), true);
  assert.equal(eventHasEnded({ endsAt: new Date(now).toISOString() }, now), true);
  assert.equal(eventHasEnded({ endsAt: new Date(now + 1).toISOString() }, now), false);
  for (const endsAt of ["", "unknown"]) assert.equal(eventHasEnded({ endsAt }, now), false);
});
test("exhibitions end at the final closing time in Japan", () => {
  assert.equal(exhibitionHasEnded({ openingSchedule: schedule }, now - 1), false);
  assert.equal(exhibitionHasEnded({ openingSchedule: schedule }, now), true);
  assert.equal(exhibitionHasEnded({ openingSchedule: schedule }, now + 1), true);
  assert.equal(exhibitionHasEnded({ openingSchedule: { ...schedule, last: { open: "10:00", close: "18:00" } } }, now), false);
  assert.equal(exhibitionHasEnded({ openingSchedule: { ...schedule, last: { open: "10:00", close: "16:00" } } }, now - 3600000), true);
});
test("single-day first-day hours take priority, matching the exhibition schedule", () => {
  assert.equal(exhibitionHasEnded({ openingSchedule: { ...schedule, startDate: schedule.endDate, first: { open: "10:00", close: "18:00" }, last: { open: "10:00", close: "16:00" } } }, now), false);
  assert.equal(exhibitionHasEnded({ openingSchedule: { ...schedule, first: { open: "10:00", close: "18:00" } } }, now), true);
});
test("an unknown exhibition schedule is not confused with a submission deadline or closed intake", () => {
  const exhibition = { status: "closed", closesAt: "2020-01-01T00:00:00Z", openingSchedule: undefined };
  assert.equal(exhibitionHasEnded(exhibition, now), false);
  assert.equal(exhibitionHasEnded({ openingSchedule: { ...schedule, endDate: "invalid" } }, now), false);
});
test("only recipient notices linked to ended events or exhibitions are hidden, without altering stored history", () => {
  const event = (id: string, endsAt: string): ActivityEvent => ({ id, title: id, endsAt, startsAt: "2026-11-01T00:00:00Z", deadline: "2026-10-01T00:00:00Z", status: "published", revision: 1, description: "", meeting: "", itinerary: "", fee: "", theme: "", ownerId: "staff", ownerName: "Staff", recipientIds: ["member"], createdAt: "", updatedAt: "", votes: {}, rules: defaultRules(), groupHistory: [] });
  const notice = (id: string, relation: Partial<MemberNotification> = {}): MemberNotification => ({ id, title: id, body: "", senderId: "staff", senderName: "Staff", recipientIds: ["member"], createdAt: "", readBy: {}, ...relation });
  const data = { events: [event("ended", new Date(now).toISOString()), event("ongoing", new Date(now + 1).toISOString())], notifications: [
    notice("event", { eventId: "ended" }), notice("cancellation", { kind: "cancellation", eventId: "ended" }), notice("reminder", { kind: "reminder", eventId: "ended" }),
    notice("exhibition", { exhibitionId: "ended" }), notice("shift", { kind: "exhibition-shift", exhibitionId: "ended" }),
    notice("ongoing", { eventId: "ongoing" }), notice("future", { exhibitionId: "future" }), notice("unscheduled", { exhibitionId: "unscheduled" }),
    notice("general"), notice("tool", { toolId: "tool" }), notice("unknown", { eventId: "unknown" }), notice("other", { recipientIds: ["other"] }),
  ] };
  const exhibitions: Pick<Exhibition, "id" | "openingSchedule">[] = [{ id: "ended", openingSchedule: schedule }, { id: "future", openingSchedule: { ...schedule, endDate: "2026-11-11" } }, { id: "unscheduled" }];
  const before = structuredClone({ data, exhibitions });
  assert.deepEqual(visibleMemberNotifications(data, exhibitions, "member", now).map(n => n.id), ["ongoing", "future", "unscheduled", "general", "tool", "unknown"]);
  assert.deepEqual({ data, exhibitions }, before);
  assert.deepEqual(visibleMemberNotifications(data, exhibitions, "other", now).map(n => n.id), ["other"]);
  data.events[0].endsAt = new Date(now + 1).toISOString();
  assert.ok(visibleMemberNotifications(data, exhibitions, "member", now).some(n => n.id === "event"));
});
