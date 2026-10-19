import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { validateAdvance, enqueueAdvance, deliverAdvance, drainAdvanceQueue } from "../src/lib/advanceRequests.ts";
import type { User } from "../src/lib/auth.ts";
const user:User={id:"test-member",name:"テスト",email:"test@example.invalid",approved:true,createdAt:"2026-01-01",providers:{}};
const input=()=>({idempotencyKey:crypto.randomUUID(),expenseDate:"2026-04-01",item:"備品",amount:3000,rosterName:"確認 太郎",university:"大学",lineName:"たろう",notes:"",receiptUrl:"",refundMethod:"cash"});

test("refund methods require their own details and preserve account number zeroes",()=>{
  const bank={...input(),refundMethod:"bank",bankName:"架空銀行",bankAccountName:"カクウ タロウ",bankBranchName:"試験支店",bankBranchCode:"００１",bankAccountNumber:"００１２３４５"};
  const valid=validateAdvance(bank);assert.equal(valid.bankBranchCode,"001");assert.equal(valid.bankAccountNumber,"0012345");
  for(const key of ['bankName','bankAccountName','bankBranchName','bankBranchCode','bankAccountNumber'])assert.throws(()=>validateAdvance({...bank,[key]:''}));
  for(const extra of [{refundMethod:'unknown'},{refundMethod:['bank']},{bankBranchCode:'ab1'},{bankAccountNumber:1234567},{bankAccountNumber:'123456789'},{bankAccountNumber:'1e6'}])assert.throws(()=>validateAdvance({...bank,...extra}));
  assert.throws(()=>validateAdvance({...input(),refundMethod:'paypay',refundLineName:'   '}));
  const paypay=validateAdvance({...bank,refundMethod:'paypay',refundLineName:'連絡名'});
  assert.equal(paypay.refundLineName,'連絡名');assert.equal(paypay.bankAccountNumber,undefined);
  const cash=validateAdvance({...bank,refundMethod:'cash',refundLineName:'連絡名'});
  assert.equal(cash.bankName,undefined);assert.equal(cash.refundLineName,undefined);
});

test("old accepted requests retry unchanged, but new requests must select a refund method",async()=>{
  const oldDir=process.env.DATA_DIR;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'advance-legacy-'));process.env.DATA_DIR=dir;
  try {
    const {refundMethod,...legacy}=input();const value=validateAdvance(legacy);
    await assert.rejects(()=>enqueueAdvance(user,value),/返金方法/);
    const {idempotencyKey,...fields}=value;
    const requestId='ADV-'+crypto.createHash('sha256').update(`${user.id}:${idempotencyKey}`).digest('hex').slice(0,32);
    const record={payload:{...fields,requestId},fingerprint:crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex'),delivery:'delivered',attempts:1,nextAttemptAt:0};
    fs.writeFileSync(path.join(dir,'advance-requests.json'),JSON.stringify([record]));
    assert.deepEqual(await enqueueAdvance(user,value),record);
    await assert.rejects(()=>enqueueAdvance(user,validateAdvance({...legacy,refundMethod:'cash'})),/別の内容/);
  } finally {if(oldDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldDir;fs.rmSync(dir,{recursive:true,force:true});}
});

test("rejects forged identity/status, fractional amounts, impossible dates and unsafe links",()=>{
  for(const extra of [{status:"承認済み"},{websiteUserId:"someone"},{amount:1.5},{amount:0},{expenseDate:"2026-02-30"},{receiptUrl:"javascript:alert(1)"}]) assert.throws(()=>validateAdvance({...input(),...extra}));
});
test("durable intake, HMAC, concurrent sends and retry after uncertain receipt preserve one request",async()=>{
  const oldDir=process.env.DATA_DIR,oldFetch=globalThis.fetch;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"accounting-test-"));process.env.DATA_DIR=dir;
  process.env.ACCOUNTING_GAS_URL="https://script.google.com/macros/s/test/exec";
  process.env.ACCOUNTING_WEBHOOK_SECRET="a".repeat(64);
  try {
    const data=validateAdvance(input());
    const [one,two]=await Promise.all([enqueueAdvance(user,data),enqueueAdvance(user,data)]);
    assert.equal(one.payload.requestId,two.payload.requestId);
    await assert.rejects(()=>enqueueAdvance(user,{...data,amount:10}));
    const received=new Set<string>();let attempts=0;
    globalThis.fetch=async(_url,options)=>{
      attempts++;const envelope=JSON.parse(String(options?.body));
      assert.equal(envelope.signature,crypto.createHmac("sha256","a".repeat(64)).update(`v2\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.payload}`).digest("hex"));
      const p=JSON.parse(envelope.payload);received.add(p.requestId);
      if(attempts===1) throw new Error("response lost after Google saved it");
      return Response.json({ok:true,requestId:p.requestId});
    };
    assert.equal(await deliverAdvance(one.payload.requestId),false);
    const saved=JSON.parse(fs.readFileSync(path.join(dir,"advance-requests.json"),"utf8"));saved[0].nextAttemptAt=0;
    fs.writeFileSync(path.join(dir,"advance-requests.json"),JSON.stringify(saved));
    await Promise.all([drainAdvanceQueue(),drainAdvanceQueue()]);
    assert.equal(received.size,1);assert.equal(attempts,2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"advance-requests.json"),"utf8"))[0].delivery,"delivered");
    const final=await enqueueAdvance({...user,name:"更新後の名前"},data);assert.equal(final.payload.accountName,"テスト");
  } finally { globalThis.fetch=oldFetch;if(oldDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldDir;fs.rmSync(dir,{recursive:true,force:true});delete process.env.ACCOUNTING_GAS_URL;delete process.env.ACCOUNTING_WEBHOOK_SECRET; }
});
