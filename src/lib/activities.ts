import { displayName, publishedGroupPeople } from "./groupPresentation.ts";
import { beforeEventDay, deadlinePassed } from './advisoryWarnings.ts';
import { enqueuePushNotice } from "./pushQueue.ts";
import { syncEventReminders } from "./reminderRules.ts";
import crypto from "node:crypto";
import { reconcileRoster } from "./rosterReconciliation.ts";
import { queueRosterPortfolioGrades } from "./portfolioRosterGrade.ts";
import { ACTIVITY_HTML_LIMIT, ACTIVITY_TEXT_LIMIT, isActivityHeaderImage } from "./activityPresentation.ts";
import { activityRichTextPlain } from "./activityRichText.ts";
import { sanitizePortfolioIntroduction } from "./portfolioIntroduction.ts";
import { readUsers, isStaff, isExecutive, type User } from "./auth.ts";
import {
  fetchActivityRoster,
  activityRosterSource,
  applyRosterProfiles,
} from "./activityRoster.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { audit } from "./audit.ts";
import { isMemberAccount, isSiteManagement } from "./accountVisibility.ts";
import {
  emptyActivities,
  defaultRules,
  voteLabels,
  eventCategoryLabels,
  type EventCategory,
  type ActivityStore,
  type ActivityEvent,
  type GroupRules,
  type Group,
  type Participant,
  type Vote,
} from "./activityTypes.ts";
import {
  generateGroups,
  groupPairs,
  groupScore,
  validateGroups,
} from "./grouping.ts";

export class ActivityError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const file = "member-activities.json";
export async function removeExhibitionNotices(exhibitionId: string) {
  return withStoreLock("member-activities",()=>{const data=readActivities();data.notifications=data.notifications.filter(n=>n.exhibitionId!==exhibitionId);writeData(file,data);});
}
/** Dispatches an already authorized, persisted exhibition notification outbox entry. */
export async function appendExhibitionNotice(notice: import("./exhibitionTypes.ts").ExhibitionNotice) {
  return withStoreLock("member-activities", () => {
    const data = readActivities();
    if (data.deletedNotificationIds?.includes(notice.id)) return;
    const existing = data.notifications.find(n => n.id === notice.id);
    if (existing) {
      if (existing.exhibitionId !== notice.exhibitionId) throw new ActivityError("通知IDが重複しています。", 409);
      return;
    }
    const notification = { id: notice.id, exhibitionId: notice.exhibitionId, title: notice.title, body: notice.body, senderId: notice.senderId, senderName: notice.senderName, recipientIds: [...notice.recipientIds], createdAt: notice.createdAt, readBy: {}, kind: notice.kind === "exhibition-shift" ? "exhibition-shift" as const : "exhibition" as const };
    data.notifications.push(notification);
    enqueuePushNotice(data, notification);
    writeData(file, data);
  });
}
export function readActivities(): ActivityStore {
  const data = readData<ActivityStore>(file, emptyActivities());
  if (
    data.version !== 1 ||
    !Array.isArray(data.events) ||
    !Array.isArray(data.notifications) ||
    !data.profiles ||
    typeof data.profiles !== "object"
  )
    throw new Error(
      "企画データの形式が正しくありません。バックアップを確認してください。",
    );
  return data;
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ActivityError("入力形式を確認してください。");
  return input as Record<string, unknown>;
}
function text(
  input: unknown,
  name: string,
  max = 200,
  required = true,
): string {
  if (
    typeof input !== "string" ||
    input.length > max ||
    (required && !input.trim())
  )
    throw new ActivityError(`${name}を${max}文字以内で入力してください。`);
  return input.trim();
}
function strings(input: unknown, max = 1000): string[] {
  if (
    !Array.isArray(input) ||
    input.length > max ||
    input.some((s) => typeof s !== "string" || s.length > 128)
  )
    throw new ActivityError("対象メンバーの指定を確認してください。");
  return input as string[];
}
function activityText(input: unknown, html: unknown, label: string, required = true) {
  if (html === undefined) return { text: text(input, label, ACTIVITY_TEXT_LIMIT, required), html: undefined };
  if (typeof html !== "string" || html.length > ACTIVITY_HTML_LIMIT)
    throw new ActivityError(`${label}の文章や装飾を減らしてください。`);
  const clean = sanitizePortfolioIntroduction(html, true);
  const plain = text(activityRichTextPlain(clean), label, ACTIVITY_TEXT_LIMIT, required);
  return { text: plain, html: plain ? clean : undefined };
}
function date(input: unknown, name: string) {
  const value = text(input, name, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ActivityError(`${name}を正しい日時で入力してください。`);
  return new Date(value).toISOString();
}
function activeUser(users: User[], id: string) {
  const user = users.find((u) => u.id === id && u.approved);
  if (!user)
    throw new ActivityError(
      "承認済みのアカウントでログインしてください。",
      401,
    );
  return user;
}
function staff(user: User) {
  if (!isStaff(user))
    throw new ActivityError("運営以上の権限が必要です。", 403);
}
function recipientIds(input: unknown, users: User[]) {
  const hidden = new Set(users.filter(isSiteManagement).map(user => user.id));
  const ids = [...new Set(strings(input))].filter(id => !hidden.has(id));
  if (
    !ids.length ||
    ids.some((id) => !users.some((u) => u.id === id && isMemberAccount(u)))
  )
    throw new ActivityError(
      "通知先は承認済みメンバーを1人以上選択してください。",
    );
  return ids;
}
function eventFor(data: ActivityStore, input: unknown) {
  const event = data.events.find((e) => e.id === input);
  if (!event) throw new ActivityError("企画が見つかりません。", 404);
  return event;
}
function revision(actual: number, expected: unknown) {
  if (actual !== expected)
    throw new ActivityError(
      "ほかの操作で更新されています。入力内容を控えてから再読み込みしてください。",
      409,
    );
}
export function eventPeople(
  data: ActivityStore,
  event: ActivityEvent,
  users: User[],
): Participant[] {
  return users
    .filter(
      (u) =>
        isMemberAccount(u) &&
        !data.roster?.retiredRecords?.some(
          (r) => r.key === data.roster?.bindings[u.id],
        ) &&
        event.recipientIds.includes(u.id) &&
        event.votes[u.id]?.value === "attending",
    )
    .map((u) => ({
      id: u.id,
      name: u.name,
      lineName: data.roster?.records.find(
        (r) => r.key === data.profiles[u.id]?.rosterKey,
      )?.lineName,
      gender: data.profiles[u.id]?.rosterKey
        ? data.profiles[u.id].gender
        : undefined!,
      grade: data.profiles[u.id]?.rosterKey
        ? data.profiles[u.id].grade
        : undefined!,
    }));
}
export function previousEvent(
  data: ActivityStore,
  event: ActivityEvent,
  now = Date.now(),
) {
  return [
    ...data.events,
    ...(data.eventGroupingHistory || []).map((e) => ({
      ...e,
      status: "published",
    })),
  ]
    .filter(
      (e) =>
        e.id !== event.id &&
        e.status === "published" &&
        e.publishedGroups &&
        Date.parse(e.endsAt) <= now &&
        Date.parse(e.startsAt) < Date.parse(event.startsAt),
    )
    .sort(
      (a, b) =>
        b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id),
    )[0];
}
export function groupSource(
  data: ActivityStore,
  event: ActivityEvent,
  users: User[],
  now = Date.now(),
) {
  const people = eventPeople(data, event, users).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const previous = previousEvent(data, event, now);
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        people: people.map(({ lineName, ...p }) => p),
        rules: event.rules,
        previous: previous ? [previous.id, previous.publishedGroups] : null,
      }),
    )
    .digest("hex");
}
function readyForGrouping(
  data: ActivityStore,
  event: ActivityEvent,
  users: User[],
  now: number,
) {
  if (event.status !== "published" || Date.parse(event.deadline) > now)
    throw new ActivityError("投票締切後の公開済み企画で班分けできます。", 409);
  const people = eventPeople(data, event, users);
  const missing = people.filter((p) => !p.gender || !p.grade);
  if (missing.length)
    throw new ActivityError(
      `班分け情報が未登録です：${missing.map((p) => p.name).join("、")}`,
      409,
    );
  return people;
}
function notify(
  data: ActivityStore,
  actor: User,
  recipients: string[],
  title: string,
  body: string,
  now: number,
  eventId?: string,
  id: string = crypto.randomUUID(),
  bodyHtml?: string,
) {
  data.notifications.push({
    id,
    title,
    body,
    ...(bodyHtml ? { bodyHtml } : {}),
    senderId: actor.id,
    senderName: actor.name,
    recipientIds: recipients,
    eventId,
    kind: eventId ? (title.startsWith("中止：") ? "cancellation" : "event") : "announcement",
    createdAt: new Date(now).toISOString(),
    readBy: {},
  });
  return id;
}
export function parseRules(input: unknown): GroupRules {
  const r = object(input);
  const pairs = (v: unknown) => {
    if (!Array.isArray(v) || v.length > 500)
      throw new ActivityError("同班・別班指定は500組以内にしてください。");
    return v.map((x) => {
      const pair = strings(x, 2);
      if (pair.length !== 2 || pair[0] === pair[1])
        throw new ActivityError("同班・別班は異なる2人を選択してください。");
      return pair;
    });
  };
  if (
    ![r.count, r.min, r.max].every(
      (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 200,
    ) ||
    Number(r.min) > Number(r.max)
  )
    throw new ActivityError(
      "班数・人数は1〜200の整数で、下限≦上限にしてください。",
    );
  return {
    count: Number(r.count),
    min: Number(r.min),
    max: Number(r.max),
    leaders: strings(r.leaders, 200),
    together: pairs(r.together),
    apart: pairs(r.apart),
  };
}
export function parseGroups(input: unknown): Group[] {
  if (!Array.isArray(input) || input.length > 200)
    throw new ActivityError("班の指定を確認してください。");
  return input.map((x) => {
    const g = object(x);
    return {
      leaderId: text(g.leaderId, "リーダー", 128),
      memberIds: strings(g.memberIds),
    };
  });
}

// Every write rereads the actor under auth -> activities locks, including generation commit.
async function transaction<T>(
  actorId: string,
  action: (data: ActivityStore, actor: User, users: User[]) => T,
  clock: () => number = Date.now,
) {
  return withStoreLock("auth", () =>
    withStoreLock("member-activities", () => {
      const users = readUsers(),
        actor = activeUser(users, actorId),
        data = readActivities();
      const existing = new Set(data.notifications.map(n => n.id));
      const result = action(data, actor, users);
      for (const notice of data.notifications) if (!existing.has(notice.id)) enqueuePushNotice(data, notice);
      syncEventReminders(data, clock());
      writeData(file, data);
      return result;
    }),
  );
}
export async function activityAction(
  actorId: string,
  input: unknown,
  clock: () => number = Date.now,
): Promise<Record<string, unknown>> {
  const p = object(input),
    action = text(p.action, "操作", 50);
  if (["roster.preview", "roster.apply", "roster.retry"].includes(action)) {
    const { rosterChangeAction } = await import("./rosterChanges.ts");
    return rosterChangeAction(actorId, p);
  }
  if (action === "roster.sync") {
    const actor = activeUser(readUsers(), actorId);
    if (!isExecutive(actor))
      throw new ActivityError("名簿の更新は管理者のみ行えます。", 403);
    revision(readActivities().roster?.revision ?? 0, p.revision);
    const selectedRoster = readActivities().roster;
    if (selectedRoster?.term) {
      const { rosterChangeAction } = await import("./rosterChanges.ts");
      const { rosterSourceLinks } = await import("./termRoster.ts");
      const links = rosterSourceLinks(selectedRoster);
      return rosterChangeAction(actorId, { action: "roster.preview", mode: "term", year: selectedRoster.term.year, season: selectedRoster.term.season,
        admissionUrl: links[0].url, continuationUrl: links[1].url, revision: p.revision });
    }
    let incoming;
    try {
      incoming = await fetchActivityRoster(
        readActivities().roster || activityRosterSource,
      );
    } catch (error) {
      throw new ActivityError(
        error instanceof Error ? error.message : "名簿を取得できませんでした。",
        503,
      );
    }
    const result = await transaction(actorId, (data, current, users) => {
      if (!isExecutive(current))
        throw new ActivityError("名簿の更新は管理者のみ行えます。", 403);
      revision(data.roster?.revision ?? 0, p.revision);
      const source = data.roster || activityRosterSource;
      const next = reconcileRoster(
        data.roster,
        incoming.records,
        source,
        new Date(clock()).toISOString(),
      );
      if (data.roster?.managedSource && next.departed.length)
        throw new ActivityError(
          "名簿から外れた人がいます。「変更内容を確認」から退会対象を確認して適用してください。",
          409,
        );
      data.roster = {
        ...data.roster,
        spreadsheetId: source.spreadsheetId,
        sheetId: source.sheetId,
        ...incoming,
        records: data.roster?.managedSource ? next.records : incoming.records,
        retiredRecords: data.roster?.managedSource
          ? next.retiredRecords
          : data.roster?.retiredRecords,
        fetchedAt: new Date(clock()).toISOString(),
        fetchedBy: current.id,
        revision: (data.roster?.revision ?? 0) + 1,
        bindings: data.roster?.bindings ?? {},
      };
      applyRosterProfiles(data, users);
      return { ok: true, imported: incoming.records.length };
    });
    const { queueAccountingRoster } = await import("./accountingRoster.ts");
    await queueAccountingRoster().catch(() => console.error("accounting.roster: will retry in worker"));
    await audit(
      actorId,
      "activities.roster.sync",
      readActivities().roster!.spreadsheetId,
    ).catch(() => console.error("[activities] roster audit write failed"));
    return result;
  }
  if (action === "groups.generate") {
    const snapshot = await transaction(actorId, (data, actor, users) => {
      staff(actor);
      const event = eventFor(data, p.eventId);
      revision(event.revision, p.revision);
      const now = clock(),
        people = readyForGrouping(data, event, users, now),
        previous = previousEvent(data, event, now);
      return {
        people,
        rules: event.rules,
        source: groupSource(data, event, users, now),
        revision: event.revision,
        history: groupPairs(previous?.publishedGroups?.groups || []),
      };
    });
    const result = await generateGroups(
      snapshot.people,
      snapshot.rules,
      snapshot.history,
    );
    if (!result.groups)
      throw new ActivityError(
        result.problems.join("\n"),
        result.status === "timeout" ? 422 : 400,
      );
    const saved = await transaction(actorId, (data, actor, users) => {
      staff(actor);
      const event = eventFor(data, p.eventId),
        now = clock();
      readyForGrouping(data, event, users, now);
      revision(event.revision, snapshot.revision);
      if (groupSource(data, event, users, now) !== snapshot.source)
        throw new ActivityError(
          "生成中に参加者・属性・履歴が変わりました。再生成してください。",
          409,
        );
      event.draftGroups = {
        groups: result.groups!,
        source: snapshot.source,
        savedAt: new Date(now).toISOString(),
        savedBy: actor.id,
      };
      event.revision++;
      event.updatedAt = new Date(now).toISOString();
      return { ok: true, eventId: event.id, score: result.score };
    });
    try {
      await audit(actorId, "activities.groups.generate", saved.eventId);
    } catch {
      console.error("[activities] generation audit write failed");
    }
    return saved;
  }
  const result = await transaction(
    actorId,
    (data, actor, users): Record<string, unknown> => {
      const now = clock(),
        timestamp = new Date(now).toISOString();
      if (action === "notification.read") {
        const n = data.notifications.find(
          (n) => n.id === p.id && n.recipientIds.includes(actor.id),
        );
        if (!n) throw new ActivityError("通知が見つかりません。", 404);
        n.readBy[actor.id] ||= timestamp;
        return { ok: true };
      }
      if (action === "notification.delete") {
        staff(actor);
        if (p.confirmation !== "delete")
          throw new ActivityError("通知の削除を確認してください。");
        const id = text(p.id, "通知ID", 80);
        if (data.deletedNotificationIds?.includes(id)) return { ok: true, id };
        if (!data.notifications.some((n) => n.id === id))
          throw new ActivityError("通知が見つかりません。", 404);
        data.notifications = data.notifications.filter((n) => n.id !== id);
        if (data.push) data.push.jobs = data.push.jobs.filter((j) => j.noticeId !== id);
        (data.deletedNotificationIds ||= []).push(id);
        return { ok: true, id };
      }
      if (action === "profile.save") {
        if (!isExecutive(actor))
          throw new ActivityError("名簿の更新は管理者のみ行えます。", 403);
        throw new ActivityError(
          "性別・学年の手入力は廃止しました。Google名簿から更新してください。",
          410,
        );
      }
      if (action === "roster.link") {
        if (!isExecutive(actor))
          throw new ActivityError("名簿の更新は管理者のみ行えます。", 403);
        if (!data.roster)
          throw new ActivityError("先にGoogle名簿を取得してください。", 409);
        revision(data.roster.revision, p.revision);
        const input = object(p.bindings);
        const bindings = { ...data.roster.bindings };
        for (const [id, key] of Object.entries(input)) {
          activeUser(users, id);
          if (key === "") {
            delete bindings[id];
            continue;
          }
          if (key === data.roster.bindings[id]) continue;
          if (
            typeof key !== "string" ||
            !data.roster.records.some((r) => r.active && r.key === key)
          )
            throw new ActivityError("名簿から継続中の人物を選択してください。");
          bindings[id] = key;
        }
        const keys = Object.values(bindings);
        if (new Set(keys).size !== keys.length)
          throw new ActivityError(
            "同じ名簿の人物を複数のアカウントに連携できません。",
          );
        const initialUserIds = new Set(Object.keys(bindings).filter(id => !data.roster!.bindings[id]));
        data.roster.bindings = bindings;
        data.roster.revision++;
        applyRosterProfiles(data, users);
        queueRosterPortfolioGrades(data, users, timestamp, initialUserIds);
        for (const id of Object.keys(input)) {
          const owner = users.find((user) => user.id === id);
          if (owner) {
            delete owner.rosterRelink;
            if (owner.approvalSetup) owner.approvalSetup.rosterStatus = bindings[id] ? "linked" : "unlinked";
          }
        }
        writeData("users.json", users);
        return { ok: true };
      }
      if (action === "notification.send") {
        staff(actor);
        const id = text(p.id, "通知ID", 80);
        if (data.deletedNotificationIds?.includes(id))
          throw new ActivityError("この通知は削除されています。新しいお知らせとして作成してください。", 410);
        if (!/^[0-9a-f-]{36}$/.test(id))
          throw new ActivityError("通知IDが正しくありません。");
        const previous = data.notifications.find((n) => n.id === id);
        if (previous) {
          if (previous.senderId !== actor.id)
            throw new ActivityError("通知IDが重複しています。", 409);
          return { ok: true, id };
        }
        const body = activityText(p.body, p.bodyHtml, "本文");
        notify(
          data,
          actor,
          recipientIds(p.recipientIds, users),
          text(p.title, "件名"),
          body.text,
          now,
          undefined,
          id,
          body.html,
        );
        return { ok: true, id };
      }
      if (action === "notification.edit") {
        staff(actor);
        const id = text(p.id, "通知ID", 80);
        const notice = data.notifications.find(n => n.id === id);
        if (!notice) throw new ActivityError("通知が見つかりません。", 404);
        const currentRevision = notice.revision ?? 0;
        revision(currentRevision, p.revision);
        const title = text(p.title, "件名");
        const body = activityText(p.body, p.bodyHtml, "本文");
        notice.title = title;
        notice.body = body.text;
        if (body.html) notice.bodyHtml = body.html;
        else delete notice.bodyHtml;
        notice.revision = currentRevision + 1;
        notice.updatedAt = timestamp;
        return { ok: true, id };
      }
      if (action === "event.save") {
        staff(actor);
        const old = p.eventId ? eventFor(data, p.eventId) : undefined;
        if (old) {
          revision(old.revision, p.revision);
        }
        const owner = activeUser(users, text(p.ownerId, "担当者", 128));
        if (!isStaff(owner))
          throw new ActivityError("担当者は運営以上から選択してください。");
        const headerImage = text(
          p.headerImage ?? old?.headerImage ?? "",
          "ヘッダー画像",
          2000,
          false,
        );
        if (headerImage && !isActivityHeaderImage(headerImage))
          throw new ActivityError(
            "ヘッダー画像は画像選択からアップロードしてください。",
          );
        const category = p.category ?? old?.category ?? "other";
        if (typeof category !== "string" || !Object.hasOwn(eventCategoryLabels, category)) throw new ActivityError("企画の種類を選択してください。");
        const description = activityText(p.description, p.descriptionHtml, "企画内容");
        const itinerary = activityText(p.itinerary, p.itineraryHtml, "行程", false);
        const details = {
          category: category as EventCategory,
          title: text(p.title, "企画名"),
          description: description.text,
          descriptionHtml: description.html,
          headerImage,
          startsAt: date(p.startsAt, "開始日時"),
          endsAt: date(p.endsAt, "終了日時"),
          deadline: date(p.deadline, "参加投票期日"),
          meeting: text(p.meeting, "集合場所", 1000, false),
          itinerary: itinerary.text,
          itineraryHtml: itinerary.html,
          fee: text(p.fee, "徴収費", 300, false),
          theme: text(p.theme, "テーマ", 1000, false),
          ownerId: owner.id,
          ownerName: owner.name,
          recipientIds:
            old && old.status !== "draft"
              ? old.recipientIds
              : recipientIds(p.recipientIds, users),
          updatedAt: timestamp,
        };
        if (
          Date.parse(details.endsAt) <= Date.parse(details.startsAt) ||
          Date.parse(details.deadline) > Date.parse(details.startsAt)
        )
          throw new ActivityError(
            "終了日時は開始より後、投票期日は開始以前にしてください。",
          );
        if (
          old?.status === "published" &&
          Date.parse(old.deadline) <= now &&
          Date.parse(details.deadline) > now
        )
          throw new ActivityError(
            "締切後の回答は運営の参加者一覧から修正してください。投票の再開はできません。",
          );
        if (old) {
          Object.assign(old, details);
          old.revision++;
          if (old.status === "published" && p.notifyMembers !== false)
            notify(
              data,
              actor,
              old.recipientIds,
              `企画変更：${old.title}`,
              "企画の詳細が更新されました。最新の内容をご確認ください。",
              now,
              old.id,
            );
          return { ok: true, eventId: old.id };
        }
        const event: ActivityEvent = {
          ...details,
          id: crypto.randomUUID(),
          revision: 1,
          status: "draft",
          createdAt: timestamp,
          votes: {},
          rules: defaultRules(),
          groupHistory: [],
        };
        data.events.push(event);
        return { ok: true, eventId: event.id };
      }
      const event = eventFor(data, p.eventId);
      if (action === "attendance.add") {
        staff(actor);
        revision(event.revision, p.revision);
        const target = activeUser(users, text(p.userId, "メンバー", 128));
        if (isSiteManagement(target)) throw new ActivityError("管理専用アカウントは参加者に追加できません。");
        if (event.status !== "published")
          throw new ActivityError("公開中の企画に参加者を追加できます。", 409);
        if (event.recipientIds.includes(target.id))
          throw new ActivityError(
            "このメンバーはすでに通知先です。回答一覧から変更してください。",
            409,
          );
        event.recipientIds.push(target.id);
        event.votes[target.id] = {
          value: "attending",
          at: timestamp,
          actorId: actor.id,
        };
        event.revision++;
        notify(
          data,
          actor,
          [target.id],
          `企画への参加追加：${event.title}`,
          "運営があなたを参加者に追加しました。詳細をご確認ください。",
          now,
          event.id,
        );
        return { ok: true, eventId: event.id };
      }
      if (action === "vote" || action === "attendance.set") {
        let target = actor.id;
        if (action === "attendance.set") {
          staff(actor);
          target = text(p.userId, "メンバー", 128);
          revision(event.revision, p.revision);
        }
        if (
          event.status !== "published" ||
          !event.recipientIds.includes(target)
        )
          throw new ActivityError("この企画に回答できません。", 403);
        activeUser(users, target);
        if (action === "vote" && !beforeEventDay(event.startsAt,now))
          throw new ActivityError(
            "開催日以降は参加投票を変更できません。変更は運営へご連絡ください。",
            409,
          );
        if (
          typeof p.vote !== "string" ||
          p.vote === "unanswered" ||
          !Object.hasOwn(voteLabels, p.vote)
        )
          throw new ActivityError("参加・不参加・未定から選択してください。");
        event.votes[target] = {
          value: p.vote as Vote,
          at: timestamp,
          actorId: actor.id,
        };
        event.revision++;
        return { ok: true, eventId: event.id };
      }
      staff(actor);
      revision(event.revision, p.revision);
      if (action === "event.delete") {
        if (p.confirmation !== "delete")
          throw new ActivityError("企画の削除を確認してください。");
        // Keep only the held event's grouping history, so deletion cannot undo
        // the repeat-pair constraint. Content, votes and notices are removed.
        if (
          event.status === "published" &&
          event.publishedGroups &&
          Date.parse(event.endsAt) <= now
        ) {
          (data.eventGroupingHistory ||= []).push({
            id: event.id,
            title: "削除済みの企画",
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            publishedGroups: structuredClone(event.publishedGroups),
          });
        }
        data.events = data.events.filter((e) => e.id !== event.id);
        data.notifications = data.notifications.filter(
          (n) => n.eventId !== event.id,
        );
        return { ok: true, eventId: event.id };
      } else if (action === "event.publish") {
        if (event.status !== "draft" || Date.parse(event.deadline) <= now)
          throw new ActivityError(
            "公開できる下書きか、投票期日が未来かを確認してください。",
            409,
          );
        recipientIds(event.recipientIds, users);
        if (!isStaff(users.find((u) => u.id === event.ownerId)))
          throw new ActivityError(
            "担当者を現在の運営以上の会員に変更してください。",
            409,
          );
        event.status = "published";
        notify(
          data,
          actor,
          event.recipientIds,
          `企画のご案内：${event.title}`,
          "参加・不参加・未定をご回答ください。",
          now,
          event.id,
        );
      } else if (action === "event.cancel") {
        if (event.status !== "published")
          throw new ActivityError("公開中の企画だけ中止できます。", 409);
        event.status = "cancelled";
        notify(
          data,
          actor,
          event.recipientIds,
          `中止：${event.title}`,
          "この企画は中止になりました。",
          now,
          event.id,
        );
      } else if (action === "groups.rules") {
        const people = readyForGrouping(data, event, users, now),
          rules = parseRules(p.rules);
        if (
          [
            ...rules.leaders,
            ...rules.together.flat(),
            ...rules.apart.flat(),
          ].some((id) => !people.some((person) => person.id === id))
        )
          throw new ActivityError(
            "班分けの指定対象は参加者から選択してください。",
          );
        event.rules = rules;
      } else if (action === "groups.save" || action === "groups.publish") {
        const people = readyForGrouping(data, event, users, now),
          source = groupSource(data, event, users, now);
        if (p.source !== source)
          throw new ActivityError(
            "参加者・属性・条件・履歴が変わりました。再読み込みして班案を確認してください。",
            409,
          );
        if (action === "groups.save") {
          const groups = parseGroups(p.groups);
          // Drafts may contain temporary constraint violations, but never foreign members.
          if (
            groups.some((g) =>
              [...g.memberIds, g.leaderId].some(
                (id) => !people.some((person) => person.id === id),
              ),
            )
          )
            throw new ActivityError("参加者以外を班に含めることはできません。");
          event.draftGroups = {
            groups,
            source,
            savedAt: timestamp,
            savedBy: actor.id,
          };
        } else {
          if (!event.draftGroups || event.draftGroups.source !== source)
            throw new ActivityError(
              "班案を保存・再確認してから公開してください。",
              409,
            );
          const errors = validateGroups(
            people,
            event.rules,
            event.draftGroups.groups,
          );
          if (errors.length) throw new ActivityError(errors.join("\n"));
          const published = {
            ...structuredClone(event.draftGroups),
            names: Object.fromEntries(people.map((p) => [p.id, p.name])),
            people: structuredClone(people),
            rules: structuredClone(event.rules),
            previousGroups: structuredClone(
              previousEvent(data, event, now)?.publishedGroups?.groups || [],
            ),
            publishedAt: timestamp,
            version: (event.publishedGroups?.version ?? 0) + 1,
          };
          event.publishedGroups = published;
          event.groupHistory.push(structuredClone(published));
          notify(
            data,
            actor,
            people.map((p) => p.id),
            `班分けのお知らせ：${event.title}`,
            "班分けを公開しました。所属班とリーダーをご確認ください。",
            now,
            event.id,
          );
        }
      } else throw new ActivityError("未対応の操作です。");
      event.revision++;
      event.updatedAt = timestamp;
      return { ok: true, eventId: event.id };
    }, clock,
  );
  if (action !== "notification.read") {
    try {
      await audit(
        actorId,
        `activities.${action}`,
        String(result.eventId || result.userId || result.id || actorId),
      );
    } catch {
      console.error("[activities] audit write failed after saving");
    }
  }
  if (action === "roster.link") {
    const { queueAccountingRoster } = await import("./accountingRoster.ts");
    await queueAccountingRoster().catch(() => console.error("accounting.roster: will retry in worker"));
  }
  return result;
}

/** Public share DTO: only event details, aggregate votes and attending display names. */
export function publicEvent(event: ActivityEvent, users: User[]) {
  if (event.status === "draft") throw new ActivityError("企画が見つかりません。", 404);
  const recipients = users.filter(u => isMemberAccount(u) && event.recipientIds.includes(u.id));
  const counts = { attending: 0, absent: 0, undecided: 0, unanswered: 0 };
  recipients.forEach(u => counts[event.votes[u.id]?.value || "unanswered"]++);
  return {
    id: event.id, title: event.title, category: event.category ?? "other",
    description: event.description, headerImage: event.headerImage || "",
    descriptionHtml: event.descriptionHtml, itineraryHtml: event.itineraryHtml,
    startsAt: event.startsAt, endsAt: event.endsAt, deadline: event.deadline,
    meeting: event.meeting, itinerary: event.itinerary, fee: event.fee,
    theme: event.theme, ownerName: event.ownerName, status: event.status,
    counts,
    attendees: recipients.filter(u => event.votes[u.id]?.value === "attending").map(u => ({ name: u.name })),
  };
}

/** Explicit DTOs: private profiles, constraints and non-attending names never enter member HTML/API. */
export function memberEvent(
  data: ActivityStore,
  event: ActivityEvent,
  user: User,
  users: User[],
  now = Date.now(),
) {
  if (
    !user.approved ||
    event.status === "draft" ||
    (!isStaff(user) && !event.recipientIds.includes(user.id))
  )
    throw new ActivityError("企画が見つかりません。", 404);
  const roster = users.filter(
    (u) => isMemberAccount(u) && event.recipientIds.includes(u.id),
  );
  const attendees = roster
    .filter((u) => event.votes[u.id]?.value === "attending")
    .map((u) => ({ id: u.id, name: u.name }));
  const published = event.publishedGroups;
  const publishedPeople = publishedGroupPeople(
    published,
    eventPeople(data, event, users),
  );
  const canSeeGroups =
    event.status === "published" &&
    (isStaff(user) || attendees.some((p) => p.id === user.id));
  return {
    ...publicEvent(event, users),
    attendees,
    vote: (event.votes[user.id]?.value || "unanswered") as Vote | "unanswered",
    canVote:
      event.status === "published" &&
      event.recipientIds.includes(user.id) &&
      beforeEventDay(event.startsAt,now),
    voteOverdue: event.status === "published" && event.recipientIds.includes(user.id) && beforeEventDay(event.startsAt,now) && deadlinePassed(event.deadline,now),
    groups:
      published && canSeeGroups
        ? published.groups.map((g) => ({
            leaderId: g.leaderId,
            members: g.memberIds.map((id) => ({
              id,
              name: displayName(
                publishedPeople.find((p) => p.id === id) || {
                  name: published.names[id] || "退会済みメンバー",
                },
              ),
            })),
          }))
        : null,
    groupsNeedReview:
      !!published &&
      canSeeGroups &&
      published.source !== groupSource(data, event, users, now),
  };
}
export function groupingSummary(
  data: ActivityStore,
  event: ActivityEvent,
  users: User[],
  now = Date.now(),
) {
  const people = eventPeople(data, event, users),
    source = groupSource(data, event, users, now),
    previous = previousEvent(data, event, now);
  return {
    people,
    publishedPeople: publishedGroupPeople(event.publishedGroups, people),
    source,
    previous,
    stale: !!event.draftGroups && event.draftGroups.source !== source,
    problems: event.draftGroups
      ? validateGroups(people, event.rules, event.draftGroups.groups)
      : [],
    score: event.draftGroups
      ? groupScore(
          people,
          event.draftGroups.groups,
          groupPairs(previous?.publishedGroups?.groups || []),
        )
      : null,
  };
}
