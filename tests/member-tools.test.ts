import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { writeData, dataPath } from "../src/lib/store.ts";
import type { User } from "../src/lib/auth.ts";
import {
  createTool,
  readTool,
  toolAction,
  questionFor,
  resultsFor,
  identityFor,
  manageResults,
  revealIdentity,
  receptionOpen,
  publicationOpen,
  cleanupToolAccount,
  deleteTool,
  toolIds,
} from "../src/lib/memberTools.ts";
import {
  saveToolAsset,
  authorizedToolAsset,
  toolAssetPath,
  cleanUnusedToolAssets,
} from "../src/lib/memberToolAssets.ts";
import { drainToolNotices } from "../src/lib/memberToolNotices.ts";
import { readActivities, activityAction } from "../src/lib/activities.ts";
import type { ToolKind } from "../src/lib/memberToolTypes.ts";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "member-tools-"));
const users = [
  "member",
  "other",
  "staff",
  "executive",
  "admin",
  "outsider",
].map((id) => ({
  id,
  name: `架空${id}`,
  email: `${id}@example.invalid`,
  approved: true,
  role: ["staff", "executive", "admin"].includes(id) ? id : "member",
  providers: {},
  createdAt: new Date().toISOString(),
})) as User[];
const [member, other, staff, executive, admin, outsider] = users;
beforeEach(() => {
  process.env.DATA_DIR = directory;
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory);
  writeData("users.json", users);
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const act = (id: string, user: User, p: any) => {
  const t = readTool(id);
  const own = p.responseId
    ? t.responses.find((r) => r.id === p.responseId)
    : t.kind === "box"
      ? undefined
      : t.responses.find((r) => r.userId === user.id);
  return toolAction(id, user, {
    revision: t.revision,
    answerRevision: t.answerRevision,
    responseRevision: own?.revision ?? 0,
    ...p,
  });
};
async function setup(kind: ToolKind = "poll", creator = staff, settings = {}) {
  const t = await createTool(creator, kind);
  await act(t.id, creator, {
    action: "save",
    question: "架空の質問",
    recipientIds: ["member", "other"],
    options:
      kind === "schedule"
        ? [
            { date: "2027-01-01", text: "午前" },
            { date: "2027-01-01", text: "午後", start: "13:00", end: "15:00" },
          ]
        : [{ text: "A" }, { text: "B" }],
    settings: { ...t.settings, ...settings },
  });
  await act(t.id, creator, { action: "publish" });
  return readTool(t.id);
}
test("only staff can create and edit; public questions never expose responses or identities", async () => {
  await assert.rejects(createTool(member, "poll"), { status: 403 });
  const t = await setup("poll", staff, {
    publicQuestion: true,
    anonymous: true,
  });
  await act(t.id, member, { action: "respond", choices: [t.options[0].id] });
  const dto = questionFor(readTool(t.id), null);
  assert.equal(dto.own.length, 0);
  assert.equal("recipientIds" in dto, false);
  assert.equal("publication" in dto, false);
  assert.equal(JSON.stringify(dto).includes("架空member"), false);
  assert.throws(() => resultsFor(readTool(t.id), null), { status: 403 });
  await assert.rejects(
    act(t.id, member, { action: "reception", closed: true }),
    { status: 403 },
  );
  await assert.rejects(
    act(t.id, outsider, { action: "respond", choices: [t.options[0].id] }),
    { status: 403 },
  );
});
test("creator role locks management defaults and identity access is independently granted and audited", async () => {
  for (const creator of [staff, executive, admin]) {
    const t = await setup("poll", creator, { anonymous: true });
    await act(t.id, member, { action: "respond", choices: [t.options[0].id] });
    const fresh = readTool(t.id),
      r = fresh.responses[0];
    assert.equal(manageResults(fresh, staff), creator === staff);
    assert.equal(revealIdentity(fresh, staff), false);
    await assert.rejects(identityFor(t.id, r.id, staff), { status: 403 });
    assert.deepEqual(await identityFor(t.id, r.id, executive), {
      name: member.name,
    });
    const result = resultsFor(fresh, member);
    assert.equal("userId" in result.responses[0], false);
    assert.equal(result.responses[0].name, "匿名");
    await act(t.id, executive, {
      action: "permissions",
      staffResults: false,
      staffIdentity: true,
    });
    assert.equal(revealIdentity(readTool(t.id), staff), creator === staff);
    await act(t.id, executive, {
      action: "permissions",
      staffResults: true,
      staffIdentity: true,
    });
    assert.equal((await identityFor(t.id, r.id, staff)).name, member.name);
    await assert.rejects(
      act(t.id, staff, { action: "permissions", staffIdentity: true }),
      { status: 403 },
    );
  }
  assert.match(
    fs.readFileSync(dataPath("audit.jsonl"), "utf8"),
    /tool.identity.reveal/,
  );
});
test("result audience, timing, pause and reception operate separately", async () => {
  const t = await setup();
  assert.equal(publicationOpen(t, other), true);
  await act(t.id, staff, {
    action: "publication",
    publication: { ...t.publication, start: "answered" },
  });
  assert.equal(publicationOpen(readTool(t.id), other), false);
  await act(t.id, other, { action: "respond", choices: [t.options[0].id] });
  assert.equal(publicationOpen(readTool(t.id), other), true);
  await act(t.id, staff, {
    action: "publication",
    publication: { ...t.publication, paused: true },
  });
  assert.equal(receptionOpen(readTool(t.id)), true);
  assert.equal(publicationOpen(readTool(t.id), other), false);
  assert.equal(resultsFor(readTool(t.id), staff).respondentCount, 1);
  await act(t.id, staff, {
    action: "publication",
    publication: { ...t.publication, start: "closed" },
  });
  assert.equal(publicationOpen(readTool(t.id), member), false);
  await act(t.id, staff, { action: "reception", closed: true });
  assert.equal(publicationOpen(readTool(t.id), member), true);
  await assert.rejects(
    act(t.id, member, { action: "respond", choices: [t.options[0].id] }),
    { status: 403 },
  );
  for (const audience of ["staff", "executive", "admin"] as const) {
    await act(t.id, staff, {
      action: "publication",
      publication: { ...t.publication, audience },
    });
    assert.equal(publicationOpen(readTool(t.id), member), false);
    assert.equal(publicationOpen(readTool(t.id), admin), true);
  }
  const now = Date.now();
  await act(t.id, staff, {
    action: "publication",
    publication: {
      ...t.publication,
      start: "date",
      startsAt: new Date(now + 1000).toISOString(),
      endsAt: new Date(now + 2000).toISOString(),
    },
  });
  assert.equal(publicationOpen(readTool(t.id), member, now), false);
  assert.equal(publicationOpen(readTool(t.id), member, now + 1500), true);
  assert.equal(publicationOpen(readTool(t.id), member, now + 2000), false);
});
test("option edits retain stable votes, removal flags own response, settings do not erase history", async () => {
  const t = await setup("poll", staff, { multiple: true, anonymous: true });
  await act(t.id, member, {
    action: "respond",
    choices: t.options.map((o) => o.id),
  });
  await act(t.id, staff, {
    action: "save",
    question: "編集済み",
    recipientIds: t.recipientIds,
    options: [{ ...t.options[1], text: "新B" }],
    settings: { ...t.settings, multiple: false, anonymous: false },
  });
  const fresh = readTool(t.id);
  assert.equal(fresh.responses[0].choices.length, 2);
  assert.equal(fresh.responses[0].anonymous, true);
  assert.equal(resultsFor(fresh, other).responses[0].choices.length, 1);
  assert.equal(questionFor(fresh, member).own[0].needsRevision, true);
  await act(t.id, member, { action: "respond", choices: [t.options[1].id] });
  assert.equal(readTool(t.id).responses[0].anonymous, true);
  await assert.rejects(
    toolAction(t.id, staff, { action: "reception", revision: 1, closed: true }),
    { status: 409 },
  );
});
test("schedule keeps multiple slots per date and distinguishes missing from no; recipient candidates respect reception", async () => {
  const t = await setup("schedule", staff, { allowOptions: true });
  await act(t.id, member, {
    action: "respond",
    dates: { [t.options[0].id]: "maybe", [t.options[1].id]: "no" },
  });
  await act(t.id, other, {
    action: "add-option",
    option: { date: "2027-01-02", text: "夕方" },
  });
  const result = resultsFor(readTool(t.id), other);
  assert.equal(result.options.length, 3);
  assert.equal(result.responses[0].dates[result.options[2].id], undefined);
  await act(t.id, staff, { action: "reception", closed: true });
  await assert.rejects(
    act(t.id, other, {
      action: "add-option",
      option: { date: "2027-01-03", text: "" },
    }),
    { status: 403 },
  );
});
test("box selected publication is withheld after edits, all mode includes future posts and recipients are separate", async () => {
  const t = await setup("box");
  await act(t.id, member, {
    action: "respond",
    body: "回答 https://example.invalid",
    assetIds: [],
  });
  const r = readTool(t.id).responses[0];
  assert.throws(() => resultsFor(readTool(t.id), member), { status: 403 });
  assert.equal(questionFor(readTool(t.id), member).own.length, 1);
  await assert.rejects(act(t.id, member, { action: "respond", body: "重複" }));
  await act(t.id, staff, {
    action: "publication",
    publication: {
      ...t.publication,
      paused: false,
      audience: "selected",
      memberIds: [outsider.id],
      responseIds: [r.id],
    },
  });
  assert.equal(resultsFor(readTool(t.id), outsider).responses.length, 1);
  assert.equal(questionFor(readTool(t.id), outsider).canAnswer, false);
  await act(t.id, member, {
    action: "respond",
    responseId: r.id,
    body: "更新",
  });
  assert.equal(resultsFor(readTool(t.id), outsider).responses.length, 0);
  await act(t.id, staff, {
    action: "publication",
    publication: {
      ...t.publication,
      paused: false,
      audience: "all",
      boxMode: "all",
    },
  });
  await act(t.id, other, { action: "respond", body: "後からの投稿" });
  assert.equal(resultsFor(readTool(t.id), outsider).responses.length, 2);
  await act(t.id, member, { action: "withdraw", responseId: r.id });
  assert.equal(resultsFor(readTool(t.id), outsider).responses.length, 1);
});
test("private attachments validate content, ownership and result publication; unused assets expire", async () => {
  const t = await setup("box");
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  const a = await saveToolAsset(
    t.id,
    member,
    new File([png], "photo.png"),
    "response",
  );
  assert.equal(a.mime, "image/webp");
  assert.throws(() => authorizedToolAsset(readTool(t.id), a.id, other), {
    status: 403,
  });
  await assert.rejects(
    act(t.id, other, { action: "respond", body: "", assetIds: [a.id] }),
  );
  await act(t.id, member, {
    action: "respond",
    body: "添付",
    assetIds: [a.id],
  });
  assert.equal(authorizedToolAsset(readTool(t.id), a.id, staff).id, a.id);
  await act(t.id, staff, {
    action: "publication",
    publication: { ...t.publication, paused: false, boxMode: "all" },
  });
  assert.equal(authorizedToolAsset(readTool(t.id), a.id, other).id, a.id);
  await assert.rejects(
    saveToolAsset(
      t.id,
      member,
      new File(["<script>bad</script>"], "bad.svg"),
      "response",
    ),
  );
  await assert.rejects(
    saveToolAsset(t.id, member, new File(["fake"], "bad.pdf"), "response"),
  );
  await assert.rejects(
    saveToolAsset(
      t.id,
      member,
      new File([new Uint8Array(21 * 1024 * 1024)], "large.txt"),
      "response",
    ),
    { status: 413 },
  );
  const orphan = await saveToolAsset(
    t.id,
    member,
    new File(["text"], "draft.txt"),
    "response",
  );
  await cleanUnusedToolAssets(Date.now() + 2 * 86400000);
  assert.equal(fs.existsSync(toolAssetPath(orphan.id)), false);
  assert.equal(fs.existsSync(toolAssetPath(a.id)), true);
  await cleanupToolAccount(member.id);
  assert.equal(readTool(t.id).responses.length, 0);
  assert.equal(fs.existsSync(toolAssetPath(a.id)), false);
});
test("publication outbox delivers once; republishing and retry never duplicate notification", async () => {
  const t = await setup();
  await Promise.all([drainToolNotices(), drainToolNotices()]);
  assert.equal(readActivities().notifications.length, 1);
  assert.equal(readActivities().notifications[0].toolId, t.id);
  await act(t.id, staff, { action: "publish" });
  await drainToolNotices();
  assert.equal(readActivities().notifications.length, 1);
  const saved = readTool(t.id);
  saved.outbox!.delivered = false;
  writeData(`member-tool-${t.id}.json`, saved);
  await drainToolNotices();
  assert.equal(readActivities().notifications.length, 1);
});

test("independent replies and publication edits do not invalidate pending answers; stale own edits are rejected", async () => {
  const t = await setup();
  const pending = {
    action: "respond",
    revision: t.revision,
    answerRevision: t.answerRevision,
    responseRevision: 0,
    choices: [t.options[0].id],
  };
  await act(t.id, staff, {
    action: "publication",
    publication: { ...t.publication, paused: true },
  });
  await Promise.all([
    toolAction(t.id, member, pending),
    toolAction(t.id, other, pending),
  ]);
  assert.equal(readTool(t.id).responses.length, 2);
  await assert.rejects(toolAction(t.id, member, pending), { status: 409 });
});

test("staff can delete each tool kind, while missing confirmation, stale edits and unauthorized deletion preserve data", async () => {
  for (const kind of ["poll", "schedule", "box"] as const) {
    const t = await createTool(staff, kind);
    const request = { confirmation: "delete", revision: t.revision };
    await assert.rejects(deleteTool(t.id, member, request), { status: 403 });
    await assert.rejects(deleteTool(t.id, staff, { revision: t.revision }), {
      status: 400,
    });
    await assert.rejects(deleteTool(t.id, staff, { ...request, revision: 0 }), {
      status: 409,
    });
    assert.equal(readTool(t.id).kind, kind);
    await deleteTool(t.id, staff, request);
    assert.throws(() => readTool(t.id), { status: 404 });
    assert.equal(toolIds().includes(t.id), false);
    assert.equal(fs.existsSync(dataPath(`member-tool-${t.id}.json`)), false);
    await assert.rejects(deleteTool(t.id, staff, request), { status: 404 });
  }
  assert.match(fs.readFileSync(dataPath("audit.jsonl"), "utf8"), /tool.delete/);
});

test("deleting a published tool removes its answers, attachments, notices and queued pushes without affecting another tool", async () => {
  const t = await setup("box");
  const otherTool = await setup("poll");
  const a = await saveToolAsset(
    t.id,
    member,
    new File(["private answer"], "answer.txt"),
    "response",
  );
  await act(t.id, member, {
    action: "respond",
    body: "private answer",
    assetIds: [a.id],
  });
  await drainToolNotices();
  const activities = readActivities();
  activities.push = {
    reminders: [],
    jobs: activities.notifications.map((n) => ({
      id: n.id,
      noticeId: n.id,
      deviceId: "fixture",
      generation: "fixture-generation",
      status: "pending",
      attempts: 0,
      nextAttemptAt: Date.now(),
      expiresAt: Date.now() + 10000,
    })),
  };
  writeData("member-activities.json", activities);
  await deleteTool(t.id, executive, {
    confirmation: "delete",
    revision: t.revision,
  });
  assert.equal(fs.existsSync(toolAssetPath(a.id)), false);
  assert.equal(
    readActivities().notifications.some((n) => n.toolId === t.id),
    false,
  );
  assert.equal(
    readActivities().push!.jobs.some((j) => j.noticeId === t.outbox!.id),
    false,
  );
  assert.equal(readTool(otherTool.id).id, otherTool.id);
  assert.equal(
    readActivities().notifications.some((n) => n.toolId === otherTool.id),
    true,
  );
  assert.throws(
    () => act(t.id, member, { action: "respond", body: "late answer" }),
    { status: 404 },
  );
});

test("deletion racing with notice delivery and asset cleanup cannot recreate the tool or its notification", async () => {
  const t = await setup("poll");
  await Promise.all([
    drainToolNotices(),
    deleteTool(t.id, admin, { confirmation: "delete", revision: t.revision }),
    cleanUnusedToolAssets(Date.now() + 86400001),
    cleanupToolAccount(other.id),
  ]);
  await drainToolNotices();
  assert.deepEqual(toolIds(), []);
  assert.equal(readActivities().notifications.length, 0);
});

test("an interrupted deletion blocks reading immediately and the worker safely completes cleanup", async (testContext) => {
  const t = await setup("box");
  const a = await saveToolAsset(
    t.id,
    member,
    new File(["private file"], "answer.txt"),
    "response",
  );
  const remove = fs.rmSync;
  const stub = testContext.mock.method(
    fs,
    "rmSync",
    (...args: Parameters<typeof fs.rmSync>) => {
      if (args[0] === toolAssetPath(a.id))
        throw new Error("simulated disk failure");
      return remove(...args);
    },
  );
  await assert.rejects(
    deleteTool(t.id, staff, { confirmation: "delete", revision: t.revision }),
    /simulated disk failure/,
  );
  stub.mock.restore();
  assert.throws(() => readTool(t.id), { status: 404 });
  assert.deepEqual(toolIds(), []);
  const marker = fs.readFileSync(dataPath(`member-tool-${t.id}.json`), "utf8");
  assert.equal(marker.includes("架空の質問"), false);
  assert.equal(marker.includes("answer.txt"), false);
  await drainToolNotices();
  assert.equal(fs.existsSync(toolAssetPath(a.id)), false);
  assert.equal(fs.existsSync(dataPath(`member-tool-${t.id}.json`)), false);
  assert.equal(readActivities().notifications.length, 0);
});

test("deleting only a tool notification preserves the tool and suppresses delivery retries", async () => {
  const t = await setup();
  await drainToolNotices();
  await activityAction(staff.id, {
    action: "notification.delete",
    id: t.outbox!.id,
    confirmation: "delete",
  });
  const fresh = readTool(t.id);
  fresh.outbox!.delivered = false;
  writeData(`member-tool-${t.id}.json`, fresh);
  await drainToolNotices();
  assert.equal(readActivities().notifications.length, 0);
  assert.equal(readTool(t.id).outbox!.delivered, true);
  assert.equal(questionFor(readTool(t.id), member).canAnswer, true);
});

test('polls and date surveys accept late responses with a warning, while explicit closure still blocks replies',async()=>{
 for(const kind of ['poll','schedule'] as const){const t=await setup(kind,staff,{endsAt:'2020-01-01T00:00:00Z'});assert.equal(questionFor(t,member).open,true);assert.equal(questionFor(t,member).overdue,true);await act(t.id,member,{action:'respond',...(kind==='poll'?{choices:[t.options[0].id]}:{dates:{[t.options[0].id]:'yes',[t.options[1].id]:'no'}})});assert.equal(readTool(t.id).responses.length,1);await act(t.id,staff,{action:'reception',closed:true});assert.equal(questionFor(readTool(t.id),member).overdue,false);await assert.rejects(act(t.id,member,{action:'respond',choices:[t.options[0].id],dates:{[t.options[0].id]:'yes'}}));}
});
test('after-deadline result publication opens at the scheduled deadline without closing late reception',async()=>{
 const now=Date.now(),deadline=now+10000,t=await setup('poll',staff,{endsAt:new Date(deadline).toISOString()});await act(t.id,staff,{action:'publication',publication:{...t.publication,start:'closed'}});const tool=readTool(t.id);assert.equal(publicationOpen(tool,member,deadline-1),false);assert.equal(publicationOpen(tool,member,deadline),true);assert.equal(receptionOpen(tool,deadline),true);await act(t.id,member,{action:'respond',choices:[tool.options[0].id]});assert.equal(readTool(t.id).responses.length,1);
});
