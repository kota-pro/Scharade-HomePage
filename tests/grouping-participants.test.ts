import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { guestExpiry, activeGuests, previewGroupingParticipants } from "../src/lib/groupingParticipants.ts";

test("expiry is three calendar months in Japan, with end-of-month clamping", () => {
  assert.equal(guestExpiry("2026-11-30T15:30:00.000Z"), "2027-02-28T15:30:00.000Z"); // Dec 1 -> Mar 1 JST
  assert.equal(guestExpiry("2026-11-30T00:00:00.000Z"), "2027-02-28T00:00:00.000Z");
  assert.equal(guestExpiry("2027-11-30T00:00:00.000Z"), "2028-02-29T00:00:00.000Z");
  assert.equal(activeGuests([{ expiresAt: "2027-01-01T00:00:00Z" } as any], Date.parse("2027-01-01T00:00:00Z")).length, 0);
});
function gas() {
  const sourceId = "example-participant-spreadsheet-2026";
  const records = [
    ["タイムスタンプ", "名前", "性別", "大学名", "学部名", "学年", "LINEのQRコード", "LINE上でのお名前"],
    ["2026/04/01", "架空 一郎", "男性", "私的大学", "私的学部", "大学３年生", "private-qr", "ichiro"],
    ["2026/04/02", "架空 花子", "女性", "私的大学", "私的学部", "大学１年生", "private-qr2", "hana"],
    ["", "", "", "", "", "", "", ""],
  ];
  const reads: number[] = [];
  const sheet = { getSheetId: () => 123, getName: () => "フォームの回答 1", getLastRow: () => records.length, getLastColumn: () => records[0].length,
    getRange: (row:number,col:number,n:number,width:number) => {
      if (row > 1) { assert.ok(![4,5,7].includes(col)); reads.push(col); }
      return { getDisplayValues: () => records.slice(row-1,row-1+n).map(r => r.slice(col-1,col-1+width)) };
    } };
  const ctx: any = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => "accounting-spreadsheet-2026" }) }, SpreadsheetApp: { openById: (id: string) => { assert.equal(id, sourceId); return { getName: () => "撮影会回答", getSheets: () => [sheet] }; } } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync("gas/intake/Code.gs","utf8"),ctx);
  return { ctx, sourceId, reads, records };
}
test("GAS imports form columns read-only without membership questions, QR or university data", () => {
  const {ctx, sourceId, reads, records} = gas(), before = structuredClone(records);
  const result = JSON.parse(JSON.stringify(ctx.groupingParticipants_({ spreadsheetId: sourceId, sheetId: 123 })));
  assert.equal(result.ok,true); assert.deepEqual(result.columns, { name:1,grade:5,gender:2,lineName:7 });
  assert.equal(result.rows.length,2); assert.equal(result.rows[0].lineName,"ichiro");
  assert.deepEqual(reads,[2,6,3,8]); assert.deepEqual(records,before);
  assert.equal(ctx.groupingParticipants_({spreadsheetId:"accounting-spreadsheet-2026",sheetId:123}).ok,false);
  assert.equal(ctx.groupingParticipants_({spreadsheetId:sourceId,sheetId:999}).ok,false);
  assert.equal(ctx.groupingParticipants_({spreadsheetId:sourceId,sheetId:123,columns:{name:99,grade:5,gender:2,lineName:7}}).ok,false);
});
test("preview normalizes Japanese attributes, accepts mapping and rejects malformed or failed imports", async () => {
  const {ctx,sourceId} = gas(); const fetchBefore = globalThis.fetch;
  const old = { url: process.env.ACCOUNTING_GAS_URL, secret: process.env.ACCOUNTING_WEBHOOK_SECRET };
  process.env.ACCOUNTING_GAS_URL = "https://script.google.com/macros/s/fixture/exec";
  process.env.ACCOUNTING_WEBHOOK_SECRET = "fixture-secret-with-32-characters-long";
  try {
    globalThis.fetch = (async (_url, options) => { const envelope = JSON.parse(String(options?.body)); return Response.json(ctx.groupingParticipants_(JSON.parse(envelope.payload))); }) as typeof fetch;
    const result = await previewGroupingParticipants(`https://docs.google.com/spreadsheets/d/${sourceId}/edit#gid=123`);
    assert.equal(result.rows[0].gender,"male"); assert.equal(result.rows[0].grade,"3");
    assert.equal(result.rows[1].gender,"female"); assert.equal(result.rows[1].grade,"1");
    assert.equal(JSON.stringify(result.rows).includes("private-qr"),false);
    await assert.rejects(previewGroupingParticipants("https://evil.invalid/"));
    await assert.rejects(previewGroupingParticipants(`https://docs.google.com/spreadsheets/d/${sourceId}/edit#gid=123`,{name:999}));
    globalThis.fetch = (async () => Response.json({ok:false,code:"RETRY"})) as typeof fetch;
    await assert.rejects(previewGroupingParticipants(`https://docs.google.com/spreadsheets/d/${sourceId}/edit#gid=123`), /閲覧権限/);
  } finally { globalThis.fetch = fetchBefore; for (const [k,v] of [["ACCOUNTING_GAS_URL",old.url],["ACCOUNTING_WEBHOOK_SECRET",old.secret]]) { if (v === undefined) delete process.env[k!]; else process.env[k!] = v; } }
});
