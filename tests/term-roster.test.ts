import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { clubGasHarness } from "./helpers/club-forms-gas.ts";
import {
  mergeTermResponses,
  type TermResponse,
} from "../src/lib/termRoster.ts";
import { activityAction, readActivities } from "../src/lib/activities.ts";
import {
  readRosterPreview,
  rosterPreviewSummary,
} from "../src/lib/rosterChanges.ts";
import { emptyActivities, defaultRules } from "../src/lib/activityTypes.ts";
import { writeData } from "../src/lib/store.ts";
import { drainRosterExports } from "../src/lib/rosterExports.ts";
import { drainRosterPortfolioUpdates } from "../src/lib/rosterPortfolioUpdates.ts";
import { applyAccountReview } from "../src/lib/accountReview.ts";
import { readUsers } from "../src/lib/auth.ts";
import type { TermRosterSource } from "../src/lib/clubFormsTypes.ts";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "scharade-term-roster-"),
);
const originalFetch = globalThis.fetch;
const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const term: TermRosterSource = {
  year: 2027,
  season: "spring",
  admission: { spreadsheetId: "admission_fixture_2027_012345", sheetId: 11 },
  continuation: {
    spreadsheetId: "continuation_fixture_2027_012345",
    sheetId: 22,
  },
};
const sheetUrl = (kind: "admission" | "continuation") =>
  `https://docs.google.com/spreadsheets/d/${term[kind].spreadsheetId}/edit#gid=${term[kind].sheetId}`;
const names: Record<string, string> = {
  one: "継続会員",
  missing: "退会会員",
  declined: "不継続会員",
  same: "維持会員",
  fresh: "新入会員",
};
let h: ReturnType<typeof clubGasHarness>,
  admissionSheet: any,
  continuationSheet: any,
  fail: boolean,
  cms: Record<string, any>,
  patches: any[];
const headers = [
  "タイムスタンプ",
  "名前",
  "大学名",
  "性別",
  "学年",
  "LINE名",
  "継続しますか？",
];
const answer = (
  name: string,
  grade: string,
  active = "はい",
  gender = "",
  time = "2027-03-01T00:00:00Z",
) => [new Date(time), name, "大学", gender, grade, "line", active];
const preview = () =>
  activityAction("executive", {
    action: "roster.preview",
    mode: "term",
    year: term.year,
    season: term.season,
    admissionUrl: sheetUrl("admission"),
    continuationUrl: sheetUrl("continuation"),
    revision: readActivities().roster!.revision,
  });
const apply = (id: string) =>
  activityAction("executive", {
    action: "roster.apply",
    previewId: id,
    confirm: true,
  });

test("a deletion queued during roster fetching invalidates the preview before apply commits", async () => {
  const p = await preview();
  const before = JSON.stringify(readActivities());
  const delegate = globalThis.fetch;
  let marked = false;
  globalThis.fetch = async (...args) => {
    const response = await delegate(...args);
    const body =
      typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : {};
    if (body.payload && JSON.parse(body.payload).action === "roster.read") {
      writeData("club-forms.json", {
        version: 1,
        forms: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            deleteRequestedAt: new Date().toISOString(),
            remote: { spreadsheetId: term.admission.spreadsheetId },
          },
        ],
        operations: [],
      });
      marked = true;
    }
    return response;
  };
  try {
    assert.ok(typeof p.previewId === "string");
    await assert.rejects(apply(p.previewId), /削除中または削除済み/);
  } finally {
    globalThis.fetch = delegate;
  }
  assert.equal(marked, true);
  assert.equal(JSON.stringify(readActivities()), before);
  await assert.rejects(preview(), /削除中または削除済み/);
});
beforeEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory);
  h = clubGasHarness();
  fail = false;
  patches = [];
  cms = {};
  Object.assign(process.env, {
    DATA_DIR: directory,
    CLUB_FORMS_GAS_URL: "https://script.google.com/macros/s/club-fixture/exec",
    CLUB_FORMS_WEBHOOK_SECRET: h.props.WEBHOOK_SECRET,
    MICROCMS_SERVICE_DOMAIN: "fixture",
    MICROCMS_SERVER_API_KEY: "fixture",
  });
  writeData("users.json", [
    {
      id: "executive",
      name: "幹部",
      email: "executive@example.invalid",
      role: "executive",
      approved: true,
      providers: {},
      createdAt: "2026-01-01",
    },
    ...Object.entries(names).map(([id, name]) => ({
      id,
      name,
      email: `${id}@example.invalid`,
      role: "member",
      approved: true,
      portfolioId: id,
      providers: {},
      createdAt: "2026-01-01",
    })),
  ]);
  const data = emptyActivities(),
    bindings: Record<string, string> = {};
  const records = Object.entries(names)
    .filter(([id]) => id !== "fresh")
    .map(([id, name]) => {
      bindings[id] = hash(id);
      return {
        key: hash(id),
        name,
        university: "大学",
        gender: "female" as const,
        grade: (id === "declined" ? "3" : id === "one" ? "1" : "2") as
          | "1"
          | "2"
          | "3",
        lineName: "line",
        active: true,
      };
    });
  data.roster = {
    spreadsheetId: "old_legacy_fixture_0123456789",
    sheetId: 1,
    title: "旧名簿",
    sheetTitle: "回答",
    fetchedAt: "2026-01-01T00:00:00Z",
    fetchedBy: "executive",
    revision: 1,
    records,
    bindings,
  };
  records.forEach((row) => {
    const id = Object.keys(bindings).find((id) => bindings[id] === row.key)!;
    data.profiles[id] = {
      gender: row.gender,
      grade: row.grade,
      rosterKey: row.key,
      revision: 1,
    };
    cms[id] = {
      grade: id === "same" ? ["International"] : [`${row.grade}st Grade`],
      pictures: ["keep"],
    };
  });
  cms.fresh = { grade: [], pictures: ["keep"] };
  data.events = [
    {
      id: "event",
      title: "企画",
      revision: 1,
      status: "published",
      recipientIds: Object.keys(names),
      rules: {
        ...defaultRules(),
        leaders: ["one", "missing"],
        together: [["one", "declined"]],
      },
      draftGroups: {
        groups: [{ leaderId: "one", memberIds: ["one", "missing"] }],
        source: "",
        savedAt: "",
        savedBy: "",
      },
      votes: {},
      groupHistory: [],
      createdAt: "",
      updatedAt: "",
      startsAt: "2030-01-01T00:00:00Z",
      endsAt: "2030-01-02T00:00:00Z",
      deadline: "2029-01-01T00:00:00Z",
      description: "",
      meeting: "",
      itinerary: "",
      fee: "",
      theme: "",
      ownerId: "executive",
      ownerName: "幹部",
    },
  ];
  writeData("member-activities.json", data);
  admissionSheet = h.addSource(term.admission.spreadsheetId, 11, headers, [
    answer("新入会員", "1年生", "はい", "女性"),
    answer("不継続会員", "3年生", "はい", "男性", "2027-03-02T00:00:00Z"),
  ]);
  continuationSheet = h.addSource(
    term.continuation.spreadsheetId,
    22,
    headers,
    [
      answer("継続会員", "2年生"),
      answer("不継続会員", "3年生", "いいえ"),
      answer("維持会員", "2年生"),
    ],
  );
  globalThis.fetch = async (input, options) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname === "script.google.com") {
      if (fail) throw new Error("outage");
      return Response.json(
        h.ctx.doPost({ postData: { contents: String(options?.body) } }),
      );
    }
    if (url.hostname === "fixture.microcms.io") {
      const id = url.pathname.split("/").at(-1)!;
      if (options?.method === "PATCH") {
        const body = JSON.parse(String(options.body));
        patches.push({ id, ...body });
        Object.assign(cms[id], body);
        return Response.json({});
      }
      return Response.json(cms[id]);
    }
    throw new Error("unexpected network");
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

test("preview is read-only, continuation has priority, explicit no and missing names retire, changed grades update Portfolio and confirmed exports", async () => {
  const before = readActivities(),
    p = await preview(),
    saved = readRosterPreview("executive", p.previewId as string)!;
  assert.deepEqual(readActivities(), before);
  const summary = rosterPreviewSummary(saved);
  assert.equal(summary.departures.length, 2);
  assert.equal(summary.gradeChanges.length, 1);
  assert.equal(summary.added.length, 1);
  assert.equal(
    summary.departures.find((row) => row.name === "不継続会員")
      ?.departureReason,
    "declined",
  );
  assert.equal(summary.linkCandidates[0].name, "新入会員");
  await apply(p.previewId as string);
  const data = readActivities();
  assert.equal(data.roster?.term?.year, 2027);
  assert.equal(data.profiles.one.grade, "2");
  assert.equal(data.profiles.one.gender, "female");
  assert.equal(data.profiles.missing, undefined);
  assert.equal(data.profiles.declined, undefined);
  assert.equal(data.profiles.fresh.grade, "1");
  assert.deepEqual(data.events[0].rules.leaders, ["one"]);
  assert.deepEqual(data.events[0].rules.together, []);
  assert.equal(data.events[0].draftGroups, undefined);
  assert.equal(data.rosterExports?.[0].status, "pending");
  const jobs = data.rosterPortfolioUpdates!;
  assert.equal(
    jobs.some((job) => job.userId === "same"),
    false,
  );
  assert.equal(jobs.find((job) => job.userId === "fresh")?.initialOnly, true);
  await drainRosterPortfolioUpdates(10);
  assert.equal(cms.one.grade[0], "2nd Grade");
  assert.equal(cms.declined.grade[0], "OB/OG");
  assert.equal(cms.missing.grade[0], "OB/OG");
  assert.equal(cms.same.grade[0], "International");
  assert.equal(cms.fresh.grade[0], "1st Grade");
  assert.deepEqual(cms.one.pictures, ["keep"]);
  assert.deepEqual(await drainRosterExports(), { attempted: 1, completed: 1 });
  assert.match(
    readActivities().roster!.mergedSpreadsheetUrl!,
    /docs.google.com/,
  );
  const sheets = [...h.books.values()].find((book) =>
    book.getSheetByName("在籍者"),
  );
  assert.ok(sheets);
  assert.equal(sheets.getSheetByName("退会者").rows.length, 3);
});

test("same-period grade changes and returning members are reflected; a changed response after preview refuses the entire apply", async () => {
  await apply((await preview()).previewId as string);
  const data = readActivities(),
    binding = data.roster!.bindings.declined;
  continuationSheet.rows[2] = answer("不継続会員", "3年生", "はい");
  const p = await preview(),
    s = rosterPreviewSummary(
      readRosterPreview("executive", p.previewId as string)!,
    );
  assert.equal(
    s.gradeChanges.find((row) => row.key === binding)?.returning,
    true,
  );
  continuationSheet.rows[1] = answer("継続会員", "3年生", "はい");
  await assert.rejects(apply(p.previewId as string), /Google名簿が変わり/);
  assert.deepEqual(readActivities(), data);
  await apply((await preview()).previewId as string);
  assert.equal(readActivities().profiles.one.grade, "3");
  assert.equal(readActivities().profiles.declined.grade, "3");
  assert.equal(
    readActivities().roster!.retiredRecords!.some((row) => row.key === binding),
    false,
  );
});

test("a failed or incomplete source cannot erase members, and both source IDs must be distinct", async () => {
  const before = readActivities();
  fail = true;
  await assert.rejects(preview());
  assert.deepEqual(readActivities(), before);
  fail = false;
  continuationSheet.rows[0][6] = "別の見出し";
  await assert.rejects(preview());
  assert.deepEqual(readActivities(), before);
  await assert.rejects(
    activityAction("executive", {
      action: "roster.preview",
      mode: "term",
      year: 2027,
      season: "spring",
      admissionUrl: sheetUrl("admission"),
      continuationUrl: sheetUrl("admission"),
      revision: 1,
    }),
    /異なる/,
  );
  for (const role of ["one", "missing"])
    await assert.rejects(
      activityAction(role, {
        action: "roster.preview",
        mode: "term",
        year: 2027,
        season: "spring",
        admissionUrl: sheetUrl("admission"),
        continuationUrl: sheetUrl("continuation"),
        revision: 1,
      }),
      (e: any) => e.status === 403,
    );
});

test("automatic approval uses the active term and refuses to apply unrelated grade changes without confirmation", async () => {
  await apply((await preview()).previewId as string);
  const users = readUsers();
  users.push({
    id: "new",
    name: "次の会員",
    email: "new@example.invalid",
    role: "member",
    approved: false,
    providers: {},
    createdAt: "2027-01-01",
  });
  writeData("users.json", users);
  continuationSheet.rows[1] = answer("継続会員", "3年生");
  admissionSheet.rows.push(answer("次の会員", "1年生", "はい", "女性"));
  let emails = 0;
  assert.equal(
    await applyAccountReview("new", "approve", async () => {
      emails++;
    }),
    "setup-failed",
  );
  assert.equal(readActivities().profiles.one.grade, "2");
  assert.equal(readUsers().find((user) => user.id === "new")?.approved, true);
  assert.equal(emails, 1);
});

test("latest answers resolve within each form while namesakes, missing genders and unknown continuation answers remain reviewable", () => {
  const row = (
    kind: TermResponse["kind"],
    extra: Partial<TermResponse> = {},
  ): TermResponse => ({
    key: hash(JSON.stringify(extra) + kind),
    name: "同姓 同名",
    university: "大学",
    lineName: "line",
    gender: "女性",
    grade: "2年生",
    submittedAt: "2027-03-01T00:00:00Z",
    active: true,
    kind,
    ...extra,
  });
  const merged = mergeTermResponses(
    [
      row("admission", { grade: "1年生", submittedAt: "2027-03-05T00:00:00Z" }),
      row("continuation", { active: false }),
      row("continuation", {
        grade: "3年生",
        submittedAt: "2027-03-02T00:00:00Z",
      }),
    ],
    term,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].active, true);
  assert.equal(merged[0].grade, "3");
  const namesakes = mergeTermResponses(
    [
      row("admission", { identityHash: hash("one") }),
      row("admission", { identityHash: hash("two") }),
      row("continuation", { identityHash: undefined }),
    ],
    term,
  );
  assert.equal(namesakes.length, 3);
  assert.ok(namesakes.some((row) => row.identityUncertain));
  assert.equal(new Set(namesakes.map((row) => row.key)).size, 3);
  const unknown = mergeTermResponses(
    [row("continuation", { gender: "", active: null })],
    term,
  );
  assert.equal(unknown[0].membershipUncertain, true);
  assert.equal(unknown[0].gender, null);
  assert.equal(unknown[0].active, false);
});

test("an unknown continuation keeps the known active person and their binding even when deterministic answer IDs match", async () => {
  await apply((await preview()).previewId as string);
  const before = readActivities(),
    key = before.roster!.bindings.one;
  continuationSheet.rows[1] = answer("継続会員", "2年生", "確認中");
  await apply((await preview()).previewId as string);
  const after = readActivities();
  assert.equal(after.roster!.bindings.one, key);
  assert.equal(
    after.roster!.records.find((row) => row.key === key)?.active,
    true,
  );
  assert.equal(after.profiles.one.grade, "2");
  assert.equal(
    after.roster!.retiredRecords!.some((row) => row.key === key),
    false,
  );
  assert.ok(
    after.roster!.records.some(
      (row) => row.name === "継続会員" && row.membershipUncertain,
    ),
  );
  assert.equal(
    new Set(after.roster!.records.map((row) => row.key)).size,
    after.roster!.records.length,
  );
});

test("managed source sheets must match the chosen year, season and form kind", async () => {
  const source = { ...term.admission };
  writeData("club-forms.json", {
    version: 1,
    forms: [
      {
        id: crypto.randomUUID(),
        revision: 1,
        year: 2026,
        season: "autumn",
        kind: "admission",
        remote: source,
      },
    ],
    operations: [],
  });
  const before = readActivities();
  await assert.rejects(preview(), /西暦・春秋・種類/);
  assert.deepEqual(readActivities(), before);
});

test("a failed merged-sheet export retries its saved snapshot and never marks a newer period with an old result", async () => {
  await apply((await preview()).previewId as string);
  const snapshot = readActivities();
  fail = true;
  assert.deepEqual(await drainRosterExports(), { attempted: 1, completed: 0 });
  let saved = readActivities();
  assert.equal(saved.rosterExports![0].status, "pending");
  assert.equal(saved.roster!.mergedSpreadsheetUrl, undefined);
  saved.rosterExports![0].nextAttemptAt = 0;
  saved.roster!.term!.season = "autumn";
  writeData("member-activities.json", saved);
  fail = false;
  assert.deepEqual(await drainRosterExports(), { attempted: 1, completed: 1 });
  saved = readActivities();
  assert.equal(saved.roster!.mergedSpreadsheetUrl, undefined);
  assert.equal(saved.rosterExports![0].status, "done");
  assert.deepEqual(
    saved.rosterExports![0].records,
    snapshot.rosterExports![0].records,
  );
});
