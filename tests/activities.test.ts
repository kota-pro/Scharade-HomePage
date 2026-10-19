import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { activityTextParts } from "../src/lib/activityPresentation.ts";
import { groupingPeople, type GroupingRun } from "../src/lib/groupingTools.ts";
import {
  activityAction,
  ActivityError,
  readActivities,
  memberEvent,
  publicEvent,
  groupSource,
  previousEvent,
} from "../src/lib/activities.ts";
import { writeData, readData } from "../src/lib/store.ts";
import { emptyActivities, defaultRules } from "../src/lib/activityTypes.ts";
import {
  isStaff,
  isAdmin,
  createSession,
  getUserFromSession,
  type User,
} from "../src/lib/auth.ts";
import {
  updateAccountRegistration,
  accountRevision,
  accountRegistration,
} from "../src/lib/accountManagement.ts";
import {
  activityRosterSource,
  rosterSuggestions,
  rosterGrade,
  rosterGender,
} from "../src/lib/activityRoster.ts";
const originalFetch = globalThis.fetch;
let rosterRows: Array<{
  key: string;
  name: string;
  lineName?: string;
  university: string;
  gender: string;
  grade: string;
  active: boolean;
}>;
const rowKey = (id: string) =>
  crypto.createHash("sha256").update(id).digest("hex");
async function syncRoster() {
  return act("u0", {
    action: "roster.sync",
    revision: readActivities().roster?.revision ?? 0,
  });
}
async function linkRoster(bindings: Record<string, string>) {
  return act("u0", {
    action: "roster.link",
    revision: readActivities().roster!.revision,
    bindings,
  });
}
async function changeRosterGrade(id: string, grade: string) {
  rosterRows.find((r) => r.key === rowKey(id))!.grade = grade;
  await syncRoster();
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-activities-"));
process.env.DATA_DIR = dir;
const users: User[] = Array.from({ length: 10 }, (_, i) => ({
  id: `u${i}`,
  name: `メンバー${i}`,
  email: `u${i}@example.invalid`,
  approved: i !== 9,
  role: i === 0 ? "admin" : i === 1 ? "staff" : "member",
  createdAt: "2026-01-01",
  providers: {},
}));
let now = Date.parse("2026-10-01T00:00:00Z");
const act = (actor: string, data: Record<string, unknown>) =>
  activityAction(actor, data, () => now);
const reject = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ActivityError && e.status === status,
  );
const latest = () => readActivities().events[0];
const edit = (changes = {}) => ({
  ...latest(),
  action: "event.save",
  eventId: latest().id,
  ...changes,
});
beforeEach(() => {
  now = Date.parse("2026-10-01T00:00:00Z");
  process.env.ACCOUNTING_GAS_URL =
    "https://script.google.com/macros/s/fixture/exec";
  process.env.ACCOUNTING_WEBHOOK_SECRET =
    "test-roster-secret-at-least-32-characters";
  rosterRows = users.map((u) => ({
    key: rowKey(u.id),
    name: u.name,
    university: "大学",
    gender: "男",
    grade: "2年生",
    active: true,
  }));
  globalThis.fetch = async (_input, options) => {
    const envelope = JSON.parse(String(options?.body));
    assert.equal(JSON.parse(envelope.payload).action, "roster.read");
    return Response.json({
      ok: true,
      ...activityRosterSource,
      sheetTitle: "フォームの回答 1",
      records: rosterRows,
    });
  };
  writeData("users.json", users);
  writeData("sessions.json", []);
  writeData("member-activities.json", emptyActivities());
});
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});
async function event() {
  await act("u1", {
    action: "event.save",
    title: "秋の撮影合宿",
    description: "撮影します",
    startsAt: "2026-10-05T09:00:00+09:00",
    endsAt: "2026-10-06T18:00:00+09:00",
    deadline: "2026-10-02T21:00:00+09:00",
    meeting: "駅前",
    itinerary: "集合\n撮影",
    fee: "1000円",
    theme: "秋",
    ownerId: "u1",
    recipientIds: users.slice(0, 8).map((u) => u.id),
  });
}
async function published() {
  await event();
  await act("u1", {
    action: "event.publish",
    eventId: latest().id,
    revision: latest().revision,
  });
}
test("event images survive edits and publication; untrusted image sources are rejected", async () => {
  await event();
  const image = "https://images.microcms-assets.io/assets/fixture/header.webp";
  await act("u1", edit({ headerImage: image }));
  assert.equal(latest().headerImage, image);
  assert.equal(readActivities().notifications.length, 0);
  for (const value of [
    "javascript:alert(1)",
    "https://evil.invalid/a.webp",
    "https://images.microcms-assets.io.evil.invalid/a",
    "https://user:password@images.microcms-assets.io/a",
  ]) {
    await reject(act("u1", edit({ headerImage: value })), 400);
    assert.equal(latest().headerImage, image);
  }
  await reject(act("u2", edit({ headerImage: "" })), 403);
  const withoutImage = edit();
  delete withoutImage.headerImage;
  await act("u1", withoutImage);
  assert.equal(latest().headerImage, image);
  await act("u1", {
    action: "event.publish",
    eventId: latest().id,
    revision: latest().revision,
  });
  assert.equal(
    memberEvent(readActivities(), latest(), users[2], users, now).headerImage,
    image,
  );
  await act("u1", edit({ headerImage: "" }));
  assert.equal(latest().headerImage, "");
});
test("web links preserve prose and Japanese punctuation without making HTML executable", () => {
  const value =
    "案内：https://example.com/企画?q=1&b=2。\n集合 (https://maps.example/place_(park))。<img src=x onerror=alert(1)> javascript:alert(1) https://bad@host.example/a";
  const parts = activityTextParts(value);
  assert.equal(parts.map((p) => p.text).join(""), value);
  assert.deepEqual(
    parts.filter((p) => p.href).map((p) => p.href),
    [
      "https://example.com/%E4%BC%81%E7%94%BB?q=1&b=2",
      "https://maps.example/place_(park)",
    ],
  );
  assert.equal(
    activityTextParts("https://").some((p) => p.href),
    false,
  );
});
async function ready() {
  await published();
  await syncRoster();
  await linkRoster(
    Object.fromEntries(users.slice(0, 8).map((u) => [u.id, rowKey(u.id)])),
  );
  for (const u of users.slice(0, 8)) {
    await act(u.id, {
      action: "vote",
      eventId: latest().id,
      vote: "attending",
    });
  }
  now = Date.parse(latest().deadline);
  await act("u1", {
    action: "groups.rules",
    eventId: latest().id,
    revision: latest().revision,
    rules: { ...defaultRules(), count: 2, leaders: ["u0", "u1"] },
  });
}
test("three levels preserve administrator powers and revoke a promoted member's sessions", async () => {
  assert.equal(isStaff(users[1]), true);
  assert.equal(isAdmin(users[1]), false);
  assert.equal(isStaff(users[2]), false);
  const session = await createSession("u2", 100);
  await updateAccountRegistration("u0", "u2", {
    ...accountRegistration(users[2]),
    role: "staff",
    revision: accountRevision(users[2]),
  });
  assert.equal(getUserFromSession(session.token).user, null);
  await assert.rejects(
    updateAccountRegistration("u0", "u0", {
      ...accountRegistration(users[0]),
      role: "staff",
      revision: accountRevision(users[0]),
    }),
    /最後の承認済み管理者/,
  );
  await assert.rejects(
    updateAccountRegistration("u1", "u2", {
      ...accountRegistration(users[2]),
      role: "admin",
      revision: accountRevision(users[2]),
    }),
    /管理者権限/,
  );
});
test("notifications enforce sender and recipient authorization; read is private and send is retry-safe", async () => {
  const input = {
    action: "notification.send",
    id: crypto.randomUUID(),
    title: "会費",
    body: "連絡",
    recipientIds: ["u2"],
  };
  await reject(act("u2", input), 403);
  await reject(act("u9", input), 401);
  await act("u1", input);
  await act("u1", input);
  assert.equal(readActivities().notifications.length, 1);
  await reject(act("u3", { action: "notification.read", id: input.id }), 404);
  await act("u2", { action: "notification.read", id: input.id });
  assert.deepEqual(Object.keys(readActivities().notifications[0].readBy), [
    "u2",
  ]);
  await reject(
    act("u1", { ...input, id: crypto.randomUUID(), recipientIds: ["u9"] }),
    400,
  );
});
test("publication atomically creates notification; member view excludes private answers and draft groups", async () => {
  await event();
  const e = latest();
  assert.throws(
    () => memberEvent(readActivities(), e, users[2], users),
    /企画が見つかりません/,
  );
  await act("u1", {
    action: "event.publish",
    eventId: e.id,
    revision: e.revision,
  });
  await act("u2", { action: "vote", eventId: e.id, vote: "attending" });
  await act("u3", { action: "vote", eventId: e.id, vote: "absent" });
  const view = memberEvent(readActivities(), latest(), users[4], users, now);
  assert.deepEqual(view.counts, {
    attending: 1,
    absent: 1,
    undecided: 0,
    unanswered: 6,
  });
  assert.deepEqual(view.attendees, [{ id: "u2", name: users[2].name }]);
  for (const key of [
    "votes",
    "rules",
    "draftGroups",
    "gender",
    "recipientIds",
    "email",
  ])
    assert.equal(Object.hasOwn(view, key), false);
  assert.throws(
    () => memberEvent(readActivities(), latest(), users[8], users, now),
    /見つかりません/,
  );
  assert.equal(readActivities().notifications[0].eventId, e.id);
});
test("server deadline is exact, votes can change, undecided/unanswered excluded, staff can correct", async () => {
  await published();
  const id = latest().id;
  await reject(
    act("u8", { action: "vote", eventId: id, vote: "attending" }),
    403,
  );
  now = Date.parse(latest().deadline) - 1;
  await act("u2", { action: "vote", eventId: id, vote: "undecided" });
  await act("u2", { action: "vote", eventId: id, vote: "attending" });
  now++;
  await reject(act("u2", { action: "vote", eventId: id, vote: "absent" }), 409);
  await reject(
    act("u2", {
      action: "attendance.set",
      eventId: id,
      revision: latest().revision,
      userId: "u3",
      vote: "attending",
    }),
    403,
  );
  await act("u1", {
    action: "attendance.set",
    eventId: id,
    revision: latest().revision,
    userId: "u2",
    vote: "absent",
  });
  assert.equal(latest().votes.u2.actorId, "u1");
  await reject(act("u1", edit({ deadline: "2026-10-03T21:00:00+09:00" })), 400);
});
test("concurrent votes are preserved and stale edits cannot overwrite changes", async () => {
  await published();
  const id = latest().id,
    stale = edit();
  await Promise.all(
    ["u2", "u3", "u4"].map((actor) =>
      act(actor, { action: "vote", eventId: id, vote: "attending" }),
    ),
  );
  assert.equal(Object.keys(latest().votes).length, 3);
  await reject(act("u1", stale), 409);
  await act("u1", edit({ title: "変更後" }));
  assert.equal(readActivities().notifications.length, 2);
  await act("u1", {
    action: "event.cancel",
    eventId: id,
    revision: latest().revision,
  });
  await reject(
    act("u2", { action: "vote", eventId: id, vote: "attending" }),
    403,
  );
});
test("roster changes require administrator; manual profile edits are discontinued", async () => {
  for (const id of ["u1", "u2"]) {
    for (const action of ["profile.save", "roster.sync", "roster.link"])
      await reject(
        act(id, { action, revision: 0, gender: "female", grade: "1" }),
        403,
      );
  }
  await reject(
    act("u0", {
      action: "profile.save",
      userId: "u2",
      revision: 0,
      gender: "female",
      grade: "1",
    }),
    410,
  );
  await syncRoster();
  assert.equal(Object.keys(readActivities().profiles).length, 0);
  assert.equal(rosterSuggestions(readActivities(), users).u2, rowKey("u2"));
  rosterRows[2].gender = "回答しない";
  rosterRows[2].grade = "その他";
  await syncRoster();
  await linkRoster({ u2: rowKey("u2") });
  assert.equal(readActivities().profiles.u2.gender, "undisclosed");
  assert.equal(readActivities().profiles.u2.grade, "other");
  await reject(
    act("u0", {
      action: "roster.link",
      revision: 1,
      bindings: { u2: rowKey("u2") },
    }),
    409,
  );
});
test("group lifecycle validates manual edits, keeps published snapshots and detects changed source", async () => {
  await ready();
  const id = latest().id;
  await act("u1", {
    action: "groups.generate",
    eventId: id,
    revision: latest().revision,
  });
  let e = latest(),
    source = groupSource(readActivities(), e, users, now);
  await act("u1", {
    action: "groups.publish",
    eventId: id,
    revision: e.revision,
    source,
  });
  assert.equal(latest().publishedGroups?.version, 1);
  assert.equal(
    memberEvent(readActivities(), latest(), users[2], users, now).groups
      ?.length,
    2,
  );
  const published = latest().publishedGroups;
  await changeRosterGrade("u2", "3年生");
  await reject(
    act("u1", {
      action: "groups.publish",
      eventId: id,
      revision: latest().revision,
      source,
    }),
    409,
  );
  assert.deepEqual(latest().publishedGroups, published);
  e = latest();
  source = groupSource(readActivities(), e, users, now);
  const invalid = structuredClone(e.draftGroups!.groups);
  invalid[0].memberIds.push("u2");
  await act("u1", {
    action: "groups.save",
    eventId: id,
    revision: e.revision,
    source,
    groups: invalid,
  });
  await reject(
    act("u1", {
      action: "groups.publish",
      eventId: id,
      revision: latest().revision,
      source,
    }),
    400,
  );
  await act("u1", {
    action: "groups.save",
    eventId: id,
    revision: latest().revision,
    source,
    groups: published!.groups,
  });
  await act("u1", {
    action: "groups.publish",
    eventId: id,
    revision: latest().revision,
    source,
  });
  assert.equal(latest().publishedGroups?.version, 2);
  assert.equal(latest().groupHistory.length, 2);
});
test("missing attributes, revoked actor and changed generation source fail safely", async () => {
  await published();
  await act("u2", { action: "vote", eventId: latest().id, vote: "attending" });
  now = Date.parse(latest().deadline);
  await reject(
    act("u1", {
      action: "groups.generate",
      eventId: latest().id,
      revision: latest().revision,
    }),
    409,
  );
  writeData(
    "users.json",
    users.map((u) => (u.id === "u1" ? { ...u, role: "member" } : u)),
  );
  await reject(
    act("u1", {
      action: "event.cancel",
      eventId: latest().id,
      revision: latest().revision,
    }),
    403,
  );
});
test("history uses last held published event, excluding future and cancelled events", async () => {
  await ready();
  await act("u1", {
    action: "groups.generate",
    eventId: latest().id,
    revision: latest().revision,
  });
  await act("u1", {
    action: "groups.publish",
    eventId: latest().id,
    revision: latest().revision,
    source: groupSource(readActivities(), latest(), users, now),
  });
  const data = readActivities(),
    base = latest();
  now = Date.parse("2026-11-01T00:00:00Z");
  const next = {
    ...structuredClone(base),
    id: "next",
    startsAt: "2026-11-04T00:00:00Z",
    endsAt: "2026-11-05T00:00:00Z",
  };
  data.events.push(
    {
      ...structuredClone(base),
      id: "cancel",
      status: "cancelled",
      startsAt: "2026-10-20T00:00:00Z",
    },
    {
      ...structuredClone(base),
      id: "future",
      startsAt: "2026-11-02T00:00:00Z",
      endsAt: "2026-11-03T00:00:00Z",
    },
  );
  assert.equal(previousEvent(data, next, now)?.id, base.id);
});
test("corrupt saved data is not silently initialized", async () => {
  writeData("member-activities.json", { version: 99 });
  await assert.rejects(
    act("u2", {
      action: "profile.save",
      revision: 0,
      gender: "male",
      grade: "2",
    }),
  );
  assert.deepEqual(readData("member-activities.json", {}), { version: 99 });
});
test("a participant added after the deadline receives notice and makes the published plan stale", async () => {
  await ready();
  const id = latest().id;
  await act("u1", {
    action: "groups.generate",
    eventId: id,
    revision: latest().revision,
  });
  await act("u1", {
    action: "groups.publish",
    eventId: id,
    revision: latest().revision,
    source: groupSource(readActivities(), latest(), users, now),
  });
  await reject(
    act("u2", {
      action: "attendance.add",
      eventId: id,
      revision: latest().revision,
      userId: "u8",
    }),
    403,
  );
  await act("u1", {
    action: "attendance.add",
    eventId: id,
    revision: latest().revision,
    userId: "u8",
  });
  const data = readActivities();
  assert.equal(latest().votes.u8.value, "attending");
  assert.deepEqual(data.notifications.at(-1)?.recipientIds, ["u8"]);
  assert.equal(
    memberEvent(data, latest(), users[2], users, now).groupsNeedReview,
    true,
  );
  assert.equal(
    memberEvent(data, latest(), users[8], users, now).canVote,
    false,
  );
});
test("a profile change during cooperative generation rejects the stale candidate", async () => {
  await ready();
  const generating = reject(
    act("u1", {
      action: "groups.generate",
      eventId: latest().id,
      revision: latest().revision,
    }),
    409,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await changeRosterGrade("u2", "4年生");
  await generating;
  assert.equal(latest().draftGroups, undefined);
});

test("roster refresh preserves confirmed links, clears withdrawn/missing/unknown attributes, and never trusts old manual profiles", async () => {
  const old = readActivities();
  old.profiles.u2 = { gender: "female", grade: "1", revision: 1 };
  writeData("member-activities.json", old);
  await syncRoster();
  assert.equal(readActivities().profiles.u2, undefined);
  await linkRoster({ u2: rowKey("u2"), u3: rowKey("u3"), u4: rowKey("u4") });
  rosterRows[2].active = false;
  rosterRows[3].grade = "不明";
  rosterRows = rosterRows.filter((r) => r.key !== rowKey("u4"));
  await syncRoster();
  for (const id of ["u2", "u3", "u4"])
    assert.equal(readActivities().profiles[id], undefined);
  assert.equal(readActivities().roster!.bindings.u2, rowKey("u2"));
  rosterRows[2].active = true;
  rosterRows[2].gender = "女";
  await syncRoster();
  assert.equal(readActivities().profiles.u2.gender, "female");
});
test("failed Google reads and invalid snapshots preserve the prior roster", async () => {
  await syncRoster();
  await linkRoster({ u2: rowKey("u2") });
  const before = readActivities();
  globalThis.fetch = async () => {
    throw Error("network");
  };
  await reject(syncRoster(), 503);
  assert.deepEqual(readActivities(), before);
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      ...activityRosterSource,
      sheetTitle: "回答",
      records: [rosterRows[0], rosterRows[0]],
    });
  await reject(syncRoster(), 503);
  assert.deepEqual(readActivities(), before);
});
test("duplicate names are not automatically linked; duplicate account bindings and unknown people are rejected", async () => {
  rosterRows[2].name = users[3].name;
  await syncRoster();
  assert.equal(rosterSuggestions(readActivities(), users).u3, undefined);
  await reject(linkRoster({ u2: rowKey("u2"), u3: rowKey("u2") }), 400);
  await reject(linkRoster({ u2: "a".repeat(64) }), 400);
  await linkRoster({ u2: rowKey("u2") });
  assert.equal(readActivities().profiles.u2.grade, "2");
  await linkRoster({ u2: "" });
  assert.equal(readActivities().profiles.u2, undefined);
});
test("administrator role and roster revision are rechecked after a slow Google response", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await real(...args);
    const current = structuredClone(users);
    current[0].role = "staff";
    writeData("users.json", current);
    return response;
  };
  await reject(syncRoster(), 403);
  assert.equal(readActivities().roster, undefined);
  writeData("users.json", users);
  globalThis.fetch = async (...args) => {
    const response = await real(...args);
    const current = readActivities();
    current.roster = {
      ...activityRosterSource,
      revision: 1,
      sheetTitle: "回答",
      fetchedAt: new Date(now).toISOString(),
      fetchedBy: "u0",
      records: [],
      bindings: {},
    };
    writeData("member-activities.json", current);
    return response;
  };
  await reject(syncRoster(), 409);
  assert.equal(readActivities().roster!.revision, 1);
});
test("sheet attribute normalization does not guess unknown genders or grades", () => {
  assert.equal(rosterGender("女"), "female");
  assert.equal(rosterGender("未記入"), null);
  assert.equal(rosterGrade("１年生"), "1");
  assert.equal(rosterGrade("修士2年"), "master");
  assert.equal(rosterGrade("博士1年生"), "doctorate");
  assert.equal(rosterGrade("不明"), null);
});

test("graduate year labels normalize widths, Japanese numerals and explicit courses without becoming undergraduate first-years", () => {
  for (const label of [
    "大学院２年生",
    "大学院 1 年生",
    "大学院二年生",
    "院2年",
    "大学院生",
    "大学院修士課程２年生",
    "博士前期課程2年",
    "大学院博士課程前期1年生",
    "Ｍ２",
  ])
    assert.equal(rosterGrade(label), "master", label);
  for (const label of [
    "大学院博士３年生",
    "博士後期課程２年生",
    "大学院博士課程後期三年生",
    "Ｄ１",
  ])
    assert.equal(rosterGrade(label), "doctorate", label);
  for (const label of ["学部２年生", "大学二年生"])
    assert.equal(rosterGrade(label), "2", label);
  for (const label of ["大学院志望2年生", "修士9年", "博士0年生", "不明2年生"])
    assert.equal(rosterGrade(label), null, label);
});

test("roster sync recovers graduate grades for linked accounts and standalone grouping without changing bindings or published history", async () => {
  await ready();
  await act("u1", {
    action: "groups.generate",
    eventId: latest().id,
    revision: latest().revision,
  });
  await act("u1", {
    action: "groups.publish",
    eventId: latest().id,
    revision: latest().revision,
    source: groupSource(readActivities(), latest(), users, now),
  });
  const before = structuredClone(readActivities());
  // An older import could not recognize these Google Sheet answers.
  before.roster!.records.find((r) => r.key === rowKey("u2"))!.grade = null;
  delete before.profiles.u2;
  writeData("member-activities.json", before);
  rosterRows[2].grade = "大学院２年生";
  rosterRows[3].grade = "博士後期課程１年生";
  await syncRoster();
  const after = readActivities();
  assert.equal(after.profiles.u2.grade, "master");
  assert.equal(after.profiles.u3.grade, "doctorate");
  assert.deepEqual(after.roster!.bindings, before.roster!.bindings);
  assert.deepEqual(latest().publishedGroups, before.events[0].publishedGroups);
  assert.equal(
    memberEvent(after, latest(), users[2], users, now).groupsNeedReview,
    true,
  );
  const run = { participantIds: [rowKey("u2"), rowKey("u3")] } as GroupingRun;
  assert.deepEqual(
    groupingPeople(after, run).map((p) => p.grade),
    ["master", "doctorate"],
  );
  await act("u1", {
    action: "groups.generate",
    eventId: latest().id,
    revision: latest().revision,
  });
  assert.equal(
    latest().draftGroups!.groups.flatMap((g) => g.memberIds).length,
    8,
  );
});

test("staff deletion removes draft/published/cancelled events and their notices, with confirmation and revision checks", async () => {
  for (const state of ["draft", "published", "cancelled"]) {
    await event();
    const target = () => readActivities().events.at(-1)!;
    if (state !== "draft")
      await act("u1", {
        action: "event.publish",
        eventId: target().id,
        revision: target().revision,
      });
    if (state === "cancelled")
      await act("u1", {
        action: "event.cancel",
        eventId: target().id,
        revision: target().revision,
      });
    const id = target().id;
    const payload = {
      action: "event.delete",
      eventId: id,
      revision: target().revision,
      confirmation: "delete",
    };
    await reject(act("u2", payload), 403);
    await reject(act("u1", { ...payload, confirmation: "" }), 400);
    await reject(act("u1", { ...payload, revision: 999 }), 409);
    await act("u1", payload);
    assert.equal(
      readActivities().events.some((e) => e.id === id),
      false,
    );
    assert.equal(
      readActivities().notifications.some((n) => n.eventId === id),
      false,
    );
    await reject(act("u1", payload), 404);
  }
});
test("deleting a held event preserves repeat-pair history but removes its content and votes", async () => {
  await ready();
  const id = latest().id;
  await act("u1", {
    action: "groups.generate",
    eventId: id,
    revision: latest().revision,
  });
  await act("u1", {
    action: "groups.publish",
    eventId: id,
    revision: latest().revision,
    source: groupSource(readActivities(), latest(), users, now),
  });
  const groups = latest().publishedGroups;
  now = Date.parse(latest().endsAt) + 1;
  await act("u1", {
    action: "event.delete",
    eventId: id,
    revision: latest().revision,
    confirmation: "delete",
  });
  await event();
  await act(
    "u1",
    edit({
      startsAt: "2026-10-20T09:00:00+09:00",
      endsAt: "2026-10-20T18:00:00+09:00",
      deadline: "2026-10-19T21:00:00+09:00",
    }),
  );
  const previous = previousEvent(readActivities(), latest(), now)!;
  assert.equal(previous.id, id);
  assert.deepEqual(previous.publishedGroups, groups);
  assert.equal("description" in previous, false);
  assert.equal("votes" in previous, false);
});

test("Google LINE names are validated, displayed in confirmed groups and do not invalidate prepared assignments", async () => {
  await ready();
  await act("u1", {
    action: "groups.generate",
    eventId: latest().id,
    revision: latest().revision,
  });
  const source = groupSource(readActivities(), latest(), users, now);
  rosterRows[0].lineName = " kota ";
  await syncRoster();
  assert.equal(readActivities().roster!.records[0].lineName, "kota");
  assert.equal(groupSource(readActivities(), latest(), users, now), source);
  await act("u1", {
    action: "groups.publish",
    eventId: latest().id,
    revision: latest().revision,
    source,
  });
  const dto = memberEvent(readActivities(), latest(), users[2], users, now);
  assert.ok(JSON.stringify(dto.groups).includes("メンバー0（kota）"));
  assert.equal(JSON.stringify(dto).includes('"gender"'), false);
  const saved = readActivities().roster;
  rosterRows[0].lineName = "x".repeat(201);
  await assert.rejects(syncRoster());
  assert.deepEqual(readActivities().roster, saved);
});

test("event categories save consistently, default legacy events to other and reject unknown categories",async()=>{
  await event();assert.equal(latest().category,'other');
  for(const category of ['photo','meeting','other']){await act('u1',edit({category}));assert.equal(latest().category,category);}
  await assert.rejects(()=>act('u1',edit({category:'exhibition'})),/種類/);
  await act('u1',{action:'event.publish',eventId:latest().id,revision:latest().revision});const saved=readActivities();delete saved.events[0].category;writeData('member-activities.json',saved);assert.equal(memberEvent(readActivities(),latest(),users[2],users,now).category,'other');
});


test("public event details expose only details, counts and attending names", async () => {
  await event();
  const e = latest();
  assert.throws(() => publicEvent(e, users), /企画が見つかりません/);
  await act("u1", { action: "event.publish", eventId: e.id, revision: e.revision });
  await act("u2", { action: "vote", eventId: e.id, vote: "attending" });
  await act("u3", { action: "vote", eventId: e.id, vote: "absent" });
  const dto = publicEvent(latest(), users);
  assert.equal(dto.counts.attending, 1);
  assert.equal(dto.counts.absent, 1);
  assert.deepEqual(dto.attendees, [{ name: users[2].name }]);
  for (const field of ["votes", "recipientIds", "rules", "draftGroups", "publishedGroups", "ownerId", "groups", "email"])
    assert.equal(Object.hasOwn(dto, field), false);
  assert.equal(JSON.stringify(dto).includes(users[3].name), false);
});
