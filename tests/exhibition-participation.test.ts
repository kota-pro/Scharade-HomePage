import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore, voteExhibition, authorizeAsset, uploadExhibitionAsset } from "../src/lib/exhibitions.ts";
import { participationState, ownSubmission, requireExhibitionInput } from "../src/lib/exhibitionParticipation.ts";
import { exhibitionCalendarEntries } from "../src/lib/exhibitionCalendar.ts";
import { drainExhibitionQueues } from "../src/lib/exhibitionIntegrations.ts";
import { writeData, readData } from "../src/lib/store.ts";
import type { User } from "../src/lib/auth.ts";

const users: User[] = ["staff", "author", "other", "uninvited"].map(id => ({ id, name: id, email: `${id}@example.invalid`, role: id === "staff" ? "staff" : "member", approved: true, createdAt: "2026-01-01", providers: {} }));

test("overlapping periods allow an attending voter to begin, upload, save and submit immediately while input deadlines warn without blocking submissions", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-overlap-"));
  process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "重なる受付期間" })).exhibition;
    const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString();
    const current = () => readExhibitions().exhibitions[0];
    await exhibitionAction("staff", { action: "settings", exhibitionId: e.id, revision: e.revision, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-60000), voteClosesAt: iso(7200000), opensAt: iso(-120000), closesAt: iso(3600000), recipientIds: ["author", "other"] });
    await exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current().revision });
    assert.equal(participationState(current(), users[1]).accepting, false);
    await drainExhibitionQueues("https://example.invalid");
    for (const vote of ["absent", "undecided"] as const) {
      await voteExhibition("author", e.id, vote);
      await assert.rejects(publicAction(e.id, "", { action: "begin" }, "author"), /参加投票/);
    }
    const result = await voteExhibition("author", e.id, "attending");
    assert.equal(result.canVote, true); assert.equal(result.accepting, true);
    assert.equal(result.message, "");
    assert.equal(participationState(current(), users[2]).accepting, false);
    assert.equal(participationState(current(), users[3]).accepting, false);
    const begun = await publicAction(e.id, "", { action: "begin" }, "author");
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } }).png().toBuffer(), assetId = crypto.randomUUID();
    await uploadExhibitionAsset(e.id, "", assetId, new File([new Uint8Array(bytes)], "overlap.png", { type: "image/png" }), "author");
    const sectionId = current().schemas[0].sections[0].id;
    const content = { ...begun.submission.draft, name: "作者", authorName: "作者", grade: "2年", sections: [{ sectionId, singles: 1, series: 0, books: 0, seriesPhotoCounts: [], fields: {} }], works: [{ id: crypto.randomUUID(), sectionId, kind: "single", title: "投票中の提出", caption: "", location: "", equipment: "", settings: "", fields: {}, photos: [{ assetId, x: 0, y: 0, width: 210, height: 297, rotation: 0 }] }] };
    const beforeGuard = structuredClone(readExhibitions());
    await assert.rejects(publicAction(e.id, "", { action: "save", ownerId: "other", submissionId: begun.submission.id, revision: begun.submission.revision, content }, "author"), (error: any) => error.status === 401);
    await assert.rejects(publicAction(e.id, "", { action: "save", ownerId: "author", submissionId: crypto.randomUUID(), revision: begun.submission.revision, content }, "author"), (error: any) => error.status === 409);
    await assert.rejects(uploadExhibitionAsset(e.id, "", crypto.randomUUID(), new File([new Uint8Array(bytes)], "wrong.png", {type:"image/png"}), "author", crypto.randomUUID()), (error: any) => error.status === 409);
    assert.deepEqual(readExhibitions(), beforeGuard);
    const saved = await publicAction(e.id, "", { action: "save", revision: begun.submission.revision, content }, "author");
    const submitted = await publicAction(e.id, "", { action: "submit", revision: saved.submission.revision, content }, "author");
    assert.equal(submitted.submission.versions.length, 1);
    const submission = structuredClone(readExhibitions().submissions[0]);
    await voteExhibition("author", e.id, "absent");
    await assert.rejects(publicAction(e.id, "", { action: "save", revision: submission.revision, content }, "author"), /参加投票/);
    assert.deepEqual(readExhibitions().submissions[0], submission);
    await voteExhibition("author", e.id, "attending");
    assert.equal((await publicAction(e.id, "", { action: "begin" }, "author")).submission.id, begun.submission.id);
    assert.equal(participationState(current(), users[1], now + 3599999).accepting, true);
    assert.equal(participationState(current(), users[1], now + 3600000).canVote, true);
    assert.equal(participationState(current(), users[1], now + 3600000).accepting, true);
    assert.equal(participationState(current(), users[1], now + 3600000).submissionOverdue, true);
    assert.doesNotThrow(() => requireExhibitionInput(current(), "author", now + 3600000));
    await updateExhibitionStore(store => { store.exhibitions[0].closesAt = iso(-1000); });
    assert.equal((await publicAction(e.id, "", { action: "save", revision: submission.revision, content }, "author")).exhibition.submissionOverdue,true);
    await uploadExhibitionAsset(e.id, "", crypto.randomUUID(), new File([new Uint8Array(bytes)], "late.png", { type: "image/png" }), "author");
    assert.equal(readExhibitions().assets.length, 2);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("staff can extend a scheduled voting deadline without resetting votes, submissions or notices; authorization and opening times remain validated", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-reopen-"));
  process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "投票の再開" })).exhibition;
    const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString();
    const current = () => readExhibitions().exhibitions[0];
    const settings = { action: "settings", exhibitionId: e.id, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), opensAt: iso(-60000), closesAt: iso(7200000) };
    await exhibitionAction("staff", { ...settings, revision: e.revision, recipientIds: ["author", "other"] });
    await exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current().revision });
    await drainExhibitionQueues("https://example.invalid");
    await voteExhibition("author", e.id, "attending");
    await voteExhibition("other", e.id, "undecided");
    const begun = await publicAction(e.id, "", { action: "begin" }, "author");
    await exhibitionAction("staff", { ...settings, revision: current().revision, voteClosesAt: iso(-1000) });
    const before = structuredClone(readExhibitions());
    const reopen = { ...settings, revision: current().revision };
    assert.equal(participationState(current(), users[1]).canVote, true);
    assert.equal(participationState(current(), users[1]).voteOverdue, true);
    await assert.rejects(exhibitionAction("author", reopen), /運営以上/);
    await assert.rejects(exhibitionAction("staff", { ...reopen, revision: reopen.revision - 1 }), /別の画面/);
    for (const patch of [{ voteClosesAt: settings.voteOpensAt }, { closesAt: settings.opensAt }, { voteOpensAt: "" }])
      await assert.rejects(exhibitionAction("staff", { ...reopen, ...patch }), /日時/);
    assert.deepEqual(readExhibitions(), before);
    const opened = (await exhibitionAction("staff", reopen)).exhibition;
    assert.equal(participationState(opened, users[1]).canVote, true);
    assert.equal(participationState(opened, users[1]).accepting, true);
    assert.deepEqual(opened.participation?.votes, before.exhibitions[0].participation?.votes);
    assert.deepEqual(opened.notices, before.exhibitions[0].notices);
    assert.equal(opened.participation?.noticeId, before.exhibitions[0].participation?.noticeId);
    assert.deepEqual(readExhibitions().submissions, before.submissions);
    assert.equal((await publicAction(e.id, "", { action: "begin" }, "author")).submission.id, begun.submission.id);
    const entries = exhibitionCalendarEntries([opened], "author");
    assert.equal(entries.find(entry => entry.kind === "exhibition-vote")?.endsAt, settings.voteClosesAt);
    assert.equal(entries.find(entry => entry.kind === "exhibition-form")?.startsAt, settings.opensAt);
    const vote = await voteExhibition("other", e.id, "attending");
    assert.equal(vote.accepting, true);
    assert.equal(participationState(current(), users[1], Date.parse(settings.voteClosesAt)).canVote, true);
    await updateExhibitionStore(store => { store.exhibitions[0].status = "closed"; });
    assert.equal(participationState(current(), users[1]).accepting, false);
    await assert.rejects(publicAction(e.id, "", { action: "begin" }, "author"), /入力期間外/);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});
test("notice is delivered before voting; participation and input/asset operations enforce the signed-in owner and opening times", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-participation-"));
  process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "秋季写真展" })).exhibition;
    const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString();
    const settings = { action: "settings", exhibitionId: e.id, revision: e.revision, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-1000), voteClosesAt: iso(60000), opensAt: iso(60000), closesAt: iso(180000), recipientIds: ["author", "other"] };
    await assert.rejects(() => exhibitionAction("author", settings), /運営以上/);
    let current = (await exhibitionAction("staff", settings)).exhibition;
    current = (await exhibitionAction("staff", { ...settings, revision: current.revision, voteClosesAt: iso(-2000) })).exhibition;
    await assert.rejects(() => exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current.revision, body: "参加投票" }), /参加投票/);
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
    await assert.rejects(() => publicAction(e.id, "", { action: "begin" }, "author"), /入力期間外/);
    const voted = readExhibitions().exhibitions[0];
    assert.equal(participationState(voted, users[1], now + 59999).accepting, false);
    assert.equal(participationState(voted, users[1], now + 60000).accepting, true);
    assert.equal(participationState(voted, users[1], now + 180000).accepting, true);
    assert.equal(participationState(voted, users[2], now + 60000).accepting, false);
    assert.equal((await voteExhibition("author", e.id, "attending", now + 60000)).voteOverdue,true);
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

test("extending published voting can invite new recipients once without changing existing votes or submissions", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-invite-"));
  process.env.DATA_DIR = dir;
  try {
    writeData("users.json", users);
    const e = (await exhibitionAction("staff", { action: "create", title: "通知先の追加" })).exhibition;
    const now = Date.now(), iso = (delta: number) => new Date(now + delta).toISOString();
    const current = () => readExhibitions().exhibitions[0];
    const settings = { action: "settings", exhibitionId: e.id, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), opensAt: iso(-60000), closesAt: iso(7200000) };
    const save = (patch = {}) => exhibitionAction("staff", { ...settings, revision: current().revision, ...patch });
    await save({ recipientIds: ["author"] });
    await exhibitionAction("staff", { action: "participation.publish", exhibitionId: e.id, revision: current().revision });
    const publishing = structuredClone(readExhibitions());
    await assert.rejects(save({ recipientIds: ["author", "other"] }), /送信完了後/);
    assert.deepEqual(readExhibitions(), publishing);
    await drainExhibitionQueues("https://example.invalid");
    await voteExhibition("author", e.id, "attending");
    await publicAction(e.id, "", { action: "begin" }, "author");
    await save({ voteClosesAt: iso(-1000) });
    const before = structuredClone(readExhibitions());
    const add = { ...settings, revision: current().revision, recipientIds: ["author", "other", "other"] };
    await assert.rejects(exhibitionAction("author", add), /運営以上/);
    await assert.rejects(exhibitionAction("staff", { ...add, revision: add.revision - 1 }), /別の画面/);
    await assert.rejects(save({ recipientIds: ["other"] }), /解除できません/);
    await assert.rejects(save({ recipientIds: ["author", "missing"] }), /通知先/);
    writeData("users.json", users.map(u => u.id === "other" ? { ...u, approved: false } : u));
    await assert.rejects(save({ recipientIds: ["author", "other"] }), /通知先/);
    writeData("users.json", users);
    await assert.rejects(save({ voteClosesAt: iso(-1000), recipientIds: ["author", "other"] }), /未来/);
    await assert.rejects(save({ closesAt: "", recipientIds: ["author", "other"] }), /日時/);
    assert.deepEqual(readExhibitions(), before);
    await exhibitionAction("staff", add);
    assert.deepEqual(current().participation?.recipientIds, ["author", "other"]);
    assert.deepEqual(current().participation?.votes, before.exhibitions[0].participation?.votes);
    assert.equal(current().participation?.noticeId, before.exhibitions[0].participation?.noticeId);
    assert.equal(current().participation?.state, "published");
    assert.deepEqual(readExhibitions().submissions, before.submissions);
    assert.equal(current().notices!.length, before.exhibitions[0].notices!.length + 1);
    assert.deepEqual(current().notices!.at(-1)!.recipientIds, ["other"]);
    assert.equal(participationState(current(), users[2]).vote, "unanswered");
    await assert.rejects(publicAction(e.id, "", { action: "begin" }, "other"), /参加投票/);
    await save({ recipientIds: ["other", "author"] });
    assert.equal(current().notices!.length, before.exhibitions[0].notices!.length + 1);
    await assert.rejects(exhibitionAction("staff", add), /別の画面/);
    await drainExhibitionQueues("https://example.invalid");
    const notifications = readData<any>("member-activities.json", {}).notifications.filter((n: any) => n.exhibitionId === e.id);
    assert.deepEqual(notifications.map((n: any) => n.recipientIds), [["author"], ["other"]]);
    await voteExhibition("other", e.id, "attending");
    assert.equal((await publicAction(e.id, "", { action: "begin" }, "other")).submission.draft.name, "other");
    // Previously invited accounts may be unapproved later; retaining them must not prevent inviting another approved member.
    writeData("users.json", users.map(u => u.id === "author" ? { ...u, approved: false } : u));
    await save({ recipientIds: ["author", "other", "uninvited"] });
    assert.deepEqual(current().participation?.recipientIds, ["author", "other", "uninvited"]);
    assert.deepEqual(current().notices!.at(-1)!.recipientIds, ["uninvited"]);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("owners can preview unsaved title cards across sections without uploads or writes, including after input closes", async () => {
  const {previewOwnTitleBoard}=await import('../src/lib/exhibitionTitleBoardPreview.ts');
  const previous=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-own-preview-'));
  process.env.DATA_DIR=dir;
  try {
    writeData('users.json',users.map(u=>u.id==='author'?{...u,portfolioId:'author-portfolio'}:u));
    let e=(await exhibitionAction('staff',{action:'create',title:'自分のプレビュー'})).exhibition;
    const sectionId=e.schemas[0].sections[0].id,specialId=crypto.randomUUID();
    e=(await exhibitionAction('staff',{action:'schema',exhibitionId:e.id,revision:e.revision,schema:{...e.schemas[0],sections:[...e.schemas[0].sections,{id:specialId,title:'企画展示',description:''}],fields:[{id:crypto.randomUUID(),scope:'common',label:'追加の必須質問',description:'',type:'number',required:true,options:[]}]}})).exhibition;
    const now=Date.now(),iso=(delta:number)=>new Date(now+delta).toISOString(),current=()=>readExhibitions().exhibitions[0];
    const settings={action:'settings',exhibitionId:e.id,title:e.title,status:'open',gallery:'staff',voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),opensAt:iso(-60000),closesAt:iso(3600000)};
    await exhibitionAction('staff',{...settings,revision:current().revision,recipientIds:['author','other']});
    await exhibitionAction('staff',{action:'participation.publish',exhibitionId:e.id,revision:current().revision});
    await drainExhibitionQueues('https://example.invalid');await voteExhibition('author',e.id,'attending');
    const begun=await publicAction(e.id,'',{action:'begin'},'author');assert.ok('token' in begun);
    const draft={name:'作者',authorName:'作者',grade:'2年',portfolioUrl:'https://instagram.com/author',portfolioId:'someone-else',work:{id:crypto.randomUUID(),sectionId,kind:'series',title:'未保存の作品',caption:'あ'.repeat(155)+'i',details:{place:'新宿',prefecture:'東京都',camera:'Z f',lens:'50mm'},photos:[{assetId:'unavailable',width:0}],fields:{}}};
    const before=fs.readFileSync(path.join(dir,'exhibitions.json')),files=fs.readdirSync(dir).sort();
    const preview=await previewOwnTitleBoard(e.id,'',draft,'author','https://scharade.jp');
    assert.equal(preview.ok,true);assert.deepEqual(preview.issues,[]);assert.equal(preview.fontSize,8);assert.equal(preview.sectionTitle,'通常展示');
    assert.equal(preview.qrUrl,'https://instagram.com/author');
    assert.equal((await sharp(Buffer.from(preview.image.split(',')[1],'base64')).metadata()).width,840);
    const special=await previewOwnTitleBoard(e.id,'',{...draft,work:{...draft.work,sectionId:specialId,title:'企画の作品',caption:'短い説明'}},'author','https://scharade.jp');
    assert.equal(special.sectionTitle,'企画展示');assert.equal(special.fontSize,10);assert.notEqual(special.image,preview.image);
    const blank=await previewOwnTitleBoard(e.id,'',{...draft,work:{...draft.work,title:''}},'author','https://scharade.jp');assert.ok(blank.issues.includes('作品タイトルを入力してください。'));
    const invalid=await previewOwnTitleBoard(e.id,'',{...draft,work:{...draft.work,caption:'あ'.repeat(156)}},'author','https://scharade.jp');assert.ok(invalid.issues.some(i=>/枠.*収まりません/.test(i)));
    // Identity fields still enforce the current limit; corrected form values must not retain stale preview warnings.
    await assert.rejects(previewOwnTitleBoard(e.id,'',{...draft,name:'あ'.repeat(151)},'author','https://scharade.jp'),(error:any)=>error.status===400&&/名前/.test(error.message));
    const corrected=await previewOwnTitleBoard(e.id,'',draft,'author','https://scharade.jp');assert.deepEqual(corrected.issues,[]);
    for(const [actor,token,status] of [[undefined,'',401],['other','',403],['uninvited','',403]] as const)
      await assert.rejects(previewOwnTitleBoard(e.id,token,draft,actor,'https://scharade.jp'),(error:any)=>error.status===status);
    await assert.rejects(previewOwnTitleBoard(e.id,'invalid',draft,'author','https://scharade.jp'),/本人用/);
    await assert.rejects(previewOwnTitleBoard(e.id,'',{...draft,work:{...draft.work,sectionId:crypto.randomUUID()}},'author','https://scharade.jp'),/参加セクション/);
    await assert.rejects(previewOwnTitleBoard(e.id,'',{...draft,portfolioUrl:'javascript:alert(1)'},'author','https://scharade.jp'),/HTTPS/);
    assert.deepEqual(fs.readFileSync(path.join(dir,'exhibitions.json')),before);assert.deepEqual(fs.readdirSync(dir).sort(),files);
    await voteExhibition('other',e.id,'attending');
    await assert.rejects(previewOwnTitleBoard(e.id,'',draft,'other','https://scharade.jp'),/先に出展/);
    await publicAction(e.id,'',{action:'begin'},'other');
    await assert.rejects(previewOwnTitleBoard(e.id,begun.token!,draft,'other','https://scharade.jp'),/自分の提出/);
    await exhibitionAction('staff',{...settings,revision:current().revision,closesAt:iso(-1000)});
    const closed=fs.readFileSync(path.join(dir,'exhibitions.json'));
    assert.equal((await previewOwnTitleBoard(e.id,'',draft,'author','https://scharade.jp')).ok,true);
    assert.deepEqual(fs.readFileSync(path.join(dir,'exhibitions.json')),closed);
  } finally {if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
