import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../gas/accounting/Core.gs", import.meta.url), "utf8"), context);
const core = context.Accounting;
const settings = { startDate: "2025-11-01", bankOpening: 100000, cashOpening: 10000 };
const event = (id:string, date:string, type:string, amount:number, extra:Record<string, unknown>={}) => ({id,date,type,amount,description:id,createdAt:`2026-09-01T00:00:0${id.length}.000Z`,...extra});

test("advance expense is booked once and partial refunds affect the correct months", () => {
  const events=[event("advance","2026-04-01","advance",3000,{memberId:"p1"}),event("r1","2026-05-01","refund",1000,{memberId:"p1",advanceId:"advance",account:"bank"}),event("r2","2026-06-01","refund",2000,{memberId:"p1",advanceId:"advance",account:"cash"})];
  const rows=core.months(settings,events,2025,"2026-10-01");
  assert.equal(rows[5].expense,3000); assert.equal(rows[5].outstanding,3000);
  assert.equal(rows[6].expense,0); assert.equal(rows[6].bank,99000); assert.equal(rows[6].outstanding,2000);
  assert.equal(rows[7].expense,0); assert.equal(rows[7].cash,8000); assert.equal(rows[7].outstanding,0);
});
test("income, expense and transfers reconcile both accounts without counting a transfer as income", () => {
  const events=[event("1","2026-03-01","income",5000,{account:"cash"}),event("2","2026-03-02","transfer",20000,{from:"bank",to:"cash"}),event("3","2026-03-03","expense",3000,{account:"cash"})];
  const b=core.build(settings,events);assert.equal(b.bank,80000);assert.equal(b.cash,32000);assert.equal(b.income,5000);assert.equal(b.expense,3000);
  assert.equal(core.reconcile(settings,events,[{account:"cash",date:"2026-03-03",actual:31900}])[0].difference,-100);
});
test("overpayments, wrong people, refunds before advances and cancellation of repaid advances are rejected", () => {
  const a=event("a","2026-04-02","advance",3000,{memberId:"p1"});
  for(const r of [event("r","2026-04-03","refund",3001,{memberId:"p1",advanceId:"a",account:"bank"}),event("r","2026-04-03","refund",1,{memberId:"p2",advanceId:"a",account:"bank"}),event("r","2026-04-01","refund",1,{memberId:"p1",advanceId:"a",account:"bank"})]) assert.throws(()=>core.build(settings,[a,r]));
  assert.throws(()=>core.build(settings,[{...a,canceledAt:"now"},event("r","2026-04-03","refund",1,{memberId:"p1",advanceId:"a",account:"bank"})]));
});
test("opening liabilities do not create a current expense and survive the fiscal boundary", () => {
  const events=[event("a","2025-11-01","openingAdvance",5000,{memberId:"p1"}),event("r","2026-11-01","refund",2000,{memberId:"p1",advanceId:"a",account:"bank"})];
  assert.equal(core.build(settings,events).expense,0);
  assert.equal(core.months(settings,events,2026,"2026-11-02")[0].outstanding,3000);
  assert.equal(core.fiscalYear("2026-10-31"),2025);assert.equal(core.fiscalYear("2026-11-01"),2026);
});
test("zero actual balances differ from missing input, and backdated transactions change reconciliation", () => {
  const s={...settings,bankOpening:0};
  assert.equal(core.reconcile(s,[],[{date:"2026-05-01",account:"bank",actual:0}])[0].difference,0);
  assert.throws(()=>core.reconcile(s,[],[{date:"2026-05-01",account:"bank",actual:""}]));
  assert.equal(core.reconcile(s,[event("1","2026-04-30","income",100,{account:"bank"})],[{date:"2026-05-01",account:"bank",actual:0}])[0].difference,-100);
  assert.throws(()=>core.build({...settings,bankOpening:""},[]));
});
test("roster periods select the correct half, reject overlaps and never reuse an expired source", () => {
  const periods=[{start:"2025-11-01",end:"2026-04-30",spreadsheetId:"a",sheetId:1},{start:"2026-05-01",end:"2026-10-31",spreadsheetId:"b",sheetId:2}];
  assert.equal(core.activePeriod(periods,"2026-04-30").spreadsheetId,"a");assert.equal(core.activePeriod(periods,"2026-05-01").spreadsheetId,"b");
  assert.throws(()=>core.activePeriod(periods,"2026-11-01"));assert.throws(()=>core.periods([...periods,{...periods[0],end:"2026-05-01"}]));
});
