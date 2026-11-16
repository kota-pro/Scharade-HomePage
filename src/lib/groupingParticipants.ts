import { genderLabels, gradeLabels, type Participant, type ActivityStore } from "./activityTypes.ts";
import { parseRosterSource, rosterGender, rosterGrade } from "./activityRoster.ts";
import { advanceIntegrationConfigured, postAccountingPayload } from "./advanceRequests.ts";
import { ActivityError } from "./activities.ts";

export type GroupingParticipantSource = "event" | "sheet" | "manual";
export type GroupingParticipant = Participant & { inputSource?: GroupingParticipantSource };
export type GroupingGuest = GroupingParticipant & { lastUsedAt: string; expiresAt: string };
export function isGroupingParticipantSource(value: unknown): value is GroupingParticipantSource {
  return value === "event" || value === "sheet" || value === "manual";
}
export const participantKey = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
export function guestExpiry(now: string): string {
  const local = new Date(Date.parse(now) + 9 * 3600_000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + 3);
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, end));
  return new Date(local.getTime() - 9 * 3600_000).toISOString();
}
export function activeGuests(guests: GroupingGuest[] = [], now = Date.now()) {
  return guests.filter(guest => Date.parse(guest.expiresAt) > now);
}
export function rosterParticipants(activities: ActivityStore): Participant[] {
  return (activities.roster?.records || []).filter(r => r.active && r.grade && r.gender).map(r => ({
    id: r.key, name: r.name, lineName: r.lineName, grade: r.grade!, gender: r.gender!,
  }));
}
export function parseGuest(value: unknown): GroupingParticipant {
  const p = value as Partial<GroupingParticipant> | null;
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !/^guest-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.id) ||
      typeof p.name !== "string" || !p.name.trim() || p.name.length > 200 || /[\x00-\x1f\x7f]/.test(p.name) ||
      typeof p.gender !== "string" || !Object.hasOwn(genderLabels, p.gender) ||
      typeof p.grade !== "string" || !Object.hasOwn(gradeLabels, p.grade) ||
      (p.lineName !== undefined && (typeof p.lineName !== "string" || p.lineName.length > 200 || /[\x00-\x1f\x7f]/.test(p.lineName))) ||
      (p.inputSource !== undefined && !isGroupingParticipantSource(p.inputSource)))
    throw new ActivityError("追加参加者の名前・学年・性別を確認してください。");
  return {
    id: p.id, name: p.name.trim(), lineName: p.lineName?.trim() || "", gender: p.gender, grade: p.grade,
    ...(p.inputSource ? { inputSource: p.inputSource } : {}),
  };
}
export async function previewGroupingParticipants(url: unknown, columns?: unknown) {
  let source;
  try { source = parseRosterSource(url); }
  catch (error) { throw new ActivityError((error as Error).message); }
  if (!advanceIntegrationConfigured()) throw new ActivityError("Google連携が未設定です。管理者に連絡してください。", 503);
  if (columns !== undefined && (!columns || typeof columns !== "object" || Array.isArray(columns) ||
      ["name", "grade", "gender", "lineName"].some(k => !Number.isInteger((columns as any)[k]) || (columns as any)[k] < -1 || (columns as any)[k] > 99)))
    throw new ActivityError("取り込む列を確認してください。");
  let result: any;
  try {
    const response = await postAccountingPayload({ action: "participants.read", ...source, columns }, 25000);
    const text = await response.text();
    if (!response.ok || text.length > 2_000_000) throw new Error();
    result = JSON.parse(text);
  } catch { throw new ActivityError("参加者を取得できませんでした。接続を確認して再度お試しください。", 503); }
  const validText = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  if (!result?.ok || result.spreadsheetId !== source.spreadsheetId || result.sheetId !== source.sheetId ||
      !validText(result.title, 300) || !validText(result.sheetTitle, 100) ||
      !Array.isArray(result.headers) || result.headers.length > 100 || result.headers.some((v: unknown) => !validText(v, 200)) ||
      !result.columns || ["name", "grade", "gender", "lineName"].some(k => !Number.isInteger(result.columns[k]) || result.columns[k] < -1 || result.columns[k] >= result.headers.length) ||
      !Array.isArray(result.rows) || result.rows.length > 2000 || result.rows.some((r: any) => !r || !Number.isInteger(r.row) || r.row < 2 || r.row > 2001 || ["name", "grade", "gender", "lineName"].some(k => !validText(r[k], 200))))
    throw new ActivityError("シートを読み込めません。Google連携アカウントの閲覧権限、URL、見出し、回答数（2000行以内）を確認してください。", 400);
  return {
    ok: true, title: result.title, sheetTitle: result.sheetTitle, headers: result.headers, columns: result.columns,
    rows: result.rows.map((r: any) => ({ row: r.row, name: r.name.trim(), lineName: r.lineName.trim(), gender: rosterGender(r.gender) || "", grade: rosterGrade(r.grade) || "" })),
  };
}
