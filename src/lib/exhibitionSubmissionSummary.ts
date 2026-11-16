import { exhibitionNotesText } from "./exhibitionNotes.ts";
type RecordValue = Record<string, any>;
export type SubmissionStage = "none" | "draft" | "submitted";
export type SubmissionRow = { id: string; name: string; search: string; grade: string; stage: SubmissionStage; notesCount: number; hasUnsubmittedNotes: boolean; submission?: RecordValue; user?: RecordValue };
export const submissionStageLabels: Record<SubmissionStage, string> = { none: "未入力", draft: "下書き", submitted: "提出済み" };
export const normalizeSubmissionSearch = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");

export function submissionGrade(value: string, fallback = "unknown"): string {
  const source = normalizeSubmissionSearch(value || fallback).replace(/[一二三四五六](?=年)/g, n => String("一二三四五六".indexOf(n) + 1));
  if (/master|修士|大学院|^院|^m[12]?(?:年(?:生)?)?$/.test(source) && !/博士|doctor|^d[1-6]?/.test(source)) return "修士・大学院";
  if (/博士|doctor|^d[1-6]?$/.test(source)) return "博士";
  if (/alumni|ob|og|卒業/.test(source)) return "OB・OG";
  const grade = source.match(/^(?:学部|大学)?([1-6])(?:年(?:生)?|(?:st|nd|rd|th)grade)?$/);
  if (grade) return `${grade[1]}年生`;
  return !source || /unknown|未設定/.test(source) ? "学年未設定" : "その他";
}

/** Submitted statistics use one current submission per account; drafts stay separate. */
export function exhibitionSubmissionRows(data: RecordValue): SubmissionRow[] {
  const users: RecordValue[] = data.users ?? [], active: RecordValue[] = (data.submissions ?? []).filter((s: RecordValue) => !s.inactive);
  const selected = new Map<string, RecordValue>();
  for (const s of active) {
    const key = s.userId ? `user:${s.userId}` : `submission:${s.id}`, previous = selected.get(key);
    if (!previous || String(s.updatedAt).localeCompare(String(previous.updatedAt)) > 0 || s.updatedAt === previous.updatedAt && s.revision > previous.revision) selected.set(key, s);
  }
  const keys = new Set<string>(selected.keys()), participation = data.exhibition?.participation;
  for (const id of participation?.recipientIds ?? []) if (participation.votes?.[id]?.value === "attending") keys.add(`user:${id}`);
  return [...keys].map(key => {
    const submission = selected.get(key), userId = submission?.userId ?? (key.startsWith("user:") ? key.slice(5) : undefined), user = users.find(u => u.id === userId);
    const content = submission?.content, draft = submission?.draft;
    const name = content?.name || draft?.name || user?.name || "未登録の出展者";
    return { id: key, name, user, submission, grade: submissionGrade(content?.grade || draft?.grade || "", user?.grade),
      stage: submission?.versions?.length && content ? "submitted" : submission ? "draft" : "none",
      notesCount: exhibitionNotesText(content ?? draft) ? 1 : 0,
      hasUnsubmittedNotes: !!content && exhibitionNotesText(content) !== exhibitionNotesText(draft),
      search: normalizeSubmissionSearch([name, user?.name, user?.lineName, content?.authorName, draft?.name, draft?.authorName, ...(content?.works??[]).map((w:RecordValue)=>w.title), ...(draft?.works??[]).map((w:RecordValue)=>w.title)].filter(Boolean).join(" ")) } as SubmissionRow;
  }).sort((a, b) => a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));
}
export function filterSubmissionRows(rows: SubmissionRow[], query: string, stage: string) {
  const normalized = normalizeSubmissionSearch(query);
  return rows.filter(row => row.search.includes(normalized) && (stage === "all" || row.stage === stage));
}
export function summarizeExhibitionSubmissions(rows: SubmissionRow[]) {
  const submitted = rows.filter(row => row.stage === "submitted"), kinds = { single: 0, series: 0, book: 0 };
  const grades = new Map<string, { grade: string; people: number; submitted: number; works: number }>();
  const sections = new Map<string, { id: string; single: number; series: number; book: number; total: number }>();
  let photos = 0, works = 0;
  for (const row of rows) {
    const grade = grades.get(row.grade) ?? { grade: row.grade, people: 0, submitted: 0, works: 0 }; grade.people++;
    if (row.stage === "submitted") {
      grade.submitted++;
      for (const work of row.submission?.content.works ?? []) {
        if (!Object.hasOwn(kinds, work.kind)) continue;
        const kind = work.kind as keyof typeof kinds; kinds[kind]++; works++; grade.works++;
        if (kind !== "book") photos += work.photos?.length ?? 0;
        const section = sections.get(work.sectionId) ?? { id: work.sectionId, single: 0, series: 0, book: 0, total: 0 };
        section[kind]++; section.total++; sections.set(work.sectionId, section);
      }
    }
    grades.set(row.grade, grade);
  }
  const order = ["1年生", "2年生", "3年生", "4年生", "5年生", "6年生", "修士・大学院", "博士", "OB・OG", "その他", "学年未設定"];
  return { people: rows.length, submitted: submitted.length, draft: rows.filter(row => row.stage === "draft").length,
    none: rows.filter(row => row.stage === "none").length, works, photos, kinds, notes: submitted.filter(row => row.notesCount).length,
    percent: rows.length ? Math.round(submitted.length / rows.length * 1000) / 10 : 0,
    grades: [...grades.values()].sort((a, b) => order.indexOf(a.grade) - order.indexOf(b.grade)), sections: [...sections.values()] };
}
