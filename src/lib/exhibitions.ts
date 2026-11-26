import {parseBoardDesign} from './exhibitionBoardDesign.ts';
import { isMemberAccount, isSiteManagement } from "./accountVisibility.ts";
import { parseOpeningSchedule } from "./exhibitionShiftSchedule.ts";
import { recordLayoutVersion, publicExhibition } from "./exhibitionLayoutHistory.ts";
import { effectiveSubmissionLimits } from './exhibitionSubmissionLimits.ts';
import { boardPlacementProblems } from "./exhibitionBoards.ts";
import { contentTextIssues } from "./exhibitionText.ts";
import { extractPhotoExif } from "./photoExif.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { boundedFormData, HttpInputError } from "./http.ts";
import { imageSignature, withImageSlot, ImageBusyError } from "./imageSecurity.ts";
import { readData, writeData, withStoreLock, dataPath } from "./store.ts";
import { readUsers, actorUser, isStaff, type User } from "./auth.ts";
import { audit } from "./audit.ts";
import { exhibitionMember, ownSubmission, participationState, requireExhibitionInput, requireExhibitionRecipient } from "./exhibitionParticipation.ts";
import { exhibitionAccountGrade } from "./exhibitionAccountGrade.ts";
import { preserveSubmissionNotes } from "./exhibitionNotes.ts";
import { resetSubmissionQr } from "./exhibitionQrTarget.ts";
import { currentSchema, emptySubmission, latestContent, type Exhibition, type ExhibitionStore, type Submission, type SubmissionContent } from "./exhibitionTypes.ts";
import { ExhibitionError, id, object, text, parseSchema, parseContent, parseRooms } from "./exhibitionValidation.ts";
import { ACTIVITY_HTML_LIMIT } from "./activityPresentation.ts";
import { activityRichTextPlain } from "./activityRichText.ts";
import { checkBodyAssets } from "./bodyMedia.ts";
import { sanitizeArticleHtml } from "./contentSecurity.ts";

const FILE = "exhibitions.json", LOCK = "exhibitions";
export function readExhibitions(): ExhibitionStore {
  const data = readData<ExhibitionStore>(FILE, { version: 1, exhibitions: [], submissions: [], assets: [] });
  if (data.version !== 1 || !Array.isArray(data.exhibitions) || !Array.isArray(data.submissions) || !Array.isArray(data.assets) || data.exhibitions.some(e => !e.id || !e.schemas?.length || !Array.isArray(e.rooms)) || data.submissions.some(s => !s.id || !Array.isArray(s.versions))) throw new Error("写真展データを読めません。バックアップを確認してください。");
  return data;
}
export function requireStaff(actorId: string): User {
  const user = actorUser(actorId);
  if (!isStaff(user)) throw new ExhibitionError("運営以上の権限が必要です。", 403);
  return user!;
}
export function findExhibition(data: ExhibitionStore, exhibitionId: string): Exhibition {
  const e = data.exhibitions.find(e => e.id === exhibitionId);
  if (!e) throw new ExhibitionError("写真展が見つかりません。", 404);
  return e;
}
export function tokenSubmission(data: ExhibitionStore, exhibitionId: string, token: string): Submission {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ExhibitionError("本人用の編集リンクを開いてください。", 403);
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  const s = data.submissions.find(s => s.exhibitionId === exhibitionId && s.tokenHash === digest);
  if (!s) throw new ExhibitionError("編集リンクが無効です。", 403);
  return s;
}
function touch(e: Exhibition) { e.revision++; e.updatedAt = new Date().toISOString(); }
function checkRevision(actual: number, expected: unknown) {
  if (actual !== expected) throw new ExhibitionError("別の画面で変更されています。再読み込みして確認してください。", 409);
}
function date(value: unknown) {
  const s = text(value ?? "", "受付日時", 100);
  if (!s) return "";
  if (!Number.isFinite(Date.parse(s))) throw new ExhibitionError("受付日時を確認してください。");
  return new Date(s).toISOString();
}
function numberYear(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2000 || value > 9999) throw new ExhibitionError("保存先の西暦を2000〜9999で入力してください。");
  return value;
}
export function validateParticipationPeriods(e: Exhibition) {
  const p = e.participation;
  const times = [p?.opensAt, p?.closesAt, e.opensAt, e.closesAt].map(value => Date.parse(value ?? ""));
  if (times.some(value => !Number.isFinite(value)) || !(times[0] < times[1] && times[2] < times[3])) throw new ExhibitionError("参加投票とフォーム入力の日時をすべて設定し、それぞれの終了日時を開始日時より後にしてください。投票期間と入力期間は重ねて設定できます。");
}
export async function voteExhibition(actorId: string, exhibitionId: string, value: unknown, now = Date.now()) {
  return withStoreLock(LOCK, () => {
    const data = readExhibitions(), e = findExhibition(data, id(exhibitionId)), user = exhibitionMember(actorId);
    requireExhibitionRecipient(e, user);
    if (!participationState(e, user, now).canVote) throw new ExhibitionError("現在は参加投票期間外です。変更は運営に依頼してください。", 409);
    if (!["attending", "absent", "undecided"].includes(String(value))) throw new ExhibitionError("参加・不参加・未定を選択してください。");
    e.participation!.votes[user.id] = { value: value as "attending" | "absent" | "undecided", at: new Date(now).toISOString(), actorId: user.id };
    touch(e); writeData(FILE, data); return { ok: true, ...participationState(e, user, now) };
  });
}
function appendVersion(s: Submission, content: SubmissionContent) {
  const previous = latestContent(s);
  if (!previous || previous.name !== content.name || previous.portfolioUrl !== content.portfolioUrl) {
    const candidates = s.userId ? readUsers().filter(u => isMemberAccount(u) && u.id === s.userId && u.portfolioId).map(u => ({ userId: u.id, name: u.name, portfolioId: u.portfolioId! })) : portfolioCandidates(content.name);
    resetSubmissionQr(s, content, candidates.length === 1 ? candidates[0].portfolioId : undefined);
  }
  const version = (s.versions.at(-1)?.version ?? 0) + 1;
  s.draft = content; s.revision++; s.updatedAt = new Date().toISOString();
  s.versions.push({ version, schemaVersion: s.schemaVersion, at: s.updatedAt, content: structuredClone(content), delivery: "pending", attempts: 0, nextAttemptAt: 0 });
}
function appendStaffCorrection(s: Submission, content: SubmissionContent, actorId: string) {
  const previous = latestContent(s);
  const separateDraft = previous && JSON.stringify(s.draft) !== JSON.stringify(previous) ? structuredClone(s.draft) : undefined;
  appendVersion(s, content);
  if (separateDraft) s.draft = separateDraft;
  const version = s.versions.at(-1)!; version.editedBy = actorId; version.source = "staff";
  // Imported sheet rows must not become new Google Form answers.
  if (s.sheetSource) version.delivery = "delivered";
}
export function portfolioCandidates(name: string) {
  const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const members = readUsers().filter(isMemberAccount);
  const ownerCounts = new Map<string, number>();
  for (const { portfolioId } of members) if (portfolioId) ownerCounts.set(portfolioId, (ownerCounts.get(portfolioId) ?? 0) + 1);
  return members.filter(u => u.portfolioId && ownerCounts.get(u.portfolioId) === 1 && normalize(u.name) === normalize(name)).map(u => ({ userId: u.id, name: u.name, portfolioId: u.portfolioId! }));
}
export function publicSubmission(data: ExhibitionStore, e: Exhibition, s: Submission, actorId?: string) {
  const schema = e.schemas.find(schema => schema.version === s.schemaVersion);
  if (!schema) throw new ExhibitionError("提出時のフォーム定義が見つかりません。", 503);
  return { viewerId: actorId, exhibition: { id: e.id, title: e.title, shiftsEnabled: !!e.openingSchedule, accepting: actorId ? participationState(e, exhibitionMember(actorId)).accepting : false, submissionOverdue:actorId?participationState(e,exhibitionMember(actorId)).submissionOverdue:false, opensAt: e.opensAt, closesAt: e.closesAt }, schema, effectiveLimits: effectiveSubmissionLimits(e.schemas),
    submission: { id: s.id, revision: s.revision, draft: s.draft, versions: s.versions.map(v => ({ version: v.version, at: v.at, delivery: v.delivery, error: v.error })) },
    assets: data.assets.filter(a => a.submissionId === s.id).map(({ id, name, width, height, bytes, uploaded, albumAdded, photoMetadata }) => ({ id, name, width, height, bytes, uploaded, albumAdded, photoMetadata })) };
}
export async function publicAction(exhibitionId: string, token: string, value: unknown, actorId?: string) {
  const raw = object(value);
  let initialGrade = "";
  if (raw.action === "begin") {
    const existingData = readExhibitions(), existingExhibition = findExhibition(existingData, id(exhibitionId));
    const user = requireExhibitionInput(existingExhibition, actorId);
    if (raw.ownerId !== undefined && raw.ownerId !== user.id) throw new ExhibitionError("ログイン中のアカウントが変わりました。元のアカウントでログインし直してください。", 401);
    // Resolve external profile data before taking the write lock; recheck access below.
    if (!ownSubmission(existingData, existingExhibition, user.id)) initialGrade = await exhibitionAccountGrade(user);
  }
  return withStoreLock(LOCK, () => {
    const data = readExhibitions(), e = findExhibition(data, id(exhibitionId));
    const user = requireExhibitionInput(e, actorId);
    if (raw.ownerId !== undefined && raw.ownerId !== user.id) throw new ExhibitionError("ログイン中のアカウントが変わりました。元のアカウントでログインし直してください。", 401);
    if (raw.action === "begin") {
      const existing = ownSubmission(data, e, user.id);
      if (existing) return { ok: true, ...publicSubmission(data, e, existing, user.id) };
      if (data.submissions.filter(s => s.exhibitionId === e.id).length >= 10000) throw new ExhibitionError("受付件数の上限に達しました。運営に連絡してください。", 429);
      const newToken = crypto.randomBytes(32).toString("base64url"), now = new Date().toISOString();
      const draft = emptySubmission(); draft.name = user.name; draft.authorName = user.portfolioName || user.name; draft.grade = initialGrade;
      const s: Submission = { id: crypto.randomUUID(), exhibitionId: e.id, userId: user.id, tokenHash: crypto.createHash("sha256").update(newToken).digest("hex"), createdAt: now, updatedAt: now, revision: 1, schemaVersion: currentSchema(e).version, draft, versions: [] };
      data.submissions.push(s); writeData(FILE, data);
      return { ok: true, token: newToken, ...publicSubmission(data, e, s, user.id) };
    }
    const s = ownSubmission(data, e, user.id, token ? tokenSubmission(data, e.id, token) : undefined);
    if (!s) throw new ExhibitionError("先に出展を開始してください。", 404);
    if (raw.submissionId !== undefined && raw.submissionId !== s.id) throw new ExhibitionError("提出先が変更されました。画面を開き直してください。", 409);
    checkRevision(s.revision, raw.revision);
    if (!["save", "submit"].includes(raw.action)) throw new ExhibitionError("操作を確認してください。");
    const schema = e.schemas.find(schema => schema.version === s.schemaVersion)!;
    const content = parseContent(preserveSubmissionNotes(object(raw.content), s.draft), schema, data.assets.filter(a => a.submissionId === s.id), raw.action === "submit");
    if (data.submissions.some(other => other.id !== s.id && other.exhibitionId === e.id && [...other.draft.works, ...(latestContent(other)?.works ?? [])].some(work => content.works.some(w => w.id === work.id)))) throw new ExhibitionError("別の提出と作品番号が重複しています。作品を作り直してください。");
    if (raw.action === "submit") {
      appendVersion(s, content);
    } else { s.draft = content; s.revision++; s.updatedAt = new Date().toISOString(); }
    writeData(FILE, data);
    return { ok: true, ...publicSubmission(data, e, s, user.id) };
  });
}
export async function exhibitionAction(actorId: string, value: unknown) {
  requireStaff(actorId);
  const raw = object(value);
  const result = await withStoreLock(LOCK, () => {
    requireStaff(actorId);
    const data = readExhibitions(), now = new Date().toISOString();
    if (raw.action === "create") {
      const e: Exhibition = { id: crypto.randomUUID(), title: text(raw.title, "写真展名", 150, true), revision: 1, status: "draft", opensAt: "", closesAt: "", createdAt: now, updatedAt: now,
        ...(raw.openingSchedule || raw.enableShifts === true ? { openingSchedule: parseOpeningSchedule(raw.openingSchedule) } : {}), schemas: [{ version: 1, sections: [{ id: crypto.randomUUID(), title: "通常展示", description: "" }], fields: [], captionLabel: "キャプション" }], rooms: [], albumId: crypto.randomUUID().replaceAll("-", ""), gallery: "staff", googleForms: [], year: new Date(Date.now() + 9 * 3600000).getUTCFullYear(), participation: { state: "draft", opensAt: "", closesAt: "", recipientIds: readUsers().filter(isMemberAccount).map(u => u.id), votes: {} }, notices: [] };
      data.exhibitions.push(e); writeData(FILE, data); return { ok: true, exhibition: publicExhibition(e) };
    }
    const e = findExhibition(data, id(raw.exhibitionId)); checkRevision(e.revision, raw.revision);
    const previousTitle = e.title, previousYear = e.year;
    if (raw.action === "settings") {
      if (raw.openingSchedule !== undefined) e.openingSchedule = parseOpeningSchedule(raw.openingSchedule);
      const opensAt = date(raw.opensAt), closesAt = date(raw.closesAt);
      if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) throw new ExhibitionError("受付終了日時は開始日時より後にしてください。");
      if (!["draft", "open", "closed"].includes(raw.status) || !["staff", "members", "public"].includes(raw.gallery)) throw new ExhibitionError("受付・公開設定を確認してください。");
      if (closesAt !== e.closesAt || (e.status !== "open" && raw.status === "open")) (e.reminderConfiguredAt ??= {}).submission = now;
      e.title = text(raw.title, "写真展名", 150, true); e.opensAt = opensAt; e.closesAt = closesAt; e.status = raw.status; e.gallery = raw.gallery;
      if (raw.year !== undefined) e.year = numberYear(raw.year);
      if (raw.voteOpensAt !== undefined || raw.voteClosesAt !== undefined || raw.recipientIds !== undefined) {
        const previous = e.participation ?? { state: "draft" as const, opensAt: "", closesAt: "", recipientIds: [], votes: {} };
        const voteOpensAt = date(raw.voteOpensAt ?? previous.opensAt), voteClosesAt = date(raw.voteClosesAt ?? previous.closesAt);
        const hiddenIds = new Set(readUsers().filter(isSiteManagement).map(u => u.id));
        const previousRecipientIds = previous.recipientIds.filter(id => !hiddenIds.has(id));
        let recipientIds = previousRecipientIds;
        if (raw.recipientIds !== undefined) {
          const approvedIds = new Set(readUsers().filter(isMemberAccount).map(u => u.id)), existingIds = new Set(previousRecipientIds);
          if (!Array.isArray(raw.recipientIds) || raw.recipientIds.length > 10000 || raw.recipientIds.some((v: unknown) => typeof v !== "string" || !hiddenIds.has(v) && !(previous.state !== "draft" && existingIds.has(v)) && !approvedIds.has(v as string))) throw new ExhibitionError("通知先を確認してください。");
          const selected = new Set<string>((raw.recipientIds as string[]).filter(id => !hiddenIds.has(id))), selectedIds = [...selected];
          if (previous.state === "draft") recipientIds = selectedIds;
          else {
            if (previousRecipientIds.some(userId => !selected.has(userId))) throw new ExhibitionError("通知済みの対象者は解除できません。参加状況は参加者一覧から変更してください。");
            const addedIds = selectedIds.filter(userId => !existingIds.has(userId));
            if (addedIds.length) {
              if (previous.state !== "published") throw new ExhibitionError("通知の送信完了後に対象者を追加してください。", 409);
              if (Date.parse(voteClosesAt) <= Date.now() || !voteClosesAt) throw new ExhibitionError("通知先を追加するには、参加投票の終了を未来の日時に設定してください。");
              const actor = requireStaff(actorId);
              (e.notices ??= []).push({ id: crypto.randomUUID(), exhibitionId: e.id, senderId: actor.id, senderName: actor.name, title: `写真展の参加投票：${e.title}`, body: "写真展の通知対象者に追加されました。参加・不参加・未定をご回答ください。「参加」と回答した方は、フォーム入力期間中に出展フォームを入力できます。", recipientIds: addedIds, createdAt: now });
            }
            recipientIds = [...previousRecipientIds, ...addedIds];
          }
        }
        if (voteClosesAt !== previous.closesAt || voteOpensAt !== previous.opensAt) (e.reminderConfiguredAt ??= {}).vote = now;
        e.participation = { ...previous, opensAt: voteOpensAt, closesAt: voteClosesAt, recipientIds };
      }
      if (e.participation?.state !== "draft" && e.participation) validateParticipationPeriods(e);
    } else if (raw.action === "participation.publish") {
      validateParticipationPeriods(e);
      const p = e.participation!;
      if (p.state !== "draft") throw new ExhibitionError("この写真展の通知は送信済みか送信中です。", 409);
      if (Date.parse(p.closesAt) <= Date.now()) throw new ExhibitionError("参加投票の終了を未来に設定してください。");
      const hiddenIds = new Set(readUsers().filter(isSiteManagement).map(u => u.id));
      p.recipientIds = p.recipientIds.filter(id => !hiddenIds.has(id));
      if (!p.recipientIds.length || p.recipientIds.some(userId => !readUsers().some(u => u.id === userId && isMemberAccount(u)))) throw new ExhibitionError("承認済み会員を通知先に選んでください。");
      if (data.submissions.some(s => s.exhibitionId === e.id && !s.userId && !s.inactive && !s.sheetSource)) throw new ExhibitionError("既存の下書きを会員に紐付けるか、保管対象にしてから通知してください。");
      const actor = requireStaff(actorId), noticeId = crypto.randomUUID();
      const bodyHtml = raw.bodyHtml === undefined ? undefined : sanitizeArticleHtml(text(raw.bodyHtml, "通知本文", ACTIVITY_HTML_LIMIT), true);
      if (bodyHtml !== undefined && !checkBodyAssets(bodyHtml, { kind: "exhibition-notice", id: e.id }, actorId))
        throw new ExhibitionError("通知本文の添付ファイルを確認してください。");
      const body = text(bodyHtml === undefined
        ? raw.body ?? "参加・不参加・未定をご回答ください。「参加」と回答した方は、フォーム入力期間中に出展フォームを入力できます。"
        : activityRichTextPlain(bodyHtml), "通知本文", 10000, true);
      p.state = "publishing"; p.noticeId = noticeId;
      e.reminderConfiguredAt = { vote: now, submission: now };
      (e.notices ??= []).push({ id: noticeId, exhibitionId: e.id, senderId: actor.id, senderName: actor.name, title: `写真展の参加投票：${e.title}`, body, bodyHtml, recipientIds: [...p.recipientIds], createdAt: now });
    } else if (raw.action === "participation.attendance.set") {
      const p = e.participation;
      if (p?.state !== "published") throw new ExhibitionError("通知済みの写真展を選んでください。");
      const target = exhibitionMember(text(raw.userId, "会員", 128, true));
      if (isSiteManagement(target)) throw new ExhibitionError("管理専用アカウントは参加者に追加できません。");
      if (!["attending", "absent", "undecided"].includes(raw.vote)) throw new ExhibitionError("参加・不参加・未定を選択してください。");
      if (!p.recipientIds.includes(target.id)) {
        p.recipientIds.push(target.id);
        const actor = requireStaff(actorId);
        (e.notices ??= []).push({ id: crypto.randomUUID(), exhibitionId: e.id, senderId: actor.id, senderName: actor.name, title: `写真展への参加：${e.title}`, body: "運営が写真展の通知対象者に追加しました。参加状況と入力期間をご確認ください。", recipientIds: [target.id], createdAt: now });
      }
      p.votes[target.id] = { value: raw.vote, at: now, actorId };
    } else if (raw.action === "submission.bind") {
      const submission = data.submissions.find(s => s.id === id(raw.submissionId) && s.exhibitionId === e.id);
      if (!submission || submission.sheetSource || submission.versions.length) throw new ExhibitionError("紐付ける下書きを選んでください。");
      checkRevision(submission.revision, raw.submissionRevision);
      if (raw.archive === true) submission.inactive = true;
      else {
        const target = exhibitionMember(text(raw.userId, "会員", 128, true));
        if (data.submissions.some(s => s.id !== submission.id && s.exhibitionId === e.id && s.userId === target.id && !s.inactive && s.versions.length)) throw new ExhibitionError("この会員には提出済みの作品があります。提出済みの作品を再開してください。");
        data.submissions.filter(s => s.id !== submission.id && s.exhibitionId === e.id && s.userId === target.id && !s.versions.length).forEach(s => s.inactive = true);
        submission.userId = target.id; delete submission.inactive;
      }
      submission.revision++; submission.updatedAt = now;
    } else if (raw.action === "schema") {
      const previous = currentSchema(e);
      const next = parseSchema(raw.schema, previous.version + 1);
      const existing = previous.sections.map(section => section.descriptionHtml);
      for (const section of next.sections) {
        if (section.descriptionHtml === undefined) continue;
        const html = sanitizeArticleHtml(section.descriptionHtml, true);
        if (!checkBodyAssets(html, { kind: "exhibition-section", id: e.id }, actorId, existing))
          throw new ExhibitionError("展示区分の説明に添付したファイルを確認してください。");
        section.description = text(activityRichTextPlain(html), "説明", 1500);
        if (section.description) section.descriptionHtml = html;
        else delete section.descriptionHtml;
      }
      e.schemas.push(next);
    } else if (raw.action === "rooms") {
      if(e.layoutProtocol)throw new ExhibitionError("共同編集の画面を再読み込みしてください。旧画面からの一括保存はできません。",409);
      const rooms = parseRooms(raw.rooms), works = data.submissions.filter(s => s.exhibitionId === e.id).flatMap(s => latestContent(s)?.works ?? []);
      if (rooms.some(r => r.placements.some(p => !works.some(w => w.id === p.workId && w.kind !== "book")) || r.books.some(p => !works.some(w => w.id === p.workId && w.kind === "book") || !r.tables.some(t => t.id === p.tableId)))) throw new ExhibitionError("配置する作品・展示台を確認してください。");
      for(const room of rooms) {const problems=boardPlacementProblems(room,works);if(problems.length)throw new ExhibitionError(problems.join("\n"));}
      if(JSON.stringify(e.rooms)!==JSON.stringify(rooms))recordLayoutVersion(e,rooms,requireStaff(actorId));
    }
    else if (raw.action === "submission.board") {
      const s = data.submissions.find(s => s.id === id(raw.submissionId) && s.exhibitionId === e.id);
      if (!s || !latestContent(s)) throw new ExhibitionError("提出が見つかりません。", 404);
      checkRevision(s.revision, raw.submissionRevision);
      const patch = object(raw.content), content = structuredClone(latestContent(s)!);
      for (const key of ["name", "grade", "authorName"] as const) content[key] = text(patch[key], key, key === "grade" ? 100 : 150, true);
      content.portfolioUrl = text(patch.portfolioUrl ?? "", "Portfolio URL", 2000);
      if (!Array.isArray(patch.works) || patch.works.length !== content.works.length) throw new ExhibitionError("作品一覧を再読み込みしてください。");
      const seen = new Set<string>();
      for (const value of patch.works) {
        const workPatch = object(value), workId = id(workPatch.id), work = content.works.find(w => w.id === workId);
        if (!work || seen.has(workId)) throw new ExhibitionError("作品一覧を再読み込みしてください。");
        seen.add(workId);
        work.title = text(workPatch.title, "作品タイトル", 300, true);
        work.caption = text(workPatch.caption ?? "", "キャプション");
        const changedMetadata=["location", "equipment", "settings"].some(key=>workPatch[key] !== (work as any)[key]);
        for (const key of ["location", "equipment", "settings"] as const) work[key] = text(workPatch[key] ?? "", key, 1000);
        if(changedMetadata) delete work.details;
      }
      const schema = e.schemas.find(schema => schema.version === s.schemaVersion)!;
      const textIssues=contentTextIssues(content).filter(issue=>!issue.layout);if(textIssues.length)throw new ExhibitionError(textIssues.map(i=>i.message).join("\n"),400,textIssues);
      appendStaffCorrection(s, parseContent(content, schema, data.assets.filter(a => a.submissionId === s.id), false), actorId);
    }
    else if (raw.action === "submission.edit") {
      const s = data.submissions.find(s => s.id === id(raw.submissionId) && s.exhibitionId === e.id && !s.inactive);
      const previous = s && latestContent(s);
      if (!s || !previous) throw new ExhibitionError("修正する提出済みの回答が見つかりません。", 404);
      checkRevision(s.revision, raw.submissionRevision);
      const schema = e.schemas.find(schema => schema.version === s.schemaVersion);
      if (!schema) throw new ExhibitionError("提出時のフォーム定義が見つかりません。", 503);
      const content = parseContent(preserveSubmissionNotes(object(raw.content), previous), schema, data.assets.filter(a => a.submissionId === s.id), !s.sheetSource);
      for (const key of ["name", "grade", "authorName"] as const) text(content[key], key, key === "grade" ? 100 : 150, true);
      content.works.forEach(w => text(w.title, "作品タイトル", 300, true));
      const textIssues = contentTextIssues(content).filter(issue=>!issue.layout);
      if (textIssues.length) throw new ExhibitionError(textIssues.map(i => i.message).join("\n"), 400, textIssues);
      if (data.submissions.some(other => other.id !== s.id && other.exhibitionId === e.id && [...other.draft.works, ...(latestContent(other)?.works ?? [])].some(work => content.works.some(w => w.id === work.id)))) throw new ExhibitionError("別の提出と作品番号が重複しています。");
      const placed = new Set(e.rooms.flatMap(r => [...r.placements, ...r.books, ...(r.boardPlacements ?? []), ...(r.titleBoards ?? [])].map(p => p.workId)));
      if (previous.works.some(w => placed.has(w.id) && !content.works.some(next => next.id === w.id && next.kind === w.kind))) throw new ExhibitionError("配置済みの作品は削除できません。先に展示室・壁面レイアウトから配置を解除してください。");
      const allWorks = data.submissions.filter(other => other.exhibitionId === e.id && other.id !== s.id && !other.inactive).flatMap(other => latestContent(other)?.works ?? []).concat(content.works);
      const geometry = (w: SubmissionContent["works"][number]) => JSON.stringify(w.photos.map(({x,y,width,height,rotation}) => ({x,y,width,height,rotation})));
      const resized = new Set(content.works.filter(w => { const old = previous.works.find(old => old.id === w.id); return old && geometry(old) !== geometry(w); }).map(w => w.id));
      for (const room of e.rooms) {
        // Text/image-only corrections must not be blocked by an unrelated existing placement.
        const problems = boardPlacementProblems({...room, boardPlacements: room.boardPlacements?.filter(p => resized.has(p.workId)), titleBoards: []}, allWorks);
        if (problems.length) throw new ExhibitionError(problems.join("\n"));
      }
      appendStaffCorrection(s, content, actorId);
    }
    else if (raw.action === "submission") {
      const s = data.submissions.find(s => s.id === id(raw.submissionId) && s.exhibitionId === e.id);
      if (!s) throw new ExhibitionError("提出が見つかりません。", 404);
      checkRevision(s.revision, raw.submissionRevision);
      const schema = e.schemas.find(schema => schema.version === s.schemaVersion)!;
      const content = parseContent(preserveSubmissionNotes(object(raw.content), latestContent(s) ?? s.draft), schema, data.assets.filter(a => a.submissionId === s.id));
      appendStaffCorrection(s, content, actorId);
    } else if (raw.action === "qr") {
      const s = data.submissions.find(s => s.id === id(raw.submissionId) && s.exhibitionId === e.id);
      if (!s) throw new ExhibitionError("提出が見つかりません。", 404);
      if (raw.portfolioId) {
        const portfolioId = text(raw.portfolioId, "Portfolio ID", 200, true);
        if (readUsers().filter(u => isMemberAccount(u) && u.portfolioId === portfolioId).length !== 1) throw new ExhibitionError("承認済みアカウントに紐づくPortfolioを選んでください。");
        s.portfolioId = portfolioId;
        s.qrSource = "account";
      } else {
        if (!latestContent(s)?.portfolioUrl) throw new ExhibitionError("外部Portfolio URLを入力するか、アカウントを選んでください。");
        delete s.portfolioId;
        s.qrSource = "external";
      }
      s.qrConfirmed = true;
    } else if(raw.action === "boards.design") {
      const workId=id(raw.workId),submission=data.submissions.find(s=>s.exhibitionId===e.id&&!s.inactive&&latestContent(s)?.works.some(w=>w.id===workId));
      if(!submission)throw new ExhibitionError('提出済みの作品が見つかりません。',404);
      checkRevision(submission.revision,raw.submissionRevision);
      try {
        if(raw.design===null)delete (e.boardDesigns??={})[workId];
        else (e.boardDesigns??={})[workId]=parseBoardDesign(raw.design);
      }catch(error){throw new ExhibitionError(error instanceof Error?error.message:'配置を確認してください。');}
    } else if (raw.action === "retry") {
      for (const s of data.submissions.filter(s => s.exhibitionId === e.id)) for (const v of s.versions.filter(v => v.delivery === "pending")) { v.nextAttemptAt = 0; delete v.error; }
    } else throw new ExhibitionError("操作を確認してください。");
    if ((raw.action === "settings" && (previousTitle !== e.title || previousYear !== e.year)) || raw.action === "schema") {
      if (e.googleForms.length) e.googleSync = { ...e.googleSync, pending: true, nextAttemptAt: 0 };
      if (e.albumCreated && previousTitle !== e.title) e.albumSync = { ...e.albumSync, pending: true, nextAttemptAt: 0 };
    }
    touch(e); writeData(FILE, data); return { ok: true, exhibition: publicExhibition(e) };
  });
  await audit(actorId, `exhibition.${String(raw.action)}`, result.exhibition.id);
  return result;
}
export const exhibitionAssetPath = (assetId: string, preview = false) => dataPath(`exhibition-${id(assetId)}.${preview ? "png" : "bin"}`);
export function authorizeAsset(exhibitionId: string, assetId: string, user: User | null | undefined, token: string) {
  const data = readExhibitions();
  findExhibition(data, id(exhibitionId));
  const asset = data.assets.find(a => a.id === id(assetId) && a.exhibitionId === exhibitionId);
  if (!asset) throw new ExhibitionError("写真が見つかりません。", 404);
  const actor = exhibitionMember(user?.id);
  if (!isStaff(actor)) {
    const exhibition = findExhibition(data, exhibitionId);
    const s = ownSubmission(data, exhibition, actor.id, token ? tokenSubmission(data, exhibitionId, token) : undefined);
    if (!s) throw new ExhibitionError("この写真を閲覧できません。", 403);
    if (s.id !== asset.submissionId) throw new ExhibitionError("この写真を閲覧できません。", 403);
  }
  return asset;
}
export const MAX_EXHIBITION_BYTES = 20 * 1024 * 1024;
export async function exhibitionUploadForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new ExhibitionError("写真の送信形式を確認してください。");
  try { return await boundedFormData(request, MAX_EXHIBITION_BYTES + 65536); }
  catch (error) { throw new ExhibitionError(error instanceof HttpInputError && error.status === 413 ? "写真は20MB以下にしてください。" : "写真の送信内容を確認してください。", error instanceof HttpInputError ? error.status : 400); }
}
function writeBinary(file: string, bytes: Buffer) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { const fd = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
type StaffUploadTarget = { submissionId: string; revision: number; exhibitionRevision: number };
export async function uploadStaffExhibitionAsset(exhibitionId: string, target: StaffUploadTarget, assetId: string, file: File, actorId: string) {
  requireStaff(actorId);
  return uploadExhibitionAsset(exhibitionId, "", assetId, file, actorId, target.submissionId, target);
}
export async function uploadExhibitionAsset(exhibitionId: string, token: string, assetId: string, file: File, actorId?: string, expectedSubmissionId?: string, staffTarget?: StaffUploadTarget) {
  const resolve = (data: ExhibitionStore) => {
    const e = findExhibition(data, id(exhibitionId));
    if (staffTarget) {
      requireStaff(actorId ?? ""); checkRevision(e.revision, staffTarget.exhibitionRevision);
      const s = data.submissions.find(s => s.id === id(staffTarget.submissionId) && s.exhibitionId === e.id && !s.inactive && !!latestContent(s));
      if (!s) throw new ExhibitionError("提出済みの回答が見つかりません。", 404);
      checkRevision(s.revision, staffTarget.revision); return { e, s };
    }
    const user = requireExhibitionInput(e, actorId);
    return { e, s: ownSubmission(data, e, user.id, token ? tokenSubmission(data, e.id, token) : undefined) };
  };
  const { e, s } = resolve(readExhibitions()); id(assetId);
  if (!s) throw new ExhibitionError("先に出展を開始してください。", 404);
  if (expectedSubmissionId !== undefined && expectedSubmissionId !== s.id) throw new ExhibitionError("提出先が変更されました。画面を開き直してください。", 409);
  if (!file.size || file.size > MAX_EXHIBITION_BYTES) throw new ExhibitionError("空でない20MB以下のJPEG・PNGを選んでください。", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  let meta: { format?: string; width?: number; height?: number; pages?: number }, preview: { data: Buffer; info: { width: number; height: number } };
  try {
    if (!["jpeg", "png"].includes(imageSignature(bytes) ?? "")) throw new Error("format");
    const inspected = await withImageSlot(async () => {
      const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: "error" }).timeout({ seconds: 20 });
      const metadata = await image.metadata();
      if (!["jpeg", "png"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error();
      return { metadata, preview: await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true }) };
    });
    meta = inspected.metadata; preview = inspected.preview;
  } catch (error) { throw new ExhibitionError(error instanceof ImageBusyError ? error.message : "JPEG・PNGを選んでください。破損・複数フレーム・6000万画素を超える写真は添付できません。", error instanceof ImageBusyError ? error.status : 400); }
  const photoMetadata = await extractPhotoExif(bytes);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  return withStoreLock(LOCK, () => {
    const data = readExhibitions(), { s: owner } = resolve(data);
    if (!owner || owner.id !== s.id) throw new ExhibitionError("提出内容が変更されました。画面を開き直してください。", 409);
    const existing = data.assets.find(a => a.id === assetId);
    if (existing) { if (existing.submissionId !== s.id || existing.sha256 !== digest) throw new ExhibitionError("添付番号が別の写真に使われています。選び直してください。", 409); return { ok: true, asset: existing }; }
    if (data.assets.filter(a => a.submissionId === s.id).length >= 1500) throw new ExhibitionError("添付件数の上限に達しました。", 429);
    writeBinary(exhibitionAssetPath(assetId), bytes); writeBinary(exhibitionAssetPath(assetId, true), preview.data);
    const asset = { photoMetadata, id: assetId, exhibitionId: e.id, submissionId: s.id, name: (file.name || "写真").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 150), mimeType: meta.format === "jpeg" ? "image/jpeg" as const : "image/png" as const,
      bytes: bytes.length, sha256: digest, width: preview.info.width, height: preview.info.height, createdAt: new Date().toISOString(), lightroomId: crypto.randomUUID().replaceAll("-", "") };
    data.assets.push(asset); writeData(FILE, data); return { ok: true, asset };
  });
}
export async function updateExhibitionStore<T>(update: (data: ExhibitionStore) => T) {
  return withStoreLock(LOCK, () => { const data = readExhibitions(), result = update(data); writeData(FILE, data); return result; });
}
