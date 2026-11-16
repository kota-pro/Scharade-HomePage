import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { clubGasHarness } from "./helpers/club-forms-gas.ts";
import {
  clubFormAction,
  clubFormsView,
  readClubForms,
  drainClubFormOperations,
  refreshClubFormStatuses,
  validateClubForm,
} from "../src/lib/clubForms.ts";
import { writeData } from "../src/lib/store.ts";
import { GET, POST } from "../src/pages/api/admin/club-forms.ts";
import { checkedClubFormRemote } from "../src/lib/clubForms.ts";
import { welcomeFormTitle } from "../src/lib/clubFormTitle.ts";
import { unavailableClubFormSource } from "../src/lib/clubFormDeletion.ts";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "scharade-club-forms-"),
);
const originalFetch = globalThis.fetch;
let h: ReturnType<typeof clubGasHarness>, calls: number, loseReply: boolean;
const input = () => ({
  year: 2027,
  season: "spring",
  kind: "admission",
  fee: 4500,
  deadline: "2027-04-01T09:00:00Z",
  eventName: "",
  startsAt: "",
  endsAt: "",
  place: "",
});
const create = () => ({
  action: "create",
  id: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  input: input(),
});
beforeEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory);
  h = clubGasHarness();
  calls = 0;
  loseReply = false;
  Object.assign(process.env, {
    DATA_DIR: directory,
    CLUB_FORMS_GAS_URL: "https://script.google.com/macros/s/club-fixture/exec",
    CLUB_FORMS_WEBHOOK_SECRET: h.props.WEBHOOK_SECRET,
  });
  writeData(
    "users.json",
    ["member", "staff", "executive", "admin"].map((role) => ({
      id: role,
      email: `${role}@example.invalid`,
      name: role,
      role,
      approved: true,
      createdAt: new Date().toISOString(),
      providers: {},
    })),
  );
  globalThis.fetch = async (_input, options) => {
    calls++;
    const result = h.ctx.doPost({
      postData: { contents: String(options?.body) },
    });
    if (loseReply) {
      loseReply = false;
      throw new Error("lost reply");
    }
    return Response.json(result);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});
const ready = async () => {
  const request = create();
  await clubFormAction("executive", request);
  assert.deepEqual(await drainClubFormOperations(), {
    attempted: 1,
    completed: 1,
  });
  return { request, form: readClubForms().forms[0] };
};

test("confirmed deletion trashes only managed files, survives a lost reply, hides its card and rejects later edits", async () => {
  const { form } = await ready();
  const remote = form.remote!;
  const request = {
    action: "delete",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    confirm: true,
  };
  await assert.rejects(
    clubFormAction("executive", { ...request, confirm: false }),
    /確認/,
  );
  await assert.rejects(
    clubFormAction("member", request),
    (e: any) => e.status === 403,
  );
  await assert.rejects(
    clubFormAction("executive", { ...request, revision: 0 }),
    (e: any) => e.status === 409,
  );
  await clubFormAction("executive", request);
  await clubFormAction("executive", request);
  assert.equal(
    readClubForms().operations.filter((j) => j.action === "delete").length,
    1,
  );
  loseReply = true;
  await drainClubFormOperations();
  assert.equal(h.files.get(remote.formId).trashed, true);
  assert.equal(h.files.get(remote.spreadsheetId).trashed, true);
  assert.equal(h.forms.get(remote.formId).accepting, false);
  assert.equal(
    h.files.get(new URL(remote.mergedSpreadsheetUrl!).pathname.split("/")[3])
      .trashed,
    undefined,
  );
  assert.equal(readClubForms().forms[0].deletedAt, undefined);
  const pending = readClubForms();
  pending.operations.find((j) => j.action === "delete")!.nextAttemptAt = 0;
  writeData("club-forms.json", pending);
  await drainClubFormOperations();
  assert.ok(readClubForms().forms[0].deletedAt);
  assert.equal(clubFormsView("executive").forms.length, 0);
  assert.equal(await refreshClubFormStatuses(), 0);
  await clubFormAction("executive", request);
  await assert.rejects(
    clubFormAction("executive", {
      action: "update",
      id: form.id,
      revision: 2,
      operationId: crypto.randomUUID(),
      input: input(),
    }),
    /削除/,
  );
});

test("deleting cancels an undelivered create and reconciles a lost partial copy without creating more files", async () => {
  const request = create();
  await clubFormAction("executive", request);
  await clubFormAction("executive", {
    action: "delete",
    id: request.id,
    revision: 1,
    operationId: crypto.randomUUID(),
    confirm: true,
  });
  assert.equal(readClubForms().operations[0].status, "cancelled");
  await drainClubFormOperations();
  assert.equal(h.counts().forms, 0);
  const stale = h.send({
    action: "form.mutate",
    id: request.id,
    operationId: request.operationId,
    revision: 1,
    operation: "create",
    input: input(),
    desiredState: "draft",
  });
  assert.equal(stale.code, "FORM_DELETED");
  const partial = create();
  await clubFormAction("executive", partial);
  h.crashCopy();
  await drainClubFormOperations();
  assert.equal(h.counts().forms, 1);
  await clubFormAction("executive", {
    action: "delete",
    id: partial.id,
    revision: 1,
    operationId: crypto.randomUUID(),
    confirm: true,
  });
  await drainClubFormOperations();
  assert.equal(h.counts().forms, 1);
  assert.ok(readClubForms().forms.find((f) => f.id === partial.id)!.deletedAt);
  assert.ok(
    [...h.files.values()]
      .filter(
        (f) => !f.original && f.mimeType === "application/vnd.google-apps.form",
      )
      .every((f) => f.trashed),
  );
});

test("active roster sources cannot be deleted; deleting sources cannot be selected for a new roster", async () => {
  const { form } = await ready();
  const request = {
    action: "delete",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    confirm: true,
  };
  writeData("member-activities.json", {
    roster: {
      spreadsheetId: "other-sheet",
      term: {
        admission: { spreadsheetId: form.remote!.spreadsheetId },
        continuation: { spreadsheetId: "another-sheet" },
      },
    },
  });
  await assert.rejects(
    clubFormAction("executive", request),
    /現在の名簿に使用中/,
  );
  assert.match(
    clubFormsView("executive").forms[0].deleteBlockedReason,
    /参照先を切り替える/,
  );
  assert.equal(
    unavailableClubFormSource({ spreadsheetId: form.remote!.spreadsheetId }),
    false,
  );
  writeData("member-activities.json", {});
  await clubFormAction("executive", request);
  assert.equal(
    unavailableClubFormSource({ spreadsheetId: form.remote!.spreadsheetId }),
    true,
  );
});

test("welcome title suggestions use Japanese dates and weekdays for local and UTC input", () => {
  assert.equal(
    welcomeFormTitle("welcome_photo"),
    "【月/日（曜日）】シャレード新歓撮影会＠場所",
  );
  assert.equal(
    welcomeFormTitle("welcome_meal", "2027-04-02T15:00", " 早稲田 "),
    "【4/2（金）】シャレード新歓食事会＠早稲田",
  );
  assert.equal(
    welcomeFormTitle("welcome_photo", "2027-04-02T15:00:00Z", "新宿御苑"),
    "【4/3（土）】シャレード新歓撮影会＠新宿御苑",
  );
  assert.equal(welcomeFormTitle("admission"), "");
});

test("blank welcome titles are generated and maintained across edits and reception changes, while custom titles win", async () => {
  const request = {
    ...create(),
    input: {
      ...input(),
      kind: "welcome_photo",
      eventName: "",
      startsAt: "2027-04-02T15:00:00Z",
      place: "新宿御苑",
    },
  };
  await clubFormAction("executive", request);
  await drainClubFormOperations();
  let form = readClubForms().forms[0];
  const id = form.remote!.formId;
  assert.equal(form.eventName, "【4/3（土）】シャレード新歓撮影会＠新宿御苑");
  assert.equal(form.autoEventName, true);
  assert.equal(h.forms.get(id).name, form.eventName);
  await clubFormAction("executive", {
    action: "update",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    input: {
      ...request.input,
      startsAt: "2027-04-04T01:00:00Z",
      place: "代々木公園",
    },
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.eventName, "【4/4（日）】シャレード新歓撮影会＠代々木公園");
  await clubFormAction("executive", {
    action: "close",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.autoEventName, true);
  assert.equal(h.forms.get(id).name, form.eventName);
  await clubFormAction("executive", {
    action: "update",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    input: { ...request.input, eventName: "手入力の企画名" },
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.autoEventName, undefined);
  assert.equal(h.forms.get(id).name, "手入力の企画名");
  await clubFormAction("executive", {
    action: "update",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    input: request.input,
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.autoEventName, true);
  assert.equal(form.remote!.formId, id);
  assert.throws(
    () => validateClubForm({ ...request.input, place: "長".repeat(150) }),
    /企画名を短く/,
  );
  assert.equal(
    validateClubForm({
      ...request.input,
      place: "長".repeat(500),
      eventName: "短い名前",
    }).eventName,
    "短い名前",
  );
  assert.throws(
    () => validateClubForm({ ...input(), autoEventName: true }),
    /新歓企画/,
  );
  assert.throws(
    () => validateClubForm({ ...request.input, autoEventName: "true" }),
    /新歓企画/,
  );
});

test("capacity persists through delivery and opening, refresh reports a full form, and it can be removed", async () => {
  for (const capacity of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => validateClubForm({ ...input(), capacity }), /定員/);
  assert.throws(
    () => validateClubForm({ ...input(), kind: "continuation", capacity: 2 }),
    /定員/,
  );
  const request = { ...create(), input: { ...input(), capacity: 2 } };
  await clubFormAction("executive", request);
  await drainClubFormOperations();
  let form = readClubForms().forms[0];
  await clubFormAction("executive", {
    action: "open",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    deadline: form.deadline,
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.capacity, 2);
  const google = h.forms.get(form.remote!.formId);
  google.responseCount = 2;
  h.ctx.closeFullClubForm({ source: google });
  await refreshClubFormStatuses(form.id);
  form = readClubForms().forms[0];
  assert.equal(form.state, "closed");
  assert.equal(form.remote!.closedReason, "capacity");
  assert.equal(form.remote!.responseCount, 2);
  await clubFormAction("executive", {
    action: "update",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    input: input(),
  });
  await drainClubFormOperations();
  assert.equal(readClubForms().forms[0].capacity, undefined);
  assert.equal(readClubForms().forms[0].state, "closed");
});

test("welcome fee notice survives delivery and reopening, and can be changed back to a fixed amount", async () => {
  const request = {
    ...create(),
    input: {
      ...input(),
      kind: "welcome_photo",
      fee: 0,
      feeOnDay: true,
      eventName: "新歓撮影会",
      startsAt: "2027-04-02T06:00:00Z",
      place: "早稲田",
    },
  };
  await clubFormAction("executive", request);
  await drainClubFormOperations();
  let form = readClubForms().forms[0];
  const formId = form.remote!.formId;
  assert.equal(form.feeOnDay, true);
  assert.match(
    h.forms.get(formId).description,
    /参加費：当日、参加費がかかる場合があります/,
  );
  await clubFormAction("executive", {
    action: "open",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    deadline: request.input.deadline,
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.feeOnDay, true);
  assert.match(
    h.forms.get(formId).description,
    /参加費：当日、参加費がかかる場合があります/,
  );
  await clubFormAction("executive", {
    action: "update",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    input: { ...request.input, feeOnDay: false, fee: 500 },
  });
  await drainClubFormOperations();
  form = readClubForms().forms[0];
  assert.equal(form.feeOnDay, undefined);
  assert.equal(form.remote!.formId, formId);
  assert.match(h.forms.get(formId).description, /参加費：500円/);
  assert.doesNotMatch(h.forms.get(formId).description, /当日、参加費/);
  assert.throws(
    () => validateClubForm({ ...input(), feeOnDay: true }),
    /新歓企画/,
  );
  assert.throws(
    () => validateClubForm({ ...request.input, feeOnDay: "true" }),
    /新歓企画/,
  );
});

test("an executive can check upload readiness immediately without waiting for the periodic refresh", async () => {
  const { form } = await ready();
  const google = h.forms.get(form.remote!.formId);
  google.uploadReady = false;
  await clubFormAction("executive", { action: "refresh", id: form.id });
  assert.equal(readClubForms().forms[0].remote!.uploadReady, false);
  google.uploadReady = true;
  await clubFormAction("executive", { action: "refresh", id: form.id });
  assert.equal(readClubForms().forms[0].remote!.uploadReady, true);
  google.uploadCheckFailed = true;
  await assert.rejects(
    clubFormAction("executive", { action: "refresh", id: form.id }),
    /準備状態を確認できません/,
  );
});

test("both executives and admins create forms; lower/unapproved/stale roles cannot view, queue or retry", async () => {
  for (const role of ["member", "staff", "missing"]) {
    assert.throws(
      () => clubFormsView(role),
      (e: any) => e.status === 403,
    );
    await assert.rejects(
      clubFormAction(role, create()),
      (e: any) => e.status === 403,
    );
  }
  const request = create();
  await clubFormAction("executive", request);
  await clubFormAction("admin", create());
  assert.equal(readClubForms().forms.length, 2);
  assert.equal(calls, 0);
  writeData("users.json", [
    {
      id: "executive",
      email: "executive@example.invalid",
      name: "former",
      role: "executive",
      approved: false,
    },
  ]);
  await assert.rejects(
    clubFormAction("executive", request),
    (e: any) => e.status === 403,
  );
});

test("create requests are idempotent, validate payloads, and return actual stored Google links only after delivery", async () => {
  const request = create();
  await clubFormAction("executive", request);
  await clubFormAction("executive", request);
  assert.equal(readClubForms().operations.length, 1);
  assert.equal(readClubForms().forms[0].remote, undefined);
  await assert.rejects(
    clubFormAction("executive", { ...request, input: { ...input(), fee: 1 } }),
    (e: any) => e.status === 409,
  );
  assert.deepEqual(await drainClubFormOperations(), {
    attempted: 1,
    completed: 1,
  });
  const form = readClubForms().forms[0];
  assert.equal(form.delivery, "done");
  assert.equal(form.remote?.state, "draft");
  assert.equal(form.remote?.sheetId! > 0, true);
  assert.equal(
    h.forms.get(form.remote!.formId).destination,
    form.remote!.spreadsheetId,
  );
  assert.equal(
    clubFormsView("executive").forms[0].remote?.formId,
    form.remote?.formId,
  );
  for (const changes of [
    { fee: -1 },
    { fee: 1.5 },
    { year: 1999 },
    { season: "winter" },
    { kind: "custom" },
    { deadline: "invalid" },
    { deadline: "2027-02-30T00:00:00Z" },
  ])
    assert.throws(() => validateClubForm({ ...input(), ...changes }));
  assert.throws(() =>
    checkedClubFormRemote(
      { ...form.remote, editUrl: "javascript:alert(1)" },
      form.revision,
    ),
  );
});

test("a lost Google response retries the same operation without a second form or answer spreadsheet", async () => {
  const request = create();
  await clubFormAction("executive", request);
  loseReply = true;
  assert.deepEqual(await drainClubFormOperations(), {
    attempted: 1,
    completed: 0,
  });
  assert.equal(readClubForms().forms[0].delivery, "pending");
  assert.equal(h.counts().forms, 1);
  const data = readClubForms();
  data.operations[0].nextAttemptAt = 0;
  writeData("club-forms.json", data);
  assert.deepEqual(await drainClubFormOperations(), {
    attempted: 1,
    completed: 1,
  });
  assert.equal(h.counts().forms, 1);
  assert.equal(h.counts().sheets, 2);
});

test("early close and deadline editing do not reopen a form; explicit reopening requires a future deadline and keeps its links", async () => {
  const { form } = await ready();
  const original = form.remote!;
  const act = async (action: string, extra = {}) => {
    const form = readClubForms().forms[0];
    await clubFormAction("executive", {
      action,
      id: form.id,
      operationId: crypto.randomUUID(),
      revision: form.revision,
      ...extra,
    });
    assert.deepEqual(await drainClubFormOperations(), {
      attempted: 1,
      completed: 1,
    });
    return readClubForms().forms[0];
  };
  assert.equal(
    (await act("open", { deadline: "2027-05-01T09:00:00Z" })).state,
    "open",
  );
  assert.equal((await act("close")).state, "closed");
  assert.equal(
    (
      await act("update", {
        input: { ...input(), fee: 5000, deadline: "2027-06-01T09:00:00Z" },
      })
    ).state,
    "closed",
  );
  const current = readClubForms().forms[0];
  await assert.rejects(
    clubFormAction("executive", {
      action: "open",
      id: current.id,
      operationId: crypto.randomUUID(),
      revision: current.revision,
      deadline: "2020-01-01T00:00:00Z",
    }),
    /未来/,
  );
  const reopened = await act("open", { deadline: "2027-06-01T09:00:00Z" });
  assert.equal(reopened.state, "open");
  assert.equal(reopened.remote?.formId, original.formId);
  assert.equal(reopened.remote?.spreadsheetId, original.spreadsheetId);
});

test("failed delivery is visible and an executive can retry it without losing the operation identity", async () => {
  await clubFormAction("executive", create());
  h.setOwner("wrong@example.invalid");
  const data = readClubForms();
  data.operations[0].attempts = 7;
  writeData("club-forms.json", data);
  await drainClubFormOperations();
  const failed = readClubForms();
  assert.equal(failed.forms[0].delivery, "error");
  assert.equal(failed.operations[0].status, "error");
  const id = failed.operations[0].id;
  h.setOwner("contact@scharade.jp");
  await clubFormAction("admin", { action: "retry", id: failed.forms[0].id });
  await drainClubFormOperations();
  assert.equal(readClubForms().operations[0].id, id);
  assert.equal(readClubForms().forms[0].delivery, "done");
});

test("status refresh observes Google-side closing and API authorization checks persistent roles", async () => {
  const { form } = await ready();
  await clubFormAction("executive", {
    action: "open",
    id: form.id,
    revision: form.revision,
    operationId: crypto.randomUUID(),
    deadline: input().deadline,
  });
  await drainClubFormOperations();
  h.forms.get(form.remote!.formId).setAcceptingResponses(false);
  const data = readClubForms();
  data.forms[0].checkedAt = "2000-01-01T00:00:00Z";
  writeData("club-forms.json", data);
  assert.equal(await refreshClubFormStatuses(), 1);
  assert.equal(readClubForms().forms[0].state, "closed");
  assert.equal((await GET({ locals: { user: null } } as any)).status, 401);
  assert.equal(
    (
      await GET({
        locals: { user: { id: "staff", role: "staff", approved: true } },
      } as any)
    ).status,
    403,
  );
  assert.equal(
    (
      await GET({
        locals: {
          user: { id: "executive", role: "executive", approved: true },
        },
      } as any)
    ).status,
    200,
  );
  const response = await POST({
    locals: { user: { id: "staff", role: "executive", approved: true } },
    request: new Request("https://scharade.jp/api/admin/club-forms", {
      method: "POST",
      body: JSON.stringify(create()),
    }),
  } as any);
  assert.equal(response.status, 403);
});
