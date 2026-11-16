import { deadlinePassed } from './advisoryWarnings.ts';
import { isMemberAccount, isSiteManagement } from "./accountVisibility.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import { readData, writeData, withStoreLock, dataPath } from "./store.ts";
import { readUsers, type User } from "./auth.ts";
import { accountRole, isStaff, isExecutive, hasRole } from "./roles.ts";
import { audit } from "./audit.ts";
import { readActivities } from "./activities.ts";
import {
  defaultToolSettings,
  defaultToolPublication,
  toolLabels,
  type MemberTool,
  type ToolKind,
  type ToolOption,
  type ToolPublication,
  type ToolResults,
} from "./memberToolTypes.ts";

export class ToolError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function toolId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ToolError("見つかりません。", 404);
  return id;
}
const filename = (id: string) => `member-tool-${toolId(id)}.json`;
function storedToolIds(): string[] {
  const value = readData<{ version: number; ids: string[] }>(
    "member-tools-index.json",
    { version: 1, ids: [] },
  );
  if (
    value.version !== 1 ||
    !Array.isArray(value.ids) ||
    value.ids.some(
      (id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id),
    )
  )
    throw new Error("通知ツールの一覧を読み取れません。");
  return value.ids;
}
export function listTools(): MemberTool[] {
  return storedToolIds().flatMap((id) => {
    const t = findTool(id);
    return t ? [t] : [];
  });
}
export function toolIds(): string[] {
  return listTools().map((t) => t.id);
}
export function readTool(id: string): MemberTool {
  const t = readData<(MemberTool & { deletedAt?: string }) | null>(
    filename(id),
    null,
  );
  if (!t || t.deletedAt) throw new ToolError("見つかりません。", 404);
  if (
    t.version !== 1 ||
    t.id !== id ||
    !Object.hasOwn(toolLabels, t.kind) ||
    !Array.isArray(t.responses) ||
    !Array.isArray(t.options) ||
    !Array.isArray(t.assets) ||
    !t.publication ||
    !t.settings
  )
    throw new Error("通知ツールのデータを読み取れません。");
  return t;
}
/** A tool can disappear between enumeration and acquiring its lock. */
export function findTool(id: string): MemberTool | null {
  try {
    return readTool(id);
  } catch (e) {
    if (e instanceof ToolError && e.status === 404) return null;
    throw e;
  }
}

type ToolDeletion = {
  version: 1;
  id: string;
  deletedAt: string;
  assetIds: string[];
  noticeIds: string[];
};
// The caller holds the tool lock. A content-free marker makes interrupted
// deletions inaccessible immediately and lets the notification worker finish.
async function finishToolDeletion(id: string, deleted: ToolDeletion | null) {
  if (deleted) {
    await withStoreLock("member-activities", () => {
      const data = readActivities();
      const noticeIds = new Set([
        ...deleted.noticeIds,
        ...data.notifications.filter((n) => n.toolId === id).map((n) => n.id),
      ]);
      data.notifications = data.notifications.filter(
        (n) => !noticeIds.has(n.id),
      );
      if (data.push)
        data.push.jobs = data.push.jobs.filter(
          (j) => !noticeIds.has(j.noticeId),
        );
      writeData("member-activities.json", data);
    });
    for (const assetId of deleted.assetIds)
      fs.rmSync(dataPath(`member-tool-asset-${toolId(assetId)}.bin`), {
        force: true,
      });
  }
  await withStoreLock("member-tools-index", () => {
    // Remove the record before its index entry so interrupted cleanup is retryable.
    fs.rmSync(dataPath(filename(id)), { force: true });
    writeData("member-tools-index.json", {
      version: 1,
      ids: storedToolIds().filter((value) => value !== id),
    });
  });
}
export async function deleteTool(id: string, user: User, input: unknown) {
  const actor = readUsers().find((u) => u.id === user?.id);
  if (!isStaff(actor)) throw new ToolError("運営以上の権限が必要です。", 403);
  const p = input as { confirmation?: unknown; revision?: unknown } | null;
  if (!p || p.confirmation !== "delete")
    throw new ToolError("ツールの削除を確認してください。");
  return withStoreLock(`member-tool-${toolId(id)}`, async () => {
    const record = readData<(MemberTool & Partial<ToolDeletion>) | null>(
      filename(id),
      null,
    );
    if (record?.deletedAt) {
      await finishToolDeletion(id, record as ToolDeletion);
      return;
    }
    const t = readTool(id);
    if (p.revision !== t.revision)
      throw new ToolError(
        "別の操作で内容が更新されました。再読み込みして確認してください。",
        409,
      );
    const deleted: ToolDeletion = {
      version: 1,
      id,
      deletedAt: new Date().toISOString(),
      assetIds: t.assets.map((a) => a.id),
      noticeIds: t.outbox ? [t.outbox.id] : [],
    };
    await audit(actor!.id, "tool.delete", id);
    writeData(filename(id), deleted);
    await finishToolDeletion(id, deleted);
  });
}
export async function cleanupDeletedTools() {
  for (const id of storedToolIds()) {
    const record = readData<Partial<ToolDeletion> | null>(filename(id), null);
    if (record && !record.deletedAt) continue;
    await withStoreLock(`member-tool-${id}`, async () => {
      const fresh = readData<Partial<ToolDeletion> | null>(filename(id), null);
      if (!fresh || fresh.deletedAt)
        await finishToolDeletion(id, fresh as ToolDeletion | null);
    });
  }
}
export function manageResults(t: MemberTool, user?: User | null) {
  return (
    isExecutive(user) ||
    (isStaff(user) && (t.creatorRole === "staff" || t.settings.staffResults))
  );
}
export function revealIdentity(t: MemberTool, user?: User | null) {
  return (
    manageResults(t, user) && (isExecutive(user) || t.settings.staffIdentity)
  );
}
export function receptionOpen(t: MemberTool, _now = Date.now()) {
  return (
    t.status === "published" &&
    !t.closed
  );
}
export function recipient(t: MemberTool, user?: User | null) {
  return Boolean(user?.approved && t.recipientIds.includes(user.id));
}
export function viewQuestion(t: MemberTool, user?: User | null) {
  return (
    isStaff(user) ||
    (t.status === "published" &&
      (t.settings.publicQuestion || recipient(t, user)))
  );
}
export function publicationOpen(
  t: MemberTool,
  user?: User | null,
  now = Date.now(),
) {
  const p = t.publication;
  if (
    !user?.approved ||
    t.status !== "published" ||
    p.paused ||
    (p.endsAt && Date.parse(p.endsAt) <= now)
  )
    return false;
  const audience =
    p.audience === "all"
      ? true
      : p.audience === "selected"
        ? p.memberIds.includes(user.id)
        : p.audience === "recipients"
          ? recipient(t, user)
          : hasRole(user, p.audience);
  if (!audience) return false;
  if (p.start === "answered")
    return t.responses.some((r) => r.userId === user.id);
  if (p.start === "closed") return t.closed || deadlinePassed(t.settings.endsAt,now);
  if (p.start === "date") return Date.parse(p.startsAt) <= now;
  return true;
}
export function canReadResults(
  t: MemberTool,
  user?: User | null,
  now = Date.now(),
) {
  return manageResults(t, user) || publicationOpen(t, user, now);
}
export function resultsFor(
  t: MemberTool,
  user?: User | null,
  now = Date.now(),
): ToolResults {
  if (!canReadResults(t, user, now))
    throw new ToolError("結果は現在公開されていません。", 403);
  const users = readUsers();
  const active = new Set(t.options.filter((o) => !o.removed).map((o) => o.id));
  const rows = t.responses.filter(
    (r) =>
      t.kind !== "box" ||
      manageResults(t, user) ||
      t.publication.boxMode === "all" ||
      t.publication.responseIds.includes(r.id),
  );
  return {
    kind: t.kind,
    question: t.question,
    options: t.options.filter((o) => !o.removed),
    recipientCount: t.recipientIds.length,
    respondentCount: new Set(rows.map((r) => r.userId)).size,
    responses: rows.map(({ userId, ...r }) => ({
      ...r,
      choices: r.choices.filter((id) => active.has(id)),
      dates: Object.fromEntries(
        Object.entries(r.dates).filter(([id]) => active.has(id)),
      ),
      name: r.anonymous
        ? "匿名"
        : users.find((u) => u.id === userId)?.name || "退会したメンバー",
    })),
  };
}
export function questionFor(t: MemberTool, user?: User | null) {
  // Box publication can target approved members outside the original respondent list.
  if (!viewQuestion(t, user) && !publicationOpen(t, user))
    throw new ToolError(
      user ? "閲覧する権限がありません。" : "ログインが必要です。",
      user ? 403 : 401,
    );
  const manager = isStaff(user);
  return {
    id: t.id,
    revision: t.revision,
    answerRevision: t.answerRevision,
    kind: t.kind,
    question: t.question,
    status: t.status,
    closed: t.closed,
    options: t.options.filter((o) => !o.removed),
    settings: {
      endsAt: t.settings.endsAt,
      multiple: t.settings.multiple,
      anonymous: t.settings.anonymous,
      allowOptions: t.settings.allowOptions,
      publicQuestion: t.settings.publicQuestion,
    },
    open: receptionOpen(t),
    overdue:receptionOpen(t)&&deadlinePassed(t.settings.endsAt),
    canAnswer: recipient(t, user),
    canEdit: manager,
    canManageResults: manageResults(t, user),
    canReveal: revealIdentity(t, user),
    canSeeResults: canReadResults(t, user),
    own: user?.approved
      ? t.responses
          .filter((r) => r.userId === user.id)
          .map(({ userId, ...r }) => ({
            ...r,
            needsRevision: r.choices.some(
              (id) => !t.options.some((o) => o.id === id && !o.removed),
            ),
          }))
      : [],
    boxPublication:
      t.kind === "box"
        ? {
            audience: t.publication.audience,
            mode: t.publication.boxMode,
            paused: t.publication.paused,
            selectedCount: t.publication.memberIds.length,
          }
        : undefined,
    ...(manager
      ? {
          recipientIds: t.recipientIds,
          managementSettings: {
            staffResults: t.settings.staffResults,
            staffIdentity: t.settings.staffIdentity,
          },
          canSetManagement: isExecutive(user),
        }
      : {}),
    ...(manageResults(t, user) ? { publication: t.publication } : {}),
  };
}
function text(v: unknown, label: string, max: number, empty = false) {
  if (typeof v !== "string" || v.length > max || (!empty && !v.trim()))
    throw new ToolError(`${label}を${max}文字以内で入力してください。`);
  return v.trim();
}
function strings(v: unknown, max = 2000): string[] {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    v.some((x) => typeof x !== "string" || x.length > 100)
  )
    throw new ToolError("選択内容を確認してください。");
  return [...new Set(v)];
}
function date(v: unknown) {
  if (v === "" || v == null) return "";
  if (
    typeof v !== "string" ||
    v.length > 40 ||
    !/(Z|[+-]\d\d:\d\d)$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new ToolError("日時を確認してください。");
  return new Date(v).toISOString();
}
const approvedIds = (value: unknown) => {
  const hidden = new Set(readUsers().filter(isSiteManagement).map(user => user.id));
  const ids = strings(value).filter(id => !hidden.has(id));
  const valid = new Set(
    readUsers()
      .filter(isMemberAccount)
      .map((u) => u.id),
  );
  if (ids.some((id) => !valid.has(id)))
    throw new ToolError("通知先に無効なアカウントがあります。");
  return ids;
};
function options(t: MemberTool, input: unknown): ToolOption[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new ToolError("選択肢は100件以内にしてください。");
  const seen = new Set<string>();
  const next = input.map((v) => {
    if (!v || typeof v !== "object")
      throw new ToolError("選択肢を確認してください。");
    let id =
      typeof v.id === "string" &&
      t.options.some((o) => o.id === v.id && !o.removed)
        ? v.id
        : crypto.randomUUID();
    if (seen.has(id)) throw new ToolError("選択肢が重複しています。");
    seen.add(id);
    const o: ToolOption = {
      id,
      text: text(v.text ?? "", "選択肢", 300, t.kind === "schedule"),
    };
    if (t.kind === "poll" && v.imageId) {
      const a = t.assets.find(
        (a) =>
          a.id === v.imageId &&
          a.purpose === "option" &&
          a.mime.startsWith("image/"),
      );
      if (!a) throw new ToolError("画像を選び直してください。");
      o.imageId = a.id;
    }
    if (t.kind === "schedule") {
      o.date = text(v.date, "候補日", 10);
      if (
        !/^\d{4}-\d\d-\d\d$/.test(o.date) ||
        !Number.isFinite(Date.parse(`${o.date}T00:00:00Z`)) ||
        new Date(`${o.date}T00:00:00Z`).toISOString().slice(0, 10) !== o.date
      )
        throw new ToolError("候補日を確認してください。");
      for (const key of ["start", "end"] as const)
        if (v[key]) {
          o[key] = text(v[key], "時間", 5);
          if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(o[key]!))
            throw new ToolError("時間を確認してください。");
        }
      if (o.start && o.end && o.end <= o.start)
        throw new ToolError("終了時刻は開始時刻より後にしてください。");
    }
    return o;
  });
  if (t.kind !== "box" && !next.length)
    throw new ToolError("選択肢を一つ以上追加してください。");
  return [
    ...next,
    ...t.options
      .filter((o) => !seen.has(o.id))
      .map((o) => ({ ...o, removed: true })),
  ];
}
function publication(t: MemberTool, input: any): ToolPublication {
  if (
    !input ||
    !["recipients", "staff", "executive", "admin", "all", "selected"].includes(
      input.audience,
    ) ||
    !["always", "answered", "closed", "date"].includes(input.start)
  )
    throw new ToolError("結果の公開設定を確認してください。");
  if (t.kind !== "box" && ["all", "selected"].includes(input.audience))
    throw new ToolError("結果の公開先を確認してください。");
  const p: ToolPublication = {
    audience: input.audience,
    memberIds:
      input.audience === "selected" ? approvedIds(input.memberIds) : [],
    start: input.start,
    startsAt: date(input.startsAt),
    endsAt: date(input.endsAt),
    paused: input.paused === true,
    boxMode: input.boxMode === "all" ? "all" : "selected",
    responseIds: strings(input.responseIds ?? []),
  };
  if (p.start === "date" && !p.startsAt)
    throw new ToolError("結果の公開開始日時を指定してください。");
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt)
    throw new ToolError("公開終了は開始日時より後にしてください。");
  if (p.responseIds.some((id) => !t.responses.some((r) => r.id === id)))
    throw new ToolError("公開する投稿を選び直してください。");
  return p;
}
export async function createTool(user: User, kind: ToolKind) {
  if (!isStaff(user)) throw new ToolError("運営以上の権限が必要です。", 403);
  if (!Object.hasOwn(toolLabels, kind))
    throw new ToolError("種類を確認してください。");
  return withStoreLock("member-tools-index", () => {
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    const t: MemberTool = {
      version: 1,
      id,
      revision: 1,
      answerRevision: 1,
      kind,
      question: "",
      creatorId: user.id,
      creatorRole: accountRole(user),
      createdAt: now,
      updatedAt: now,
      status: "draft",
      closed: false,
      recipientIds: [],
      options: [],
      settings: defaultToolSettings(),
      publication: defaultToolPublication(kind),
      responses: [],
      assets: [],
    };
    writeData(filename(id), t);
    writeData("member-tools-index.json", {
      version: 1,
      ids: [...toolIds(), id],
    });
    return t;
  });
}
export async function toolAction(id: string, user: User, p: any) {
  if (
    !user?.approved ||
    !readUsers().some((u) => u.id === user.id && u.approved)
  )
    throw new ToolError("ログインが必要です。", 401);
  if (!p || typeof p !== "object")
    throw new ToolError("入力形式を確認してください。");
  return withStoreLock(`member-tool-${toolId(id)}`, async () => {
    const t = readTool(id),
      now = new Date().toISOString();
    const management = [
      "save",
      "publish",
      "reception",
      "publication",
      "permissions",
    ].includes(p.action);
    if (management && !isStaff(user))
      throw new ToolError("運営以上の権限が必要です。", 403);
    if (management && p.revision !== t.revision)
      throw new ToolError(
        "別の操作で内容が更新されました。再読み込みして確認してください。",
        409,
      );
    if (p.action === "save") {
      t.question = text(p.question, "質問", 10000);
      t.recipientIds = approvedIds(p.recipientIds);
      if (t.kind !== "box") t.options = options(t, p.options);
      const s = p.settings;
      if (!s || typeof s !== "object")
        throw new ToolError("設定を確認してください。");
      Object.assign(t.settings, {
        endsAt: date(s.endsAt),
        multiple: s.multiple === true,
        anonymous: s.anonymous === true,
        allowOptions: s.allowOptions === true,
        publicQuestion: s.publicQuestion === true,
      });
    } else if (p.action === "publish") {
      if (
        !t.question ||
        !t.recipientIds.length ||
        (t.kind !== "box" && !t.options.some((o) => !o.removed))
      )
        throw new ToolError("質問・通知先・選択肢を保存してください。");
      if (t.status === "draft") {
        t.status = "published";
        t.closed = false;
        t.outbox = {
          id: crypto.randomUUID(),
          senderId: user.id,
          senderName: user.name,
          createdAt: now,
          recipientIds: [...t.recipientIds],
        };
      }
    } else if (p.action === "reception") {
      t.closed = p.closed === true;
    } else if (p.action === "publication") {
      if (!manageResults(t, user))
        throw new ToolError("結果の管理権限が必要です。", 403);
      t.publication = publication(t, p.publication);
    } else if (p.action === "permissions") {
      if (!isExecutive(user))
        throw new ToolError("幹部以上の権限が必要です。", 403);
      t.settings.staffResults = p.staffResults === true;
      t.settings.staffIdentity = p.staffIdentity === true;
      await audit(user.id, "tool.permissions", t.id);
    } else if (p.action === "add-option") {
      if (p.answerRevision !== t.answerRevision)
        throw new ToolError(
          "質問の設定が更新されました。再読み込みして確認してください。",
          409,
        );
      if (
        !recipient(t, user) ||
        !receptionOpen(t) ||
        !t.settings.allowOptions ||
        t.kind === "box"
      )
        throw new ToolError("選択肢を追加できません。", 403);
      if (
        p.option?.imageId &&
        !t.assets.some(
          (a) => a.id === p.option.imageId && a.ownerId === user.id,
        )
      )
        throw new ToolError("自分で追加した画像を選んでください。", 403);
      t.options = options(t, [
        ...t.options.filter((o) => !o.removed),
        p.option,
      ]);
    } else if (p.action === "respond" || p.action === "withdraw") {
      if (p.answerRevision !== t.answerRevision)
        throw new ToolError(
          "質問や受付の設定が更新されました。入力内容を控えて再読み込みし、設定を確認してください。",
          409,
        );
      if (!recipient(t, user) || !receptionOpen(t))
        throw new ToolError("現在は回答を受け付けていません。", 403);
      const existing = p.responseId
        ? t.responses.find((r) => r.id === p.responseId && r.userId === user.id)
        : t.kind === "box"
          ? undefined
          : t.responses.find((r) => r.userId === user.id);
      if ((p.responseRevision ?? 0) !== (existing?.revision ?? 0))
        throw new ToolError(
          "この回答は別の画面で更新されています。再読み込みして確認してください。",
          409,
        );
      if (p.responseId && !existing)
        throw new ToolError("回答が見つかりません。", 404);
      if (p.action === "withdraw") {
        if (!existing) throw new ToolError("回答が見つかりません。", 404);
        t.responses = t.responses.filter((r) => r !== existing);
        t.publication.responseIds = t.publication.responseIds.filter(
          (id) => id !== existing.id,
        );
      } else {
        if (
          t.kind === "box" &&
          !t.settings.multiple &&
          !existing &&
          t.responses.some((r) => r.userId === user.id)
        )
          throw new ToolError(
            "すでに投稿しています。既存の投稿を編集してください。",
          );
        const active = new Set(
          t.options.filter((o) => !o.removed).map((o) => o.id),
        );
        const choices = t.kind === "poll" ? strings(p.choices, 100) : [];
        if (
          t.kind === "poll" &&
          (!choices.length ||
            choices.some((id) => !active.has(id)) ||
            (!t.settings.multiple && choices.length > 1))
        )
          throw new ToolError("選択肢を選び直してください。");
        const dates: Record<string, "yes" | "maybe" | "no"> = {};
        if (t.kind === "schedule") {
          if (!p.dates || typeof p.dates !== "object" || Array.isArray(p.dates))
            throw new ToolError("候補日への回答を選んでください。");
          for (const [id, value] of Object.entries(p.dates)) {
            if (
              !active.has(id) ||
              !["yes", "maybe", "no"].includes(value as string)
            )
              throw new ToolError("日程の回答を確認してください。");
            dates[id] = value as "yes" | "maybe" | "no";
          }
          if (!Object.keys(dates).length)
            throw new ToolError("一つ以上の候補日に回答してください。");
        }
        const body =
          t.kind === "box" ? text(p.body ?? "", "回答", 20000, true) : "";
        const assetIds = t.kind === "box" ? strings(p.assetIds ?? [], 5) : [];
        if (
          assetIds.some(
            (id) =>
              !t.assets.some(
                (a) =>
                  a.id === id &&
                  a.ownerId === user.id &&
                  a.purpose === "response",
              ),
          )
        )
          throw new ToolError("添付ファイルを選び直してください。");
        if (t.kind === "box" && !body && !assetIds.length)
          throw new ToolError("文章またはファイルを追加してください。");
        const r = {
          id: existing?.id ?? crypto.randomUUID(),
          userId: user.id,
          anonymous: existing?.anonymous || t.settings.anonymous,
          choices,
          dates,
          body,
          assetIds,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          revision: (existing?.revision ?? 0) + 1,
        };
        t.responses = t.responses.filter((x) => x.id !== r.id);
        t.responses.push(r);
        if (
          existing &&
          t.kind === "box" &&
          t.publication.boxMode === "selected"
        )
          t.publication.responseIds = t.publication.responseIds.filter(
            (id) => id !== r.id,
          );
      }
    } else throw new ToolError("操作を確認してください。");
    if (management && p.action !== "permissions")
      await audit(user.id, `tool.${p.action}`, t.id);
    if (management || p.action === "add-option") t.revision++;
    if (["save", "reception", "add-option"].includes(p.action))
      t.answerRevision++;
    t.updatedAt = now;
    writeData(filename(id), t);
    return questionFor(t, user);
  });
}
export async function identityFor(id: string, responseId: string, user: User) {
  const t = readTool(id);
  if (!revealIdentity(t, user))
    throw new ToolError("匿名回答の名前を確認する権限がありません。", 403);
  const r = t.responses.find((r) => r.id === responseId);
  if (!r) throw new ToolError("回答が見つかりません。", 404);
  await audit(user.id, "tool.identity.reveal", `${t.id}:${r.id}`);
  return {
    name:
      readUsers().find((u) => u.id === r.userId)?.name || "退会したメンバー",
  };
}
export async function cleanupToolAccount(userId: string) {
  for (const id of toolIds())
    await withStoreLock(`member-tool-${id}`, () => {
      const t = findTool(id);
      if (!t) return;
      t.responses = t.responses.filter((r) => r.userId !== userId);
      t.recipientIds = t.recipientIds.filter((id) => id !== userId);
      t.publication.memberIds = t.publication.memberIds.filter(
        (id) => id !== userId,
      );
      t.publication.responseIds = t.publication.responseIds.filter((id) =>
        t.responses.some((r) => r.id === id),
      );
      if (t.creatorId === userId) t.creatorId = "deleted";
      if (t.outbox) {
        t.outbox.recipientIds = t.outbox.recipientIds.filter(
          (id) => id !== userId,
        );
        if (t.outbox.senderId === userId) {
          t.outbox.senderId = "deleted";
          t.outbox.senderName = "退会したメンバー";
        }
      }
      const owned = t.assets.filter((a) => a.ownerId === userId);
      t.assets = t.assets.filter((a) => a.ownerId !== userId);
      for (const o of t.options)
        if (owned.some((a) => a.id === o.imageId)) delete o.imageId;
      t.revision++;
      writeData(filename(id), t);
      for (const a of owned)
        fs.rmSync(dataPath(`member-tool-asset-${a.id}.bin`), { force: true });
    });
}
