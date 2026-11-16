import {titleBoardSettings} from './exhibitionTitleText.ts';
import type { FormSchema, SubmissionContent } from "./exhibitionTypes.ts";
import { workKindLabels } from "./exhibitionTypes.ts";
export type SubmissionEditChange = {
  label: string;
  before: string;
  after: string;
};
const show = (value: unknown): string =>
  value === undefined || value === null || value === ""
    ? "未入力"
    : Array.isArray(value)
      ? value.join("、") || "未入力"
      : String(value);
/** Compare only submitted fields; API-only preview labels never make an untouched form dirty. */
export function editableSubmission(
  content: SubmissionContent,
): SubmissionContent {
  const result = structuredClone(content);
  result.works.forEach((work) => {
    delete (work as any).layout;
  });
  return result;
}
export function submissionEditChanges(
  before: SubmissionContent,
  after: SubmissionContent,
  schema: FormSchema,
  assetName: (id: string) => string,
): SubmissionEditChange[] {
  const changes: SubmissionEditChange[] = [];
  const add = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a ?? "") !== JSON.stringify(b ?? ""))
      changes.push({ label, before: show(a), after: show(b) });
  };
  for (const [key, label] of [
    ["name", "名前"],
    ["grade", "学年"],
    ["authorName", "作者名"],
    ["portfolioUrl", "外部Portfolio URL"],
    ["notes", "その他ご意見、ご要望など"],
  ] as const)
    add(label, before[key], after[key]);
  const fields = (
    label: string,
    a: Record<string, any>,
    b: Record<string, any>,
  ) => {
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)]))
      add(
        `${label}${schema.fields.find((f) => f.id === id)?.label ?? "追加質問"}`,
        a[id],
        b[id],
      );
  };
  fields("", before.fields, after.fields);
  for (const id of new Set(
    [...before.sections, ...after.sections].map((s) => s.sectionId),
  )) {
    const a = before.sections.find((s) => s.sectionId === id),
      b = after.sections.find((s) => s.sectionId === id),
      title = schema.sections.find((s) => s.id === id)?.title ?? "展示";
    const counts = (s: typeof a) =>
      s
        ? `単写真 ${s.singles}枚 / 組写真 ${s.series}組 / ブック ${s.books}冊`
        : "不参加";
    add(title + "・作品数", counts(a), counts(b));
    fields(title + "・", a?.fields ?? {}, b?.fields ?? {});
  }
  for (const id of new Set(
    [...before.works, ...after.works].map((w) => w.id),
  )) {
    const a = before.works.find((w) => w.id === id),
      b = after.works.find((w) => w.id === id),
      title = a?.title || b?.title || "新しい作品";
    if (!a || !b) {
      add(
        "作品の追加・削除",
        a ? `${workKindLabels[a.kind]}「${title}」` : "",
        b ? `${workKindLabels[b.kind]}「${title}」` : "",
      );
      continue;
    }
    for (const [key, label] of [
      ["title", "タイトル"],
      ["caption", "キャプション"],
      ["location", "撮影場所"],
      ["equipment", "使用機材"],
      ["settings", "撮影設定"],
    ] as const)
      add(`${title}・${label}`, a[key], b[key]);
    const titleA=titleBoardSettings(a),titleB=titleBoardSettings(b);
    add(`${title}・撮影可否`,titleA.noPhotography?"撮影NG":"撮影OK",titleB.noPhotography?"撮影NG":"撮影OK");
    add(`${title}・タイトルの鉤括弧`,titleA.quoted?"あり":"なし",titleB.quoted?"あり":"なし");
    add(`${title}・ふりがなの表示`,titleA.rubyEnabled?"あり":"なし",titleB.rubyEnabled?"あり":"なし");
    const readings=(w:typeof a)=>titleBoardSettings(w).ruby.map(r=>`${r.start+1}〜${r.end}文字目 ${r.group?"語句":"漢字"}：${r.base}（${r.reading}）`).join(" ／ ");
    add(`${title}・ふりがな設定`,readings(a),readings(b));
    for(const [key,label,parts] of [
      ["location","撮影場所",["place","prefecture","region"]],
      ["equipment","使用機材",["camera","lens","film"]],
      ["settings","撮影設定",["shutterSpeed","iso","fNumber"]],
    ] as const) {
      if(a[key]!==b[key] || !parts.some(part=>(a.details?.[part]??"")!==(b.details?.[part]??"")))continue;
      const details=(w:typeof a)=>parts.map(part=>w.details?.[part]?.replace(/\n/g,"↵\n")??"").filter(Boolean).join(" ／ ");
      add(`${title}・${label}の入力・改行`,details(a),details(b));
    }
    fields(title + "・", a.fields, b.fields);
    for (let i = 0; i < Math.max(a.photos.length, b.photos.length); i++) {
      const x = a.photos[i],
        y = b.photos[i];
      if (x?.assetId !== y?.assetId) {
        const beforeName = x?.assetId ? assetName(x.assetId) : "";
        const afterName = y?.assetId ? assetName(y.assetId) : "";
        // Filenames are not identities: replacing IMG_0001.jpg must still be saved.
        changes.push({
          label: `${title}・写真 ${i + 1}`,
          before: show(beforeName),
          after:
            show(afterName) +
            (beforeName && beforeName === afterName
              ? "（画像を差し替え）"
              : ""),
        });
      }
      const position = (p: typeof x) =>
        p
          ? `${p.width}×${p.height} mm / X ${p.x}, Y ${p.y} mm / ${p.rotation}°`
          : "";
      add(`${title}・写真 ${i + 1}の配置・サイズ`, position(x), position(y));
    }
  }
  return changes;
}
