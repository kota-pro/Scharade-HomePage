import type { LayoutWork, RoomLayout } from './exhibitionTypes.ts';
import { roomSurfaces } from './exhibitionSurface.ts';
import { sameWallSurface, wallSurfaceKey } from './exhibitionWallSurfaces.ts';

export type WorkLocation = { roomIndex:number; view:string; label:string; objectId:string };
export function layoutWorkLocations(rooms:RoomLayout[],workId:string):WorkLocation[] {
  return rooms.flatMap((room,roomIndex)=>{
    const surfaces=roomSurfaces(room),locations:WorkLocation[]=[];
    for(const p of room.placements.filter(p=>p.workId===workId)){
      const view=wallSurfaceKey(room,`wall:${p.wall}`);
      locations.push({roomIndex,view,label:`${room.name} / ${surfaces.find(s=>sameWallSurface(room,s.key,view))?.label??'壁面'}`,objectId:`work:${workId}`});
    }
    for(const p of (room.boardPlacements??[]).filter(p=>p.workId===workId)){
      const view=`board:${p.groupId}:${p.face}`;
      locations.push({roomIndex,view,label:`${room.name} / ${surfaces.find(s=>s.key===view)?.label??'展示ボード'}`,objectId:`work:${workId}`});
    }
    for(const p of room.books.filter(p=>p.workId===workId))locations.push({roomIndex,view:'floor',label:`${room.name} / ${room.tables.find(t=>t.id===p.tableId)?.name??'展示台'}`,objectId:`book:${workId}`});
    return locations;
  });
}

export const workListColors = [
  { id: 'red', label: '赤', color: '#c75c65', background: '#fbe7e9' },
  { id: 'orange', label: 'オレンジ', color: '#c77b37', background: '#fff0df' },
  { id: 'yellow', label: '黄色', color: '#a58a26', background: '#fff9d8' },
  { id: 'green', label: '緑', color: '#5a9567', background: '#e8f4e8' },
  { id: 'blue', label: '青', color: '#578cc2', background: '#e9f1fc' },
  { id: 'purple', label: '紫', color: '#9872b6', background: '#f1eafa' },
  { id: 'gray', label: 'グレー', color: '#88908d', background: '#edf0ee' },
] as const;
export type WorkListColor = typeof workListColors[number]['id'];
export function isWorkListColor(value: unknown): value is WorkListColor {
  return workListColors.some(color => color.id === value);
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja').trim();

/** Keep the original submission order within each color, including untagged works. */
export function visibleLayoutWorks(works: LayoutWork[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const rank = (work: LayoutWork) => {
    const index = workListColors.findIndex(color => color.id === work.listTag);
    return index < 0 ? workListColors.length : index;
  };
  return works.filter(work => {
    const fields = [work.title, work.exhibitorName, work.submissionName, work.lineName].map(value => normalize(value ?? ''));
    return terms.every(term => fields.some(field => field.includes(term)));
  }).sort((a, b) => rank(a) - rank(b));
}
