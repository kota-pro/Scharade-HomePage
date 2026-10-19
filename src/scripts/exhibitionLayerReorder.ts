/** Reorder only on release; the live scene and its selection stay untouched while dragging. */
export function bindLayerReorder(list: HTMLElement, commit: (frontToBack: string[]) => void,hooks?:{begin:()=>boolean;end:()=>void}) {
  let cancel: (()=>void) | undefined;
  const start = (event: PointerEvent) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-layout-layer-drag]');
    if (!handle || event.button !== 0||hooks&&!hooks.begin()) return;
    event.preventDefault(); cancel?.();list.dataset.layerReordering='';
    const row = handle.closest<HTMLElement>('[data-layout-layer]')!, rows = [...list.querySelectorAll<HTMLElement>('[data-layout-layer]')];
    const panel = list.closest<HTMLElement>('[data-layout-inspector]')!, origin = {x:event.clientX,y:event.clientY};
    let active = false, target = rows.length, y = event.clientY, frame = 0;
    const clearMarker = () => rows.forEach(r=>r.classList.remove('layer-drop-before','layer-drop-after'));
    const preview = () => {
      clearMarker(); target = rows.findIndex(r=>y<r.getBoundingClientRect().top+r.getBoundingClientRect().height/2);
      if(target<0){target=rows.length;rows.at(-1)?.classList.add('layer-drop-after');}
      else rows[target].classList.add('layer-drop-before');
    };
    const scroll = () => {
      if(!active || !list.isConnected)return;
      const b=panel.getBoundingClientRect(),delta=y<b.top+24?-Math.min(16,(b.top+24-y)/2):y>b.bottom-24?Math.min(16,(y-b.bottom+24)/2):0;
      if(delta){panel.scrollTop+=delta;preview();} frame=requestAnimationFrame(scroll);
    };
    const move = (e: PointerEvent) => {
      if(e.pointerId!==event.pointerId)return;e.preventDefault();y=e.clientY;
      if(!active && Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>=5){active=true;row.classList.add('layer-dragging');frame=requestAnimationFrame(scroll);}
      if(active)preview();
    };
    const finish = (save: boolean) => {
      window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',abort,true);window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);
      handle.removeEventListener('lostpointercapture',abort);cancelAnimationFrame(frame);clearMarker();row.classList.remove('layer-dragging');
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);cancel=undefined;delete list.dataset.layerReordering;hooks?.end();
      if(save&&active&&list.isConnected){const originIndex=rows.indexOf(row),reordered=rows.filter(r=>r!==row);reordered.splice(target>originIndex?target-1:target,0,row);commit(reordered.map(r=>r.dataset.layoutLayer!));}
    };
    const up=(e:PointerEvent)=>{if(e.pointerId===event.pointerId)finish(true);};
    const abort=(e:PointerEvent)=>{if(e.pointerId===event.pointerId)finish(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(false);}};
    const blur=()=>finish(false);cancel=blur;
    handle.setPointerCapture(event.pointerId);window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',abort,true);window.addEventListener('keydown',escape,true);window.addEventListener('blur',blur);handle.addEventListener('lostpointercapture',abort);
  };
  list.addEventListener('pointerdown',start);
  return ()=>{cancel?.();list.removeEventListener('pointerdown',start);};
}
