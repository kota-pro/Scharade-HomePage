import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore, voteExhibition, authorizeAsset, uploadExhibitionAsset } from "../src/lib/exhibitions.ts";
import { participationState, ownSubmission } from "../src/lib/exhibitionParticipation.ts";
import { exhibitionCalendarEntries } from "../src/lib/exhibitionCalendar.ts";
import { drainExhibitionQueues } from "../src/lib/exhibitionIntegrations.ts";
import { writeData, readData } from "../src/lib/store.ts";
import type { User } from "../src/lib/auth.ts";

const users: User[] = ["staff", "author", "other", "uninvited"].map(id => ({ id, name: id, email: `${id}@example.invalid`, role: id === "staff" ? "staff" : "member", approved: true, createdAt: "2026-01-01", providers: {} }));
test("notice is delivered before voting; participation and all input/asset operations enforce the signed-in owner and deadlines", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-participation-"));
  process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "秋季写真展" })).exhibition;
    const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString();
    const settings = { action: "settings", exhibitionId: e.id, revision: e.revision, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-1000), voteClosesAt: iso(60000), opensAt: iso(60000), closesAt: iso(180000), recipientIds: ["author", "other"] };
    await assert.rejects(() => exhibitionAction("author", settings), /運営以上/);
    let current = (await exhibitionAction("staff", settings)).exhibition;
    current = (await exhibitionAction("staff", { ...settings, revision: current.revision, voteClosesAt: iso(70000) })).exhibition;
    await assert.rejects(() => exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current.revision, body: "参加投票" }), /投票開始/);
    current = (await exhibitionAction("staff", { ...settings, revision: current.revision })).exhibition;
    // Publishing records the notice durably before opening votes.
    await exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current.revision, body: "参加投票をお願いします。" });
    await assert.rejects(() => voteExhibition("author", e.id, "attending"), /期間外/);
    await drainExhibitionQueues("https://example.invalid");
    await drainExhibitionQueues("https://example.invalid");
    const notices = readData<any>("member-activities.json", {}).notifications;
    assert.equal(notices.filter((n: any) => n.exhibitionId === e.id).length, 1);
    current = readExhibitions().exhibitions[0];
    assert.equal(current.participation?.state, "published");
    assert.equal(exhibitionCalendarEntries([current], "author").length, 2);
    assert.equal(exhibitionCalendarEntries([current], "uninvited").length, 0);
    await assert.rejects(() => voteExhibition("uninvited", e.id, "attending"), /閲覧できません/);
    await voteExhibition("author", e.id, "attending"); await voteExhibition("other", e.id, "absent");
    await assert.rejects(() => publicAction(e.id, "", { action: "begin" }, "author"), /投票の終了後/);
    const voted = readExhibitions().exhibitions[0];
    assert.equal(participationState(voted, users[1], now + 59999).accepting, false);
    assert.equal(participationState(voted, users[1], now + 60000).accepting, true);
    assert.equal(participationState(voted, users[1], now + 180000).accepting, false);
    assert.equal(participationState(voted, users[2], now + 60000).accepting, false);
    await assert.rejects(() => voteExhibition("author", e.id, "absent", now + 60000), /期間外/);
    await updateExhibitionStore(store => {
      const e = store.exhibitions[0]; e.participation!.closesAt = iso(-500); e.opensAt = iso(-500);
    });
    await assert.rejects(() => publicAction(e.id, "", { action: "begin" }), (err: any) => err.status === 401);
    await assert.rejects(() => publicAction(e.id, "", { action: "begin" }, "other"), /参加投票/);
    const begun = await publicAction(e.id, "", { action: "begin" }, "author");
    assert.ok("token" in begun);
    const again = await publicAction(e.id, "", { action: "begin" }, "author");
    assert.equal(again.submission.id, begun.submission.id);
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } }).png().toBuffer(), assetId = crypto.randomUUID();
    await uploadExhibitionAsset(e.id, "", assetId, new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" }), "author");
    assert.equal(authorizeAsset(e.id, assetId, users[1], "").id, assetId);
    assert.equal(authorizeAsset(e.id, assetId, users[0], "").id, assetId);
    await assert.rejects(() => publicAction(e.id, begun.token, { action: "save", revision: begun.submission.revision, content: begun.submission.draft }, "other"));
    assert.throws(() => authorizeAsset(e.id, assetId, users[2], begun.token));
    // Once an eligible second user exists, a stolen token still cannot select another owner's draft.
    await updateExhibitionStore(store => { store.exhibitions[0].participation!.votes.other.value = "attending"; });
    assert.throws(() => ownSubmission(readExhibitions(), readExhibitions().exhibitions[0], "other", readExhibitions().submissions[0]), /自分の提出/);
    assert.throws(() => authorizeAsset(e.id, assetId, users[2], begun.token));
    writeData("users.json", users.map(u => u.id === "author" ? { ...u, approved: false } : u));
    await assert.rejects(() => publicAction(e.id, "", { action: "begin" }, "author"), /承認済み/);
    assert.throws(() => authorizeAsset(e.id, assetId, users[1], ""), /承認済み/);
    assert.equal(readExhibitions().assets.length, 1);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("legacy drafts require staff binding and archival preserves their data", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-binding-")); process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "既存写真展" })).exhibition;
    const draft = { name: "旧下書き", grade: "1年", authorName: "作者", portfolioUrl: "", fields: {}, sections: [], works: [] };
    const id = crypto.randomUUID();
    await updateExhibitionStore(store => { store.submissions.push({ id, exhibitionId: e.id, tokenHash: "", createdAt: e.createdAt, updatedAt: e.createdAt, revision: 1, schemaVersion: 1, draft, versions: [] }); });
    await assert.rejects(() => exhibitionAction("other", { action: "submission.bind" }), /運営以上/);
    const bound = (await exhibitionAction("staff", { action: "submission.bind", exhibitionId: e.id, revision: e.revision, submissionId: id, submissionRevision: 1, userId: "author" })).exhibition;
    assert.equal(readExhibitions().submissions[0].userId, "author");
    await exhibitionAction("staff", { action: "submission.bind", exhibitionId: e.id, revision: bound.revision, submissionId: id, submissionRevision: 2, archive: true });
    assert.deepEqual(readExhibitions().submissions[0].draft, draft);
    assert.equal(readExhibitions().submissions[0].inactive, true);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});
