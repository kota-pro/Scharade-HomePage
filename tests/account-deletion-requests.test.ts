import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readData, writeData } from "../src/lib/store.ts";
import {
  readUsers,
  createSession,
  getUserFromSession,
  type User,
} from "../src/lib/auth.ts";
import {
  readDeletionRequests,
  requestDeletionCode,
  submitDeletionRequest,
} from "../src/lib/accountDeletionRequests.ts";
import {
  startDeletionProcessing,
  completeDeletionProcessing,
  drainDeletionEmails,
} from "../src/lib/accountDeletionProcessing.ts";
import { deletionChecks } from "../src/lib/deletionPrivacy.ts";
import { emptyActivities, defaultRules } from "../src/lib/activityTypes.ts";
const dir = fs.mkdtempSync(
  path.join(os.tmpdir(), "scharade-deletion-request-"),
);
process.env.DATA_DIR = dir;
const users: User[] = ["admin", "member", "other"].map((id) => ({
  id,
  name: id,
  email: `${id}@example.invalid`,
  role: id === "admin" ? "admin" : "member",
  approved: true,
  providers: {},
  createdAt: "2026-01-01",
  portfolioId: null,
}));
let now: number;
beforeEach(() => {
  now = Date.now();
  for (const file of fs.readdirSync(dir))
    fs.rmSync(path.join(dir, file), { recursive: true, force: true });
  writeData("users.json", users);
  writeData("sessions.json", []);
  writeData("member-activities.json", emptyActivities());
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
async function code(email = "member@example.invalid", at = now) {
  let proof = "";
  const response = await requestDeletionCode(
    email,
    async (_email, value) => {
      proof = value;
    },
    at,
  );
  return { token: response.verificationToken, proof };
}
async function request() {
  const c = await code();
  return (await submitDeletionRequest(c.token, c.proof, now)).request;
}
const input = () => ({
  confirmationEmail: "member@example.invalid",
  checks: Object.keys(deletionChecks),
});
test("approval-pending members can prove mailbox ownership and request deletion without logging in", async () => {
  writeData(
    "users.json",
    users.map((u) => (u.id === "member" ? { ...u, approved: false } : u)),
  );
  const c = await code();
  await assert.rejects(
    submitDeletionRequest(c.token, "invalid", now),
    /正しくありません/,
  );
  const result = await submitDeletionRequest(c.token, c.proof, now);
  assert.equal(result.request.status, "pending");
  assert.equal(result.request.dueAt, now + 7 * 86400000);
  await assert.rejects(
    submitDeletionRequest(c.token, c.proof, now),
    /有効期限/,
  );
  assert.ok(!JSON.stringify(readDeletionRequests()).includes(c.proof));
});
test("resending cannot reset the brute-force limit, failed mail is not usable, and unknown accounts are disclosed only after email proof", async () => {
  const c = await code();
  for (let i = 0; i < 5; i++)
    await assert.rejects(submitDeletionRequest(c.token, "bad", now));
  await assert.rejects(code("member@example.invalid", now + 61000), /集中/);
  await assert.rejects(
    requestDeletionCode(
      "other@example.invalid",
      async () => {
        throw new Error("mail down");
      },
      now,
    ),
    /送信できません/,
  );
  const unknown = await code("unknown@example.invalid");
  await assert.rejects(
    submitDeletionRequest(unknown.token, unknown.proof, now),
    /アカウントはありません/,
  );
});
test("processing revokes access, preserves unrelated group drafts and revisions, and is resumable", async () => {
  const s = await createSession("member", 3600),
    r = await request();
  const draft = {
    groups: [{ leaderId: "other", memberIds: ["other"] }],
    source: "source",
    savedAt: new Date(now).toISOString(),
    savedBy: "admin",
  };
  writeData("grouping-tools.json", {
    version: 1,
    runs: [
      {
        id: "unrelated",
        title: "別の班",
        revision: 4,
        participantIds: ["other"],
        previousRunId: "",
        rules: defaultRules(),
        draftGroups: draft,
      },
    ],
  });
  await assert.rejects(
    startDeletionProcessing("member", r.id, now),
    /管理者権限/,
  );
  await startDeletionProcessing("admin", r.id, now);
  assert.equal(getUserFromSession(s.token).user, null);
  assert.equal(readUsers().find((u) => u.id === "member")!.approved, false);
  assert.deepEqual(
    readData<any>("grouping-tools.json", {}).runs[0].draftGroups,
    draft,
  );
  assert.equal(readData<any>("grouping-tools.json", {}).runs[0].revision, 4);
  await startDeletionProcessing("admin", r.id, now + 1000);
  assert.equal(readDeletionRequests().requests[0].notBefore, now + 15 * 60000);
});
test("completion requires cooldown and every external cleanup check; mail failure retries and then removes contact details", async () => {
  const r = await request();
  await startDeletionProcessing("admin", r.id, now);
  await assert.rejects(
    completeDeletionProcessing("admin", r.id, input(), now),
    /15分/,
  );
  await assert.rejects(
    completeDeletionProcessing(
      "admin",
      r.id,
      { ...input(), checks: [] },
      now + 16 * 60000,
    ),
    /すべて/,
  );
  await completeDeletionProcessing("admin", r.id, input(), now + 16 * 60000);
  assert.equal(
    readUsers().some((u) => u.id === "member"),
    false,
  );
  assert.equal(
    readUsers().some((u) => u.id === "other"),
    true,
  );
  assert.equal(
    await drainDeletionEmails(
      async () => {
        throw new Error("offline");
      },
      () => now + 17 * 60000,
    ),
    0,
  );
  assert.equal(
    readDeletionRequests().requests[0].email,
    "member@example.invalid",
  );
  let calls = 0;
  assert.equal(
    await drainDeletionEmails(
      async (email) => {
        assert.equal(email, "member@example.invalid");
        calls++;
      },
      () => now + 30 * 60000,
    ),
    1,
  );
  assert.equal(calls, 1);
  assert.equal(readDeletionRequests().requests[0].email, "");
  assert.equal(
    await drainDeletionEmails(
      async () => {
        calls++;
      },
      () => now + 31 * 60000,
    ),
    0,
  );
  assert.equal(calls, 1);
});
test("an administrator's own deletion requires another administrator and cannot lock out the last admin", async () => {
  const c = await code("admin@example.invalid"),
    r = await submitDeletionRequest(c.token, c.proof, now);
  await assert.rejects(
    startDeletionProcessing("admin", r.request.id, now),
    /別の管理者/,
  );
  assert.equal(readUsers().find((u) => u.id === "admin")!.approved, true);
});

test("final cleanup removes derived outputs that an in-flight worker created after the original submissions were removed", async () => {
  const exhibitionId = "10000000-0000-4000-8000-000000000001",
    outputId = "20000000-0000-4000-8000-000000000002";
  const empty = {
    name: "member",
    grade: "",
    authorName: "",
    portfolioUrl: "",
    fields: {},
    sections: [],
    works: [],
  };
  const room = {
    id: "room",
    name: "部屋",
    vertices: [],
    wallHeights: [],
    openings: [],
    placements: [
      { workId: "private-work", wall: 0, x: 0, bottom: 0, rotation: 0 },
    ],
    tables: [],
    books: [],
  };
  const current = {
    id: "current",
    revision: 2,
    at: new Date(now).toISOString(),
    actorId: "member",
    actorName: "private member",
    kind: "edit",
  };
  writeData("exhibitions.json", {
    version: 1,
    exhibitions: [
      {
        id: exhibitionId,
        title: "写真展",
        revision: 1,
        schemas: [{ version: 1, sections: [], fields: [] }],
        rooms: [room],
        googleForms: [],
        albumId: "album",
        layoutRevision: 2,
        layoutCurrent: current,
        layoutHistory: [{ ...current, rooms: [room] }],
      },
    ],
    submissions: [
      {
        id: "submission",
        exhibitionId,
        userId: "member",
        draft: { ...empty, works: [{ id: "private-work" }] },
        versions: [],
      },
    ],
    assets: [],
    outputs: [],
  });
  const r = await request();
  await startDeletionProcessing("admin", r.id, now);
  const data = readData<any>("exhibitions.json", {});
  assert.equal(data.submissions.length, 0);
  assert.equal(data.exhibitions[0].rooms[0].placements.length, 0);
  assert.equal(data.exhibitions[0].layoutRevision, 3);
  assert.ok(
    data.exhibitions[0].layoutHistory.every(
      (h: any) =>
        h.actorId !== "member" &&
        h.actorName !== "private member" &&
        h.rooms[0].placements.length === 0,
    ),
  );
  data.outputs.push({
    id: outputId,
    exhibitionId,
    name: "進行中の処理の出力",
    drive: { status: "pending" },
  });
  writeData("exhibitions.json", data);
  const file = path.join(dir, `exhibition-output-${outputId}.bin`);
  fs.writeFileSync(file, "late derived output");
  await completeDeletionProcessing("admin", r.id, input(), now + 16 * 60000);
  assert.equal(readData<any>("exhibitions.json", {}).outputs.length, 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(
    readData<any>("exhibitions.json", {}).exhibitions[0].layoutRevision,
    3,
  );
});

test("shutdown stops the deletion mail queue between messages without consuming the remaining message", async () => {
  const data = readDeletionRequests();
  for (const id of ["one", "two"])
    data.requests.push({
      id,
      userId: id,
      email: `${id}@example.invalid`,
      name: id,
      portfolioId: null,
      createdAt: now,
      dueAt: now,
      status: "complete",
      completedAt: now,
    });
  writeData("account-deletion-requests.json", data);
  let stop = false,
    calls = 0;
  assert.equal(
    await drainDeletionEmails(
      async () => {
        calls++;
        stop = true;
      },
      () => now,
      () => stop,
    ),
    1,
  );
  assert.equal(calls, 1);
  assert.equal(
    readDeletionRequests().requests.filter((r) => r.mailSentAt).length,
    1,
  );
});
