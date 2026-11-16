import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { siteHarness } from "./helpers/accounting-site-harness.ts";
import { harness } from "./helpers/accounting-harness.ts";
import { signedEnvelope } from "../src/lib/signedEnvelope.ts";

const snapshot = (revision = 1) => ({ revision, fingerprint: String(revision).repeat(64), title: "Adminで適用済みの名簿", source: "source", fetchedAt: "2026-11-01T00:00:00.000Z", records: [{ key: "person-a", name: "会員A", university: "大学", lineName: "A", active: true, uncertain: false, siteUserIds: ["member"] }] });
const transaction = { action: "transaction", type: "income", date: "2026-09-01", description: "会費", amount: 1000, account: "bank", from: "", to: "", memberId: "", advanceId: "", notes: "" };
test("website gateway rejects wrong secrets, replays and untrusted roles", () => {
  const h = siteHarness(), initial = JSON.stringify(h.sheets);
  const bad = signedEnvelope({ action: "bootstrap", actor: h.actor }, "x".repeat(40));
  assert.equal(h.ctx.doPost({ postData: { contents: JSON.stringify(bad) } }).code, "UNAUTHORIZED");
  assert.equal(h.send({ action: "bootstrap", actor: { ...h.actor, role: "staff" } }).code, "UNAUTHORIZED");
  const good = signedEnvelope({ action: "health" }, h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET);
  assert.equal(h.ctx.doPost({ postData: { contents: JSON.stringify(good) } }).ok, true);
  assert.equal(h.ctx.doPost({ postData: { contents: JSON.stringify(good) } }).code, "REPLAY");
  assert.equal(JSON.stringify(h.sheets), initial);
});
test("shared roster automatically matches a unique person while preserving financial IDs and balances", () => {
  const h = siteHarness(), original = JSON.stringify(h.roster.rows);
  h.ctx.addPerson_({ token: crypto.randomUUID(), name: "会員A", university: "大学", lineName: "A" }, "previous@example.invalid");
  const existing = h.ctx.jsonRows_("人物対応")[0];
  h.ctx.registerTransaction_({ ...transaction, token: crypto.randomUUID(), type: "advance", memberId: existing.id }, "previous@example.invalid");
  const before = h.read().summary;
  assert.equal(h.send({ action: "roster.sync", snapshot: snapshot() }).ok, true);
  assert.equal(h.read().rosterPending.length, 0);
  assert.equal(h.read().members.length, 1);
  assert.equal(h.ctx.jsonRows_("人物対応")[0].rosterMatch.method, "name-line");
  assert.equal(h.read().members[0].id, existing.id);
  assert.equal(h.read().members[0].rosterKey, "person-a");
  assert.deepEqual(h.read().summary, before);
  const next = snapshot(2); next.records[0].active = false; next.records[0].siteUserIds = [];
  assert.equal(h.send({ action: "roster.sync", snapshot: next }).ok, true);
  assert.equal(h.read().members[0].active, false);
  assert.equal(h.read().summary.outstanding, 1000);
  assert.equal(h.read().members[0].siteUserIds.length, 0);
  assert.equal(h.act({ ...transaction, type: 'advance', memberId: existing.id, rosterFingerprint: next.fingerprint }).code, 'INVALID');
  assert.equal(h.act({ ...transaction, type: 'refund', memberId: existing.id, advanceId: h.read().summary.advances[0].id, amount: 500 }).ok, true);
  assert.equal(h.read().summary.outstanding, 500);
  assert.equal(h.send({ action: "roster.sync", snapshot: snapshot() }).code, "CONFLICT");
  assert.throws(() => h.ctx.syncRoster_(), /Admin/);
  assert.equal(h.ctx.accountingAction({ action: "syncRoster" }).ok, false);
  h.ctx.scheduledRosterRefresh();
  assert.equal(JSON.stringify(h.roster.rows), original);
});
test('automatic person matching handles normalization, namesakes, ambiguity and conflicting evidence in either row order', () => {
  const h=siteHarness();
  const person=(id: string, values: object={})=>({id,name:'山田太郎',lineName:'Taro',university:'大学A',legacySiteUserIds:[],...values});
  const row=(key: string, values: object={})=>({key,name:'山田太郎',lineName:'Taro',university:'大学A',siteUserIds:[],uncertain:false,active:true,...values});
  const cases=[
    {label:'width and spaces',members:[person('p1',{name:'山田　太郎',lineName:'Ｔａｒｏ',university:'大学Ａ'})],records:[row('a',{name:'山田 太郎',lineName:'taro'})],expected:{a:'p1'}},
    {label:'unique name with changed LINE and missing university',members:[person('p1',{university:'',lineName:'previous'})],records:[row('a')],expected:{a:'p1'}},
    {label:'namesakes separated by LINE',members:[person('p1'),person('p2',{lineName:'Other'})],records:[row('a'),row('b',{lineName:'Other'})],expected:{a:'p1',b:'p2'}},
    {label:'namesakes separated by university',members:[person('p1',{lineName:''}),person('p2',{lineName:'',university:'大学B'})],records:[row('a',{lineName:''}),row('b',{lineName:'',university:'大学B'})],expected:{a:'p1',b:'p2'}},
    {label:'duplicate accounting people remain pending',members:[person('p1'),person('p2')],records:[row('a')],expected:{}},
    {label:'duplicate roster people cannot claim one accounting person',members:[person('p1')],records:[row('a'),row('b')],expected:{}},
    {label:'stronger evidence wins without assigning the same person twice',members:[person('p1')],records:[row('a'),row('b',{lineName:'Changed'})],expected:{a:'p1'}},
    {label:'uncertain records cannot be used to disambiguate another person',members:[person('p1')],records:[row('a'),row('b',{uncertain:true})],expected:{}},
    {label:'university conflict',members:[person('p1',{university:'大学B'})],records:[row('a')],expected:{}},
    {label:'name and unique LINE point to different people',members:[person('p1',{lineName:'first'}),person('p2',{name:'鈴木花子'})],records:[row('a')],expected:{}},
    {label:'LINE alone does not merge different names or create a duplicate',members:[person('p1',{name:'鈴木花子'})],records:[row('a')],expected:{}},
    {label:'Admin uncertainty remains pending',members:[person('p1')],records:[row('a',{uncertain:true})],expected:{}},
    {label:'existing confirmed relationship stays fixed despite changed names',members:[person('p1',{rosterKey:'a',name:'旧氏名'}),person('p2')],records:[row('a')],expected:{a:'p1'}},
    {label:'confirmed site account wins over textual claims',members:[person('p1',{legacySiteUserIds:['user']})],records:[row('a',{name:'変更後の氏名',siteUserIds:['user']}),row('b')],expected:{a:'p1'}},
    {label:'already bound person is not reused for a new row',members:[person('p1',{rosterKey:'old'})],records:[row('a')],expected:{}},
  ];
  for(const value of cases){
    for(const reverse of [false,true]){
      const matched=h.ctx.ac_rosterMatches_(reverse?[...value.records].reverse():value.records,reverse?[...value.members].reverse():value.members);
      assert.deepEqual(Object.fromEntries(Object.entries(matched).map(([key,match]:[string,any])=>[key,match.person.id])),value.expected,value.label);
    }
  }
});
test('matching upgrade reuses an already applied roster without changing its revision, financial records or original roster', () => {
  const h=siteHarness(), applied=snapshot(), original=JSON.stringify(h.roster.rows);
  h.ctx.addPerson_({token:crypto.randomUUID(),name:'会員A',university:'大学',lineName:'A'},'previous@example.invalid');
  const id=h.read().members[0].id;
  h.ctx.registerTransaction_({...transaction,token:crypto.randomUUID(),type:'advance',memberId:id},'previous@example.invalid');
  h.ctx.writeJsonRows_('共通名簿記録',applied.records);
  h.ctx.writeJsonRows_('名簿確認',[{shared:true,record:applied.records[0],reason:'以前の手動確認'}]);
  h.props.ACCOUNTING_ROSTER_META=JSON.stringify({...applied,records:undefined,syncedAt:'previous'});
  const finance=JSON.stringify(h.ctx.jsonRows_('取引記録'));
  const write=h.ctx.writeJsonRows_;let interrupted=false;
  h.ctx.writeJsonRows_=function(name: string, rows: unknown[]){write(name,rows);if(name==='人物対応'&&!interrupted){interrupted=true;throw new Error('interrupted after matching');}};
  assert.equal(h.send({action:'roster.sync',snapshot:applied}).code,'RETRY');
  assert.equal(h.send({action:'roster.sync',snapshot:applied}).ok,true);
  assert.equal(h.read().rosterPending.length,0);
  assert.equal(h.read().members[0].id,id);
  assert.equal(h.read().sharedRoster.revision,applied.revision);
  assert.equal(h.read().sharedRoster.matchingVersion,2);
  const matched=JSON.stringify(h.ctx.jsonRows_('人物対応')),meta=h.props.ACCOUNTING_ROSTER_META;
  assert.equal(h.send({action:'roster.sync',snapshot:applied}).ok,true);
  assert.equal(JSON.stringify(h.ctx.jsonRows_('人物対応')),matched);
  assert.equal(h.props.ACCOUNTING_ROSTER_META,meta);
  assert.equal(h.send({action:'roster.sync',snapshot:{...applied,fingerprint:'f'.repeat(64)}}).code,'CONFLICT');
  assert.equal(JSON.stringify(h.ctx.jsonRows_('取引記録')),finance);
  assert.equal(JSON.stringify(h.roster.rows),original);
  assert.equal(h.read().summary.outstanding,1000);
});
test('interrupted cancellation restores the request status on replay', () => {
  const h=siteHarness(); h.send({action:'roster.sync',snapshot:snapshot()});
  const id='ADV-'+'c'.repeat(32), person=h.read().members[0];
  h.sheets['立替申請'].rows.push([id,'2026-09-01','member','会員A','','','','','2026-09-01','備品',300,'','','未承認']);
  assert.equal(h.act({action:'review',requestId:id,decision:'approve',memberId:person.id,note:'',rosterFingerprint:snapshot().fingerprint}).ok,true);
  const original=h.ctx.writeJsonRows_; let failed=false;
  h.ctx.writeJsonRows_=function(name: string, rows: unknown[]){original(name, rows);if(name==='取引記録'&&!failed){failed=true;throw new Error('interrupted after cancellation');}};
  assert.equal(h.act({action:'cancel',id:'REQ-'+id,reason:'訂正'}).code,'RETRY');
  assert.equal(h.read().requests[0].status,'承認済み');
  assert.equal(h.act({action:'recover'}).ok,true);
  assert.equal(h.read().requests[0].status,'取消済み');
  assert.equal(h.read().summary.outstanding,0);
});
test("same operation retries once, stale updates conflict and input changes cannot reuse an ID", () => {
  const h = siteHarness(), id = crypto.randomUUID(), revision = h.read().revision;
  const input = { ...transaction, operationId: id, expectedRevision: revision, actor: h.actor, rosterFingerprint: "old" };
  assert.equal(h.send(input).ok, true);
  assert.equal(h.send({ ...input, actor: { ...h.actor, name: "変更後の名前" }, rosterFingerprint: "new" }).ok, true);
  assert.equal(h.ctx.jsonRows_("取引記録").length, 1);
  assert.equal(h.read().summary.bank, 11000);
  assert.equal(h.send({ ...input, amount: 1500 }).code, "CONFLICT");
  assert.equal(h.send({ ...input, operationId: crypto.randomUUID() }).code, "CONFLICT");
  assert.equal(h.read().history[0].actor, "サイト会員：会計確認 [executive]");
  assert.equal(h.act({ ...transaction, amount: -1 }).code, "INVALID");
  assert.equal(h.read().pendingOperations.length, 0);
});
test("interrupted record save is journaled and recovered without a duplicate or silent rollback", () => {
  const h = siteHarness(), append = h.sheets['取引記録'].appendRow.bind(h.sheets['取引記録']);
  let interrupted = false;
  h.sheets['取引記録'].appendRow = row => { append(row); if (!interrupted) { interrupted = true; throw new Error('lost response'); } };
  const input = { ...transaction, operationId: crypto.randomUUID(), expectedRevision: h.read().revision, actor: h.actor };
  assert.equal(h.send(input).code, 'RETRY');
  assert.equal(h.read().pendingOperations.length, 1);
  assert.equal(h.act({ ...transaction, amount: 300 }).code, 'PENDING');
  assert.equal(h.send({ action: 'roster.sync', snapshot: snapshot() }).code, 'PENDING');
  assert.equal(h.act({ action: 'recover' }).ok, true);
  assert.equal(h.send(input).ok, true);
  assert.equal(h.read().summary.bank, 11000);
  assert.equal(h.ctx.jsonRows_('取引記録').length, 1);
  assert.equal(h.read().pendingOperations.length, 0);
});
test("approval and partial refund use the shared person, preserve bank fields and enforce limits", () => {
  const h = siteHarness();h.send({ action: 'roster.sync', snapshot: snapshot() });
  const person = h.read().members[0], id = 'ADV-' + 'a'.repeat(32);
  h.sheets['立替申請'].rows.push([id, '2026-09-01', 'member', '会員A', 'a@example.invalid', '会員A', '', '', '2026-09-01', '備品', 1000, '', '', '未承認', '', '', '', '', '', '', '', '口座振込', '', '銀行', 'カイイン', '本店', '001', '0012345']);
  assert.equal(h.act({ action: 'review', requestId: id, decision: 'approve', memberId: person.id, note: '', rosterFingerprint: 'wrong' }).code, 'ROSTER_PENDING');
  assert.equal(h.act({ action: 'review', requestId: id, decision: 'approve', memberId: person.id, note: '', rosterFingerprint: snapshot().fingerprint }).ok, true);
  const advance = h.read().summary.advances[0];
  assert.equal(h.read().requests[0].bankAccountNumber, '0012345');
  assert.equal(h.act({ ...transaction, type: 'refund', memberId: person.id, advanceId: advance.id, amount: 400 }).ok, true);
  assert.equal(h.read().summary.outstanding, 600);
  assert.equal(h.read().summary.expense, 1000);
  assert.equal(h.act({ ...transaction, type: 'refund', memberId: person.id, advanceId: advance.id, amount: 601 }).code, 'INVALID');
  assert.equal(h.act({ action: 'cancel', id: advance.id, reason: '訂正' }).code, 'INVALID');
  assert.equal(h.act({ action: 'check', date: '2026-09-01', account: 'bank', actual: 9601 }).ok, true);
  assert.equal(h.read().checks[0].difference, 1);
  assert.equal(h.act({ action: 'settings', startDate: '2026-10-01', bankOpening: 0, cashOpening: 0, fiscalYear: 2026, note: '' }).code, 'INVALID');
});
test("receipt reading requires a separate admin signature and a verified request-owned private file", () => {
  const h = harness(true);vm.runInContext(fs.readFileSync('gas/intake/AccountingReceipts.gs', 'utf8'), h.ctx);
  h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET = 'y'.repeat(40);h.props.RECEIPT_FOLDER_ID = 'receipts-folder';
  const id = 'ADV-' + 'f'.repeat(32), bytes = Buffer.from('%PDF-1.4\n%%EOF');
  h.sheets['立替申請'].rows.push([id, ...Array(11).fill(''), 'https://drive.google.com/file/d/receiptFile123456/view']);
  let read = 0;const meta = { name: 'receipt.pdf', mimeType: 'application/pdf', size: bytes.length, parents: ['receipts-folder'], appProperties: { receiptId: 'REC-' + 'b'.repeat(32), sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
  h.ctx.Drive = { Files: { get: () => meta } };
  h.ctx.ScriptApp = { getOAuthToken: () => 'synthetic-token' };
  h.ctx.Utilities.base64Encode = (b: number[]) => Buffer.from(b).toString('base64');
  h.ctx.UrlFetchApp = { fetch: () => { read++; return { getResponseCode: () => 200, getContent: () => [...bytes] }; } };
  const input = { action: 'receipt.read', requestId: id, actor: { id: 'e', role: 'executive' } };
  const send = (p: object, secret: string) => h.ctx.doPost({ postData: { contents: JSON.stringify(signedEnvelope(p, secret)) } });
  assert.equal(send(input, h.props.WEBHOOK_SECRET).code, 'UNAUTHORIZED');assert.equal(read, 0);
  assert.equal(send(input, h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET).data, bytes.toString('base64'));
  meta.parents = ['unrelated'];assert.equal(send(input, h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET).code, 'NOT_FOUND');assert.equal(read, 1);
  assert.equal(send({ ...input, actor: { id: 's', role: 'staff' } }, h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET).code, 'UNAUTHORIZED');
});
