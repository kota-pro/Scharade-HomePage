import '../styles/ExhibitionBoardManager.css';
import { boardElementLabels,boardElements,type BoardDesign,type BoardElement,type BoardFrame } from '../lib/exhibitionBoardDesign.ts';
import { readExhibitionResponse } from './exhibitionResponse.ts';
type Any=Record<string,any>;
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function openBoardManager(options:{exhibitionId:string;trigger:HTMLElement;changed:()=>Promise<void>;message:(message:string,error?:boolean)=>void;workId?:string}) {
  if(document.querySelector('.board-manager[open]'))return;
  const dialog=document.createElement('dialog');dialog.className='board-manager exhibition-page';dialog.setAttribute('aria-label','タイトルボードの配置・印刷設定');
  dialog.innerHTML=`<header class="board-manager-header"><div><h2>Title board</h2><p>配置の調整・印刷する作品の選択</p></div><button type="button" class="layout-close" data-bm-close aria-label="タイトルボードを閉じる"><span></span><span></span></button></header><p class="board-manager-status" data-bm-status role="status" aria-live="polite"></p><main data-bm-body></main>`;
  const status=dialog.querySelector<HTMLElement>('[data-bm-status]')!,body=dialog.querySelector<HTMLElement>('[data-bm-body]')!;
  const endpoint=`/api/member/exhibitions/${encodeURIComponent(options.exhibitionId)}/boards`;
  let catalog:Any|undefined,card:Any|undefined,selected:BoardElement='title',design:BoardDesign={},original='',query='',onlyIssues=false,changed=false,busy=false,loading=false,mode='select',zoom=1,pan={x:0,y:0},snap=true;
  const excluded=new Set<string>(),undo:BoardDesign[]=[],redo:BoardDesign[]=[];
  let requestId=0,previewTimer:number|undefined,pending:AbortController|undefined,detachKeyboard:(()=>void)|undefined;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';document.body.append(dialog);dialog.showModal();
  const message=(text:string,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
  const dirty=()=>!!card&&JSON.stringify(design)!==original;
  const api=async(url:string,body?:unknown)=>{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(30000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await readExhibitionResponse(response);if(!response.ok||!result.ok)throw new Error(result.message??'タイトルボードを読み込めませんでした。');return result;};
  const close=()=>{if(busy)return;if(dirty()&&!confirm('保存していない配置の変更を破棄しますか？'))return;dialog.close();};
  dialog.querySelector('[data-bm-close]')!.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{requestId++;pending?.abort();clearTimeout(previewTimer);detachKeyboard?.();dialog.remove();document.body.style.overflow=overflow;if(options.trigger.isConnected)options.trigger.focus({preventScroll:true});if(changed)void options.changed();},{once:true});
  const loadCatalog=async()=>{catalog=await api(endpoint);};
  const pushUndo=()=>{undo.push(structuredClone(design));if(undo.length>50)undo.shift();redo.length=0;};
  const updateDirty=()=>{const text=body.querySelector<HTMLElement>('[data-bm-dirty]');if(text)text.textContent=dirty()?'未保存の変更があります':'保存済み';const previous=body.querySelector<HTMLButtonElement>('[data-bm-undo]'),next=body.querySelector<HTMLButtonElement>('[data-bm-redo]');if(previous)previous.disabled=!undo.length||busy;if(next)next.disabled=!redo.length||busy;};
  const list=()=>{
    detachKeyboard?.();card=undefined;message('赤い通知は調整が必要な項目です。印刷しない作品にチェックを入れ、PDFを生成してください。');
    body.innerHTML=`<div class="board-catalog-controls"><label>作品・作者名で検索<input type="search" data-bm-search value="${escape(query)}"/></label><label class="board-checkbox"><input type="checkbox" data-bm-issues-only ${onlyIssues?'checked':''}/>調整が必要な作品のみ</label><button type="button" class="secondary" data-bm-all>すべて印刷</button><button type="button" class="secondary" data-bm-none>すべて除外</button></div><p data-bm-count></p><div class="board-catalog" data-bm-catalog></div><footer class="board-manager-footer"><p>PDFはA4に8枚ずつ配置します。配置・QRの問題がある作品は調整するか、印刷から除外してください。</p><button type="button" class="board-primary" data-bm-print>選択内容でPDFを生成</button></footer>`;
    const cards=body.querySelector<HTMLElement>('[data-bm-catalog]')!;
    const renderList=()=>{
      const works=(catalog!.works as Any[]).filter(w=>(!onlyIssues||w.issues.length)&&[w.title,w.author,w.name].join(' ').normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase()));
      cards.innerHTML=works.map(w=>`<article class="board-catalog-card" data-bm-work="${escape(w.id)}"><img src="/api/member/exhibitions/${encodeURIComponent(options.exhibitionId)}/output?kind=board-preview&workId=${encodeURIComponent(w.id)}" alt="${escape(w.title)}のタイトルボード" loading="lazy"/><h3>${escape(w.title||'無題')}${w.issues.length?'<span class="board-error-dot" title="配置の調整が必要です" aria-label="配置の調整が必要です">!</span>':''}</h3><p>${escape(w.author)} ／ ${escape(w.name)}</p><ul>${w.issues.map((i:Any)=>`<li><strong>${escape(i.label)}</strong>：${escape(i.message)}</li>`).join('')}</ul><div><label class="board-checkbox"><input type="checkbox" data-bm-exclude="${escape(w.id)}" ${excluded.has(w.id)?'checked':''}/>印刷しない</label><button type="button" class="secondary" data-bm-edit="${escape(w.id)}">配置を調整</button></div></article>`).join('')||'<p>該当する作品はありません。</p>';
      cards.querySelectorAll<HTMLInputElement>('[data-bm-exclude]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)excluded.add(input.dataset.bmExclude!);else excluded.delete(input.dataset.bmExclude!);count();}));
      cards.querySelectorAll<HTMLButtonElement>('[data-bm-edit]').forEach(button=>button.addEventListener('click',()=>void openCard(button.dataset.bmEdit!)));
      count();
    };
    const count=()=>{body.querySelector('[data-bm-count]')!.textContent=`印刷 ${catalog!.works.length-[...excluded].filter(id=>catalog!.works.some((w:Any)=>w.id===id)).length} / ${catalog!.works.length}作品 ／ 表示 ${cards.querySelectorAll('article').length}作品`;};
    body.querySelector<HTMLInputElement>('[data-bm-search]')!.addEventListener('input',event=>{query=(event.target as HTMLInputElement).value;renderList();});
    body.querySelector<HTMLInputElement>('[data-bm-issues-only]')!.addEventListener('change',event=>{onlyIssues=(event.target as HTMLInputElement).checked;renderList();});
    body.querySelector('[data-bm-all]')!.addEventListener('click',()=>{excluded.clear();renderList();});
    body.querySelector('[data-bm-none]')!.addEventListener('click',()=>{catalog!.works.forEach((w:Any)=>excluded.add(w.id));renderList();});
    body.querySelector<HTMLButtonElement>('[data-bm-print]')!.addEventListener('click',async()=>{
      const works=(catalog!.works as Any[]).filter(w=>!excluded.has(w.id));
      if(!works.length){message('印刷する作品を1つ以上選択してください。',true);return;}
      if(works.some(w=>w.issues.length)){message('赤い通知がある作品の配置・QRを調整するか、印刷しないにチェックしてください。',true);return;}
      busy=true;const button=body.querySelector<HTMLButtonElement>('[data-bm-print]')!;button.disabled=true;message('PDFを生成しています…');
      try{
        const response=await fetch(`/api/member/exhibitions/${encodeURIComponent(options.exhibitionId)}/output?kind=boards`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:catalog!.revision,workIds:works.map(w=>w.id),submissionRevisions:Object.fromEntries(works.map(w=>[w.id,w.submissionRevision]))})});
        if(!response.ok){const problem=await readExhibitionResponse(response);throw new Error(problem.message??'PDFを生成できませんでした。');}
        const bytes=await response.blob(),url=URL.createObjectURL(bytes),link=document.createElement('a');link.href=url;link.download=`${catalog!.title}-タイトルボード.pdf`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);message(`${works.length}作品のPDFを生成しました。Driveへの保存は順次処理します。`);options.message('タイトルボードPDFを生成しました。');
      }catch(error){message(error instanceof Error?error.message:'PDFを生成できませんでした。',true);}finally{busy=false;button.disabled=false;}
    });
    renderList();
  };
  const openCard=async(workId:string)=>{
    if(busy||loading)return;loading=true;message('タイトルボードを読み込んでいます…');
    try{card=await api(`${endpoint}?workId=${encodeURIComponent(workId)}`);design=structuredClone(card.design);original=JSON.stringify(design);undo.length=redo.length=0;selected='title';zoom=1;pan={x:0,y:0};editor();message('項目を選択してドラッグで移動、四隅で枠の大きさを変更できます。文字・内容は提出詳細で修正できます。');}
    catch(error){message(error instanceof Error?error.message:'読み込めませんでした。',true);}finally{loading=false;}
  };
  const preview=async()=>{
    if(!card||!dialog.open)return;const id=++requestId,workId=card.workId;pending?.abort();pending=new AbortController();
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',workId,design}),signal:pending.signal});const result=await readExhibitionResponse(response);
      if(!response.ok||!result.ok)throw new Error(result.message??'プレビューを更新できませんでした。');
      if(id!==requestId||card?.workId!==workId)return;card={...card,scene:result.scene,issues:result.issues,svg:result.svg};renderCanvas();renderIssues();updateDirty();
    }catch(error){if(id===requestId&&!(error instanceof Error&&error.name==='AbortError'))message(error instanceof Error?error.message:'プレビューを更新できませんでした。',true);}
  };
  const schedulePreview=()=>{clearTimeout(previewTimer);previewTimer=window.setTimeout(()=>void preview(),180);};
  const frames=()=>({...card!.scene.frames,...design}) as Record<BoardElement,BoardFrame>;
  const renderIssues=()=>{
    const box=body.querySelector<HTMLElement>('[data-bm-warnings]');if(!box)return;
    box.innerHTML=card!.issues.length?`<h3><span class="board-error-dot">!</span>調整が必要な項目</h3><ul>${card!.issues.map((i:Any)=>`<li><button type="button" data-bm-issue="${escape(i.element)}">${escape(i.label)}：${escape(i.message)}</button></li>`).join('')}</ul>`:'<p>✓ 枠内に収まっています。</p>';
    box.querySelectorAll<HTMLButtonElement>('[data-bm-issue]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.bmIssue as BoardElement;renderCanvas();inspector();}));
  };
  const renderCanvas=()=>{
    if(!card)return;const stage=body.querySelector<HTMLElement>('[data-bm-stage]');if(!stage)return;
    const f=frames(),view={x:52.5-52.5/zoom-pan.x,y:37.125-37.125/zoom-pan.y,w:105/zoom,h:74.25/zoom};
    const parser=new DOMParser(),svg=parser.parseFromString(card.svg,'image/svg+xml').documentElement;
    svg.removeAttribute('width');svg.removeAttribute('height');svg.setAttribute('data-bm-canvas','');svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);svg.setAttribute('aria-label','105 × 74.25 mm タイトルボード');
    svg.querySelectorAll('[data-board-element]').forEach(node=>{const key=node.getAttribute('data-board-element') as BoardElement;const before=card!.scene.frames[key],after=f[key];node.setAttribute('transform',`translate(${after.x-before.x} ${after.y-before.y})`);});
    stage.replaceChildren(document.importNode(svg,true));const canvas=stage.querySelector('svg')!;
    if(snap){const grid=document.createElementNS('http://www.w3.org/2000/svg','g');grid.classList.add('board-design-grid');for(let x=5;x<105;x+=5){grid.insertAdjacentHTML('beforeend',`<path d="M${x} 0V74.25"/>`);}for(let y=5;y<74.25;y+=5)grid.insertAdjacentHTML('beforeend',`<path d="M0 ${y}H105"/>`);canvas.append(grid);}
    for(const element of card.scene.active as BoardElement[]){const b=f[element],group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('data-bm-object',element);group.classList.add('board-design-object');if(element===selected)group.classList.add('is-selected');if(card.issues.some((i:Any)=>i.element===element))group.classList.add('has-issue');group.innerHTML=`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/><title>${boardElementLabels[element]}</title>`;if(element===selected)for(const [corner,cx,cy]of [['nw',b.x,b.y],['ne',b.x+b.width,b.y],['sw',b.x,b.y+b.height],['se',b.x+b.width,b.y+b.height]] as const)group.insertAdjacentHTML('beforeend',`<rect data-bm-handle="${corner}" x="${cx-.6/zoom}" y="${cy-.6/zoom}" width="${1.2/zoom}" height="${1.2/zoom}"/>`);canvas.append(group);}
    stage.dataset.mode=mode;
    body.querySelectorAll<HTMLButtonElement>('[data-bm-element]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.bmElement===selected)));
  };
  const inspector=()=>{
    const f=frames()[selected],box=body.querySelector<HTMLElement>('[data-bm-inspector]')!;
    box.innerHTML=`<h3>${boardElementLabels[selected]}</h3><p>位置・枠の寸法はmm、文字サイズはpt</p><div class="board-inspector-grid">${(['x','y','width','height','fontSize','lineHeight'] as const).filter(key=>selected!=='qr'||!['fontSize','lineHeight','height'].includes(key)).map(key=>`<label>${({x:'X（mm）',y:'Y（mm）',width:'幅（mm）',height:'高さ（mm）',fontSize:'文字（pt）',lineHeight:'行送り（mm）'})[key]}<input type="number" step="0.1" data-bm-number="${key}" value="${Number(f[key].toFixed(2))}" min="${key==='x'||key==='y'?-105:key==='fontSize'?4:.1}" max="${key==='fontSize'?48:key==='lineHeight'?30:150}"/></label>`).join('')}</div><p>枠の変更に合わせて文字は自動で折り返されます。QRは正方形を保ちます。</p><button type="button" class="secondary" data-bm-reset-element>この項目を標準配置に戻す</button>`;
    box.querySelectorAll<HTMLInputElement>('[data-bm-number]').forEach(input=>input.addEventListener('change',()=>{
      if(busy)return;if(!input.reportValidity()||!Number.isFinite(input.valueAsNumber)){message('指定できる範囲内の数値を入力してください。',true);inspector();return;}pushUndo();const key=input.dataset.bmNumber as keyof BoardFrame,current=frames()[selected];design[selected]={...current,[key]:input.valueAsNumber};if(selected==='qr'&&key==='width')design[selected]!.height=input.valueAsNumber;renderCanvas();updateDirty();schedulePreview();
    }));
    box.querySelector('[data-bm-reset-element]')!.addEventListener('click',()=>{if(busy)return;pushUndo();delete design[selected];void preview().then(inspector);updateDirty();});updateDirty();
  };
  const editor=()=>{
    body.innerHTML=`<nav class="board-editor-toolbar"><button type="button" class="secondary" data-bm-back>作品一覧・印刷へ</button><button type="button" class="secondary" data-bm-mode="select" aria-pressed="true">選択</button><button type="button" class="secondary" data-bm-mode="pan" aria-pressed="false">画面を移動</button><button type="button" class="secondary" data-bm-undo aria-label="元に戻す">↶</button><button type="button" class="secondary" data-bm-redo aria-label="やり直す">↷</button><label class="board-checkbox"><input type="checkbox" data-bm-snap checked/>1mmスナップ・グリッド</label><label>倍率<select data-bm-zoom>${[.5,1,1.5,2,3,4].map(n=>`<option value="${n}" ${n===zoom?'selected':''}>${n*100}%</option>`).join('')}</select></label></nav><div class="board-editor"><aside class="board-editor-elements"><h3>項目</h3>${(card!.scene.active as BoardElement[]).map(element=>`<button type="button" data-bm-element="${element}" aria-pressed="${element===selected}">${boardElementLabels[element]}</button>`).join('')}<div data-bm-warnings></div></aside><div class="board-editor-artboard"><div class="board-design-stage" data-bm-stage></div><p>105 × 74.25 mm ／ A4 8分割・Zen Old Mincho</p></div><aside class="board-editor-inspector" data-bm-inspector></aside></div><footer class="board-manager-footer"><div><strong>${escape(catalog!.works.find((w:Any)=>w.id===card!.workId)?.title)}</strong><span data-bm-dirty></span><small>配置だけを保存します。提出内容・原本は維持されます。</small></div><button type="button" class="board-primary" data-bm-save>配置を保存</button></footer>`;
    renderCanvas();inspector();renderIssues();
    const stage=body.querySelector<HTMLElement>('[data-bm-stage]')!;
    body.querySelector('[data-bm-back]')!.addEventListener('click',async()=>{if(busy||dirty()&&!confirm('保存していない配置の変更を破棄しますか？'))return;clearTimeout(previewTimer);pending?.abort();requestId++;try{await loadCatalog();list();}catch(error){message(error instanceof Error?error.message:'一覧を読み込めませんでした。',true);}});
    body.querySelectorAll<HTMLButtonElement>('[data-bm-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.bmMode!;body.querySelectorAll('[data-bm-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.bmMode===mode)));renderCanvas();}));
    body.querySelectorAll<HTMLButtonElement>('[data-bm-element]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.bmElement as BoardElement;renderCanvas();inspector();}));
    const history=(reverse=false)=>{if(busy)return;const from=reverse?redo:undo,to=reverse?undo:redo,next=from.pop();if(!next)return;to.push(structuredClone(design));design=next;renderCanvas();inspector();schedulePreview();};
    body.querySelector('[data-bm-undo]')!.addEventListener('click',()=>history());body.querySelector('[data-bm-redo]')!.addEventListener('click',()=>history(true));
    body.querySelector<HTMLInputElement>('[data-bm-snap]')!.addEventListener('change',event=>{snap=(event.target as HTMLInputElement).checked;renderCanvas();});
    body.querySelector<HTMLSelectElement>('[data-bm-zoom]')!.addEventListener('change',event=>{zoom=Number((event.target as HTMLSelectElement).value);pan={x:0,y:0};renderCanvas();});
    let drag:{id:number;start:{x:number;y:number};frame:BoardFrame;key:BoardElement;handle:string;pan:{x:number;y:number};movingPan:boolean;changed:boolean;matrix:DOMMatrix}|undefined;
    const point=(event:PointerEvent)=>{const svg=stage.querySelector('svg')!;return new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());};
    stage.addEventListener('pointerdown',event=>{if(busy||event.button!==0)return;const hit=(event.target as Element).closest<SVGElement>('[data-bm-object]'),p=point(event);if(mode!=='pan'&&!hit)return;event.preventDefault();if(hit)selected=hit.dataset.bmObject as BoardElement;const handle=(event.target as HTMLElement).dataset.bmHandle??'';drag={id:event.pointerId,start:p,frame:{...frames()[selected]},key:selected,handle,pan:{...pan},movingPan:mode==='pan',changed:false,matrix:stage.querySelector('svg')!.getScreenCTM()!.inverse()};stage.setPointerCapture(event.pointerId);if(hit){renderCanvas();inspector();}});
    stage.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(drag.matrix),dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(!drag.changed){if(!drag.movingPan)pushUndo();drag.changed=true;}if(drag.movingPan){pan={x:drag.pan.x+dx,y:drag.pan.y+dy};renderCanvas();return;}const f={...drag.frame},round=(v:number)=>snap&&!event.altKey?Math.round(v):Math.round(v*100)/100;
      if(!drag.handle){f.x=round(f.x+dx);f.y=round(f.y+dy);}else{const right=f.x+f.width,bottom=f.y+f.height;if(drag.handle.includes('w')){f.x=Math.min(right-1,round(f.x+dx));f.width=right-f.x;}else f.width=Math.max(1,round(f.width+dx));if(drag.handle.includes('n')){f.y=Math.min(bottom-1,round(f.y+dy));f.height=bottom-f.y;}else f.height=Math.max(1,round(f.height+dy));if(drag.key==='qr'){const size=Math.max(f.width,f.height);f.width=f.height=size;if(drag.handle.includes('w'))f.x=right-size;if(drag.handle.includes('n'))f.y=bottom-size;}}
      f.x=Math.max(-105,Math.min(150,f.x));f.y=Math.max(-105,Math.min(150,f.y));f.width=Math.min(150,f.width);f.height=Math.min(150,f.height);design[drag.key]=f;renderCanvas();updateDirty();
    });
    const end=(event:PointerEvent)=>{if(!drag||drag.id!==event.pointerId)return;const edited=drag.changed&&!drag.movingPan;drag=undefined;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);if(edited){inspector();schedulePreview();}};
    stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
    stage.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoom=Math.max(.5,Math.min(4,zoom*Math.exp(-event.deltaY*.005)));renderCanvas();},{passive:false});
    const keyboard=(event:KeyboardEvent)=>{if(!dialog.open||!card)return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();history(event.shiftKey);}};detachKeyboard?.();dialog.addEventListener('keydown',keyboard);detachKeyboard=()=>dialog.removeEventListener('keydown',keyboard);
    body.querySelector<HTMLButtonElement>('[data-bm-save]')!.addEventListener('click',async()=>{
      if(busy)return;busy=true;const button=body.querySelector<HTMLButtonElement>('[data-bm-save]')!;button.disabled=true;message('配置を保存しています…');clearTimeout(previewTimer);pending?.abort();requestId++;
      try{const result=await api(endpoint,{action:'save',workId:card!.workId,revision:card!.revision,submissionRevision:card!.submissionRevision,design});card!.revision=result.exhibition.revision;catalog!.revision=result.exhibition.revision;original=JSON.stringify(design);changed=true;await preview();updateDirty();message('配置を保存しました。赤い通知が残る場合は調整を続けてください。');options.message('タイトルボードの配置を保存しました。');}
      catch(error){message(error instanceof Error?error.message:'保存できませんでした。',true);}finally{busy=false;button.disabled=false;updateDirty();}
    });
  };
  try{message('提出済みの作品を確認しています…');await loadCatalog();if(options.workId){await openCard(options.workId);if(!card)list();}else list();}
  catch(error){message(error instanceof Error?error.message:'読み込めませんでした。',true);}
}
