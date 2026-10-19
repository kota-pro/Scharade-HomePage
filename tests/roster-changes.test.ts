import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  activityAction,
  readActivities,
  eventPeople,
} from "../src/lib/activities.ts";
import { writeData } from "../src/lib/store.ts";
import { emptyActivities, defaultRules } from "../src/lib/activityTypes.ts";
import {
  activityRosterSource,
  parseRosterSource,
  rosterSourceUrl,
} from "../src/lib/activityRoster.ts";
import { reconcileRoster } from "../src/lib/rosterReconciliation.ts";
import { drainRosterPortfolioUpdates } from "../src/lib/rosterPortfolioUpdates.ts";
import { readGroupingTools } from "../src/lib/groupingTools.ts";
import { toAdminAccountRoster } from "../src/lib/adminAccounts.ts";
import type { User } from "../src/lib/auth.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-change-"));
process.env.DATA_DIR = dir;
const savedFetch = globalThis.fetch;
const key = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const source = { spreadsheetId: "next-roster-fixture-2027", sheetId: 123 };
const users: User[] = [
  { id: "admin", name: "管理者", role: "admin", approved: true },
  {
    id: "one",
    name: "会員一",
    role: "member",
    approved: true,
    portfolioId: "p1",
  },
  {
    id: "two",
    name: "会員二",
    role: "member",
    approved: true,
    portfolioId: "p2",
  },
].map((u) => ({
  ...u,
  email: u.id + "@example.invalid",
  createdAt: "2026-01-01",
  providers: {},
})) as User[];
const row = (id: string) => ({
  key: key(id),
  name: users.find((u) => u.id === id)!.name,
  lineName: id,
  university: "大学",
  gender: "male" as const,
  grade: "2" as const,
  active: true,
});
let rows: any[],
  fail = false,
  patchFail = false,
  patches: any[],
  cms: any;
const act = (data: Record<string, unknown>, user = "admin") =>
  activityAction(user, data);
const preview = () =>
  act({
    action: "roster.preview",
    revision: readActivities().roster!.revision,
    url: rosterSourceUrl(source),
  });
const apply = (id: unknown) =>
  act({ action: "roster.apply", previewId: id, confirm: true });
beforeEach(() => {
  process.env.ACCOUNTING_GAS_URL =
    "https://script.google.com/macros/s/fixture/exec";
  process.env.ACCOUNTING_WEBHOOK_SECRET =
    "fixture-secret-at-least-32-characters";
  process.env.MICROCMS_SERVICE_DOMAIN = "fixture";
  process.env.MICROCMS_SERVER_API_KEY = "test";
  rows = [{ ...row("one"), key: key("new-one"), gender: "男", grade: "3年生" }];
  fail = false;
  patchFail = false;
  patches = [];
  cms = {
    grade: "2nd Grade",
    name: "会員二",
    pictures: ["preserve"],
    role: "元幹部",
  };
  writeData("users.json", users);
  writeData("roster-previews.json", []);
  const data = emptyActivities();
  data.roster = {
    ...activityRosterSource,
    revision: 1,
    sheetTitle: "回答",
    fetchedAt: "2026-10-01T00:00:00Z",
    fetchedBy: "admin",
    records: [row("one"), row("two")],
    bindings: { one: key("one"), two: key("two") },
  };
  data.profiles = {
    one: { gender: "male", grade: "2", rosterKey: key("one"), revision: 1 },
    two: { gender: "male", grade: "2", rosterKey: key("two"), revision: 1 },
  };
  writeData("member-activities.json", data);
  writeData("grouping-tools.json", {
    version: 1,
    runs: [
      {
        id: "run",
        title: "班分け",
        revision: 1,
        participantIds: [key("one"), key("two")],
        rules: {
          ...defaultRules(),
          leaders: [key("two")],
          together: [[key("one"), key("two")]],
        },
        draftGroups: {
          groups: [
            { leaderId: key("two"), memberIds: [key("one"), key("two")] },
          ],
        },
        publishedGroups: {
          groups: [
            { leaderId: key("two"), memberIds: [key("one"), key("two")] },
          ],
        },
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
  });
  globalThis.fetch = async (input, options) => {
    if (String(input).includes("script.google.com")) {
      if (fail) throw new Error("fetch failed");
      const p = JSON.parse(JSON.parse(String(options?.body)).payload);
      return Response.json({
        ok: true,
        spreadsheetId: p.spreadsheetId,
        sheetId: p.sheetId,
        title: "新名簿",
        sheetTitle: "回答",
        records: rows,
      });
    }
    assert.match(String(input), /\/portfolio\/p2$/);
    if (options?.method === "PATCH") {
      const patch = JSON.parse(String(options.body));
      patches.push(patch);
      if (patchFail) return new Response("error", { status: 503 });
      Object.assign(cms, patch);
      return Response.json({ ok: true });
    }
    return Response.json(cms);
  };
});
after(() => {
  globalThis.fetch = savedFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("source URLs require a Google sheet and explicit tab, never arbitrary fetch destinations", () => {
  assert.deepEqual(parseRosterSource(rosterSourceUrl(source)), source);
  for (const bad of [
    "https://evil.example/",
    rosterSourceUrl(source).replace("https:", "http:"),
    rosterSourceUrl(source).replace(
      "docs.google.com",
      "docs.google.com.evil.example",
    ),
    "https://docs.google.com/spreadsheets/d/next-roster-fixture-2027/edit",
    rosterSourceUrl(source).replace("123", "-1"),
  ])
    assert.throws(() => parseRosterSource(bad));
});
test("preview is read-only; applying preserves identity/history and excludes departed members before CMS sync", async () => {
  const before = readActivities();
  const p = await preview();
  assert.deepEqual(readActivities(), before);
  assert.equal(patches.length, 0);
  await apply(p.previewId);
  const data = readActivities();
  assert.equal(data.roster!.spreadsheetId, source.spreadsheetId);
  assert.equal(data.roster!.records[0].key, key("one"));
  assert.equal(data.profiles.one.grade, "3");
  assert.ok(!data.profiles.two);
  assert.equal(data.roster!.retiredRecords![0].name, "会員二");
  assert.equal(data.roster!.bindings.two, key("two"));
  assert.match(toAdminAccountRoster("two", data.roster).status, /退会/);
  const event = {
    recipientIds: ["one", "two"],
    votes: { one: { value: "attending" }, two: { value: "attending" } },
  } as any;
  assert.deepEqual(
    eventPeople(data, event, users).map((p) => p.id),
    ["one"],
  );
  const run = readGroupingTools().runs[0];
  assert.deepEqual(run.participantIds, [key("one")]);
  assert.deepEqual(run.rules.leaders, []);
  assert.equal(run.draftGroups, undefined);
  assert.equal(run.publishedGroups!.groups[0].memberIds.length, 2);
  assert.equal(data.rosterPortfolioUpdates![0].status, "pending");
  await apply(p.previewId);
  assert.equal(readActivities().rosterPortfolioUpdates!.length, 1);
  const done = await drainRosterPortfolioUpdates();
  assert.equal(done.completed, 1);
  assert.deepEqual(patches, [{ grade: "OB/OG" }]);
  assert.deepEqual(cms.pictures, ["preserve"]);
  assert.equal(cms.role, "元幹部");
  assert.equal(
    readActivities().rosterPortfolioUpdates![0].previousGrade,
    "2nd Grade",
  );
  await drainRosterPortfolioUpdates();
  assert.equal(patches.length, 1);
  assert.ok(fs.existsSync(path.join(dir, `roster-backup-${p.previewId}.json`)));
});
test("a failed CMS update is retained for retry and never restores grouping eligibility", async () => {
  await apply((await preview()).previewId);
  patchFail = true;
  await drainRosterPortfolioUpdates();
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "error");
  assert.ok(!readActivities().profiles.two);
  patchFail = false;
  await act({ action: "roster.retry" });
  await drainRosterPortfolioUpdates();
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "done");
});
test("failed reads, stale revisions, changed sheets and unconfirmed submissions never change the roster", async () => {
  const before = readActivities();
  fail = true;
  await assert.rejects(preview());
  assert.deepEqual(readActivities(), before);
  fail = false;
  let p = await preview();
  await assert.rejects(
    act({ action: "roster.apply", previewId: p.previewId, confirm: false }),
  );
  assert.deepEqual(readActivities(), before);
  rows[0].grade = "4年生";
  await assert.rejects(apply(p.previewId), /Google名簿が変わりました/);
  assert.deepEqual(readActivities(), before);
  p = await preview();
  const changed = readActivities();
  changed.roster!.revision++;
  writeData("member-activities.json", changed);
  await assert.rejects(apply(p.previewId), /更新されました/);
  assert.deepEqual(readActivities(), changed);
});
test("role changes and account relinking during confirmation prevent writes, and non-admins cannot preview/retry", async () => {
  const before = readActivities();
  for (const action of ["roster.preview", "roster.apply", "roster.retry"])
    await assert.rejects(act({ action }, "one"), /管理者/);
  const p = await preview();
  writeData(
    "users.json",
    users.map((u) => (u.id === "two" ? { ...u, portfolioId: "changed" } : u)),
  );
  await assert.rejects(apply(p.previewId), /更新されました/);
  assert.deepEqual(readActivities(), before);
  writeData(
    "users.json",
    users.map((u) => (u.id === "admin" ? { ...u, role: "staff" } : u)),
  );
  await assert.rejects(apply(p.previewId), /管理者/);
});
test("queued updates never follow a replaced Portfolio or a member restored to the roster", async () => {
  await apply((await preview()).previewId);
  writeData(
    "users.json",
    users.map((u) => (u.id === "two" ? { ...u, portfolioId: "changed" } : u)),
  );
  await drainRosterPortfolioUpdates();
  assert.equal(patches.length, 0);
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "cancelled");
});
test("duplicate names stay unresolved rather than withdrawing or silently cross-linking people", () => {
  const old = readActivities().roster!;
  old.records = [
    { ...row("one"), name: "同じ名前", lineName: "" },
    { ...row("two"), name: "同じ名前", lineName: "" },
  ];
  const next = reconcileRoster(
    old,
    [{ ...row("one"), key: key("new"), name: "同じ名前", lineName: "" }],
    source,
    new Date().toISOString(),
  );
  assert.equal(next.departed.length, 0);
  assert.equal(next.unresolved.length, 2);
  assert.equal(next.records[0].key, key("new"));
});
test("later refreshes keep the selected source and stable identities; further withdrawals require review", async () => {
  await apply((await preview()).previewId);
  await act({
    action: "roster.sync",
    revision: readActivities().roster!.revision,
  });
  assert.equal(readActivities().roster!.records[0].key, key("one"));
  rows = [];
  const before = readActivities();
  await assert.rejects(
    act({ action: "roster.sync", revision: before.roster!.revision }),
    /退会対象/,
  );
  assert.deepEqual(readActivities(), before);
});

test("returning members cancel pending graduation and a later departure creates a new update", async () => {
  await apply((await preview()).previewId);
  rows.push({
    ...row("two"),
    key: key("new-two"),
    gender: "男",
    grade: "3年生",
  });
  await apply((await preview()).previewId);
  assert.equal(readActivities().roster!.retiredRecords!.length, 0);
  assert.equal(readActivities().profiles.two.grade, "3");
  await drainRosterPortfolioUpdates();
  assert.equal(patches.length, 0);
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "cancelled");
  rows = rows.slice(0, 1);
  await apply((await preview()).previewId);
  assert.equal(readActivities().rosterPortfolioUpdates!.length, 2);
  await drainRosterPortfolioUpdates();
  assert.equal(patches.length, 1);
});

test("an array grade is updated without changing other fields", async () => {
  await apply((await preview()).previewId);
  cms.grade = ["2nd Grade"];
  await drainRosterPortfolioUpdates();
  assert.deepEqual(patches, [{ grade: ["OB/OG"] }]);
  assert.deepEqual(cms.pictures, ["preserve"]);
});

test("a lost PATCH response is recovered without a second write", async () => {
  await apply((await preview()).previewId);
  const normal = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const result = await normal(input, options);
    if (options?.method === "PATCH") throw new Error("fetch failed");
    return result;
  };
  await drainRosterPortfolioUpdates();
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "error");
  assert.equal(cms.grade, "OB/OG");
  globalThis.fetch = normal;
  await act({ action: "roster.retry" });
  await drainRosterPortfolioUpdates();
  assert.equal(patches.length, 1);
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "done");
});
