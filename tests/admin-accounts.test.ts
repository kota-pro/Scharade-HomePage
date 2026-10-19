import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAdminAccount,
  toAdminAccountRoster,
  accountDate,
} from "../src/lib/adminAccounts.ts";
import type { ActivityRoster } from "../src/lib/activityTypes.ts";
import type { User } from "../src/lib/auth.ts";

const roster: ActivityRoster = {
  revision: 1,
  spreadsheetId: "sheet",
  sheetId: 1,
  title: "後期名簿",
  sheetTitle: "回答",
  fetchedAt: "2026-10-06T10:00:00Z",
  fetchedBy: "admin",
  bindings: { account: "confirmed", removed: "deleted" },
  records: [
    {
      key: "wrong",
      name: "同姓同名",
      lineName: "別人",
      university: "別の大学",
      gender: "female",
      grade: "2",
      active: true,
    },
    {
      key: "confirmed",
      name: "同姓同名",
      lineName: "kota",
      university: "テスト大学",
      gender: "male",
      grade: "4",
      active: true,
    },
  ],
};

test("roster details follow only the confirmed account binding, even with duplicate names", () => {
  const result = toAdminAccountRoster("account", roster);
  assert.deepEqual(result.fields, [
    ["名簿上の氏名", "同姓同名"],
    ["LINE名", "kota"],
    ["大学名", "テスト大学"],
    ["性別", "男性"],
    ["学年", "4年生"],
    ["継続状況", "継続する"],
  ]);
  for (const secret of [
    "confirmed",
    "wrong",
    "別人",
    "別の大学",
    "bindings",
    "fetchedBy",
  ])
    assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(toAdminAccountRoster("wrong", roster).fields, []);
  assert.match(toAdminAccountRoster("wrong", roster).status, /未連携/);
  assert.deepEqual(toAdminAccountRoster("removed", roster).fields, []);
  assert.match(
    toAdminAccountRoster("removed", roster).status,
    /見つかりません/,
  );
  assert.match(
    toAdminAccountRoster("account").status,
    /まだ取得されていません/,
  );
});

test("inactive and incomplete roster responses remain inspectable without inventing attributes", () => {
  const copy = structuredClone(roster);
  Object.assign(copy.records[1], {
    active: false,
    lineName: undefined,
    university: "",
    gender: null,
    grade: null,
  });
  const result = toAdminAccountRoster("account", copy);
  assert.match(result.status, /継続対象外/);
  assert.deepEqual(result.fields.slice(1), [
    ["LINE名", "未記入"],
    ["大学名", "未記入"],
    ["性別", "要確認"],
    ["学年", "要確認"],
    ["継続状況", "継続対象外"],
  ]);
});

test("account view allows registration metadata without authentication secrets", () => {
  const account = toAdminAccount({
    id: "one",
    name: "会員",
    email: "test@example.invalid",
    approved: true,
    role: "admin",
    passwordHash: "private-password",
    authVersion: 7,
    createdAt: "2026-09-01T00:00:00Z",
    portfolioId: "portfolio",
    providers: {
      credentials: true,
      instagram: { id: "private-instagram-id", username: "member" },
    },
  });
  assert.equal(account.role, "管理者");
  assert.equal(account.status, "承認済み");
  assert.equal(account.instagramUsername, "member");
  assert.equal(account.instagramLinked, true);
  assert.equal(account.credentials, true);
  const json = JSON.stringify(account);
  for (const secret of [
    "private-password",
    "private-instagram-id",
    "passwordHash",
    "authVersion",
  ])
    assert.ok(!json.includes(secret));
});

test("legacy account fields and absent or invalid dates have readable fallbacks", () => {
  const account = toAdminAccount({
    id: "old",
    email: "old@example.invalid",
    approved: false,
  } as User);
  assert.equal(account.name, "未登録");
  assert.equal(account.status, "未承認");
  assert.equal(account.role, "一般会員");
  assert.equal(account.portfolioId, null);
  assert.equal(account.portfolioName, "記録なし");
  assert.equal(account.instagramLinked, false);
  assert.equal(accountDate(account.createdAt), "記録なし");
  assert.equal(accountDate("invalid"), "記録なし");
  assert.equal(accountDate("2026-09-01T00:00:00Z"), "2026/09/01 09:00");
});
