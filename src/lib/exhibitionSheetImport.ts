import {parseTitleBoardSettings,reconcileTitleRuby} from './exhibitionTitleText.ts';
import {resetSubmissionQr} from './exhibitionQrTarget.ts';
import { exhibitionNotesLimit } from "./exhibitionNotes.ts";
import { emptyWorkDetails, metadataStrings, normalizeMetadataInput } from "./exhibitionText.ts";
import crypto from "node:crypto";
import { findExhibition, portfolioCandidates, updateExhibitionStore } from "./exhibitions.ts";
import { currentSchema, emptySubmission, latestContent, type SubmissionContent, type WorkKind } from "./exhibitionTypes.ts";
import { ExhibitionError, text, httpsUrl } from "./exhibitionValidation.ts";

const aliases = {
  name: ["名前", "氏名"], grade: ["学年"], authorName: ["作者名", "作名"], title: ["作品タイトル", "タイトル"],
  titleBoard: ["タイトルボード表示設定"],
  notes: ["その他ご意見、ご要望など", "その他ご意見、要望など", "備考"],
  caption: ["キャプション"], location: ["撮影場所"], equipment: ["使用機材"], settings: ["撮影設定"],
  place:["地名"],prefecture:["都道府県名"],region:["国・地域"],camera:["カメラ"],lens:["レンズ"],film:["フィルム"],shutterSpeed:["シャッタースピード"],iso:["ISO感度"],fNumber:["F値"],
  section: ["展示セクション", "企画展タイトル"], kind: ["作品種別"], portfolioUrl: ["Portfolio URL", "外部Portfolio URL"],
  submissionId: ["提出ID"], workId: ["作品ID"], version: ["提出版"],
};
export async function importTitleBoardRows(exhibitionId: string, spreadsheetId: string, sheetName: string, input: unknown) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 2001 || input.some(row => !Array.isArray(row) || row.length > 200 || row.some(cell => typeof cell !== "string" || cell.length > exhibitionNotesLimit))) throw new ExhibitionError("取り込み元は見出し付きの1行1作品、2000行以内のシートを指定してください。");
  const values = input as string[][], normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
  const headers = values[0].map(normalize);
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(h => names.some(name => normalize(name) === h))]));
  if (values.some(row => row.some((value,index) => index !== columns.notes && value.length > 4000))) throw new ExhibitionError("備考以外のセルは4000文字以内で入力してください。");
  for (const key of ["name", "grade", "title"]) if (columns[key] < 0) throw new ExhibitionError(`「${aliases[key as keyof typeof aliases][0]}」列が見つかりません。先頭シートの見出しを確認してください。`);
  const cell = (row: string[], key: string) => row[columns[key]] ?? "";
  return updateExhibitionStore(data => {
    const exhibition = findExhibition(data, exhibitionId), schema = currentSchema(exhibition), issues: string[] = [];
    let imported = 0, unchanged = 0;
    const prepared = new Map<string, { row: number; version: number; content: SubmissionContent }>();
    values.slice(1).forEach((row, index) => {
      if (row.every(value => !value.trim())) return;
      try {
        // Native gateway exports contain historical versions. Keep the latest per work.
        const sourceKey = cell(row, "submissionId") && cell(row, "workId") ? `${cell(row, "submissionId")}:${cell(row, "workId")}` : `row:${index + 2}`;
        const rowKey = crypto.createHash("sha256").update(`${spreadsheetId}\n${sheetName}\n${sourceKey}`).digest("hex");
        const version = Number(cell(row, "version")) || 1;
        if ((prepared.get(rowKey)?.version ?? -1) > version) return;
        const sectionTitle = cell(row, "section").trim(), section = sectionTitle ? schema.sections.find(s => s.title === sectionTitle) : schema.sections[0];
        if (!section) throw new ExhibitionError(`展示セクション「${sectionTitle}」を管理画面に追加してください。`);
        const kindLabel = cell(row, "kind").trim(), kind: WorkKind = kindLabel === "組写真" ? "series" : kindLabel === "ブック" ? "book" : "single";
        const previous = data.submissions.find(s => s.exhibitionId === exhibitionId && s.sheetSource?.rowKey === rowKey);
        const content: SubmissionContent = { ...emptySubmission(), name: text(cell(row, "name"), "名前", 150, true), grade: text(cell(row, "grade"), "学年", 100, true), authorName: text(cell(row, "authorName") || cell(row, "name"), "作者名", 150, true), portfolioUrl: httpsUrl(cell(row, "portfolioUrl")),
          sections: [{ sectionId: section.id, singles: kind === "single" ? 1 : 0, series: kind === "series" ? 1 : 0, books: kind === "book" ? 1 : 0, seriesPhotoCounts: [], fields: {} }],
          works: [{ id: (previous && latestContent(previous)?.works[0]?.id) || prepared.get(rowKey)?.content.works[0]?.id || crypto.randomUUID(), sectionId: section.id, kind, title: text(cell(row, "title"), "作品タイトル", 300, true), caption: text(cell(row, "caption"), "キャプション"), location: text(cell(row, "location"), "撮影場所", 1000), equipment: text(cell(row, "equipment"), "使用機材", 1000), settings: text(cell(row, "settings"), "撮影設定", 1000), photos: [], fields: {} }] };
        const work=content.works[0];
        if(columns.titleBoard>=0){const value=cell(row,"titleBoard").trim();if(value){try{const settings=parseTitleBoardSettings(JSON.parse(value),work.title);if(settings)work.titleBoard=settings;}catch(error){throw new ExhibitionError(error instanceof Error?error.message:"タイトルボード表示設定を確認してください。");}}}
        else {const old=previous&&latestContent(previous)?.works[0];if(old?.titleBoard){work.titleBoard=structuredClone(old.titleBoard);reconcileTitleRuby(work,old.title,work.title);}}
        if (columns.notes >= 0) content.notes = text(cell(row, "notes"), "その他ご意見、ご要望など", exhibitionNotesLimit);
        else if (previous && latestContent(previous)?.notes !== undefined) content.notes = latestContent(previous)!.notes;
        if(Object.keys(emptyWorkDetails()).some(key=>columns[key]>=0 && cell(row,key).trim())) {
          const details=emptyWorkDetails();for(const key of Object.keys(details) as (keyof typeof details)[])details[key]=key==="prefecture"?cell(row,key).trim():normalizeMetadataInput(cell(row,key));
          const strings=metadataStrings(details),work=content.works[0];
          for(const [field,keys] of [["location",["place","prefecture","region"]],["equipment",["camera","lens","film"]],["settings",["shutterSpeed","iso","fNumber"]]] as const)if(keys.some(key=>details[key]))work[field]=strings[field];
          // Mixed old/new sheets keep any unsplit metadata without guessing delimiters.
          if(work.location===strings.location&&work.equipment===strings.equipment&&work.settings===strings.settings)work.details=details;
        }
        prepared.set(rowKey, { row: index + 2, version, content });
      } catch (error) { issues.push(`${index + 2}行目：${error instanceof Error ? error.message : "入力を確認してください。"}`); }
    });
    for (const [rowKey, item] of prepared) {
      let submission = data.submissions.find(s => s.exhibitionId === exhibitionId && s.sheetSource?.rowKey === rowKey);
      if (submission && JSON.stringify(latestContent(submission)) === JSON.stringify(item.content)) { unchanged++; continue; }
      const now = new Date().toISOString();
      if (!submission) {
        submission = { id: crypto.randomUUID(), exhibitionId, tokenHash: "", createdAt: now, updatedAt: now, revision: 0, schemaVersion: schema.version, draft: item.content, versions: [], sheetSource: { spreadsheetId, sheetName, rowKey } };
        data.submissions.push(submission);
      }
      if (latestContent(submission)?.name !== item.content.name || latestContent(submission)?.portfolioUrl !== item.content.portfolioUrl) {
        const candidates = portfolioCandidates(item.content.name); resetSubmissionQr(submission, item.content, candidates.length === 1 ? candidates[0].portfolioId : undefined);
      }
      submission.draft = item.content; submission.updatedAt = now; submission.revision++;
      submission.versions.push({ version: (submission.versions.at(-1)?.version ?? 0) + 1, schemaVersion: schema.version, content: item.content, at: now, delivery: "delivered", attempts: 0, nextAttemptAt: 0 });
      imported++;
    }
    if (imported) { exhibition.revision++; exhibition.updatedAt = new Date().toISOString(); }
    return { imported, unchanged, issues, sheetName, rows: values.length - 1 };
  });
}
