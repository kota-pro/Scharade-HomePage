import test from "node:test";
import assert from "node:assert/strict";
import { readExhibitionResponse } from "../src/scripts/exhibitionResponse.ts";

test("exhibition API preserves JSON validation messages", async () => {
  const data = { ok: false, message: "写真展名を入力してください。" };
  assert.deepEqual(await readExhibitionResponse(Response.json(data, { status: 400 })), data);
});
test("HTML error pages produce a usable message instead of a JSON syntax error", async () => {
  await assert.rejects(readExhibitionResponse(new Response("<!DOCTYPE html><title>404</title>", { status: 404 })), /画面を再読み込み/);
  await assert.rejects(readExhibitionResponse(new Response("not JSON", { status: 502 })), /画面を再読み込み/);
});
test("non-JSON unauthorized responses ask the operator to log in again", async () => {
  await assert.rejects(readExhibitionResponse(new Response("<!DOCTYPE html><title>Unauthorized</title>", { status: 401 })), /再度ログイン/);
});
