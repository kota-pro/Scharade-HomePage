import { wallSurface, wallSurfacePart, wallSurfaceContains, sameWallSurface, wallSurfaceKey } from "./exhibitionWallSurfaces.ts";
import {parseTitleBoardSettings,reconcileTitleRuby} from './exhibitionTitleText.ts';
import { exhibitionNotesLimit } from "./exhibitionNotes.ts";
import { exhibitionErrorCode, exhibitionErrorMessage, exhibitionErrors, type ExhibitionErrorCode } from './exhibitionErrors.ts';
import { roomWalls, validRoomPath, wallHeight } from './exhibitionRoomPath.ts';
import { cornerLimit } from './exhibitionVector.ts';
import { parsePhotoMetadata } from "./photoMetadata.ts";
import { emptyWorkDetails, metadataStrings, normalizeMetadataInput, prefectures, type TextIssue } from "./exhibitionText.ts";
import { contentTextIssues } from "./exhibitionText.ts";
import { paperSizes } from './exhibitionEditing.ts';
import type { EffectiveSubmissionLimits, LimitIssue, SectionLimits } from './exhibitionTypes.ts';
import type { ExhibitionAsset, FieldValue, FormField, FormSchema, RoomLayout, RoomAnnotation, VectorNode, VectorPath, RichTextRun, LayoutDimension, DimensionAnchor, SubmissionContent, WorkKind } from "./exhibitionTypes.ts";
import { validPolygon, wallLength } from "./exhibitionGeometry.ts";
import { layoutObjectIds, placementSurface } from "./exhibitionLayoutModel.ts";
export class ExhibitionError extends Error {
  status: number;
  code: ExhibitionErrorCode;
  issues?: TextIssue[];
  limitIssues?: LimitIssue[];
  effectiveLimits?: EffectiveSubmissionLimits;
  constructor(message: string, status = 400, issues?: TextIssue[], code?: ExhibitionErrorCode) { super(message); this.status = status; this.issues = issues; this.code = code ?? exhibitionErrorCode(message, status); }
}
export function exhibitionErrorBody(error: unknown, fallback: ExhibitionErrorCode = 'EXH-015') {
  if (!(error instanceof ExhibitionError)) return { ok: false, code: fallback, message: exhibitionErrors[fallback] };
  return { ok: false, code: error.code, message: exhibitionErrorMessage(error.code, error.message),
    ...(error.issues ? { issues: error.issues } : {}),
    ...(error.limitIssues ? { limitIssues: error.limitIssues, effectiveLimits: error.effectiveLimits } : {}) };
}
export const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new ExhibitionError("識別番号を確認してください。");
  return value.toLowerCase();
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExhibitionError("入力形式を確認してください。");
  return value as Record<string, any>;
}
export function text(value: unknown, label: string, max = 4000, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new ExhibitionError(`${label}の文字数・形式を確認してください。`);
  const result = value.trim();
  if (required && !result) throw new ExhibitionError(`${label}を入力してください。`);
  return result;
}
export function metadataInputText(value:unknown) {
  text(value,"撮影情報",1000);
  return normalizeMetadataInput(value as string);
}
export function number(value: unknown, label: string, min = 0, max = 100000, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new ExhibitionError(`${label}の数値を確認してください。`);
  return value;
}
export function list(value: unknown, label: string, max = 300): any[] {
  if (!Array.isArray(value) || value.length > max) throw new ExhibitionError(`${label}の件数を確認してください。`);
  return value;
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new ExhibitionError(`${label}が重複しています。`);
}
export function httpsUrl(value: unknown) {
  const s = text(value, "Portfolio URL", 2000);
  if (!s) return "";
  try { const u = new URL(s); if (u.protocol !== "https:" || u.username || u.password || u.port) throw new Error(); return u.href; }
  catch { throw new ExhibitionError("PortfolioはHTTPSのURLで入力してください。"); }
}
function parseLimits(value: unknown, section = false): SectionLimits {
  const raw = object(value), result: SectionLimits = {};
  if (raw.maxWorks !== undefined) result.maxWorks = number(raw.maxWorks, '作品数の上限', 1, 300, true);
  if (section) {
    for (const key of ['maxLongEdgeMm','maxShortEdgeMm'] as const) if (raw[key] !== undefined) result[key] = number(raw[key], '寸法の上限', .1, 100000);
    if (result.maxLongEdgeMm !== undefined && result.maxShortEdgeMm !== undefined && result.maxLongEdgeMm < result.maxShortEdgeMm) throw new ExhibitionError('長辺の上限は短辺の上限以上にしてください。');
    if (raw.frameSizeIds !== undefined) {
      const ids = list(raw.frameSizeIds, '規格の枠サイズ', paperSizes.length);
      if (ids.some(id => typeof id !== 'string' || !paperSizes.some(p => p.id === id))) throw new ExhibitionError('規格の枠サイズを確認してください。');
      unique(ids, '規格の枠サイズ');
      if (ids.length) result.frameSizeIds = ids as string[];
    }
  }
  return result;
}
export function parseSchema(value: unknown, version: number): FormSchema {
  const raw = object(value);
  const sections = list(raw.sections, "セクション", 20).map(s0 => {
    const s = object(s0); return { id: id(s.id), title: text(s.title, "セクション名", 150, true), description: text(s.description ?? "", "説明", 1500), ...(s.limits === undefined ? {} : { limits: parseLimits(s.limits, true) }) };
  });
  if (!sections.length) throw new ExhibitionError("展示セクションを最低1つ設定してください。");
  unique(sections.map(s => s.id), "セクション");
  const fields: FormField[] = list(raw.fields, "追加質問", 100).map(f0 => {
    const f = object(f0);
    if (!["text", "paragraph", "number", "select", "checkbox", "date"].includes(f.type) || !["common", "section", "work"].includes(f.scope) || typeof f.required !== "boolean") throw new ExhibitionError("質問の種類・必須設定を確認してください。");
    const options = list(f.options ?? [], "選択肢", 50).map(o => text(o, "選択肢", 150, true));
    unique(options, "選択肢");
    if (["select", "checkbox"].includes(f.type) && !options.length) throw new ExhibitionError("選択肢を設定してください。");
    const sectionId = f.sectionId ? id(f.sectionId) : undefined;
    if (sectionId && !sections.some(s => s.id === sectionId)) throw new ExhibitionError("質問のセクションを確認してください。");
    const kinds = f.kinds ? list(f.kinds, "作品種類", 3).map(k => {
      if (!["single", "series", "book"].includes(k)) throw new ExhibitionError("作品種類を確認してください。"); return k as WorkKind;
    }) : undefined;
    if (f.scope === "common" && sectionId || f.scope !== "work" && kinds?.length) throw new ExhibitionError("対象セクションは展示・作品質問、対象作品は作品質問に設定してください。");
    return { id: id(f.id), label: text(f.label, "質問名", 150, true), description: text(f.description ?? "", "説明", 1500), type: f.type, scope: f.scope, required: f.required, options, ...(sectionId ? { sectionId } : {}), ...(kinds ? { kinds } : {}) };
  });
  unique(fields.map(f => f.id), "質問");
  return { version, sections, fields, captionLabel: "キャプション", ...(raw.limits === undefined ? {} : { limits: parseLimits(raw.limits) }) };
}
export function fieldApplies(field: FormField, scope: FormField["scope"], sectionId?: string, kind?: WorkKind) {
  return field.scope === scope && (!field.sectionId || field.sectionId === sectionId) && (!field.kinds?.length || !!kind && field.kinds.includes(kind));
}
function answers(value: unknown, fields: FormField[], required: boolean): Record<string, FieldValue> {
  const raw = object(value ?? {}), result: Record<string, FieldValue> = {};
  if (Object.keys(raw).some(k => !fields.some(f => f.id === k))) throw new ExhibitionError("現在のフォームにない質問が含まれています。画面を開き直してください。");
  for (const f of fields) {
    const v = raw[f.id];
    if (v === undefined || v === "" || Array.isArray(v) && !v.length) {
      if (required && f.required) throw new ExhibitionError(`${f.label}を入力してください。`); continue;
    }
    if (f.type === "number") result[f.id] = number(v, f.label, -100000000, 100000000);
    else if (f.type === "checkbox") {
      const values = list(v, f.label, f.options.length).map(s => text(s, f.label, 150)); unique(values, f.label);
      if (values.some(s => !f.options.includes(s))) throw new ExhibitionError(`${f.label}の選択肢を確認してください。`);
      result[f.id] = values;
    } else {
      const s = text(v, f.label, f.type === "paragraph" ? 4000 : 1000, required && f.required);
      if (f.type === "select" && !f.options.includes(s)) throw new ExhibitionError(`${f.label}の選択肢を確認してください。`);
      if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)) throw new ExhibitionError(`${f.label}の日付を確認してください。`);
      result[f.id] = s;
    }
  }
  return result;
}
export function parseContent(value: unknown, schema: FormSchema, assets: ExhibitionAsset[], final = true): SubmissionContent {
  const raw = object(value);
  const content: SubmissionContent = {
    ...(raw.notes === undefined ? {} : { notes: text(raw.notes, "その他ご意見、ご要望など", exhibitionNotesLimit) }),
    name: text(raw.name, "名前", 150, final), grade: text(raw.grade, "学年", 100, final), authorName: text(raw.authorName, "作者名", 150, final),
    portfolioUrl: httpsUrl(raw.portfolioUrl ?? ""), fields: answers(raw.fields, schema.fields.filter(f => fieldApplies(f, "common")), final),
    sections: [], works: [],
  };
  content.sections = list(raw.sections, "参加セクション", 20).map(s0 => {
    const s = object(s0), sectionId = id(s.sectionId);
    if (!schema.sections.some(item => item.id === sectionId)) throw new ExhibitionError("参加セクションを確認してください。");
    return { sectionId, singles: number(s.singles, "単写真枚数", 0, 300, true), series: number(s.series, "組写真作品数", 0, 100, true), books: number(s.books, "ブック冊数", 0, 100, true),
      seriesPhotoCounts: list(s.seriesPhotoCounts, "組写真の写真枚数", 100).map(n => number(n, "各組写真の写真枚数", final ? 1 : 0, 100, true)),
      fields: answers(s.fields, schema.fields.filter(f => fieldApplies(f, "section", sectionId)), final) };
  });
  unique(content.sections.map(s => s.sectionId), "参加セクション");
  content.works = list(raw.works, "作品", 300).map((w0, workIndex) => {
    const w = object(w0), kind = w.kind as WorkKind, sectionId = id(w.sectionId);
    if (!["single", "series", "book"].includes(kind) || !content.sections.some(s => s.sectionId === sectionId)) throw new ExhibitionError("作品の種類・参加セクションを確認してください。");
    const workLabel = `${schema.sections.find(s => s.id === sectionId)?.title ?? '展示'}・作品${workIndex + 1}`;
    const requiredPhotos = list(w.photos, "作品の写真", 100);
    if (final && kind !== 'book' && (!requiredPhotos.length || requiredPhotos.some(p => object(p).assetId === ''))) {
      const missing = requiredPhotos.flatMap((p, i) => object(p).assetId === '' ? [i + 1] : []);
      throw new ExhibitionError(`提出する写真の枚数分、写真を添付してください。${workLabel}${missing.length ? `の写真${missing.join('・')}枚目` : ''}の写真が未添付です。`, 400, undefined, 'EXH-001');
    }
    const photos = requiredPhotos.filter(p => !(final && kind === "book" && object(p).assetId === "")).map(p0 => {
      const p = object(p0);
      let assetId: string;
      try { assetId = !final && p.assetId === '' ? '' : id(p.assetId); }
      catch { throw new ExhibitionError('添付した写真を確認できません。この作品の写真をもう一度選んで添付してください。', 400, undefined, 'EXH-002'); }
      if (assetId && !assets.some(a => a.id === assetId)) throw new ExhibitionError("写真の添付を確認してください。他の提出者の写真は使用できません。");
      return { ...(p.metadata !== undefined ? { metadata: parsePhotoMetadata(p.metadata) } : {}), assetId, x: number(p.x, "写真のX位置", -100000), y: number(p.y, "写真のY位置", -100000), width: number(p.width, "写真の幅", .1), height: number(p.height, "写真の高さ", .1), rotation: number(p.rotation, "写真の回転", -360, 360) };
    });
    unique(photos.map(p => p.assetId).filter(Boolean), "作品内の写真");
    if (final && (kind === "single" && photos.length !== 1 || kind === "series" && !photos.length)) throw new ExhibitionError("各作品のデータを添付してください。単写真は1枚、組写真は指定枚数の画像が必要です。ブックの画像は任意です。");
    const details = w.details === undefined ? undefined : emptyWorkDetails();
    if(details) {
      const values=object(w.details);
      for(const key of Object.keys(details) as (keyof typeof details)[]) details[key]=key==="prefecture"?text(values[key]??"","都道府県",1000):metadataInputText(values[key]??"");
      if(details.prefecture && ![...prefectures,"海外・その他"].includes(details.prefecture)) throw new ExhibitionError("都道府県を選択してください。");
    }
    const title=text(w.title ?? "","作品タイトル",300,false);let titleBoard;
    try{const prepared={title:w.title,titleBoard:parseTitleBoardSettings(w.titleBoard,w.title,final)};reconcileTitleRuby(prepared,w.title,title);titleBoard=prepared.titleBoard;}catch(error){throw new ExhibitionError(error instanceof Error?error.message:"ふりがなの設定を確認してください。");}
    return { ...(titleBoard?{titleBoard}:{}), ...(details ? {details} : {}), id: id(w.id), sectionId, kind, title, caption: text(w.caption ?? "", "キャプション"),
      ...(details ? metadataStrings(details) : {location: text(w.location ?? "", "撮影場所", 1000), equipment: text(w.equipment ?? "", "使用機材", 1000), settings: text(w.settings ?? "", "撮影設定", 1000)}), photos,
      fields: answers(w.fields, schema.fields.filter(f => fieldApplies(f, "work", sectionId, kind)), final) };
  });
  unique(content.works.map(w => w.id), "作品");
  if (final && !content.sections.length) throw new ExhibitionError("参加する展示を選んでください。");
  for (const s of content.sections) {
    const works = content.works.filter(w => w.sectionId === s.sectionId), series = works.filter(w => w.kind === "series");
    if (final && s.singles + s.series + s.books === 0) throw new ExhibitionError("参加する展示には最低1作品を登録してください。");
    if (final && (works.filter(w => w.kind === "single").length !== s.singles || series.length !== s.series || works.filter(w => w.kind === "book").length !== s.books || s.seriesPhotoCounts.length !== s.series || series.some((w, i) => w.photos.length !== s.seriesPhotoCounts[i]))) throw new ExhibitionError("作品数・組写真の写真枚数と、登録した作品・写真の数を一致させてください。");
  }
  if (content.works.reduce((n, w) => n + w.photos.length, 0) > 1000) throw new ExhibitionError("1回の提出は写真1000枚までです。");
  if(final) { const issues=contentTextIssues(content).filter(issue=>!issue.layout); if(issues.length) throw new ExhibitionError(issues.map(i=>i.message).join("\n"),400,issues); }
  return content;
}
function color(value: unknown, fallback: string) {
  if(value===undefined)return fallback;
  if(typeof value!=="string" || !/^#[a-fA-F0-9]{6}$/.test(value))throw new ExhibitionError("色を確認してください。");
  return value.toLowerCase();
}
export function parseVectorNode(value:unknown):VectorNode {
  const p=object(value),point=(v:unknown)=>{const q=object(v);return{x:number(q.x,'制御点X',-100000),y:number(q.y,'制御点Y',-100000)};},node:VectorNode={x:number(p.x,'頂点X',-100000),y:number(p.y,'頂点Y',-100000)};
  if(p.id!==undefined)node.id=id(p.id);
  for(const key of ['in','out'] as const)if(p[key]!==undefined)node[key]=point(p[key]);
  if(p.arc!==undefined){const a=object(p.arc);if(typeof a.sweep!=='boolean'||typeof a.large!=='boolean')throw new ExhibitionError('円弧の向きを確認してください。');node.arc={radius:number(a.radius,'円弧半径',.01),sweep:a.sweep,large:a.large};}
  if(p.mode!==undefined){if(!['corner','smooth','symmetric'].includes(p.mode))throw new ExhibitionError('頂点の種類を確認してください。');node.mode=p.mode;}
  if(p.radius!==undefined)node.radius=number(p.radius,'角丸半径');
  if(p.cornerHeight!==undefined)node.cornerHeight=number(p.cornerHeight,'曲面の高さ',1);
  return node;
}
export function parseVectorPath(value:unknown):VectorPath {
  const p=object(value),nodes=list(p.nodes,'パスの頂点',1024).map(parseVectorNode);
  if(typeof p.closed!=='boolean'||nodes.length<(p.closed?3:2)||nodes.some(n=>!n.id))throw new ExhibitionError('パスの頂点と閉じ方を確認してください。');
  unique(nodes.map(n=>n.id!),'パスの頂点');const result={nodes,closed:p.closed};
  nodes.forEach((n,i)=>{if((n.radius??0)>cornerLimit(result,i)+.01)throw new ExhibitionError('角丸が隣の辺を超えています。');});return result;
}
function parseRichText(value:unknown):RichTextRun[] {
  return list(value,'文字の装飾',2000).map(v=>{const r=object(v);text(r.text,'文字',2000);const result:RichTextRun={text:r.text};for(const k of ['bold','italic','underline'] as const)if(r[k]!==undefined){if(typeof r[k]!=='boolean')throw new ExhibitionError('文字の装飾を確認してください。');result[k]=r[k];}if(r.color!==undefined)result.color=color(r.color,'#343434');return result;});
}
export function parseLayoutAnnotation(a0:unknown):RoomAnnotation {
      const a=object(a0);if(!['power','door','window','image','text','rect','ellipse','path','freehand'].includes(a.kind))throw new ExhibitionError('図形・注記の種類を確認してください。');
      text(a.text??'','注記',2000);const annotation:RoomAnnotation={id:id(a.id),kind:a.kind,x:number(a.x,'注記X',-100000),y:number(a.y,'注記Y',-100000),width:number(a.width,'図形幅',.01),height:number(a.height,'図形高',.01),rotation:number(a.rotation,'図形回転',-360,360),text:a.text??'',fontSize:number(a.fontSize,'文字サイズ',.1,3000),color:color(a.color,'#343434')};
      if(a.name!==undefined){const name=text(a.name,'図形の名前',100);if(name)annotation.name=name;}
      if(a.showName!==undefined){if(typeof a.showName!=='boolean')throw new ExhibitionError('図形の名前の表示設定を確認してください。');annotation.showName=a.showName;}
      for(const key of ['nameFontSize','noteFontSize'] as const)if(a[key]!==undefined)annotation[key]=number(a[key],key==='nameFontSize'?'名前の文字サイズ':'注記の文字サイズ',.1,3000);
      if(a.kind==='image')annotation.assetId=id(a.assetId);
      if(a.surface!==undefined)annotation.surface=text(a.surface,'注記の図面',100,true);
      if(a.surfaceWallId!==undefined)annotation.surfaceWallId=text(a.surfaceWallId,'注記の壁',100,true);
      if(a.path!==undefined)annotation.path=parseVectorPath(a.path);
      if(['path','freehand'].includes(a.kind)&&!annotation.path)throw new ExhibitionError('図形のパスがありません。');
      if(a.runs!==undefined){annotation.runs=parseRichText(a.runs);if(annotation.runs.map(r=>r.text).join('')!==annotation.text)throw new ExhibitionError('文字と装飾の内容が一致しません。');}
      for(const key of ['textScaleX','textScaleY'] as const)if(a[key]!==undefined)annotation[key]=number(a[key],'文字の拡縮',.01,100);
      for(const key of ['flipX','flipY'] as const)if(a[key]!==undefined){if(typeof a[key]!=='boolean')throw new ExhibitionError('図形の反転を確認してください。');annotation[key]=a[key];}
      if(a.strokeWidth!==undefined)annotation.strokeWidth=number(a.strokeWidth,'線の太さ',.01,1000);
      if(a.opacity!==undefined)annotation.opacity=number(a.opacity,'線の濃さ',0,1);
      if(a.fill!==undefined)annotation.fill=a.fill==='none'?'none':color(a.fill,'#ffffff');return annotation;
}
function parseAttachment(value:unknown){const a=object(value);return {wallId:text(a.wallId,"連動する壁",100,true),offset:number(a.offset,"壁沿いの位置"),distance:number(a.distance,"壁からの距離"),...(a.bottom!==undefined?{bottom:number(a.bottom,"設備の床からの高さ")}: {})};}
export function parseRooms(value: unknown): RoomLayout[] {
  const rooms = list(value, "展示室", 30).map(r0 => {
    const r = object(r0), vertices = list(r.vertices, "部屋の頂点", 32).map(parseVectorNode);
    const wallHeights = list(r.wallHeights, "壁の高さ", 32).map(n => number(n, "壁の高さ", 1));
    if (wallHeights.length !== vertices.length) throw new ExhibitionError("すべての壁の高さを入力してください。");
    const result: RoomLayout = { id: id(r.id), name: text(r.name, "展示室名", 150, true), vertices, wallHeights, openings: [], placements: [], tables: [], books: [] };
    if(r.geometryVersion!==undefined){if(r.geometryVersion!==2)throw new ExhibitionError('部屋の形状バージョンを確認してください。');result.geometryVersion=2;}
    if(r.wallIds!==undefined){result.wallIds=list(r.wallIds,'壁の識別番号',32).map(value=>{const v=text(value,'壁の識別番号',100,true);id(v.startsWith('corner:')?v.slice(7):v);return v;});if(result.wallIds.length!==vertices.length)throw new ExhibitionError('すべての壁の識別番号を確認してください。');unique(result.wallIds,'壁');}
    if(vertices.some(n=>n.id)) {if(vertices.some(n=>!n.id))throw new ExhibitionError('すべての頂点の識別番号を確認してください。');unique(vertices.map(n=>n.id!),'部屋の頂点');}
    vertices.forEach((n,i)=>{if((n.radius??0)>cornerLimit({nodes:vertices,closed:true},i)+.01)throw new ExhibitionError('部屋の角丸半径が隣の壁を超えています。');});
    if(!validRoomPath(result))throw new ExhibitionError('部屋の頂点は交差しない閉じた形にしてください。');
    const walls=roomWalls(result),wall=(n:unknown)=>number(n,'壁番号',0,walls.length-1,true),wallRef=(value:unknown,index:number)=>{if(value===undefined)return{};const wallId=text(value,'壁の識別番号',100,true);if(walls[index]?.id!==wallId)throw new ExhibitionError('壁の参照が一致しません。');return{wallId};};

    if(r.wallNames!==undefined){const entries=Object.entries(object(r.wallNames));if(entries.length>64)throw new ExhibitionError('壁の名前が多すぎます。');result.wallNames=Object.fromEntries(entries.map(([key,value])=>{if(!walls.some(w=>w.id===key))throw new ExhibitionError('名前を設定する壁が見つかりません。');return[key,text(value,'壁の名前',150,true)];}));}
    result.openings = list(r.openings, "開口部", 100).map(o0 => {
      const o = object(o0), w = wall(o.wall);
      if (!["door", "window"].includes(o.kind)) throw new ExhibitionError("開口部の種類を確認してください。");
      const opening = { id: id(o.id), ...(o.name!==undefined&&text(o.name,"扉・窓の名前",100)?{name:text(o.name,"扉・窓の名前",100)}:{}), wall: w, kind: o.kind, offset: number(o.offset, "開口部の位置"), width: number(o.width, "開口部の幅", 1), bottom: number(o.bottom, "開口部の下端"), height: number(o.height, "開口部の高さ", 1), color:color(o.color,"#a32b2b"),...wallRef(o.wallId,w),...(o.visualPath!==undefined?{visualPath:parseVectorPath(o.visualPath)}:{}),...(o.swingAngle!==undefined?{swingAngle:number(o.swingAngle,"ドアの開閉角度",0,180)}:{}) };
      const surface=wallSurface(result,w)!,part=wallSurfacePart(result,w)!,x=part.left+opening.offset,y=surface.height-opening.bottom-opening.height;
      if (!wallSurfaceContains(surface,[{x,y},{x:x+opening.width,y},{x:x+opening.width,y:y+opening.height},{x,y:y+opening.height}])) throw new ExhibitionError("扉・窓を壁の内側に設定してください。");
      if(o.hingeSide!==undefined){if(!['start','end'].includes(o.hingeSide))throw new ExhibitionError('ドアの吊元を確認してください。');Object.assign(opening,{hingeSide:o.hingeSide});}
      if(o.swingSide!==undefined){if(!['inward','outward'].includes(o.swingSide))throw new ExhibitionError('ドアの開く方向を確認してください。');Object.assign(opening,{swingSide:o.swingSide});}
      return opening;
    });
    result.placements = list(r.placements, "作品配置", 300).map(p0 => { const p = object(p0); return { workId: id(p.workId), wall: wall(p.wall), ...wallRef(p.wallId,wall(p.wall)), x: number(p.x, "作品X", -100000), bottom: number(p.bottom, "作品下端", -100000), rotation: number(p.rotation, "作品回転", -360, 360) }; });
    result.tables = list(r.tables, "机", 100).map(t0 => { const t = object(t0); return { id: id(t.id), name: text(t.name, "机の名前", 100, true), x: number(t.x, "机X", -100000), y: number(t.y, "机Y", -100000), width: number(t.width, "机幅", 1), depth: number(t.depth, "机奥行", 1), rotation: number(t.rotation, "机回転", -360, 360),...(t.height!==undefined?{height:number(t.height,"机高さ",1)}:{}),...(t.attachment?{attachment:parseAttachment(t.attachment)}:{}) }; });
    result.books = list(r.books, "ブック配置", 300).map(b0 => { const b = object(b0); return { workId: id(b.workId), tableId: id(b.tableId), x: number(b.x, "ブックX", -100000), y: number(b.y, "ブックY", -100000), width: number(b.width, "ブック幅", 1), depth: number(b.depth, "ブック奥行", 1), rotation: number(b.rotation, "ブック回転", -360, 360) }; });
    result.annotations = list(r.annotations ?? [], '図形・注記', 200).map(a0 => {
      return parseLayoutAnnotation(a0);
    });
    result.boardGroups=list(r.boardGroups??[],"展示ボード群",100).map(g0=>{
      const g=object(g0),panels=list(g.panels,"展示ボード",100).map(p0=>{const p=object(p0);return{id:id(p.id),name:text(p.name,"ボード名",100,true),width:number(p.width,"ボード幅",1),height:number(p.height,"ボード高",1),thickness:number(p.thickness,"ボード厚み",1,1000),hingeAngle:number(p.hingeAngle,"接続角度",-180,180),color:color(p.color,"#e6ded0")};});
      if(!panels.length)throw new ExhibitionError("展示ボードを追加してください。");unique(panels.map(p=>p.id),"展示ボード");
      return{id:id(g.id),name:text(g.name,"ボード群の名前",100,true),x:number(g.x,"ボードX",-100000),y:number(g.y,"ボードY",-100000),rotation:number(g.rotation,"ボード群の角度",-360,360),panels,...(g.attachment?{attachment:parseAttachment(g.attachment)}:{})};
    });
    result.boardPlacements=list(r.boardPlacements??[],"展示ボードの作品配置",300).map(p0=>{const p=object(p0);if(!["A","B"].includes(p.face)||!result.boardGroups!.some(g=>g.id===p.groupId))throw new ExhibitionError("展示ボードの配置先・面を確認してください。");return{workId:id(p.workId),groupId:id(p.groupId),face:p.face as "A"|"B",x:number(p.x,"作品X",-100000),bottom:number(p.bottom,"作品下端",-100000),rotation:number(p.rotation,"作品回転",-360,360)};});
    for(const equipment of [...result.tables,...result.boardGroups])if(equipment.attachment&&!walls.some(w=>w.id===equipment.attachment!.wallId))throw new ExhibitionError('設備が連動する壁が見つかりません。');
    const surfaces = new Set([...walls.map(w=>`wall:${w.index}`), ...result.boardGroups.flatMap(g=>[`board:${g.id}:A`,`board:${g.id}:B`])]);
    result.titleBoards = list(r.titleBoards ?? [], "タイトルボード", 300).map(p0 => {
      const p=object(p0),workId=id(p.workId),surface=text(p.surface,"タイトルボードの配置先",100,true);
      if(!surfaces.has(surface)||!sameWallSurface(result,placementSurface(result,workId)??"",surface))throw new ExhibitionError("タイトルボードは対応する作品と同じ壁面に配置してください。");
      return {id:id(p.id),workId,surface,...(surface.startsWith("wall:")?wallRef(p.wallId,Number(surface.slice(5))):{}),x:number(p.x,"タイトルボードX",-100000),bottom:number(p.bottom,"タイトルボード下端",-100000),rotation:number(p.rotation,"タイトルボード回転",-360,360)};
    });
    unique(result.titleBoards.map(p=>p.id),"タイトルボード");unique(result.titleBoards.map(p=>p.workId),"作品のタイトルボード");
    surfaces.add('floor');
    for(const a of result.annotations){if(!surfaces.has(a.surface??'floor'))throw new ExhibitionError('注記の図面が見つかりません。');if(a.surfaceWallId&&walls[Number(a.surface?.slice(5))]?.id!==a.surfaceWallId)throw new ExhibitionError('注記の壁の参照が一致しません。');}
    const venueObjects=new Set(layoutObjectIds(result)),vertexIds=new Set(vertices.flatMap(n=>n.id?[n.id]:[])),wallIds=new Set(walls.map(w=>w.id));
    const anchor=(value:unknown):DimensionAnchor=>{const p=object(value);if(p.kind==='free')return{kind:'free',x:number(p.x,'測定X',-100000),y:number(p.y,'測定Y',-100000)};if(p.kind==='vertex'){const nodeId=id(p.nodeId);if(!vertexIds.has(nodeId))throw new ExhibitionError('測定する頂点がありません。');return{kind:'vertex',nodeId};}if(p.kind==='wall'){const wallId=text(p.wallId,'測定する壁',100,true);if(!wallIds.has(wallId))throw new ExhibitionError('測定する壁がありません。');return{kind:'wall',wallId,ratio:number(p.ratio,'壁の測定位置',0,1)};}if(p.kind==='surface'||p.kind==='panel'){return{kind:p.kind,u:number(p.u,'測定位置X',0,1),v:number(p.v,'測定位置Y',0,1),...(p.kind==='panel'?{panelId:id(p.panelId)}:{})} as DimensionAnchor;}if(p.kind==='object'){const objectId=text(p.objectId,'測定する物体',100,true);if(!venueObjects.has(objectId))throw new ExhibitionError('測定する物体がありません。');return{kind:'object',objectId,u:number(p.u,'測定位置X',0,1),v:number(p.v,'測定位置Y',0,1),...(p.feature?{feature:{key:text(object(p.feature).key,'測定する辺',200,true),edge:number(object(p.feature).edge,'辺の番号',0,3),ratio:number(object(p.feature).ratio,'辺の測定位置',0,1)}}:{})};}throw new ExhibitionError('測定の端点を確認してください。');};
    result.dimensions=list(r.dimensions??[],'寸法',200).map(v=>{const d=object(v),surface=text(d.surface,'寸法の図面',100,true);if(!surfaces.has(surface))throw new ExhibitionError('寸法の図面がありません。');const dimension:LayoutDimension={id:id(d.id),surface,a:anchor(d.a),b:anchor(d.b),offset:number(d.offset,'寸法線の位置',-100000),color:color(d.color,'#777777')};if(d.wallId!==undefined){dimension.wallId=text(d.wallId,'測定する壁',100,true);if(!wallIds.has(dimension.wallId))throw new ExhibitionError('測定する壁がありません。');}if(d.surfaceWallId!==undefined){dimension.surfaceWallId=text(d.surfaceWallId,'寸法の壁',100,true);if(walls[Number(surface.slice(5))]?.id!==dimension.surfaceWallId)throw new ExhibitionError('寸法の壁の参照が一致しません。');}return dimension;});unique(result.dimensions.map(d=>d.id),'寸法');
    for(const d of result.dimensions){for(const a of [d.a,d.b]){if(a.kind==='object'&&a.feature&&!Number.isInteger(a.feature.edge))throw new ExhibitionError('測定する辺の番号を確認してください。');if(a.kind==='surface'&&d.surface==='floor'||a.kind==='panel'&&(!d.surface.startsWith('board:')||!result.boardGroups.find(g=>g.id===d.surface.split(':')[1])?.panels.some(p=>p.id===a.panelId)))throw new ExhibitionError('測定する壁面・パネルが見つかりません。');if(a.kind==='vertex'&&d.surface!=='floor')throw new ExhibitionError('頂点の寸法は平面図に配置してください。');if(a.kind==='wall'&&d.surface!=='floor'&&!sameWallSurface(result,d.surface,`wall:${walls.find(w=>w.id===a.wallId)?.index}`))throw new ExhibitionError('寸法と測定対象の図面が一致しません。');if(a.kind==='object'){const [kind,value]=a.objectId.split(':');const allowed=kind==='annotation'?[result.annotations.find(p=>p.id===value)?.surface??'floor']:kind==='titleboard'?[result.titleBoards.find(p=>p.id===value)?.surface]:kind==='opening'?['floor',`wall:${result.openings.find(p=>p.id===value)?.wall}`]:kind==='work'?[placementSurface(result,value),...(result.placements.some(p=>p.workId===value)?['floor']:[])]:kind==='table'||kind==='board'?['floor',...((kind==='table'?result.tables.find(t=>t.id===value):result.boardGroups!.find(g=>g.id===value))?.attachment?walls.filter(w=>w.id===(kind==='table'?result.tables.find(t=>t.id===value):result.boardGroups!.find(g=>g.id===value))?.attachment?.wallId).map(w=>`wall:${w.index}`):[])]:['floor'];if(!allowed.some(surface=>surface&&sameWallSurface(result,surface,d.surface)))throw new ExhibitionError('寸法と測定対象の図面が一致しません。');}}if(d.wallId&&!(d.a.kind==='wall'&&d.b.kind==='wall'&&d.a.wallId===d.wallId&&d.b.wallId===d.wallId&&d.a.ratio===0&&d.b.ratio===1))throw new ExhibitionError('壁全体の寸法の端点を確認してください。');}


    result.labelPositions=list(r.labelPositions??[],'ラベルの位置',1500).map(v=>{const p=object(v),surface=text(p.surface,'ラベルの図面',100,true),target=text(p.target,'ラベルの対象',100,true);if(!surfaces.has(surface)||!venueObjects.has(target)||! /^(work|book|table|board):/.test(target))throw new ExhibitionError('ラベルの対象・図面を確認してください。');return{id:id(p.id),surface,target,dx:number(p.dx,'ラベルX',-100000),dy:number(p.dy,'ラベルY',-100000)};});
    unique(result.labelPositions.map(p=>p.id),'ラベル位置');unique(result.labelPositions.map(p=>p.surface+'/'+p.target),'ラベル対象');
    if(r.editor!==undefined) {
      const m=object(r.editor),known=new Set(layoutObjectIds(result));
      const refs=(value:unknown,label:string)=>{const ids=list(value??[],label,1500).map(v=>text(v,label,100,true));if(ids.some(v=>!known.has(v)))throw new ExhibitionError(`${label}に存在しない項目があります。`);unique(ids,label);return ids;};
      result.editor={order:refs(m.order,"表示順"),hidden:refs(m.hidden,"非表示"),locked:refs(m.locked,"ロック"),groups:list(m.groups??[],"編集グループ",750).map(g0=>{const g=object(g0),objectIds=refs(g.objectIds,"グループの項目");if(objectIds.length<2)throw new ExhibitionError("グループは2項目以上必要です。");return{id:id(g.id),name:text(g.name,"グループ名",150,true),objectIds};})};
      unique(result.editor.groups.map(g=>g.id),"編集グループ");unique(result.editor.groups.flatMap(g=>g.objectIds),"グループ所属");
      const frame=(ref:string)=>{const [kind,value]=ref.split(":");if(kind==="work")return placementSurface(result,value);if(kind==="titleboard")return result.titleBoards!.find(p=>p.id===value)?.surface;if(kind==="opening")return `wall:${result.openings.find(p=>p.id===value)?.wall}`;if(kind==="book")return `table:${result.books.find(p=>p.workId===value)?.tableId}`;if(kind==="annotation")return result.annotations!.find(a=>a.id===value)?.surface??"floor";if(kind==="dimension")return result.dimensions!.find(d=>d.id===value)?.surface;return "floor";};
      if(result.editor.groups.some(g=>new Set(g.objectIds.map(frame).map(key=>wallSurfaceKey(result,key??""))).size>1))throw new ExhibitionError("同じ図面の項目をグループ化してください。");
    }
    unique(result.boardGroups.map(g=>g.id),"展示ボード群");unique(result.boardGroups.flatMap(g=>g.panels.map(p=>p.id)),"展示ボード");
    if (r.showExhibitorNames !== undefined && typeof r.showExhibitorNames !== "boolean") throw new ExhibitionError("展示者名の表示設定を確認してください。");
    result.showExhibitorNames = r.showExhibitorNames ?? true;
    if(r.showWorkTitles!==undefined&&typeof r.showWorkTitles!=="boolean")throw new ExhibitionError("作品タイトルの表示設定を確認してください。");
    result.showWorkTitles=r.showWorkTitles??true;
    unique(result.annotations.map(a => a.id), "図形・注記");
    unique(result.openings.map(o => o.id), "開口部"); unique(result.tables.map(t => t.id), "机");
    unique([...result.placements.map(p => p.workId), ...result.books.map(p => p.workId), ...result.boardPlacements.map(p=>p.workId)], "配置する作品");
    return result;
  });
  unique(rooms.map(r => r.id), "展示室");
  unique(rooms.flatMap(r => [...r.placements.map(p => p.workId), ...r.books.map(b => b.workId), ...(r.boardPlacements??[]).map(p=>p.workId)]), "全展示室の作品配置");
  unique(rooms.flatMap(r=>r.titleBoards?.map(p=>p.id)??[]),"全展示室のタイトルボード");
  return rooms;
}
