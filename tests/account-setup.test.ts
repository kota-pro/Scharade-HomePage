import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAccountReview } from "../src/lib/accountReview.ts";
import { accountRevision, updateAccountRegistration } from "../src/lib/accountManagement.ts";
import { localHelpTasks } from "../src/lib/helpTasks.ts";
import { drainAccountSetups } from "../src/lib/accountSetup.ts";
import { readUsers, updateUsers, type User } from "../src/lib/auth.ts";
import {
  activityAction,
  appendExhibitionNotice,
  readActivities,
} from "../src/lib/activities.ts";
import { activityRosterSource } from "../src/lib/activityRoster.ts";
import {
  emptyActivities,
  defaultRules,
  type ActivityEvent,
  type MemberNotification,
} from "../src/lib/activityTypes.ts";
import { readExhibitions } from "../src/lib/exhibitions.ts";
import { drainRosterPortfolioUpdates } from "../src/lib/rosterPortfolioUpdates.ts";
import type {
  Exhibition,
  ExhibitionNotice,
} from "../src/lib/exhibitionTypes.ts";
import { writeData } from "../src/lib/store.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "account-setup-"));
const savedFetch = globalThis.fetch;
const at = "2026-10-01T00:00:00.000Z";
const everyone = ["admin", "existing"];
const key = (letter: string) => letter.repeat(64);
const pending: User = {
  id: "new",
  name: "新 会員",
  portfolioName: "新会員",
  email: "new@example.invalid",
  approved: false,
  role: "member",
  portfolioId: "new-portfolio",
  providers: {},
  createdAt: at,
};
const admin: User = {
  ...pending,
  id: "admin",
  name: "管理者",
  portfolioName: "管理者",
  email: "admin@example.invalid",
  approved: true,
  role: "admin",
  portfolioId: null,
};
const existing: User = {
  ...pending,
  id: "existing",
  name: "既存会員",
  portfolioName: "既存会員",
  email: "existing@example.invalid",
  approved: true,
  portfolioId: "existing-portfolio",
};
const row = (id = "b", name = "新会員", active = true) => ({
  key: key(id),
  name,
  university: "テスト大学",
  gender: "女性",
  grade: "2年生",
  active,
});
const event = (id: string, recipientIds = everyone): ActivityEvent => ({
  id,
  recipientIds: [...recipientIds],
  revision: 1,
  status: "published",
  title: id,
  description: "",
  startsAt: "2026-11-01T00:00:00Z",
  endsAt: "2026-11-02T00:00:00Z",
  deadline: "2026-10-31T00:00:00Z",
  meeting: "",
  itinerary: "",
  fee: "",
  theme: "",
  ownerId: "admin",
  ownerName: "管理者",
  createdAt: at,
  updatedAt: at,
  votes: { existing: { value: "absent", at, actorId: "existing" } },
  rules: defaultRules(),
  groupHistory: [],
});
const notice = (id: string, recipientIds = everyone): MemberNotification => ({
  id,
  recipientIds: [...recipientIds],
  title: id,
  body: "保存済みの本文",
  senderId: "admin",
  senderName: "管理者",
  createdAt: at,
  readBy: { existing: at },
});
const exhibition = (
  id: string,
  recipientIds = everyone,
  state: "draft" | "publishing" | "published" = "published",
): Exhibition => ({
  id,
  title: id,
  revision: 1,
  status: "open",
  opensAt: at,
  closesAt: "2026-12-01T00:00:00Z",
  createdAt: at,
  updatedAt: at,
  schemas: [{ version: 1, sections: [], fields: [], captionLabel: "" }],
  rooms: [],
  albumId: id,
  googleForms: [],
  gallery: "staff",
  participation: {
    state,
    recipientIds: [...recipientIds],
    opensAt: at,
    closesAt: "2026-11-01T00:00:00Z",
    votes: {},
  },
  notices: [],
});
let incoming: ReturnType<typeof row>[],
  fail: boolean,
  reads: number,
  emails: number;
let onRead: (() => void) | undefined;
const approve = () =>
  applyAccountReview(pending.id, "approve", async () => {
    emails++;
  });

beforeEach(() => {
  Object.assign(process.env, {
    DATA_DIR: directory,
    ACCOUNTING_GAS_URL: "https://script.google.com/macros/s/fixture/exec",
    ACCOUNTING_WEBHOOK_SECRET: "fixture-secret-at-least-32-characters",
  });
  fail = false;
  reads = 0;
  emails = 0;
  onRead = undefined;
  incoming = [row("a", "既存会員"), row()];
  writeData("users.json", [
    admin,
    existing,
    pending,
    {
      ...pending,
      id: "pending-other",
      name: "別の未承認会員",
      email: "pending-other@example.invalid",
      portfolioId: "other-portfolio",
    },
  ]);
  writeData("push-devices.json", { version: 1, devices: [] });
  const activities = emptyActivities();
  activities.roster = {
    ...activityRosterSource,
    revision: 1,
    fetchedAt: at,
    fetchedBy: "admin",
    sheetTitle: "回答",
    records: [
      {
        key: key("a"),
        name: "既存会員",
        university: "テスト大学",
        gender: "female",
        grade: "1",
        active: true,
      },
    ],
    bindings: { existing: key("a") },
  };
  activities.profiles.existing = {
    gender: "female",
    grade: "1",
    revision: 1,
    rosterKey: key("a"),
  };
  activities.events = [
    event("all"),
    event("limited", ["existing"]),
    event("empty", []),
    { ...event("draft"), status: "draft" },
  ];
  activities.notifications = [
    notice("all"),
    notice("limited", ["existing"]),
    notice("empty", []),
  ];
  writeData("member-activities.json", activities);
  writeData("exhibitions.json", {
    version: 1,
    exhibitions: [
      exhibition("all"),
      exhibition("limited", ["existing"]),
      exhibition("draft", everyone, "draft"),
    ],
    submissions: [],
    assets: [],
  });
  globalThis.fetch = async (_input, options) => {
    reads++;
    const payload = JSON.parse(JSON.parse(String(options?.body)).payload);
    assert.equal(payload.action, "roster.read");
    onRead?.();
    if (fail) throw new Error("Google unavailable");
    return Response.json({
      ok: true,
      spreadsheetId: payload.spreadsheetId,
      sheetId: payload.sheetId,
      title: "更新済み名簿",
      sheetTitle: "回答",
      records: incoming,
    });
  };
});
after(() => {
  globalThis.fetch = savedFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

async function rename(id: string, name: string) {
  const user = readUsers().find((user) => user.id === id)!;
  return updateAccountRegistration(admin.id, id, { name, email: user.email, portfolioName: user.portfolioName ?? "", role: user.role ?? "member", revision: accountRevision(user) });
}

test("renaming an approved account reloads Google, resolves the corrected name and initializes its Portfolio without another approval or mail", async () => {
  incoming = [row("a", "既存会員"), row("b", "写団　写麗道")];
  assert.equal(await approve(), "setup-unlinked");
  const result = await rename("new", "写団　写麗道");
  assert.equal(result.rosterSync, "linked");
  assert.equal(reads, 2);
  assert.equal(emails, 1);
  const data = readActivities();
  assert.equal(data.roster!.bindings.new, key("b"));
  assert.equal(data.profiles.new.grade, "2");
  assert.ok(data.rosterPortfolioUpdates?.some((job) => job.userId === "new" && job.targetGrade === "2nd Grade"));
  assert.equal(readUsers().find((u) => u.id === "new")?.rosterRelink, undefined);
  assert.equal(data.events[0].recipientIds.filter((id) => id === "new").length, 1);
});

test("renaming rechecks an existing binding, never claims another account's answer and leaves ambiguous names to executive tasks", async () => {
  await approve();
  incoming = [row("a", "既存会員"), row(), row("c", "訂正　会員")];
  assert.equal((await rename("new", "訂正　会員")).rosterSync, "linked");
  assert.equal(readActivities().roster!.bindings.new, key("c"));
  assert.equal((await rename("new", "既存会員")).rosterSync, "unlinked");
  assert.equal(readActivities().roster!.bindings.existing, key("a"));
  assert.equal(readActivities().roster!.bindings.new, undefined);
  incoming = [row("a", "既存会員"), row("b", "同姓　同名"), row("c", "同姓　同名")];
  assert.equal((await rename("new", "同姓　同名")).rosterSync, "unlinked");
  const tasks = localHelpTasks(admin).tasks;
  assert.ok(tasks.some((task) => task.id === "roster:bindings" && task.href === "/Admin/grouping-roster"));
  assert.ok(!tasks.some((task) => task.id === "approval-followup:new"));
  for (const role of ["staff", "member"] as const)
    assert.ok(!localHelpTasks({ ...admin, role }).tasks.some((task) => task.id.startsWith("roster:")));
});

test("a failed name refresh keeps the saved name and a durable retry without sending approval email again", async () => {
  await approve();
  incoming = [row("a", "既存会員"), row("c", "再取得　会員")];
  fail = true;
  assert.equal((await rename("new", "再取得　会員")).rosterSync, "pending");
  let user = readUsers().find((u) => u.id === "new")!;
  assert.equal(user.name, "再取得　会員");
  assert.equal(user.rosterRelink?.attempts, 1);
  assert.ok(localHelpTasks(admin).tasks.some((task) => task.id === "roster:bindings"));
  fail = false;
  await updateUsers((users) => { users.find((u) => u.id === "new")!.rosterRelink!.nextAttemptAt = 0; });
  await drainAccountSetups();
  user = readUsers().find((u) => u.id === "new")!;
  assert.equal(user.rosterRelink, undefined);
  assert.equal(readActivities().roster!.bindings.new, key("c"));
  assert.equal(emails, 1);
});

test("an older refresh cannot overwrite a newer name", async () => {
  await approve();
  onRead = () => {
    const users = readUsers();
    const user = users.find((u) => u.id === "new")!;
    user.name = "後から訂正した名前";
    delete user.rosterRelink;
    writeData("users.json", users);
  };
  await rename("new", "古い取得中の名前");
  assert.equal(readUsers().find((u) => u.id === "new")!.name, "後から訂正した名前");
  assert.equal(readActivities().roster!.bindings.new, key("b"));
});

test("manual roster confirmation completes a pending name retry and the worker preserves it", async () => {
  await approve();
  fail = true;
  await rename("new", "手動確認が必要な名前");
  const revision = readActivities().roster!.revision;
  await activityAction(admin.id, { action: "roster.link", revision, bindings: { new: key("b") } });
  assert.equal(readUsers().find((user) => user.id === "new")!.rosterRelink, undefined);
  const before = reads;
  await drainAccountSetups();
  assert.equal(reads, before);
  assert.equal(readActivities().roster!.bindings.new, key("b"));
});

test("approval refreshes Google, links only the new account and enrolls it in every all-member audience without voting", async () => {
  assert.equal(await approve(), "updated");
  assert.equal(emails, 1);
  assert.equal(reads, 1);
  const user = readUsers().find((user) => user.id === "new")!;
  assert.equal(user.approved, true);
  assert.equal(user.authVersion, 1);
  assert.equal(user.approvalSetup?.rosterStatus, "linked");
  assert.ok(user.approvalSetup?.recipientsCompletedAt);
  const data = readActivities();
  assert.equal(data.roster?.title, "更新済み名簿");
  assert.deepEqual(data.roster?.bindings, {
    existing: key("a"),
    new: key("b"),
  });
  assert.equal(data.profiles.new.grade, "2");
  assert.equal(data.profiles.existing.grade, "2");
  assert.equal(data.rosterPortfolioUpdates?.[0].status, "pending");
  assert.deepEqual(
    data.rosterPortfolioUpdates?.map((job) => [
      job.userId,
      job.targetGrade,
      job.initialOnly,
    ]),
    [["new", "2nd Grade", true]],
  );
  for (const item of [
    ...data.events,
    ...data.notifications,
    ...readExhibitions().exhibitions.map((exhibition) => ({
      id: exhibition.id,
      recipientIds: exhibition.participation!.recipientIds,
    })),
  ])
    assert.equal(
      item.recipientIds.includes("new"),
      item.id === "all" || item.id === "draft",
    );
  assert.equal(data.events[0].votes.new, undefined);
  assert.equal(data.events[0].votes.existing.value, "absent");
  assert.equal(data.notifications[0].readBy.new, undefined);
  assert.equal(data.notifications[0].readBy.existing, at);
  assert.deepEqual(readExhibitions().exhibitions[0].participation?.votes, {});
  await Promise.all([approve(), approve()]);
  assert.equal(emails, 1);
  assert.equal(reads, 1);
  assert.equal(readActivities().events[0].revision, 2);
  assert.equal(readActivities().rosterPortfolioUpdates?.length, 1);
});

test("Google failure preserves the roster and approval; the worker retries the saved approval-time audiences", async () => {
  fail = true;
  const before = readActivities().roster;
  assert.equal(await approve(), "setup-failed");
  assert.equal(emails, 1);
  assert.deepEqual(readActivities().roster, before);
  assert.equal(readActivities().events[0].recipientIds.includes("new"), true);
  assert.equal(
    readUsers().find((user) => user.id === "new")?.approvalSetup?.rosterStatus,
    "pending",
  );
  assert.deepEqual(await drainAccountSetups(), { attempted: 0 });
  const data = readActivities();
  data.events.push(event("created-after-approval"));
  data.notifications.push(notice("created-after-approval"));
  writeData("member-activities.json", data);
  fail = false;
  await updateUsers((users) => {
    users.find((user) => user.id === "new")!.approvalSetup!.nextAttemptAt = 0;
  });
  assert.deepEqual(await drainAccountSetups(), { attempted: 1 });
  assert.deepEqual(await drainAccountSetups(), { attempted: 0 });
  assert.equal(readActivities().roster?.bindings.new, key("b"));
  assert.equal(
    readActivities().events.at(-1)!.recipientIds.includes("new"),
    false,
  );
  assert.equal(
    readActivities().notifications.at(-1)!.recipientIds.includes("new"),
    false,
  );
  assert.equal(emails, 1);
});

test("unmatched, ambiguous, inactive and already linked names never choose an arbitrary identity", async () => {
  for (const records of [[], [row(), row("c")], [row("b", "新会員", false)]]) {
    incoming = [row("a", "既存会員"), ...records];
    assert.equal(await approve(), "setup-unlinked");
    assert.equal(readActivities().roster?.bindings.new, undefined);
    assert.equal(readActivities().profiles.new, undefined);
    assert.deepEqual(await drainAccountSetups(), { attempted: 0 });
  }
  incoming = [row("a", "既存会員"), row()];
  const data = readActivities();
  data.roster!.bindings.admin = key("b");
  writeData("member-activities.json", data);
  assert.equal(await approve(), "setup-unlinked");
  assert.equal(readActivities().roster?.bindings.new, undefined);
  assert.equal(emails, 1);
});

test("a competing account with the same name prevents automatic linking; registration name can resolve a display name", async () => {
  await updateUsers((users) => {
    users.push({ ...pending, id: "duplicate", approved: true });
  });
  assert.equal(await approve(), "setup-unlinked");
  assert.equal(readActivities().roster?.bindings.new, undefined);
  await updateUsers((users) => {
    users.splice(
      users.findIndex((user) => user.id === "duplicate"),
      1,
    );
    users.find((user) => user.id === "new")!.name = "表示ニックネーム";
  });
  assert.equal(await approve(), "updated");
  assert.equal(readActivities().roster?.bindings.new, key("b"));
});

test("all-member exhibition outboxes and existing notifications agree, including an older delivery already in flight", async () => {
  const data = readExhibitions();
  const full: ExhibitionNotice = {
    ...notice("outbox"),
    exhibitionId: "all",
    deliveredAt: at,
  };
  const queued: ExhibitionNotice = {
    ...notice("queued"),
    exhibitionId: "publishing",
  };
  data.exhibitions[0].notices = [
    full,
    { ...notice("private", ["existing"]), exhibitionId: "all" },
  ];
  const publishing = exhibition("publishing", everyone, "publishing");
  publishing.notices = [queued];
  publishing.participation!.noticeId = queued.id;
  data.exhibitions.push(publishing);
  writeData("exhibitions.json", data);
  const activities = readActivities();
  activities.notifications.push({
    ...notice("outbox"),
    exhibitionId: "all",
    kind: "exhibition",
  });
  writeData("member-activities.json", activities);
  assert.equal(await approve(), "updated");
  await appendExhibitionNotice(queued);
  const saved = readExhibitions(),
    notices = readActivities().notifications;
  assert.equal(
    saved.exhibitions[0].notices![0].recipientIds.includes("new"),
    true,
  );
  assert.equal(
    saved.exhibitions[0].notices![1].recipientIds.includes("new"),
    false,
  );
  assert.equal(
    saved.exhibitions.at(-1)!.participation!.recipientIds.includes("new"),
    true,
  );
  assert.equal(
    notices
      .find((notice) => notice.id === "outbox")!
      .recipientIds.includes("new"),
    true,
  );
  assert.equal(notices.filter((notice) => notice.id === "queued").length, 1);
  assert.equal(
    notices
      .find((notice) => notice.id === "queued")!
      .recipientIds.includes("new"),
    true,
  );
});

test("changed roster source during fetch and unreviewed departures leave the saved roster untouched", async () => {
  onRead = () => {
    const data = readActivities();
    data.roster!.sheetId++;
    data.roster!.revision++;
    writeData("member-activities.json", data);
  };
  assert.equal(await approve(), "setup-failed");
  assert.equal(readActivities().roster?.title, activityRosterSource.title);
  onRead = undefined;
  const data = readActivities();
  data.roster!.managedSource = true;
  writeData("member-activities.json", data);
  incoming = [row()];
  const before = readActivities().roster;
  assert.equal(await approve(), "setup-failed");
  assert.deepEqual(readActivities().roster, before);
  assert.equal(emails, 1);
});

test("reject, invalid targets and legacy approvals never initialize accounts or read Google", async () => {
  assert.equal(
    await applyAccountReview("new", "reject", async () => {
      emails++;
    }),
    "updated",
  );
  assert.equal(await approve(), "invalid");
  assert.equal(await applyAccountReview("admin", "approve"), "invalid");
  assert.equal(await applyAccountReview("missing", "approve"), "invalid");
  assert.equal(await applyAccountReview("existing", "approve"), "invalid");
  assert.equal(reads, 0);
  assert.equal(emails, 0);
  assert.equal(
    readUsers().find((user) => user.id === "new")?.approvalSetup,
    undefined,
  );
});

test("an interrupted recipient commit can replay without duplicate memberships or changing answers", async () => {
  await approve();
  const before = readActivities();
  await updateUsers((users) => {
    delete users.find((user) => user.id === "new")!.approvalSetup!
      .recipientsCompletedAt;
  });
  assert.deepEqual(await drainAccountSetups(), { attempted: 1 });
  assert.deepEqual(readActivities(), before);
});

test("first approval can initialize an empty roster, and concurrent new approvals both join all-member audiences", async () => {
  const data = readActivities();
  delete data.roster;
  writeData("member-activities.json", data);
  await updateUsers((users) => {
    const user = users.find((user) => user.id === "pending-other")!;
    user.name = "別新会員";
    user.portfolioName = "別新会員";
  });
  incoming.push(row("c", "別新会員"));
  assert.deepEqual(
    await Promise.all([
      approve(),
      applyAccountReview("pending-other", "approve", async () => {
        emails++;
      }),
    ]),
    ["updated", "updated"],
  );
  assert.equal(emails, 2);
  for (const userId of ["new", "pending-other"]) {
    assert.ok(readActivities().roster?.bindings[userId]);
    assert.equal(
      readActivities().events[0].recipientIds.includes(userId),
      true,
    );
    assert.equal(
      readActivities().events[1].recipientIds.includes(userId),
      false,
    );
    assert.equal(
      readExhibitions().exhibitions[0].participation?.recipientIds.includes(
        userId,
      ),
      true,
    );
  }
  Object.assign(process.env, {
    MICROCMS_SERVICE_DOMAIN: "fixture",
    MICROCMS_SERVER_API_KEY: "fixture",
  });
  let patches = 0;
  globalThis.fetch = async (_input, options) => {
    if (options?.method === "PATCH") {
      patches++;
      return Response.json({});
    }
    return Response.json({ grade: [] });
  };
  assert.deepEqual(await drainRosterPortfolioUpdates(), {
    attempted: 2,
    completed: 2,
  });
  assert.equal(patches, 2);
});

test("a failed manual retry after an unresolved match schedules automatic recovery", async () => {
  incoming = [];
  assert.equal(await approve(), "setup-unlinked");
  fail = true;
  assert.equal(await approve(), "setup-failed");
  assert.equal(
    readUsers().find((user) => user.id === "new")?.approvalSetup?.rosterStatus,
    "pending",
  );
  fail = false;
  incoming = [row()];
  await updateUsers((users) => {
    users.find((user) => user.id === "new")!.approvalSetup!.nextAttemptAt = 0;
  });
  assert.deepEqual(await drainAccountSetups(), { attempted: 1 });
  assert.equal(readActivities().roster?.bindings.new, key("b"));
  assert.equal(emails, 1);
});
