import test from "node:test";
import assert from "node:assert/strict";
import { readExhibitionResponse } from "../src/scripts/exhibitionResponse.ts";

test("exhibition API preserves actionable JSON validation messages and adds their number", async () => {
  const data = { ok: false, message: "写真展名を入力してください。" };
  assert.deepEqual(await readExhibitionResponse(Response.json(data, { status: 400 })), { ...data, code: 'EXH-006', errorCode: 'EXH-006', message: 'エラー番号：EXH-006\n写真展名を入力してください。' });
  const coded = { ok: false, code: 'EXH-001', message: '提出する写真の枚数分、写真を添付してください。' };
  assert.equal((await readExhibitionResponse(Response.json(coded, { status: 400 }))).message, `エラー番号：EXH-001\n${coded.message}`);
});
test("HTML error pages produce a usable message instead of a JSON syntax error", async () => {
  await assert.rejects(readExhibitionResponse(new Response("<!DOCTYPE html><title>404</title>", { status: 404 })), /EXH-019/);
  await assert.rejects(readExhibitionResponse(new Response("not JSON", { status: 502 })), /画面を再読み込み/);
});
test("non-JSON unauthorized responses ask the operator to log in again", async () => {
  await assert.rejects(readExhibitionResponse(new Response("<!DOCTYPE html><title>Unauthorized</title>", { status: 401 })), /再度ログイン/);
});
