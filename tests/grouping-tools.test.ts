import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  groupingToolAction,
  readGroupingTools,
  groupingToolSummary,
} from "../src/lib/groupingTools.ts";
import { ActivityError, readActivities } from "../src/lib/activities.ts";
import {
  emptyActivities,
  defaultRules,
  type ActivityEvent,
  type ActivityStore,
} from "../src/lib/activityTypes.ts";
import { writeData, readData } from "../src/lib/store.ts";
import { validateGroups } from "../src/lib/grouping.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-grouping-tools-"));
process.env.DATA_DIR = dir;
const users = [
  {
    id: "staff",
    name: "運営",
    email: "staff@example.invalid",
    approved: true,
    role: "staff",
  },
  {
    id: "member",
    name: "会員",
    email: "member@example.invalid",
    approved: true,
    role: "member",
  },
];
let activities: ActivityStore;
beforeEach(() => {
  writeData("users.json", users);
  writeData("grouping-tools.json", { version: 1, runs: [] });
  activities = emptyActivities();
  activities.roster = {
    revision: 1,
    spreadsheetId: "fixture",
    sheetId: 1,
    title: "名簿",
    sheetTitle: "回答",
    fetchedAt: new Date().toISOString(),
    fetchedBy: "admin",
    bindings: {},
    records: Array.from({ length: 8 }, (_, i) => ({
      key: `p${i}`,
      name: `会員${i}`,
      university: "テスト大学",
      gender: i % 4 < 2 ? "female" : "male",
      grade: i % 4 < 2 ? "1" : "2",
      active: true,
    })),
  };
  writeData("member-activities.json", activities);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const action = (p: Record<string, unknown>, actor = "staff") =>
  groupingToolAction(actor, p);
const current = () => readGroupingTools().runs.at(-1)!;
const command = (name: string, p: Record<string, unknown> = {}) =>
  action({
    action: name,
    runId: current().id,
    revision: current().revision,
    ...p,
  });
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ActivityError && e.status === status,
  );
async function setup() {
  await action({
    action: "run.save",
    title: "単独の班分け",
    participantIds: activities.roster!.records.map((r) => r.key),
  });
  await command("groups.rules", {
    rules: {
      count: 2,
      min: 4,
      max: 4,
      leaders: ["p0", "p4"],
      together: [["p0", "p1"]],
      apart: [["p0", "p4"]],
    },
  });
}
const summary = () =>
  groupingToolSummary(readActivities(), readGroupingTools(), current());
test("reads attending votes as roster identities where available and keeps source labels out of group data", async () => {
  const at = new Date().toISOString();
  const event: ActivityEvent = {
    id: "fixture-event", title: "撮影会", revision: 1, status: "published", description: "",
    startsAt: at, endsAt: at, deadline: at, meeting: "", itinerary: "", fee: "", theme: "",
    ownerId: "staff", ownerName: "運営", recipientIds: ["member", "staff"],
    createdAt: at, updatedAt: at, rules: defaultRules(), groupHistory: [],
    votes: { member: { value: "attending", at, actorId: "member" }, staff: { value: "attending", at, actorId: "staff" } },
  };
  activities.events.push(event);
  activities.roster!.bindings.member = "p0";
  writeData("member-activities.json", activities);
  const read = { action: "participants.event", eventId: event.id };
  await rejects(action(read, "member"), 403);
  assert.deepEqual((await action(read)).rows, [
    { name: "運営", lineName: "", grade: "", gender: "", participantId: undefined },
    { name: "会員0", lineName: "", grade: "1", gender: "female", participantId: "p0" },
  ]);
  event.votes.staff.value = "absent";
  writeData("member-activities.json", activities);
  assert.equal(((await action(read)).rows as unknown[]).length, 1);
  event.status = "cancelled";
  writeData("member-activities.json", activities);
  await rejects(action(read), 404);
  const guest = { id: "guest-00000000-0000-4000-8000-000000000001", name: "手入力", gender: "male", grade: "2", inputSource: "manual" };
  await action({ action: "run.save", title: "投票と手入力", participantIds: ["p0", guest.id], extraParticipants: [guest], participantSources: { p0: "event", [guest.id]: "manual" } });
  assert.deepEqual(current().participantSources, { p0: "event", [guest.id]: "manual" });
  assert.equal(readGroupingTools().guests![0].inputSource, "manual");
  assert.ok(summary().people.every(person => !Object.hasOwn(person, "inputSource")));
  await command("run.save", { title: current().title, participantIds: current().participantIds });
  assert.equal(current().participantSources?.p0, "event");
  assert.deepEqual(readActivities(), activities);
});
test("standalone grouping works with unlinked Google roster members and never creates events or notifications", async () => {
  await setup();
  await command("groups.generate");
  assert.deepEqual(
    validateGroups(
      summary().people,
      current().rules,
      current().draftGroups!.groups,
    ),
    [],
  );
  await command("groups.save", {
    source: summary().source,
    groups: current().draftGroups!.groups,
  });
  await command("groups.publish", { source: summary().source });
  const first = current();
  assert.ok(first.publishedGroups);
  assert.deepEqual(readActivities(), activities);
  await action({
    action: "run.save",
    title: "次の班分け",
    participantIds: first.participantIds,
  });
  assert.equal(current().previousRunId, first.id);
  assert.equal(summary().previous!.publishedGroups!.groups.length, 2);
  await command("run.save", {
    title: current().title,
    participantIds: current().participantIds,
    previousRunId: "",
  });
  assert.equal(summary().previous, undefined);
});
test("membership, staff authorization, revisions and manual assignment constraints are checked", async () => {
  await rejects(
    action(
      { action: "run.save", title: "拒否", participantIds: ["p0"] },
      "member",
    ),
    403,
  );
  await rejects(
    action({ action: "run.save", title: "拒否", participantIds: ["foreign"] }),
    400,
  );
  activities.roster!.records[0].gender = null;
  writeData("member-activities.json", activities);
  await rejects(
    action({ action: "run.save", title: "拒否", participantIds: ["p0"] }),
    400,
  );
  activities.roster!.records[0].gender = "female";
  writeData("member-activities.json", activities);
  await setup();
  await rejects(command("groups.generate", { revision: 99 }), 409);
  await command("groups.generate");
  await rejects(
    command("groups.save", {
      source: summary().source,
      groups: [{ leaderId: "foreign", memberIds: ["foreign"] }],
    }),
    400,
  );
  const broken = structuredClone(current().draftGroups!.groups);
  broken[1].memberIds.push(broken[0].memberIds.pop()!);
  await command("groups.save", { source: summary().source, groups: broken });
  await rejects(command("groups.publish", { source: summary().source }), 400);
  assert.equal(current().publishedGroups, undefined);
});
test("changes to the roster or selected history invalidate a prepared plan", async () => {
  await setup();
  await command("groups.generate");
  const source = summary().source;
  const next = readActivities();
  next.roster!.records[2].grade = "3";
  writeData("member-activities.json", next);
  assert.equal(summary().stale, true);
  await rejects(command("groups.publish", { source }), 409);
  await command("groups.generate");
  await command("groups.publish", { source: summary().source });
  const first = current();
  await action({
    action: "run.save",
    title: "次回",
    participantIds: first.participantIds,
  });
  await command("groups.rules", { rules: first.rules });
  await command("groups.generate");
  const secondSource = summary().source;
  const tools = readGroupingTools();
  tools.runs[0].publishedGroups!.version++;
  writeData("grouping-tools.json", tools);
  await rejects(command("groups.publish", { source: secondSource }), 409);
  next.roster!.records[0].active = false;
  writeData("member-activities.json", next);
  await rejects(command("groups.generate"), 409);
});
test("generation rechecks staff role and sheet changes before writing", async () => {
  await setup();
  const timer = setTimeout(
    () =>
      writeData(
        "users.json",
        users.map((u) => ({ ...u, role: "member" })),
      ),
    0,
  );
  await rejects(command("groups.generate"), 403);
  clearTimeout(timer);
  assert.equal(current().draftGroups, undefined);
  writeData("users.json", users);
  const changed = setTimeout(() => {
    const next = readActivities();
    next.roster!.records[0].name = "更新後";
    writeData("member-activities.json", next);
  }, 0);
  await rejects(command("groups.generate"), 409);
  clearTimeout(changed);
  assert.equal(current().draftGroups, undefined);
});
test("corrupt standalone storage is not reset", async () => {
  writeData("grouping-tools.json", { version: 99, runs: [] });
  await assert.rejects(
    action({ action: "run.save", title: "保存", participantIds: ["p0"] }),
  );
  assert.deepEqual(readData("grouping-tools.json", {}), {
    version: 99,
    runs: [],
  });
});

test("deletion requires staff, current revision and confirmation, and works even with a missing roster", async () => {
  await setup();
  const before = readGroupingTools();
  const payload = {
    action: "run.delete",
    runId: current().id,
    revision: current().revision,
    confirmation: "delete",
  };
  await rejects(action(payload, "member"), 403);
  await rejects(action({ ...payload, revision: 99 }), 409);
  await rejects(action({ ...payload, confirmation: "" }), 400);
  assert.deepEqual(readGroupingTools(), before);
  delete activities.roster;
  writeData("member-activities.json", activities);
  await action(payload);
  assert.deepEqual(readGroupingTools().runs, []);
  assert.deepEqual(readActivities(), activities);
  await rejects(action(payload), 404);
});
test("deleting a referenced confirmed run preserves existing repeat checks but removes it from future choices", async () => {
  await setup();
  await command("groups.generate");
  await command("groups.publish", { source: summary().source });
  const first = current();
  await action({
    action: "run.save",
    title: "次回",
    participantIds: first.participantIds,
  });
  await command("groups.rules", { rules: first.rules });
  await command("groups.generate");
  const source = summary().source;
  await action({
    action: "run.delete",
    runId: first.id,
    revision: first.revision,
    confirmation: "delete",
  });
  assert.equal(readGroupingTools().runs.length, 1);
  assert.equal(summary().source, source);
  assert.equal(summary().stale, false);
  assert.deepEqual(summary().previous?.publishedGroups, first.publishedGroups);
  await command("run.save", {
    title: current().title,
    participantIds: current().participantIds,
    previousRunId: first.id,
  });
  assert.equal(summary().source, source);
  await rejects(
    action({
      action: "run.save",
      title: "別の新規班分け",
      participantIds: first.participantIds,
      previousRunId: first.id,
    }),
    400,
  );
  await command("run.save", {
    title: current().title,
    participantIds: current().participantIds,
    previousRunId: "",
  });
  assert.equal(current().previousSnapshot, undefined);
  await action({
    action: "run.save",
    title: "新規班分け",
    participantIds: first.participantIds,
  });
  assert.equal(current().previousRunId, "");
  assert.deepEqual(readActivities(), activities);
});
test("LINE display changes preserve a prepared grouping source", async () => {
  await setup();
  await command("groups.generate");
  const source = summary().source;
  activities.roster!.records[0].lineName = "line0";
  writeData("member-activities.json", activities);
  assert.equal(summary().people[0].lineName, "line0");
  assert.equal(summary().source, source);
  await command("groups.publish", { source });
  assert.equal(current().publishedGroups!.people![0].lineName, "line0");
});

test("guest-only runs reuse stable identities and preserve snapshots after candidate expiry", async () => {
  const guests = Array.from({length: 8}, (_, i) => ({ id: `guest-00000000-0000-4000-8000-${String(i).padStart(12,"0")}`, name: `追加${i}`, lineName: `line${i}`, gender: i % 4 < 2 ? "female" : "male", grade: i % 4 < 2 ? "1" : "2" }));
  delete activities.roster;
  writeData("member-activities.json", activities);
  const accounts = readData("users.json", []);
  await action({ action: "run.save", title: "追加参加者だけ", participantIds: guests.map(p => p.id), extraParticipants: guests });
  await command("groups.rules", { rules: { count: 2, min: 4, max: 4, leaders: [guests[0].id, guests[4].id], together: [[guests[0].id, guests[1].id]], apart: [[guests[0].id, guests[4].id]] } });
  await command("groups.generate");
  await command("groups.publish", { source: summary().source });
  const first = current();
  assert.deepEqual(first.publishedGroups!.people, guests);
  assert.equal(readGroupingTools().guests!.length, 8);
  await action({ action: "run.save", title: "再利用", participantIds: first.participantIds });
  assert.deepEqual(summary().people, guests);
  assert.equal(current().previousRunId, first.id);
  const expired = readGroupingTools();
  expired.guests!.forEach(p => p.expiresAt = "2000-01-01T00:00:00.000Z");
  writeData("grouping-tools.json", expired);
  assert.equal(readGroupingTools().guests!.length, 0);
  assert.deepEqual(summary().people, guests);
  assert.deepEqual(readGroupingTools().runs[0].publishedGroups, first.publishedGroups);
  await rejects(action({ action: "run.save", title: "期限切れの新規利用", participantIds: first.participantIds }), 400);
  await command("run.save", { title: current().title, participantIds: current().participantIds });
  assert.equal(readGroupingTools().guests!.length, 8);
  assert.ok(readGroupingTools().guests!.every(p => Date.parse(p.expiresAt) > Date.now()));
  assert.deepEqual(readActivities(), activities);
  assert.deepEqual(readData("users.json", []), accounts);
});
test("guest input validation and failures leave all saved data untouched", async () => {
  const guest = { id: "guest-00000000-0000-4000-8000-000000000001", name: "追加", gender: "male", grade: "3" };
  for (const invalid of [{ ...guest, name: " " }, { ...guest, grade: "unknown" }, { ...guest, gender: "" }, { ...guest, id: "p0" }]) {
    await rejects(action({ action: "run.save", title: "不正入力", participantIds: [invalid.id], extraParticipants: [invalid] }), 400);
    assert.deepEqual(readGroupingTools(), { version: 1, runs: [] });
  }
  await rejects(action({ action: "run.save", title: "権限なし", participantIds: [guest.id], extraParticipants: [guest] }, "member"), 403);
  await action({ action: "run.save", title: "保存", participantIds: [guest.id, guest.id], extraParticipants: [guest] });
  assert.deepEqual(current().participantIds, [guest.id]);
  await command("run.save", { title: "保存", participantIds: [guest.id], extraParticipants: [{ ...guest, name: "勝手に上書き" }] });
  assert.equal(summary().people[0].name, "追加");
});
