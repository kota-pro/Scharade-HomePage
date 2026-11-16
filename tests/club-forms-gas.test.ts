import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { clubGasHarness } from "./helpers/club-forms-gas.ts";

const input = (kind = "admission") => ({
  year: 2027,
  season: "spring",
  kind,
  fee: 4500,
  deadline: "2027-04-01T09:00:00.000Z",
  eventName: "春の新歓",
  startsAt: "2027-04-02T06:00:00.000Z",
  endsAt: "2027-04-02T09:00:00.000Z",
  place: "早稲田",
});
const create = (kind = "admission") => ({
  action: "form.mutate",
  id: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  revision: 1,
  operation: "create",
  input: input(kind),
  desiredState: "draft",
});

test("admission and both welcome forms close on the last submitted response before the deadline", () => {
  for (const kind of ["admission", "welcome_photo", "welcome_meal"]) {
    const h = clubGasHarness();
    const request = {
      ...create(kind),
      input: { ...input(kind), capacity: 2 },
      desiredState: "open",
    };
    const result = h.send(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    const form = h.forms.get(result.form.formId);
    assert.equal(result.form.responseCount, 0);
    assert.match(form.description, /定員：2人/);
    assert.equal(h.triggers.length, 2);
    form.responseCount = 1;
    h.ctx.closeFullClubForm({ source: form });
    assert.equal(form.accepting, true);
    form.responseCount = 2;
    h.ctx.closeFullClubForm({ source: form });
    assert.equal(form.accepting, false);
    assert.equal(h.triggers.length, 1);
    const remote = h.send({ action: "forms.status", ids: [request.id] })
      .forms[0];
    assert.equal(remote.state, "closed");
    assert.equal(remote.closedReason, "capacity");
    assert.equal(remote.responseCount, 2);
    // Retrying the opening request must not reopen a full form or add another trigger.
    assert.equal(h.send(request).form.state, "closed");
    assert.equal(form.accepting, false);
    assert.equal(h.ctx.closeDueClubForms(), 0);
  }
});

test("capacity decreases, missed events, reopening and removal honor the current count", () => {
  const h = clubGasHarness();
  const request = {
    ...create(),
    input: { ...input(), capacity: 3 },
    desiredState: "open",
  };
  const form = h.forms.get(h.send(request).form.formId);
  form.responseCount = 2;
  let revision = 1;
  const change = (capacity: number | undefined, desiredState = "open") =>
    h.send({
      ...request,
      revision: ++revision,
      operation: "update",
      operationId: crypto.randomUUID(),
      input: { ...input(), ...(capacity ? { capacity } : {}) },
      desiredState,
    });
  assert.equal(change(2).form.closedReason, "capacity");
  assert.equal(form.accepting, false);
  assert.equal(change(2).form.state, "closed");
  assert.equal(change(4).form.state, "open");
  assert.equal(h.triggers.length, 2);
  // The minute trigger recovers a lost submission notification, including concurrent overfill.
  form.responseCount = 5;
  assert.equal(h.ctx.closeDueClubForms(), 1);
  assert.equal(form.accepting, false);
  assert.equal(change(undefined).form.state, "open");
  assert.equal(h.triggers.length, 1);
  assert.doesNotMatch(form.description, /定員：/);
  h.ctx.closeFullClubForm({ source: form });
  assert.equal(form.accepting, true);
  h.setNow(Date.parse(request.input.deadline) + 1);
  assert.equal(h.ctx.closeDueClubForms(), 1);
  assert.equal(form.accepting, false);
});

test("trigger quota failures keep new capped forms closed, and closing/deleting releases triggers", () => {
  const h = clubGasHarness();
  const request = {
    ...create(),
    input: { ...input(), capacity: 2 },
    desiredState: "open",
  };
  const unrelated = Array.from({ length: 19 }, () => ({
    getHandlerFunction: () => "unrelated",
  }));
  h.triggers.push(...unrelated);
  assert.equal(h.send(request).code, "CAPACITY_TRIGGER_FAILED");
  const form = h.forms.get(h.ctx.clubState_(request.id).formId);
  assert.equal(form.accepting, false);
  h.triggers.splice(1);
  assert.equal(h.send(request).form.state, "open");
  assert.equal(h.triggers.length, 2);
  assert.equal(
    h.send({
      ...request,
      revision: 2,
      operation: "close",
      operationId: crypto.randomUUID(),
      desiredState: "closed",
    }).ok,
    true,
  );
  assert.equal(h.triggers.length, 1);
  assert.equal(
    h.send({
      ...request,
      revision: 3,
      operation: "open",
      operationId: crypto.randomUUID(),
    }).ok,
    true,
  );
  assert.equal(h.triggers.length, 2);
  assert.equal(
    h.send({
      action: "form.delete",
      id: request.id,
      revision: 4,
      operationId: crypto.randomUUID(),
    }).deleted,
    true,
  );
  assert.equal(h.triggers.length, 1);
  h.ctx.closeFullClubForm({ source: form });
  assert.equal(form.accepting, false);
});

test("invalid capacity and continuation limits are rejected before Google writes", () => {
  const h = clubGasHarness();
  const before = h.counts();
  for (const capacity of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      h.send({ ...create(), input: { ...input(), capacity } }).code,
      "INVALID",
    );
  assert.equal(
    h.send({
      ...create("continuation"),
      input: { ...input("continuation"), capacity: 2 },
    }).code,
    "INVALID",
  );
  assert.deepEqual(h.counts(), before);
});

test("a partial trash failure retries safely, preserves shared files, and prevents stale mutation and deadline work", () => {
  const h = clubGasHarness(),
    request = create();
  const remote = h.send(request).form;
  const deletion = {
    action: "form.delete",
    id: request.id,
    operationId: crypto.randomUUID(),
    revision: 2,
  };
  h.crashTrash();
  assert.equal(h.send(deletion).ok, false);
  assert.equal(h.files.get(remote.formId).trashed, true);
  assert.notEqual(h.files.get(remote.spreadsheetId).trashed, true);
  assert.equal(h.send(request).code, "FORM_DELETED");
  assert.equal(h.send(deletion).deleted, true);
  assert.equal(h.send(deletion).deleted, true);
  assert.equal(h.files.get(remote.spreadsheetId).trashed, true);
  assert.equal(h.ctx.closeDueClubForms(), 0);
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).code,
    "FORM_DELETED",
  );
  assert.ok(
    [...h.files.values()]
      .filter(
        (f) =>
          f.original || f.mimeType === "application/vnd.google-apps.folder",
      )
      .every((f) => !f.trashed),
  );
  const termId = new URL(remote.mergedSpreadsheetUrl).pathname.split("/")[3];
  assert.notEqual(h.files.get(termId).trashed, true);
});

test("deletion refuses unrelated files before trashing either managed file", () => {
  const h = clubGasHarness(),
    request = create();
  const remote = h.send(request).form;
  h.files.get(remote.spreadsheetId).appProperties.clubFormsKey = "unrelated";
  const result = h.send({
    action: "form.delete",
    id: request.id,
    operationId: crypto.randomUUID(),
    revision: 2,
  });
  assert.equal(result.code, "DELETE_CHECK_FAILED");
  assert.notEqual(h.files.get(remote.formId).trashed, true);
  assert.notEqual(h.files.get(remote.spreadsheetId).trashed, true);
});

test("both welcome templates display the optional day-of fee notice and retain the numeric and free modes", () => {
  const h = clubGasHarness();
  for (const kind of ["welcome_photo", "welcome_meal"]) {
    const request = {
      ...create(kind),
      input: { ...input(kind), feeOnDay: true },
    };
    const result = h.send(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    const form = h.forms.get(result.form.formId);
    if (kind.startsWith("welcome_"))
      assert.equal(form.name, request.input.eventName);
    else assert.match(form.name, /^2027年 春 写団シャレード/);
    assert.match(
      form.description,
      /参加費：当日、参加費がかかる場合があります/,
    );
    assert.doesNotMatch(form.description, /参加費：4500円|参加費：無料/);
    for (const [revision, fee] of [
      [2, 500],
      [3, 0],
    ]) {
      const update = h.send({
        ...request,
        revision,
        operationId: crypto.randomUUID(),
        operation: "update",
        input: { ...input(kind), fee, feeOnDay: false },
      });
      assert.equal(update.ok, true, JSON.stringify(update));
      assert.match(
        form.description,
        fee === 0 ? /参加費：無料/ : /参加費：500円/,
      );
      assert.doesNotMatch(form.description, /当日、参加費/);
    }
  }
  for (const kind of ["admission", "continuation"])
    assert.equal(
      h.send({ ...create(kind), input: { ...input(kind), feeOnDay: true } })
        .code,
      "INVALID",
    );
  assert.equal(
    h.send({
      ...create("welcome_photo"),
      input: { ...input("welcome_photo"), feeOnDay: "true" },
    }).code,
    "INVALID",
  );
});

test("club GAS checks signatures, nonces, owner and a single minute trigger before Google writes", () => {
  const h = clubGasHarness(),
    before = h.counts();
  assert.equal(h.send(create(), false).code, "UNAUTHORIZED");
  const envelope = h.signed({ action: "health" });
  assert.equal(h.ctx.doPost(envelope).ok, true);
  assert.equal(h.ctx.doPost(envelope).code, "REPLAY");
  h.ctx.initializeClubForms();
  assert.equal(h.triggers.length, 1);
  h.setOwner("wrong@example.invalid");
  assert.equal(h.send(create()).code, "OWNER_MISMATCH");
  assert.deepEqual(h.counts(), before);
});

test("all templates retain uploads and questions, create independent answer sheets, and follow the exact year folders", () => {
  const h = clubGasHarness(),
    originals = [...h.forms.values()].map((form) => ({
      id: form.id,
      description: form.description,
      published: form.published,
    }));
  for (const kind of [
    "admission",
    "continuation",
    "welcome_photo",
    "welcome_meal",
  ]) {
    const request = create(kind),
      result = h.send(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    const form = h.forms.get(result.form.formId);
    assert.equal(form.published, false);
    assert.equal(form.accepting, false);
    assert.ok(form.items.some((item: any) => item.type === "FILE_UPLOAD"));
    assert.match(form.description, /4500円/);
    assert.ok(!form.description.includes("2026/4/7"));
    assert.match(form.description, /2027\/4\/1/);
    assert.equal(form.destination, result.form.spreadsheetId);
    assert.equal(h.books.get(form.destination).timeZone, "Asia/Tokyo");
    assert.equal(h.books.get(form.destination).locale, "ja_JP");
    const answer = h.books
      .get(form.destination)
      .sheets.find((sheet: any) => sheet.formId === form.id);
    assert.equal(answer.id, result.form.sheetId);
    assert.notEqual(answer.id, 0);
    const file = h.files.get(form.id),
      folder = h.folders.get(file.parents[0]),
      annual = h.folders.get(folder.parent);
    assert.equal(annual.name, "2027運営資料");
    assert.equal(annual.parent, h.ctx.CLUB_ROOT_);
    assert.equal(
      folder.name,
      kind.startsWith("welcome") ? "2027 新歓" : "2027 入会・継続フォーム",
    );
    assert.equal(
      Boolean(result.form.mergedSpreadsheetUrl),
      !kind.startsWith("welcome"),
    );
    const before = h.counts();
    assert.equal(h.send(request).form.formId, form.id);
    assert.deepEqual(h.counts(), before);
  }
  assert.equal(
    [...h.folders.values()].filter((folder) => folder.name === "2027運営資料")
      .length,
    1,
  );
  for (const before of originals) {
    const after = h.forms.get(before.id);
    assert.equal(after.description, before.description);
    assert.equal(after.published, before.published);
  }
});

test("lost copy and spreadsheet responses are reconciled using file metadata without duplicate forms", () => {
  const h = clubGasHarness(),
    request = create();
  h.crashCopy();
  assert.equal(h.send(request).ok, false);
  assert.equal(h.counts().forms, 1);
  h.crashSheet();
  assert.equal(h.send(request).ok, false);
  assert.equal(h.counts().sheets, 1);
  const result = h.send(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.counts().forms, 1);
  assert.equal(h.counts().sheets, 2);
  assert.equal(h.send(request).form.formId, result.form.formId);
});

test("missing upload folders block opening and correct a misleading accepting flag until Google restores them", () => {
  const h = clubGasHarness(),
    request = create();
  const remote = h.send(request).form,
    form = h.forms.get(remote.formId);
  form.uploadReady = false;
  form.accepting = true;
  const status = h.send({ action: "forms.status", ids: [request.id] }).forms[0];
  assert.equal(status.uploadReady, false);
  assert.equal(status.uploadRequired, true);
  assert.equal(status.state, "draft");
  assert.equal(form.accepting, false);
  const open = {
    ...request,
    revision: 2,
    operationId: crypto.randomUUID(),
    operation: "open",
    desiredState: "open",
  };
  assert.equal(h.send(open).code, "UPLOAD_SETUP_REQUIRED");
  assert.equal(form.published, false);
  form.uploadReady = true;
  form.accepting = true;
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).forms[0].state,
    "draft",
  );
  assert.equal(h.send(open).form.state, "open");
  form.uploadCheckFailed = true;
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).code,
    "UPLOAD_CHECK_FAILED",
  );
  assert.equal(form.accepting, true);
});

test("deadline closing, early closing, extension and explicit reopening preserve the original URLs and response destinations", () => {
  const h = clubGasHarness(),
    request = create();
  const draft = h.send(request).form;
  let revision = 1;
  const mutate = (
    operation: string,
    desiredState: string,
    deadline = request.input.deadline,
  ) =>
    h.send({
      ...request,
      operationId: crypto.randomUUID(),
      revision: ++revision,
      operation,
      desiredState,
      input: { ...request.input, deadline },
    });
  const opened = mutate("open", "open");
  assert.equal(opened.form.state, "open");
  h.setNow(Date.parse(request.input.deadline) + 1);
  assert.equal(h.ctx.closeDueClubForms(), 1);
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).forms[0].state,
    "closed",
  );
  const future = "2027-05-01T09:00:00.000Z";
  assert.equal(mutate("update", "closed", future).form.state, "closed");
  assert.equal(h.ctx.closeDueClubForms(), 0);
  const reopened = mutate("open", "open", future);
  assert.equal(reopened.form.state, "open");
  const closed = mutate("close", "closed", future);
  assert.equal(closed.form.state, "closed");
  assert.equal(h.ctx.closeDueClubForms(), 0);
  for (const key of [
    "formId",
    "spreadsheetId",
    "sheetId",
    "editUrl",
    "responseUrl",
  ])
    assert.equal(closed.form[key], draft[key]);
  assert.equal(h.send(request).code, "CONFLICT");
});

test("autumn copies use current grade wording and generic roles while preserving form structures", () => {
  const h = clubGasHarness(),
    request = create("continuation");
  request.input.season = "autumn";
  const result = h.send(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  const form = h.forms.get(result.form.formId);
  assert.ok(form.items.some((item: any) => item.title === "現在の学年"));
  assert.ok(form.items.some((item: any) => item.title.includes("会計担当")));
  assert.ok(!form.items.some((item: any) => item.title.includes("会計星山")));
});

test("Google-side manual opening is detected and deadlines are enforced without the website worker", () => {
  const h = clubGasHarness(),
    request = create();
  const draft = h.send(request).form,
    form = h.forms.get(draft.formId);
  form.setPublished(true);
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).forms[0].state,
    "open",
  );
  form.setAcceptingResponses(false);
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).forms[0].state,
    "closed",
  );
  // The site still believes it is closed; the independent Google trigger must check the form itself.
  form.setAcceptingResponses(true);
  h.setNow(Date.parse(request.input.deadline) + 1);
  assert.equal(h.ctx.closeDueClubForms(), 1);
  assert.equal(form.accepting, false);
  assert.equal(
    h.send({ action: "forms.status", ids: [request.id] }).forms[0].closedReason,
    "deadline",
  );
  assert.equal(h.ctx.closeDueClubForms(), 0);
});

test("roster reads omit upload/payment data, tolerate missing gender and admission continuation columns, and identify explicit no", () => {
  const h = clubGasHarness();
  const admission = {
      spreadsheetId: "admission_fixture_2027_012345",
      sheetId: 11,
    },
    continuation = {
      spreadsheetId: "continuation_fixture_2027_012345",
      sheetId: 22,
    };
  h.addSource(
    admission.spreadsheetId,
    11,
    ["タイムスタンプ", "名前", "学年", "LINEのQRコード"],
    [
      [
        new Date("2027-03-31T23:45:00.000Z"),
        "新入会員",
        "1年生",
        "private-upload",
      ],
    ],
  );
  h.addSource(
    continuation.spreadsheetId,
    22,
    [
      "回答日時",
      "氏名\n（フルネーム）",
      "春からの学年",
      "継続しますか？",
      "会費の振込画像",
    ],
    [[new Date(), "継続会員", "3年生", "いいえ", "private-payment"]],
  );
  const result = h.send({
    action: "roster.read",
    term: { year: 2027, season: "spring", admission, continuation },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.bundles[0].rows[0].active, true);
  assert.equal(result.bundles[1].rows[0].active, false);
  assert.equal(result.bundles[1].rows[0].gender, "");
  assert.ok(!JSON.stringify(result).includes("private-upload"));
  assert.ok(!JSON.stringify(result).includes("private-payment"));
  assert.equal(
    result.bundles[0].rows[0].submittedAt,
    "2027-03-31T23:45:00.000Z",
  );
});

test("confirmed exports preserve unrelated tabs, escape formulas, and reject stale conflicting snapshots", () => {
  const h = clubGasHarness(),
    term = { year: 2027, season: "autumn" },
    id = crypto.randomUUID();
  const row = [
    "a".repeat(64),
    "=PRIVATE()",
    "大学",
    "2年生",
    "女性",
    "line",
    "在籍",
    "",
    "継続",
    "",
  ];
  const request = {
    action: "roster.export",
    id,
    term,
    revision: 1,
    active: [row],
    retired: [],
    review: [],
  };
  const result = h.send(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  const book = [...h.books.values()][0];
  assert.equal(book.timeZone, "Asia/Tokyo");
  assert.equal(book.locale, "ja_JP");
  assert.equal(book.getSheetByName("在籍者").rows[1][1], "'=PRIVATE()");
  book.insertSheet("担当者のメモ").rows.push(["保持する"]);
  assert.equal(h.send({ ...request, revision: 2, active: [] }).ok, true);
  assert.equal(book.getSheetByName("担当者のメモ").rows[0][0], "保持する");
  assert.equal(h.send(request).ok, true);
  assert.notEqual(book.getSheetByName("在籍者").rows[1]?.[1], "'=PRIVATE()");
  assert.equal(h.send({ ...request, revision: 2 }).code, "CONFLICT");
});
