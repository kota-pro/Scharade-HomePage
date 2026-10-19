import { readData, writeData, withStoreLock } from "./store.ts";
import { requireStaff } from "./exhibitions.ts";
import { ExhibitionError, object, text, id, parseRooms } from "./exhibitionValidation.ts";
import { reusableRoom } from "./exhibitionRoomReuse.ts";
import type { RoomTemplate } from "./exhibitionTypes.ts";

const FILE = "exhibition-rooms.json";
export function readRoomTemplates(): RoomTemplate[] {
  const data = readData<{ version: number; templates: RoomTemplate[] }>(FILE, { version: 1, templates: [] });
  if (data.version !== 1 || !Array.isArray(data.templates)) throw new Error("保存済み展示室を読めません。バックアップを確認してください。");
  return data.templates;
}
export async function roomTemplateAction(actorId: string, value: unknown) {
  requireStaff(actorId);
  const raw = object(value);
  return withStoreLock("exhibition-rooms", () => {
    const templates = readRoomTemplates();
    if (raw.action !== "save" && raw.action !== "delete") throw new ExhibitionError("保存済み展示室の操作を確認してください。");
    const existing = raw.id ? templates.find(t => t.id === id(raw.id)) : undefined;
    if (raw.id && !existing) throw new ExhibitionError("保存済み展示室が見つかりません。", 404);
    if (existing && existing.revision !== raw.revision) throw new ExhibitionError("別の画面で保存済み展示室が更新されています。再読み込みしてください。", 409);
    if (raw.action === "delete") {
      if (!existing) throw new ExhibitionError("削除する展示室を選んでください。");
      templates.splice(templates.indexOf(existing), 1);
    } else {
      const name = text(raw.name, "保存名", 150, true);
      if (templates.some(t => t.id !== existing?.id && t.name.normalize("NFKC") === name.normalize("NFKC"))) throw new ExhibitionError("同じ保存名があります。保存済み展示室を選択して更新してください。", 409);
      if (!existing && templates.length >= 100) throw new ExhibitionError("保存済み展示室は100件までです。");
      const source = object(raw.room);
      const imageIds=new Set((Array.isArray(source.annotations)?source.annotations:[]).filter(a=>a?.kind==='image').map(a=>`annotation:${a.id}`));
      const reusableDimensions=new Set((Array.isArray(source.dimensions)?source.dimensions:[]).filter(value=>{const d=object(value);return [d.a,d.b].every(value=>{const a=object(value);return a.kind!=='object'||typeof a.objectId==='string'&&/^(annotation|table|opening|board):/.test(a.objectId)&&!imageIds.has(a.objectId);});}).map(value=>`dimension:${object(value).id}`));
      const venueRef=(ref:unknown)=>typeof ref==="string"&&!imageIds.has(ref)&&(/^(annotation|table|opening|board):/.test(ref)||reusableDimensions.has(ref));
      const metadata=source.editor ? object(source.editor) : undefined;
      const editor=metadata ? { ...metadata, ...Object.fromEntries(["order","hidden","locked"].map(key=>[key,Array.isArray(metadata[key])?metadata[key].filter(venueRef):metadata[key]])), groups:Array.isArray(metadata.groups)?metadata.groups.map(value=>{const g=object(value);return {...g,objectIds:Array.isArray(g.objectIds)?g.objectIds.filter(venueRef):g.objectIds};}).filter(g=>!Array.isArray(g.objectIds)||g.objectIds.length>1):metadata.groups } : undefined;
      const dimensions=Array.isArray(source.dimensions)?source.dimensions.filter(value=>{const d=object(value);return [d.a,d.b].every(value=>{const a=object(value);return a.kind!=='object'||venueRef(a.objectId);});}):source.dimensions;
      const room = parseRooms([{ ...source, name, annotations:Array.isArray(source.annotations)?source.annotations.filter(a=>a?.kind!=='image'):source.annotations, placements: [], books: [], boardPlacements:[], titleBoards:[], labelPositions:Array.isArray(source.labelPositions)?source.labelPositions.filter(p=>venueRef(p?.target)):source.labelPositions, dimensions, editor }])[0];
      const template = { id: existing?.id ?? crypto.randomUUID(), name, revision: (existing?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), room: reusableRoom(room, name) };
      if (existing) templates.splice(templates.indexOf(existing), 1, template); else templates.push(template);
    }
    writeData(FILE, { version: 1, templates });
    return { ok: true, templates };
  });
}
