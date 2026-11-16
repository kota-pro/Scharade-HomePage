import { layoutBounds, layoutDescription } from "../lib/exhibitionGeometry.ts";
import { arrangePhotos, photoGaps, setPhotoGap, snapMm, snapPhotoEdges } from "../lib/exhibitionEditing.ts";
import type { Work } from "../lib/exhibitionTypes.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
type State = { selected: number[]; reference: number; moving: number; snap: boolean; edgeSnap: boolean; interval: number; zoom: number; pan: {x:number;y:number}; view?: {width:number;ox:number;oy:number;base:number}; mode: "grid" | "horizontal" | "vertical"; columns: number; gapX: number; gapY: number; gapEdit?:{axis:"x"|"y";a:number;b:number;value:number} };
type Options = { getWork: (id: string) => Work | undefined; assetUrl: (id: string) => string; change: () => void; message: (text: string, error?: boolean) => void; busy: () => boolean; width: () => number };
export function createSeriesEditor(options: Options) {
  const states = new Map<string, State>();
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!event.defaultPrevented&&!event.isComposing)document.querySelectorAll("[data-series-editor]").forEach(editor=>editor.dispatchEvent(new Event("series:clear-selection")));});
  function state(work: Work) {
    let s = states.get(work.id);
    if (!s) { s = { selected: [0], reference: 0, moving: Math.min(1, work.photos.length-1), snap: true, edgeSnap: true, interval: 5, zoom: 1, pan:{x:0,y:0}, mode: "grid", columns: 2, gapX: 10, gapY: 10 }; states.set(work.id,s); }
    if(s.gapEdit&&(s.gapEdit.a>=work.photos.length||s.gapEdit.b>=work.photos.length))s.gapEdit=undefined;
    s.selected = s.selected.filter(i => i < work.photos.length); s.reference = Math.min(s.reference,work.photos.length-1); s.moving = Math.min(s.moving,work.photos.length-1);
    return s;
  }
  function html(work: Work) {
    if (work.kind !== "series" || !work.photos.length) return "";
    const s=state(work),bounds=layoutBounds(work.photos),width=Math.max(240,options.width()-48);
    if(!s.view || Math.abs(s.view.width-width)>5) {
      const ox=Math.min(0,bounds.x)-30,oy=Math.min(0,bounds.y)-30;
      s.view={width,ox,oy,base:Math.min(width/Math.max(300,bounds.x+bounds.width-ox+30),380/Math.max(200,bounds.y+bounds.height-oy+30))};
    }
    const {ox,oy,base:scale}=s.view,canvasHeight=380;
    const grid=s.interval*Math.max(1,Math.ceil(8/(s.interval*scale*s.zoom))), choices=(selected:number)=>work.photos.map((_,i)=>`<option value="${i}" ${i===selected?"selected":""}>写真 ${i+1}</option>`).join("");
    const pair = s.reference !== s.moving ? photoGaps(work.photos[s.reference],work.photos[s.moving]) : null;
    const measurements: string[] = [];
    const boxes = work.photos.map(p => layoutBounds([p]));
    const line = (x1:number,y1:number,x2:number,y2:number,label:string,axis:"x"|"y",a:number,b:number) => Math.abs(Number.parseFloat(label))<.05?'':`<g data-series-gap-axis="${axis}" data-series-gap-a="${a}" data-series-gap-b="${b}" role="button" tabindex="0" aria-label="写真${a+1}と写真${b+1}の間隔${escape(label)}を変更"><path d="M${(x1-ox)*scale} ${(y1-oy)*scale}L${(x2-ox)*scale} ${(y2-oy)*scale}"/><rect data-series-gap-hit x="${((x1+x2)/2-ox)*scale-60}" y="${((y1+y2)/2-oy)*scale-21}" width="120" height="22" fill="transparent" stroke="none"/><text x="${((x1+x2)/2-ox)*scale}" y="${((y1+y2)/2-oy)*scale-5}">${escape(label)}</text></g>`;
    boxes.forEach((a,i) => {
      const candidates = boxes.map((b,j) => ({b,j})).filter(({b,j}) => j!==i && b.x >= a.x+a.width-.05 && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y));
      const nearest = candidates.sort((u,v) => u.b.x-v.b.x)[0];
      if (nearest) measurements.push(line(a.x+a.width,a.y+a.height/2,nearest.b.x,a.y+a.height/2,`${(nearest.b.x-a.x-a.width).toFixed(1)} mm`,'x',i,nearest.j));
      const below = boxes.map((b,j) => ({b,j})).filter(({b,j}) => j!==i && b.y>=a.y+a.height-.05 && Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)).sort((u,v) => u.b.y-v.b.y)[0];
      if (below) measurements.push(line(a.x+a.width/2,a.y+a.height,a.x+a.width/2,below.b.y,`${(below.b.y-a.y-a.height).toFixed(1)} mm`,'y',i,below.j));
    });
    return `<section class="series-editor" data-series-editor="${work.id}"><h5>組写真の配置</h5><p class="exhibition-muted">全体：${escape(layoutDescription(work.photos))}</p>
      <div class="exhibition-actions series-toolbar"><label class="exhibition-check"><input type="checkbox" data-series-setting="snap" ${s.snap?"checked":""}/>グリッドスナップ</label><label class="exhibition-check"><input type="checkbox" data-series-setting="edgeSnap" ${s.edgeSnap?"checked":""}/>写真の端にスナップ</label><label>スナップ間隔 mm<input type="number" min=".1" max="1000" step=".1" data-series-setting="interval" value="${s.interval}"/></label><label>表示倍率<select data-series-setting="zoom">${[.25,.5,.75,1,1.5,2,3,4,6,8,...(![.25,.5,.75,1,1.5,2,3,4,6,8].includes(s.zoom)?[s.zoom]:[])].sort((a,b)=>a-b).map(z => `<option value="${z}" ${z===s.zoom?"selected":""}>${Math.round(z*100)}%</option>`).join("")}</select></label><button type="button" class="secondary" data-series-select-all>全写真を選択</button><button type="button" class="secondary" data-series-fit>全体表示</button></div>
      <p class="exhibition-muted">写真をドラッグして配置します。選択した写真は矢印キーでも移動できます。表示グリッド：${grid.toFixed(1)}mm</p>
      <div class="series-canvas-scroll"><div class="series-canvas" tabindex="0" style="height:${canvasHeight}px;background-size:${grid*scale*s.zoom}px ${grid*scale*s.zoom}px;background-position:${-ox*scale*s.zoom+s.pan.x}px ${-oy*scale*s.zoom+s.pan.y}px" data-series-work="${work.id}" data-scale="${scale*s.zoom}" data-base-scale="${scale}" data-origin-x="${ox}" data-origin-y="${oy}" aria-label="組写真レイアウト"><div class="series-plane" style="transform:translate(${s.pan.x}px,${s.pan.y}px) scale(${s.zoom})">
      ${work.photos.map((photo,i) => `<figure role="button" tabindex="0" aria-label="写真 ${i+1} を選択・移動" aria-pressed="${s.selected.includes(i)}" data-series-photo="${i}" class="${s.selected.includes(i)?"selected":""}" style="left:${(photo.x-ox)*scale}px;top:${(photo.y-oy)*scale}px;width:${photo.width*scale}px;height:${photo.height*scale}px;transform:rotate(${photo.rotation}deg)">${photo.assetId ? `<img alt="組写真 ${i+1}" src="${escape(options.assetUrl(photo.assetId))}"/>`:""}<figcaption>${i+1}</figcaption></figure>`).join("")}
      <svg class="series-measurements" width="100%" height="100%" aria-label="隣接写真の間隔（mm）">${measurements.join("")}</svg><svg class="series-guides" data-series-guides width="100%" height="100%"></svg></div></div></div>
      <div class="exhibition-actions series-selection">${work.photos.map((_,i) => `<label class="exhibition-check"><input type="checkbox" data-series-selection="${i}" ${s.selected.includes(i)?"checked":""}/>写真 ${i+1}</label>`).join("")}</div>
      <div class="series-inspectors"><fieldset><legend>2枚の間隔を指定</legend><div class="exhibition-grid"><label>基準の写真<select data-series-setting="reference">${choices(s.reference)}</select></label><label>動かす写真<select data-series-setting="moving">${choices(s.moving)}</select></label><label>横方向の間隔 mm<input type="number" step=".1" data-series-pair-gap="x" value="${pair?.x??0}" ${pair?"":"disabled"}/></label><label>縦方向の間隔 mm<input type="number" step=".1" data-series-pair-gap="y" value="${pair?.y??0}" ${pair?"":"disabled"}/></label></div><p class="exhibition-muted">回転後の外接枠の端から測ります。負の値は、その方向で枠が重なることを表します。</p></fieldset>
      <fieldset><legend>選択写真を等間隔で並べる</legend><div class="exhibition-grid"><label>並べ方<select data-series-setting="mode">${[["grid","グリッド"],["horizontal","横一列"],["vertical","縦一列"]].map(([v,l]) => `<option value="${v}" ${s.mode===v?"selected":""}>${l}</option>`).join("")}</select></label><label>グリッドの列数<input type="number" min="1" max="100" data-series-setting="columns" value="${s.columns}" ${s.mode!=="grid"?"disabled":""}/></label><label>横の間隔 mm<input type="number" min="0" max="100000" step=".1" data-series-setting="gapX" value="${s.gapX}"/></label><label>縦の間隔 mm<input type="number" min="0" max="100000" step=".1" data-series-setting="gapY" value="${s.gapY}"/></label></div><p class="exhibition-muted">写真の番号順に並べます。サイズが異なるグリッドは、各列・行の最大寸法で区画を揃えます。</p><button class="secondary" type="button" data-series-arrange>選択した写真を並べる</button></fieldset></div></section>`;
  }
  function bind(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>("[data-series-editor]").forEach(editor => {
      const work = options.getWork(editor.dataset.seriesEditor!); if (!work) return;
      const s=state(work);
      editor.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-series-setting]").forEach(input => input.addEventListener("change", () => {
        const key=input.dataset.seriesSetting as keyof State;
        if(key==="snap" || key==="edgeSnap") s[key]=(input as HTMLInputElement).checked;
        else if(key==="mode") s.mode=input.value as State["mode"];
        else { const value=Number(input.value); if(!Number.isFinite(value) || key==="interval" && (value<.1 || value>1000)) { options.message("スナップ間隔は0.1〜1000mmで入力してください。",true); return; } (s as unknown as Record<string,unknown>)[key]=value; }
        options.change();
      }));
      editor.querySelectorAll<HTMLInputElement>("[data-series-selection]").forEach(input => input.addEventListener("change", () => { const i=Number(input.dataset.seriesSelection); s.selected=input.checked?[...new Set([...s.selected,i])]:s.selected.filter(n=>n!==i); paintSelection(); }));
      editor.querySelector<HTMLButtonElement>("[data-series-fit]")?.addEventListener("click",()=>{s.view=undefined;s.zoom=1;s.pan={x:0,y:0};options.change();});
      editor.querySelector<HTMLButtonElement>("[data-series-select-all]")?.addEventListener("click", () => {s.selected=work.photos.map((_,i)=>i); paintSelection();});
      editor.querySelectorAll<HTMLInputElement>("[data-series-pair-gap]").forEach(input => input.addEventListener("change", () => {
        const gap=Number(input.value); if(!Number.isFinite(gap) || Math.abs(gap)>100000 || s.reference===s.moving) {options.message("異なる写真を選び、間隔を数値で入力してください。",true); return;}
        work.photos[s.moving]=setPhotoGap(work.photos[s.reference],work.photos[s.moving],input.dataset.seriesPairGap as "x"|"y",gap); options.change();
      }));
      editor.querySelector<HTMLButtonElement>("[data-series-arrange]")?.addEventListener("click", () => {
        if(s.selected.length<2) {options.message("並べる写真を2枚以上選んでください。",true);return;}
        try { work.photos=arrangePhotos(work.photos,s.selected,s.mode,s.columns,s.gapX,s.gapY); options.change(); } catch(error) {options.message(error instanceof Error?error.message:"配置できませんでした。",true);}
      });
      const canvas=editor.querySelector<HTMLElement>(".series-canvas")!,plane=canvas.querySelector<HTMLElement>(".series-plane")!,base=Number(canvas.dataset.baseScale);
      const ox=Number(canvas.dataset.originX),oy=Number(canvas.dataset.originY),pointers=new Map<number,{x:number;y:number}>();
      let drag:{id:number;start:{x:number;y:number};photos:Work["photos"];pan:{x:number;y:number};photo:boolean}|undefined;
      let pinch:{distance:number;center:{x:number;y:number};zoom:number;pan:{x:number;y:number}}|undefined;
      const local=(e:{clientX:number;clientY:number})=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
      const paintSelection=()=>{
        canvas.querySelectorAll<HTMLElement>("[data-series-photo]").forEach(f=>{const selected=s.selected.includes(Number(f.dataset.seriesPhoto));f.classList.toggle("selected",selected);f.setAttribute("aria-pressed",String(selected));});
        editor.querySelectorAll<HTMLInputElement>("[data-series-selection]").forEach(i=>i.checked=s.selected.includes(Number(i.dataset.seriesSelection)));
      };
      const paintPhotos=()=>work.photos.forEach((p,i)=>{const f=canvas.querySelector<HTMLElement>(`[data-series-photo="${i}"]`)!;f.style.left=`${(p.x-ox)*base}px`;f.style.top=`${(p.y-oy)*base}px`;});
      const refreshGapHits=()=>editor.querySelectorAll<SVGGElement>('[data-series-gap-axis]').forEach(group=>{const text=group.querySelector('text'),hit=group.querySelector<SVGRectElement>('[data-series-gap-hit]');if(!text||!hit)return;try{const box=text.getBBox();if(!box.width)return;const padding=12*Math.max(0,1-Math.log2(Math.max(1,s.zoom))/2)/s.zoom;hit.setAttribute('x',String(box.x-padding));hit.setAttribute('y',String(box.y-padding));hit.setAttribute('width',String(box.width+2*padding));hit.setAttribute('height',String(box.height+2*padding));}catch{}});
      requestAnimationFrame(refreshGapHits);
      void document.fonts.ready.then(()=>{if(editor.isConnected)refreshGapHits();});
      const viewport=()=>{refreshGapHits();plane.style.transform=`translate(${s.pan.x}px,${s.pan.y}px) scale(${s.zoom})`;canvas.dataset.scale=String(base*s.zoom);const grid=s.interval*Math.max(1,Math.ceil(8/(s.interval*base*s.zoom)));canvas.style.backgroundSize=`${grid*base*s.zoom}px ${grid*base*s.zoom}px`;canvas.style.backgroundPosition=`${-ox*base*s.zoom+s.pan.x}px ${-oy*base*s.zoom+s.pan.y}px`;const select=editor.querySelector<HTMLSelectElement>('[data-series-setting="zoom"]');if(select){const value=String(s.zoom);if(![...select.options].some(o=>o.value===value))select.add(new Option(`${Math.round(s.zoom*100)}%`,value));select.value=value;}};
      const zoomAt=(zoom:number,center:{x:number;y:number})=>{const next=Math.max(.25,Math.min(8,zoom)),ratio=next/s.zoom;s.pan={x:center.x-(center.x-s.pan.x)*ratio,y:center.y-(center.y-s.pan.y)*ratio};s.zoom=next;viewport();};
      const pinchPair=()=>{const [a,b]=[...pointers.values()];return{distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};};
      const guides=canvas.querySelector<SVGSVGElement>("[data-series-guides]")!;
      const clearGuides=()=>guides.replaceChildren();
      const scroll={x:0,y:0};const blockWheel=(e:WheelEvent)=>e.preventDefault();
      const keepScroll=()=>{if(window.scrollX!==scroll.x||window.scrollY!==scroll.y)window.scrollTo({left:scroll.x,top:scroll.y,behavior:"instant"});};
      const release=()=>{delete canvas.dataset.dragging;window.removeEventListener("wheel",blockWheel,true);window.removeEventListener("scroll",keepScroll);};
      const gapWork=work;function chooseFixed(index:number){const work=gapWork;const editing=s.gapEdit;if(!editing||![editing.a,editing.b].includes(index))return;const moving=index===editing.a?editing.b:editing.a;if(!work.photos[index]||!work.photos[moving]){s.gapEdit=undefined;options.message("写真の配置が変更されています。間隔を選び直してください。",true);return;}work.photos[moving]=setPhotoGap(work.photos[index],work.photos[moving],editing.axis,editing.value);s.reference=index;s.moving=moving;s.gapEdit=undefined;options.change();}
      function editGap(element:Element){const work=gapWork;const a=Number((element as SVGElement).dataset.seriesGapA),b=Number((element as SVGElement).dataset.seriesGapB),axis=(element as SVGElement).dataset.seriesGapAxis as 'x'|'y';if(!work.photos[a]||!work.photos[b])return;const value=photoGaps(work.photos[a],work.photos[b])[axis],dialog=document.createElement('dialog');dialog.className='exhibition-confirm-dialog exhibition-page series-gap-dialog';dialog.setAttribute('aria-label','写真間隔の編集');dialog.innerHTML=`<h2>写真${a+1}と写真${b+1}の間隔</h2><label>${axis==='x'?'横':'縦'}の間隔 mm<input type="number" step=".1" min="-100000" max="100000" value="${value}" data-series-gap-value/></label><p>数値を入力した後、キャンバスで固定する写真を選んでください。もう片方だけを移動します。</p><div class="exhibition-actions"><button type="button" data-series-gap-next>基準の写真を選ぶ</button><button type="button" class="secondary" data-series-gap-cancel>取消</button></div>`;document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});const input=dialog.querySelector<HTMLInputElement>('input')!;const next=()=>{const value=Number(input.value);if(!Number.isFinite(value)||Math.abs(value)>100000){input.setCustomValidity('間隔は−100000〜100000mmで入力してください。');input.reportValidity();return;}s.gapEdit={a,b,axis,value};dialog.close();editor.querySelectorAll<HTMLElement>('[data-series-photo]').forEach(photo=>photo.classList.toggle('series-gap-pick',[a,b].includes(Number(photo.dataset.seriesPhoto))));options.message('固定する写真をクリックするか、写真にフォーカスしてEnterを押してください。');};dialog.querySelector('[data-series-gap-next]')!.addEventListener('click',next);dialog.querySelector('[data-series-gap-cancel]')!.addEventListener('click',()=>dialog.close());input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();next();}});dialog.showModal();input.focus({preventScroll:true});input.select();}
      editor.querySelectorAll<SVGElement>('[data-series-gap-axis]').forEach(g=>g.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();editGap(g);}}));
      editor.addEventListener('keydown',event=>{if(s.gapEdit&&event.key==='Escape'){s.gapEdit=undefined;editor.querySelectorAll('.series-gap-pick').forEach(p=>p.classList.remove('series-gap-pick'));}const photo=(event.target as Element).closest<HTMLElement>('[data-series-photo]');if(s.gapEdit&&photo&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();chooseFixed(Number(photo.dataset.seriesPhoto));}});
      canvas.addEventListener("pointerdown",event=>{
        if(options.busy()||event.button!==0)return;const measurement=(event.target as Element).closest<SVGElement>("[data-series-gap-axis]");if(measurement){event.preventDefault();editGap(measurement);return;}const fixedPhoto=(event.target as Element).closest<HTMLElement>("[data-series-photo]");if(s.gapEdit){event.preventDefault();if(fixedPhoto)chooseFixed(Number(fixedPhoto.dataset.seriesPhoto));return;}event.preventDefault();canvas.focus({preventScroll:true});
        canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,local(event));
        if(pointers.size===2){if(drag?.photo)work.photos=drag.photos.map(p=>({...p}));drag=undefined;paintPhotos();clearGuides();pinch={...pinchPair(),zoom:s.zoom,pan:{...s.pan}};return;}
        if(pointers.size>2)return;
        const target=(event.target as HTMLElement).closest<HTMLElement>("[data-series-photo]"),index=target?Number(target.dataset.seriesPhoto):-1;
        if(index>=0) {if(event.shiftKey||event.ctrlKey||event.metaKey)s.selected=[...new Set([...s.selected,index])];else if(!s.selected.includes(index))s.selected=[index];}else s.selected=[];
        if(target)target.focus({preventScroll:true});
        paintSelection();drag={id:event.pointerId,start:local(event),photos:work.photos.map(p=>({...p})),pan:{...s.pan},photo:index>=0};
        canvas.dataset.dragging="true";scroll.x=window.scrollX;scroll.y=window.scrollY;window.addEventListener("wheel",blockWheel,{capture:true,passive:false});window.addEventListener("scroll",keepScroll);
      });
      canvas.addEventListener("pointermove",event=>{
        if(!pointers.has(event.pointerId))return;event.preventDefault();pointers.set(event.pointerId,local(event));
        if(pinch && pointers.size>=2) {const p=pinchPair(),next=Math.max(.25,Math.min(8,pinch.zoom*p.distance/pinch.distance)),ratio=next/pinch.zoom;s.pan={x:p.center.x-(pinch.center.x-pinch.pan.x)*ratio,y:p.center.y-(pinch.center.y-pinch.pan.y)*ratio};s.zoom=next;viewport();return;}
        if(!drag || drag.id!==event.pointerId)return;
        const p=local(event),scale=base*s.zoom;
        if(!drag.photo){s.pan={x:drag.pan.x+p.x-drag.start.x,y:drag.pan.y+p.y-drag.start.y};viewport();return;}
        let dx=(p.x-drag.start.x)/scale,dy=(p.y-drag.start.y)/scale;
        const snapped=s.edgeSnap&&!event.altKey?snapPhotoEdges(drag.photos,s.selected,dx,dy,6/scale):{dx,dy,xGuide:undefined,yGuide:undefined};
        const primary=drag.photos[s.selected[0]];
        dx=snapped.xGuide===undefined && s.snap&&!event.altKey?snapMm(primary.x+dx,s.interval)-primary.x:snapped.dx;
        dy=snapped.yGuide===undefined && s.snap&&!event.altKey?snapMm(primary.y+dy,s.interval)-primary.y:snapped.dy;
        s.selected.forEach(i=>{work.photos[i].x=snapMm(drag!.photos[i].x+dx,0);work.photos[i].y=snapMm(drag!.photos[i].y+dy,0);});paintPhotos();clearGuides();
        const r=canvas.getBoundingClientRect();for(const [axis,value]of [["x",snapped.xGuide],["y",snapped.yGuide]] as const)if(value!==undefined){const line=document.createElementNS("http://www.w3.org/2000/svg","line"),v=(value-(axis==="x"?ox:oy))*base;line.setAttribute("x1",String(axis==="x"?v:-s.pan.x/s.zoom));line.setAttribute("x2",String(axis==="x"?v:(r.width-s.pan.x)/s.zoom));line.setAttribute("y1",String(axis==="y"?v:-s.pan.y/s.zoom));line.setAttribute("y2",String(axis==="y"?v:(r.height-s.pan.y)/s.zoom));guides.append(line);}
      });
      const end=(event:PointerEvent)=>{
        if(!pointers.has(event.pointerId))return;
        if(event.type==="pointercancel" && drag) {if(drag.photo)work.photos=drag.photos;else s.pan=drag.pan;}
        pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        if(pinch && pointers.size<2){pinch=undefined;drag=undefined;}
        if(!pointers.size){release();drag=undefined;clearGuides();const x=window.scrollX,y=window.scrollY;options.change();window.scrollTo({left:x,top:y,behavior:"instant"});}
      };
      canvas.addEventListener("pointerup",end);canvas.addEventListener("pointercancel",end);
      canvas.addEventListener("wheel",event=>{if(!event.ctrlKey||options.busy())return;event.preventDefault();zoomAt(s.zoom*Math.exp(-event.deltaY*.01),local(event));},{passive:false});
      let safariZoom=1;canvas.addEventListener("gesturestart",event=>{event.preventDefault();safariZoom=s.zoom;});canvas.addEventListener("gesturechange",event=>{event.preventDefault();const e=event as Event&{scale:number;clientX:number;clientY:number};zoomAt(safariZoom*e.scale,local(e));});
      const clearSelection=()=>{if(drag?.photo)work.photos=drag.photos;drag=undefined;pinch=undefined;s.selected=[];s.gapEdit=undefined;editor.querySelectorAll(".series-gap-pick").forEach(p=>p.classList.remove("series-gap-pick"));paintPhotos();paintSelection();clearGuides();release();};
      editor.addEventListener("series:clear-selection",clearSelection);
      editor.addEventListener("series:dispose",release);
      editor.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();clearSelection();}});
      canvas.querySelectorAll<HTMLElement>("figure[data-series-photo]").forEach(figure=>figure.addEventListener("keydown",event=>{
        const i=Number(figure.dataset.seriesPhoto);if(options.busy()||!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(event.key))return;
        event.preventDefault();if(event.key===" "){s.selected=s.selected.includes(i)?s.selected.filter(n=>n!==i):[...s.selected,i];paintSelection();return;}
        const amount=(s.snap?s.interval:1)*(event.shiftKey?10:1),x=event.key==="ArrowLeft"?-amount:event.key==="ArrowRight"?amount:0,y=event.key==="ArrowUp"?-amount:event.key==="ArrowDown"?amount:0;
        (s.selected.includes(i)?s.selected:[i]).forEach(index=>{work.photos[index].x=snapMm(work.photos[index].x+x,0);work.photos[index].y=snapMm(work.photos[index].y+y,0);});options.change();root.querySelector<HTMLElement>(`[data-series-work="${work.id}"] [data-series-photo="${i}"]`)?.focus({preventScroll:true});
      }));

    });
  }
  // Photo indices change after deletion; discard selection and pending gap edits.
  const reset = (workId: string) => states.delete(workId);
  return {html,bind,reset};
}
