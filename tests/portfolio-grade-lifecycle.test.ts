import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeData } from "../src/lib/store.ts";
import { activityAction, readActivities } from "../src/lib/activities.ts";
import { emptyActivities } from "../src/lib/activityTypes.ts";
import { activityRosterSource, rosterSourceUrl } from "../src/lib/activityRoster.ts";
import { drainRosterPortfolioUpdates } from "../src/lib/rosterPortfolioUpdates.ts";
import { createSession } from "../src/lib/auth.ts";
import { POST } from "../src/pages/api/portfolio/update.ts";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "portfolio-grade-lifecycle-"),
);
const originalFetch = globalThis.fetch;
const rosterKey = "a".repeat(64);
let cms: Record<string, unknown>,
  incomingGrade: string,
  writes: unknown[],
  failPatch: boolean;
let now = Date.now();
const act = (input: Record<string, unknown>, actor = "admin") =>
  activityAction(actor, input, () => ++now);
const link = () =>
  act({
    action: "roster.link",
    revision: readActivities().roster!.revision,
    bindings: { member: rosterKey },
  });
const sync = () =>
  act({ action: "roster.sync", revision: readActivities().roster!.revision });
async function preview(source = { spreadsheetId: readActivities().roster!.spreadsheetId, sheetId: readActivities().roster!.sheetId + 1 }) {
  return act({ action: "roster.preview", revision: readActivities().roster!.revision, url: rosterSourceUrl(source) });
}
async function changeSource() {
  const result = await preview();
  return act({ action: "roster.apply", previewId: result.previewId, confirm: true });
}
async function save(grade: string) {
  const session = await createSession("member", 3600);
  return POST({
    request: new Request("https://scharade.jp/api/portfolio/update", {
      method: "POST",
      headers: {
        Cookie: `__Host-session=${session.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grade }),
    }),
  } as any);
}
beforeEach(() => {
  Object.assign(process.env, {
    DATA_DIR: directory,
    MICROCMS_SERVICE_DOMAIN: "fixture",
    MICROCMS_SERVER_API_KEY: "fixture",
    ACCOUNTING_GAS_URL: "https://script.google.com/macros/s/fixture/exec",
    ACCOUNTING_WEBHOOK_SECRET: "fixture-secret-at-least-32-characters",
  });
  cms = { grade: [], name: "架空会員", camera: "preserved" };
  incomingGrade = "博士";
  writes = [];
  failPatch = false;
  writeData("users.json", [
    {
      id: "admin",
      email: "admin@example.invalid",
      name: "管理者",
      approved: true,
      role: "admin",
      createdAt: "2026-10-28",
      providers: {},
    },
    {
      id: "member",
      email: "member@example.invalid",
      name: "架空会員",
      approved: true,
      role: "member",
      portfolioId: "member",
      createdAt: "2026-10-28",
      providers: {},
    },
  ]);
  writeData("sessions.json", []);
  const data = emptyActivities();
  data.roster = {
    ...activityRosterSource,
    revision: 1,
    sheetTitle: "回答",
    fetchedAt: "2026-10-01T00:00:00Z",
    fetchedBy: "admin",
    bindings: {},
    records: [
      {
        key: rosterKey,
        name: "架空会員",
        university: "大学",
        gender: "female",
        grade: "master",
        active: true,
      },
    ],
  };
  writeData("member-activities.json", data);
  globalThis.fetch = async (input, options) => {
    if (String(input).includes("script.google.com")) {
      const payload = JSON.parse(JSON.parse(String(options?.body)).payload);
      return Response.json({
        ok: true,
        ...activityRosterSource,
        spreadsheetId: payload.spreadsheetId,
        sheetId: payload.sheetId,
        sheetTitle: "回答",
        records: [
          {
            key: rosterKey,
            name: "架空会員",
            university: "大学",
            gender: "女性",
            grade: incomingGrade,
            active: true,
          },
        ],
      });
    }
    assert.equal(
      String(input),
      "https://fixture.microcms.io/api/v1/portfolio/member",
    );
    if (options?.method === "PATCH") {
      const patch = JSON.parse(String(options.body));
      if (failPatch) return new Response("unavailable", { status: 503 });
      if (!Array.isArray(patch.grade))
        return new Response("grade: unexpected data type", { status: 400 });
      writes.push(patch);
      Object.assign(cms, patch);
    }
    return Response.json(cms);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

test("new account's confirmed link initializes once; manual grades survive refreshes until a different roster source is applied", async () => {
  await link();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["Master's Program"]);
  assert.equal((await save("International")).status, 200);
  await link();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["International"]);
  assert.equal(readActivities().rosterPortfolioUpdates!.length, 1);
  await sync();
  await drainRosterPortfolioUpdates();
  assert.equal(readActivities().profiles.member.grade, "doctorate");
  assert.deepEqual(cms.grade, ["International"]);
  assert.equal(readActivities().rosterPortfolioUpdates!.length, 1);
  await changeSource();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["Doctor's Program"]);
  assert.equal(cms.camera, "preserved");
  assert.equal((await save("4th Grade")).status, 200);
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["4th Grade"]);
});

test("manual save supersedes both pending and failed imports, including a later retry", async () => {
  await link();
  assert.equal((await save("International")).status, 200);
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["International"]);
  assert.equal(readActivities().rosterPortfolioUpdates![0].status, "cancelled");
  await changeSource();
  failPatch = true;
  await drainRosterPortfolioUpdates();
  assert.equal(
    readActivities().rosterPortfolioUpdates!.at(-1)!.status,
    "error",
  );
  assert.equal((await save("2nd Grade")).status, 502);
  assert.equal(
    readActivities().rosterPortfolioUpdates!.at(-1)!.status,
    "error",
  );
  failPatch = false;
  assert.equal((await save("3rd Grade")).status, 200);
  await act({ action: "roster.retry" });
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["3rd Grade"]);
});

test("unmappable new roster grades and unlinked accounts cannot apply stale defaults", async () => {
  await link();
  incomingGrade = "その他";
  await changeSource();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, []);
  assert.equal(writes.length, 0);
  incomingGrade = "博士";
  await changeSource();
  await act({
    action: "roster.link",
    revision: readActivities().roster!.revision,
    bindings: { member: "" },
  });
  await drainRosterPortfolioUpdates();
  assert.equal(writes.length, 0);
});

test("only the latest confirmed roster import applies; reads and repeated worker ticks do not reset it", async () => {
  await link();
  await changeSource();
  incomingGrade = "4年生";
  await changeSource();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(writes, [{ grade: ["4th Grade"] }]);
  assert.equal((await save("International")).status, 200);
  for (let i = 0; i < 3; i++) {
    readActivities();
    await drainRosterPortfolioUpdates();
  }
  assert.deepEqual(cms.grade, ["International"]);
  await assert.rejects(
    act(
      { action: "roster.sync", revision: readActivities().roster!.revision },
      "member",
    ),
    /管理者/,
  );
});

test("first roster linkage preserves a grade already saved by the account owner", async () => {
  cms.grade = ["International"];
  await link();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["International"]);
  assert.equal(writes.length, 0);
  await changeSource();
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["Doctor's Program"]);
});

test("preview alone, rejected confirmation and equivalent source URLs never reset saved grades", async () => {
  await link(); await drainRosterPortfolioUpdates();
  assert.equal((await save("International")).status, 200);
  const before = readActivities();
  const different = await preview({ spreadsheetId: "different-roster-fixture-2027", sheetId: before.roster!.sheetId });
  assert.deepEqual(readActivities(), before);
  await assert.rejects(act({ action: "roster.apply", previewId: different.previewId, confirm: false }));
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["International"]);
  const { spreadsheetId, sheetId } = before.roster!;
  const equivalent = await act({ action: "roster.preview", revision: before.roster!.revision, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${sheetId}#gid=${sheetId}` });
  await act({ action: "roster.apply", previewId: equivalent.previewId, confirm: true });
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["International"]);
  assert.equal(readActivities().profiles.member.grade, "doctorate");
  assert.equal(readActivities().rosterPortfolioUpdates!.length, 1);
  const changed = await preview({ spreadsheetId: "different-roster-fixture-2027", sheetId });
  await act({ action: "roster.apply", previewId: changed.previewId, confirm: true });
  await drainRosterPortfolioUpdates();
  assert.deepEqual(cms.grade, ["Doctor's Program"]);
});

test("manual saving waits for an in-flight roster update and remains the final value", async () => {
  await link();
  const normalFetch = globalThis.fetch;
  let reached!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (input, options) => {
    if (!options?.method) {
      reached();
      await pause;
    }
    return normalFetch(input, options);
  };
  const importing = drainRosterPortfolioUpdates();
  await started;
  const saving = save("International");
  release();
  await importing;
  assert.equal((await saving).status, 200);
  assert.deepEqual(cms.grade, ["International"]);
});
