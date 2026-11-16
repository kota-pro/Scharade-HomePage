import crypto from "node:crypto";
import { readUsers, isExecutive } from "./auth.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { audit } from "./audit.ts";
import { welcomeFormTitle } from "./clubFormTitle.ts";
import { activeClubFormSheets } from "./clubFormDeletion.ts";
import {
  clubFormsConfigured,
  postClubForms,
  googleFileId,
  googleUrl,
} from "./clubFormsGoogle.ts";
import type {
  ClubForm,
  ClubFormInput,
  ClubFormKind,
  ClubFormOperation,
  ClubFormRemote,
  ClubFormsStore,
} from "./clubFormsTypes.ts";

export class ClubFormsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const FILE = "club-forms.json";
export function readClubForms(): ClubFormsStore {
  const data = readData<ClubFormsStore>(FILE, {
    version: 1,
    forms: [],
    operations: [],
  });
  if (
    data.version !== 1 ||
    !Array.isArray(data.forms) ||
    !Array.isArray(data.operations) ||
    data.forms.some(
      (form) => !form.id || !Number.isSafeInteger(form.revision),
    ) ||
    data.operations.some((job) => !job.id || !job.formId)
  )
    throw new Error(
      "フォームの保存データを読めません。バックアップを確認してください。",
    );
  return data;
}
function executive(actorId: string) {
  if (!isExecutive(readUsers().find((user) => user.id === actorId)))
    throw new ClubFormsError("幹部以上の権限が必要です。", 403);
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ClubFormsError("入力内容を確認してください。");
  return input as Record<string, unknown>;
}
function uuid(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new ClubFormsError("画面を開き直して再試行してください。");
  return value;
}
function date(value: unknown, label: string, required = true) {
  if (!required && (value === "" || value === undefined)) return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    throw new ClubFormsError(`${label}を正しい日時で入力してください。`);
  return new Date(value).toISOString();
}
function text(value: unknown, label: string, max: number, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value) ||
    (required && !value.trim())
  )
    throw new ClubFormsError(`${label}を${max}文字以内で入力してください。`);
  return value.trim();
}
export function validateClubForm(input: unknown): ClubFormInput {
  const raw = object(input);
  if (
    !Number.isSafeInteger(raw.year) ||
    Number(raw.year) < 2000 ||
    Number(raw.year) > 9999 ||
    !["spring", "autumn"].includes(String(raw.season))
  )
    throw new ClubFormsError("西暦と春・秋を選択してください。");
  if (
    !["admission", "continuation", "welcome_photo", "welcome_meal"].includes(
      String(raw.kind),
    )
  )
    throw new ClubFormsError("フォームの種類を選択してください。");
  if (!Number.isSafeInteger(raw.fee) || Number(raw.fee) < 0)
    throw new ClubFormsError("会費・参加費を0円以上の整数で入力してください。");
  const welcome = String(raw.kind).startsWith("welcome_");
  if (
    raw.capacity !== undefined &&
    (!Number.isSafeInteger(raw.capacity) ||
      Number(raw.capacity) < 1 ||
      raw.kind === "continuation")
  )
    throw new ClubFormsError(
      "定員は入会・新歓フォームで1人以上の整数を入力してください。",
    );
  if (
    (raw.feeOnDay !== undefined && typeof raw.feeOnDay !== "boolean") ||
    (raw.feeOnDay === true && !welcome)
  )
    throw new ClubFormsError(
      "当日の参加費の案内は新歓企画で選択してください。",
    );
  const startsAt = welcome ? date(raw.startsAt, "開催日時") : "";
  const endsAt = welcome ? date(raw.endsAt, "終了日時", false) : "";
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    throw new ClubFormsError("終了日時は開始日時より後にしてください。");
  if (
    (raw.autoEventName !== undefined &&
      typeof raw.autoEventName !== "boolean") ||
    (raw.autoEventName === true && !welcome)
  )
    throw new ClubFormsError("企画名の自動設定は新歓企画で選択してください。");
  const place = welcome ? text(raw.place, "場所", 500) : "";
  const suppliedName = welcome
    ? text(raw.eventName ?? "", "企画名", 150, false)
    : "";
  const autoEventName =
    welcome && (raw.autoEventName === true || !suppliedName);
  const eventName = autoEventName
    ? welcomeFormTitle(String(raw.kind), startsAt, place)
    : suppliedName;
  if (eventName.length > 150)
    throw new ClubFormsError(
      "自動の企画名が150文字を超えます。企画名を短く入力してください。",
    );
  return {
    year: Number(raw.year),
    season: raw.season as ClubFormInput["season"],
    kind: raw.kind as ClubFormKind,
    fee: Number(raw.fee),
    ...(raw.feeOnDay === true ? { feeOnDay: true } : {}),
    ...(raw.capacity !== undefined ? { capacity: Number(raw.capacity) } : {}),
    deadline: date(raw.deadline, "提出期限"),
    eventName,
    ...(autoEventName ? { autoEventName: true } : {}),
    startsAt,
    endsAt,
    place,
  };
}
function formInput(form: ClubForm): ClubFormInput {
  return {
    year: form.year,
    season: form.season,
    kind: form.kind,
    fee: form.fee,
    ...(form.feeOnDay === true ? { feeOnDay: true } : {}),
    ...(form.capacity !== undefined ? { capacity: form.capacity } : {}),
    deadline: form.deadline,
    eventName: form.eventName,
    ...(form.autoEventName === true ? { autoEventName: true } : {}),
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    place: form.place,
  };
}
export function clubFormsView(actorId: string) {
  executive(actorId);
  const data = readClubForms();
  const activeSheets = activeClubFormSheets();
  return {
    ok: true,
    configured: clubFormsConfigured(),
    forms: data.forms
      .filter((form) => !form.deletedAt)
      .slice()
      .reverse()
      .map((form) => ({
        ...form,
        deleteBlockedReason:
          form.remote && activeSheets.has(form.remote.spreadsheetId)
            ? "現在の名簿に使用中です。参照先を切り替えると削除できます。"
            : "",
      })),
    operations: data.operations
      .filter((job) => job.status !== "done" && job.status !== "cancelled")
      .map(({ id, formId, action, status, attempts, error }) => ({
        id,
        formId,
        action,
        status,
        attempts,
        error,
      })),
  };
}

export async function clubFormAction(actorId: string, value: unknown) {
  executive(actorId);
  const raw = object(value);
  if (raw.action === "health") {
    const health = await postClubForms({ action: "health" });
    return {
      ok: true,
      ready: health.triggerReady === true,
      owner: health.owner,
    };
  }
  if (raw.action === "refresh") {
    const id = uuid(raw.id);
    const form = readClubForms().forms.find((form) => form.id === id);
    if (
      !form?.remote ||
      form.delivery !== "done" ||
      form.deleteRequestedAt ||
      form.deletedAt
    )
      throw new ClubFormsError("Googleへの保存完了後に確認してください。", 409);
    await refreshClubFormStatuses(id);
    if (readClubForms().forms.find((form) => form.id === id)?.statusError)
      throw new ClubFormsError(
        "Googleの準備状態を確認できません。時間をおいて再試行してください。",
        503,
      );
    return { ok: true, id };
  }
  if (!clubFormsConfigured())
    throw new ClubFormsError(
      "Googleフォーム連携が未設定です。管理者が連携を設定してください。",
      503,
    );
  const result = await withStoreLock("auth", () =>
    withStoreLock("member-activities", () =>
      withStoreLock("club-forms", () => {
        executive(actorId);
        const data = readClubForms(),
          now = new Date().toISOString();
        if (raw.action === "retry") {
          const form = data.forms.find((form) => form.id === raw.id);
          if (!form || form.deletedAt)
            throw new ClubFormsError("フォームが見つかりません。", 404);
          const job = data.operations.find(
            (job) =>
              job.formId === form.id &&
              job.revision === form.revision &&
              job.status === "error",
          );
          if (!job) return { ok: true, id: form.id };
          job.status = "pending";
          job.attempts = 0;
          job.nextAttemptAt = 0;
          delete job.error;
          form.delivery = "pending";
          writeData(FILE, data);
          return { ok: true, id: form.id };
        }
        if (
          !["create", "update", "open", "close", "delete"].includes(
            String(raw.action),
          )
        )
          throw new ClubFormsError("操作を確認してください。");
        if (raw.action === "delete" && raw.confirm !== true)
          throw new ClubFormsError(
            "削除するフォームと回答シートを確認してください。",
          );
        const action = raw.action as ClubFormOperation["action"],
          operationId = uuid(raw.operationId),
          id = uuid(raw.id);
        const old = data.forms.find((form) => form.id === id);
        const input =
          action === "create" || action === "update"
            ? validateClubForm(raw.input)
            : old && action === "delete"
              ? formInput(old)
              : old
                ? validateClubForm({
                    ...formInput(old),
                    ...(action === "open" ? { deadline: raw.deadline } : {}),
                  })
                : null;
        if (!input) throw new ClubFormsError("フォームが見つかりません。", 404);
        const replay = data.operations.find((job) => job.id === operationId);
        if (replay) {
          if (
            replay.formId !== id ||
            replay.action !== action ||
            JSON.stringify(replay.input) !== JSON.stringify(input)
          )
            throw new ClubFormsError(
              "同じ操作番号に異なる内容が指定されています。",
              409,
            );
          return { ok: true, id };
        }
        if (action === "create" && old)
          throw new ClubFormsError(
            "作成済みのフォームです。一覧から確認してください。",
            409,
          );
        if (action !== "create" && !old)
          throw new ClubFormsError("フォームが見つかりません。", 404);
        if (old?.deletedAt || old?.deleteRequestedAt)
          throw new ClubFormsError(
            "このフォームは削除済み、または削除処理中です。",
            409,
          );
        if (old && old.revision !== raw.revision)
          throw new ClubFormsError(
            "別の画面で更新されています。再読み込みしてください。",
            409,
          );
        if (old && old.delivery !== "done" && action !== "delete")
          throw new ClubFormsError(
            "直前のGoogle連携が未完了です。完了を待つか、再試行してください。",
            409,
          );
        if (action === "delete") {
          if (
            old!.remote &&
            activeClubFormSheets().has(old!.remote!.spreadsheetId)
          )
            throw new ClubFormsError(
              "現在の名簿に使用中のフォームです。先に名簿の参照先を切り替えてください。",
              409,
            );
          for (const job of data.operations.filter(
            (job) =>
              job.formId === id &&
              job.status !== "done" &&
              job.status !== "cancelled",
          )) {
            job.status = "cancelled";
            delete job.leaseToken;
            delete job.leaseUntil;
          }
          old!.deleteRequestedAt = now;
          old!.revision++;
          old!.updatedAt = now;
          old!.delivery = "pending";
          old!.desiredState = "closed";
          delete old!.statusError;
          data.operations.push({
            id: operationId,
            formId: id,
            revision: old!.revision,
            actorId,
            action,
            input,
            desiredState: "closed",
            status: "pending",
            attempts: 0,
            nextAttemptAt: 0,
          });
          writeData(FILE, data);
          return { ok: true, id };
        }
        if (
          old &&
          (old.year !== input.year ||
            old.season !== input.season ||
            old.kind !== input.kind)
        )
          throw new ClubFormsError(
            "西暦・春秋・種類を変える場合は、新しいフォームを作成してください。",
          );
        const existingState =
          old?.state === "open" && Date.parse(old.deadline) <= Date.now()
            ? "closed"
            : old?.state;
        const desiredState =
          action === "create"
            ? "draft"
            : action === "open"
              ? "open"
              : action === "close"
                ? "closed"
                : existingState!;
        if (desiredState === "open" && Date.parse(input.deadline) <= Date.now())
          throw new ClubFormsError(
            "受付開始・再開には未来の期限を指定してください。",
          );
        const form: ClubForm = old ?? {
          ...input,
          id,
          revision: 0,
          state: "draft",
          desiredState: "draft",
          actorId,
          createdAt: now,
          updatedAt: now,
          delivery: "pending",
        };
        Object.assign(form, input, {
          revision: form.revision + 1,
          desiredState,
          updatedAt: now,
          delivery: "pending",
        });
        if (input.feeOnDay !== true) delete form.feeOnDay;
        if (input.capacity === undefined) delete form.capacity;
        if (input.autoEventName !== true) delete form.autoEventName;
        if (!old) data.forms.push(form);
        data.operations.push({
          id: operationId,
          formId: id,
          revision: form.revision,
          actorId,
          action,
          input,
          desiredState,
          status: "pending",
          attempts: 0,
          nextAttemptAt: 0,
        });
        writeData(FILE, data);
        return { ok: true, id };
      }),
    ),
  );
  await audit(actorId, `club-forms.${String(raw.action)}`, result.id).catch(
    () => console.error("[club-forms] audit failed"),
  );
  return result;
}

export function checkedClubFormRemote(
  value: unknown,
  revision: number,
): ClubFormRemote {
  const row = object(value);
  if (
    !googleFileId(row.formId) ||
    !googleFileId(row.spreadsheetId) ||
    !Number.isSafeInteger(row.sheetId) ||
    Number(row.sheetId) < 0 ||
    row.revision !== revision ||
    !["draft", "open", "closed"].includes(String(row.state)) ||
    !googleUrl(row.editUrl, "form") ||
    !googleUrl(row.responseUrl, "form") ||
    !googleUrl(row.spreadsheetUrl, "sheet") ||
    !googleUrl(row.folderUrl, "folder") ||
    (row.mergedSpreadsheetUrl !== undefined &&
      !googleUrl(row.mergedSpreadsheetUrl, "sheet")) ||
    (row.uploadRequired !== undefined &&
      typeof row.uploadRequired !== "boolean") ||
    (row.uploadReady !== undefined && typeof row.uploadReady !== "boolean") ||
    (row.responseCount !== undefined &&
      (!Number.isSafeInteger(row.responseCount) ||
        Number(row.responseCount) < 0)) ||
    (row.closedReason !== undefined &&
      !["manual", "deadline", "capacity", "upload_setup"].includes(
        String(row.closedReason),
      )) ||
    (row.state === "open" && row.uploadReady === false)
  )
    throw new Error("Googleの保存結果を確認できませんでした。");
  if (
    new URL(String(row.editUrl)).pathname !== `/forms/d/${row.formId}/edit` ||
    new URL(String(row.spreadsheetUrl)).pathname !==
      `/spreadsheets/d/${row.spreadsheetId}/edit`
  )
    throw new Error("Googleの保存先が一致しません。");
  return row as unknown as ClubFormRemote;
}

export async function drainClubFormOperations(
  limit = 2,
  shouldStop = () => false,
) {
  let attempted = 0,
    completed = 0;
  if (!clubFormsConfigured()) return { attempted, completed };
  for (let n = 0; n < limit && !shouldStop(); n++) {
    const job = await withStoreLock("club-forms", () => {
      const data = readClubForms(),
        now = Date.now();
      const job = data.operations.find(
        (job) =>
          (job.status === "pending" && job.nextAttemptAt <= now) ||
          (job.status === "processing" && (job.leaseUntil ?? 0) < now),
      );
      if (!job) return null;
      job.status = "processing";
      job.attempts++;
      job.leaseUntil = now + 90_000;
      job.leaseToken = crypto.randomUUID();
      writeData(FILE, data);
      return structuredClone(job);
    });
    if (!job) break;
    attempted++;
    let remote: ClubFormRemote | undefined,
      deleted = false,
      error = "";
    try {
      if (job.action === "delete") {
        const result = await postClubForms({
          action: "form.delete",
          id: job.formId,
          operationId: job.id,
          revision: job.revision,
        });
        if (
          result.deleted !== true ||
          result.id !== job.formId ||
          result.revision !== job.revision
        )
          throw new Error("Googleの削除結果を確認できませんでした。");
        deleted = true;
      } else {
        const result = await postClubForms({
          action: "form.mutate",
          id: job.formId,
          operationId: job.id,
          revision: job.revision,
          operation: job.action,
          input: job.input,
          desiredState: job.desiredState,
        });
        remote = checkedClubFormRemote(result.form, job.revision);
      }
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure.message.slice(0, 300)
          : "Google連携を再試行してください。";
    }
    await withStoreLock("club-forms", () => {
      const data = readClubForms(),
        current = data.operations.find((item) => item.id === job.id);
      if (!current || current.leaseToken !== job.leaseToken) return;
      delete current.leaseToken;
      delete current.leaseUntil;
      const form = data.forms.find(
        (item) => item.id === job.formId && item.revision === job.revision,
      );
      if (remote || deleted) {
        current.status = "done";
        delete current.error;
        completed++;
        if (form) {
          if (remote) {
            form.remote = remote;
            form.state = remote.state;
          }
          if (deleted) {
            form.deletedAt = new Date().toISOString();
            form.state = "closed";
            form.desiredState = "closed";
          }
          form.delivery = "done";
          form.checkedAt = new Date().toISOString();
          delete form.statusError;
        }
      } else {
        current.status = current.attempts >= 8 ? "error" : "pending";
        current.error = error;
        current.nextAttemptAt =
          Date.now() +
          Math.min(3600_000, 30_000 * 2 ** Math.min(7, current.attempts - 1));
        if (form)
          form.delivery = current.status === "error" ? "error" : "pending";
      }
      writeData(FILE, data);
    });
  }
  return { attempted, completed };
}

export async function refreshClubFormStatuses(id?: string) {
  if (!clubFormsConfigured()) return 0;
  const forms = readClubForms()
    .forms.filter(
      (form) =>
        form.delivery === "done" &&
        !form.deleteRequestedAt &&
        !form.deletedAt &&
        form.remote &&
        (!id || form.id === id) &&
        (id ||
          !form.checkedAt ||
          Date.parse(form.checkedAt) + 60_000 < Date.now()),
    )
    .slice(0, 10);
  if (!forms.length) return 0;
  let results: any[] = [],
    error = "";
  try {
    const result = await postClubForms({
      action: "forms.status",
      ids: forms.map((form) => form.id),
    });
    if (!Array.isArray(result.forms) || result.forms.length !== forms.length)
      throw new Error();
    results = result.forms;
  } catch {
    error = "Googleの受付状態を確認できません。時間をおいて再確認します。";
  }
  await withStoreLock("club-forms", () => {
    const data = readClubForms();
    for (const before of forms) {
      const form = data.forms.find(
        (form) =>
          form.id === before.id &&
          form.revision === before.revision &&
          form.delivery === "done",
      );
      if (!form) continue;
      try {
        if (error) throw new Error(error);
        const result = results.find((result) => result.id === form.id);
        if (!result) throw new Error();
        form.remote = checkedClubFormRemote(result, form.revision);
        form.state = form.remote.state;
        delete form.statusError;
      } catch {
        form.statusError =
          "Googleの受付状態を確認できません。時間をおいて再確認します。";
      }
      form.checkedAt = new Date().toISOString();
    }
    writeData(FILE, data);
  });
  return forms.length;
}
