import { layoutScene } from './exhibitionLayoutScene.ts';
import { roomFloorBounds } from './exhibitionSurface.ts';
import type { LayoutWork, RoomLayout } from './exhibitionTypes.ts';
let cache=new WeakMap<RoomLayout,Map<string,ReturnType<typeof renderRoomPreview>>>();
export function clearRoomPreviewCache(){cache=new WeakMap();}
type Options={width?:number;height?:number;imageUrl?:(id:string)=>string};
export function roomPreview(room:RoomLayout,works:LayoutWork[],options:Options={}){
  const key=JSON.stringify([options.width??650,options.height??320,room,works.map(w=>[w.id,w.title,w.exhibitorName,w.photos]),(room.annotations??[]).filter(a=>a.assetId).map(a=>options.imageUrl?.(a.assetId!))]);
  let entries=cache.get(room);if(!entries){entries=new Map();cache.set(room,entries);}
  const known=entries.get(key);if(known)return known;
  const result=renderRoomPreview(room,works,options);entries.set(key,result);if(entries.size>4)entries.delete(entries.keys().next().value!);return result;
}

/** Fit the same physical scene as the editor, keeping labels readable at the displayed size. */
function renderRoomPreview(room: RoomLayout, works: LayoutWork[], options: Options) {
  const width = Math.max(1, options.width ?? 650), height = Math.max(1, options.height ?? 320);
  const availableWidth = Math.max(1, width - 40), availableHeight = Math.max(1, height - 40);
  const fit = (bounds: { width: number; height: number }) => Math.max(bounds.width / availableWidth, bounds.height / availableHeight, .001);
  let unit = fit(roomFloorBounds(room));
  for (let i = 0; i < 10; i++) {
    const scene = layoutScene(room, works, 'floor', { unit, gaps: false, sizes: false, imageUrl: options.imageUrl });
    const next = fit(scene.bounds);
    if (Math.abs(next - unit) < unit * .001) break;
    unit = next;
  }
  const scene = layoutScene(room, works, 'floor', { unit, gaps: false, sizes: false, imageUrl: options.imageUrl });
  const scale = fit(scene.bounds), w = width * scale, h = height * scale;
  const x = scene.bounds.x + scene.bounds.width / 2 - w / 2;
  const y = scene.bounds.y + scene.bounds.height / 2 - h / 2;
  // The overview must not be mistaken for the editor by its controls or event selectors.
  let svg = scene.svg.replace(/<[^>]+>/g, tag => tag.replace(/\sdata-/g, ' data-preview-'));
  // SVG IDs are document-wide. The overview and modal must not share clip paths/patterns.
  for(const match of [...svg.matchAll(/\sid="([^"]+)"/g)]){
    const id=match[1],next=`overview-${room.id}-${id}`;
    svg=svg.replaceAll(`id="${id}"`,`id="${next}"`).replaceAll(`url(#${id})`,`url(#${next})`).replaceAll(`href="#${id}"`,`href="#${next}"`);
  }
  return { ...scene, svg, unit, frame: { x, y, width: w, height: h }, viewBox: `${x} ${y} ${w} ${h}` };
}
