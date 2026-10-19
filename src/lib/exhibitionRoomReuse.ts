import type { RoomLayout } from './exhibitionTypes.ts';
import { layoutObjectIds } from './exhibitionLayoutModel.ts';
/** A template contains the venue, never another exhibition's assigned works. */
export function reusableRoom(room:RoomLayout,name=room.name):RoomLayout {
  const map=new Map<string,string>();
  const newid=(kind:string,old:string)=>{const id=crypto.randomUUID();map.set(`${kind}:${old}`,`${kind}:${id}`);return id;};
  const next:RoomLayout={...structuredClone(room),id:crypto.randomUUID(),name,placements:[],books:[],boardPlacements:[],titleBoards:[],
    boardGroups:(room.boardGroups??[]).map(g=>({...g,id:newid('board',g.id),panels:g.panels.map(p=>({...p,id:newid('panel',p.id)}))})),
    openings:room.openings.map(o=>({...structuredClone(o),id:newid('opening',o.id)})),tables:room.tables.map(t=>({...t,id:newid('table',t.id)})),annotations:(room.annotations??[]).filter(a=>a.kind!=='image').map(a=>({...structuredClone(a),id:newid('annotation',a.id)}))};
  // Keep the venue's stable geometry references; object identities are new for each reuse.
  const remapAnchor=(a:import('./exhibitionTypes.ts').DimensionAnchor):import('./exhibitionTypes.ts').DimensionAnchor=>a.kind==='object'?{...a,objectId:map.get(a.objectId)!,...a.feature?.key.startsWith('panel:')?{feature:{...a.feature,key:map.get(a.feature.key)!}}:{}}:a.kind==='panel'?{...a,panelId:map.get('panel:'+a.panelId)!.slice(6)}:structuredClone(a);
  next.dimensions=(room.dimensions??[]).filter(d=>[d.a,d.b].every(a=>a.kind!=='object'||map.has(a.objectId))).map(d=>({...structuredClone(d),id:newid('dimension',d.id),a:remapAnchor(d.a),b:remapAnchor(d.b)}));
  for(const a of next.annotations??[])if(a.surface?.startsWith('board:')){const [,old,face]=a.surface.split(':');a.surface=`${map.get(`board:${old}`)}:${face}`;}
  for(const d of next.dimensions)if(d.surface.startsWith('board:')){const [,old,face]=d.surface.split(':');d.surface=`${map.get(`board:${old}`)}:${face}`;}
  next.labelPositions=(room.labelPositions??[]).filter(p=>map.has(p.target)).map(p=>({...p,id:crypto.randomUUID(),target:map.get(p.target)!,surface:p.surface.startsWith('board:')?`${map.get('board:'+p.surface.split(':')[1])}:${p.surface.split(':')[2]}`:p.surface}));
  if(room.editor){const known=new Set(layoutObjectIds(next)),refs=(ids:string[])=>ids.map(id=>map.get(id)??'').filter(id=>known.has(id));next.editor={order:refs(room.editor.order),hidden:refs(room.editor.hidden),locked:refs(room.editor.locked),groups:room.editor.groups.map(g=>({...g,id:crypto.randomUUID(),objectIds:refs(g.objectIds)})).filter(g=>g.objectIds.length>1)};}
  return next;
}
