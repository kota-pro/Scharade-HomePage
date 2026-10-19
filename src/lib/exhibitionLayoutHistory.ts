import crypto from 'node:crypto';
import type { Exhibition, LayoutVersion, LayoutVersionInfo, RoomLayout } from './exhibitionTypes.ts';

export function currentLayoutVersion(e:Exhibition):LayoutVersion {
  return {...(e.layoutCurrent??{id:e.id,revision:e.layoutRevision??0,at:null,actorName:'記録開始前',kind:'baseline' as const}),rooms:structuredClone(e.rooms)};
}
export function layoutVersionInfo(version:LayoutVersion):LayoutVersionInfo {
  const {rooms,...info}=version;
  return {...info,roomCount:rooms.length,workCount:new Set(rooms.flatMap(r=>[...r.placements,...r.books,...r.boardPlacements??[]].map(p=>p.workId))).size};
}
export function recordLayoutVersion(e:Exhibition,rooms:RoomLayout[],actor:{id:string;name:string},kind:'edit'|'restore'='edit',restoredFrom?:string) {
  const previous=currentLayoutVersion(e);
  e.layoutHistory=[previous,...e.layoutHistory??[]].slice(0,10);
  e.layoutRevision=(e.layoutRevision??0)+1;
  e.rooms=structuredClone(rooms);
  e.layoutCurrent={id:crypto.randomUUID(),revision:e.layoutRevision,at:new Date().toISOString(),actorId:actor.id,actorName:actor.name,kind,...restoredFrom?{restoredFrom}:{}};
}
/** Keep the ten full snapshots off ordinary admin/list responses. */
export function publicExhibition(e:Exhibition) {
  const {layoutHistory,layoutReceipts,...value}=e;
  return value;
}
