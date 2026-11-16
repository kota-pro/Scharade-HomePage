import {readExhibitionResponse} from './exhibitionResponse.ts';
import type {ExhibitionAlbumPhoto} from '../lib/exhibitionAlbumPhotos.ts';
import '../styles/ExhibitionAlbumPicker.css';

export function openExhibitionAlbumPicker(options:{exhibitionId:string;trigger:HTMLButtonElement;save:(ids:string[],revision:number)=>Promise<void>}) {
  const dialog=document.createElement('dialog');dialog.className='exhibition-album-picker';dialog.setAttribute('aria-labelledby','exhibition-album-picker-title');dialog.setAttribute('aria-describedby','exhibition-album-picker-help');
  dialog.innerHTML=`<div class="exhibition-album-picker-shell"><div class="exhibition-album-picker-heading"><h2 id="exhibition-album-picker-title">写真の除外設定</h2><button type="button" data-album-cancel>閉じる</button><p id="exhibition-album-picker-help">写真を押すと除外・解除できます。最新の提出内容に含まれる写真を表示します。</p></div><div class="exhibition-album-picker-tools"><label>作品名・作者名・氏名で検索<input type="search" data-album-search placeholder="作品名・作者名・氏名" autocomplete="off"></label><label>表示する写真<select data-album-filter><option value="all">すべて</option><option value="included">表示候補</option><option value="excluded">除外中</option></select></label></div><div class="exhibition-album-picker-scroll"><p data-album-status role="status" aria-live="polite"></p><button type="button" data-album-reload hidden>一覧と保存済みの設定を読み直す</button><p data-album-count role="status"></p><div class="exhibition-album-picker-grid" data-album-grid></div><nav class="exhibition-album-picker-pages" aria-label="写真一覧のページ送り"><button type="button" data-album-prev>前へ</button><span data-album-page></span><button type="button" data-album-next>次へ</button></nav></div><div class="exhibition-album-picker-footer"><p>除外した写真はサイトの展示アルバムに表示せず、Lightroomへの新規追加も行いません。保存済みのLightroom写真・Drive原本・提出内容は保持します。</p><div><button type="button" data-album-cancel>キャンセル</button><button type="button" data-album-apply>選択して作成</button></div></div></div>`;
  document.body.append(dialog);
  const get=<T extends HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
  const search=get<HTMLInputElement>('[data-album-search]'),filter=get<HTMLSelectElement>('[data-album-filter]'),grid=get('[data-album-grid]'),status=get('[data-album-status]'),count=get('[data-album-count]'),prev=get<HTMLButtonElement>('[data-album-prev]'),next=get<HTMLButtonElement>('[data-album-next]'),apply=get<HTMLButtonElement>('[data-album-apply]'),reload=get<HTMLButtonElement>('[data-album-reload]'),scroll=get('.exhibition-album-picker-scroll');
  let photos:ExhibitionAlbumPhoto[]|null=null,selected=new Set<string>(),page=1,revision=0,created=false,busy=false,loading=false,failed=false;
  const pageSize=36,normal=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g,'');
  const render=()=>{
    const words=search.value.trim().split(/\s+/u).filter(Boolean).map(normal);
    const matched=(photos??[]).filter(p=>words.every(word=>[p.title,p.authorName,p.submissionName,p.name].some(value=>normal(value).includes(word)))&&(filter.value==='all'||selected.has(p.id)===(filter.value==='excluded')));
    const pages=Math.max(1,Math.ceil(matched.length/pageSize));page=Math.min(page,pages);
    const excluded=(photos??[]).filter(p=>selected.has(p.id)).length;
    count.textContent=photos?`表示候補 ${photos.length-excluded}枚 ／ 除外中 ${excluded}枚　（検索結果 ${matched.length}枚）`:'';
    if(photos&&selected.size>excluded)count.textContent+=` ※一覧にない${selected.size-excluded}枚の除外設定も保持します。`;
    const fragment=document.createDocumentFragment();
    for(const photo of matched.slice((page-1)*pageSize,page*pageSize)) {
      const button=document.createElement('button');button.type='button';button.dataset.albumPhoto=photo.id;button.setAttribute('aria-pressed',String(selected.has(photo.id)));button.setAttribute('aria-label',`${photo.title||'無題'}・${photo.authorName||photo.submissionName}を${selected.has(photo.id)?'除外から戻す':'除外する'}`);button.disabled=busy;
      const image=document.createElement('img');image.src=`/api/exhibitions/${encodeURIComponent(options.exhibitionId)}/assets/${encodeURIComponent(photo.id)}?preview=1`;image.alt='';image.loading='lazy';image.decoding='async';image.width=photo.width;image.height=photo.height;image.addEventListener('error',()=>{image.hidden=true;const fallback=document.createElement('span');fallback.className='exhibition-album-image-fallback';fallback.textContent='画像を読み込めませんでした';button.prepend(fallback);},{once:true});
      const title=document.createElement('span');title.textContent=photo.title||'無題';title.title=photo.name;
      const author=document.createElement('small');author.textContent=photo.authorName||photo.submissionName||'作者名未入力';
      const state=document.createElement('span');state.className='exhibition-album-photo-state';state.textContent=selected.has(photo.id)?'✓ 除外中':'表示候補';
      button.append(image,title,author,state);button.addEventListener('click',()=>{
        if(busy)return;if(!selected.has(photo.id)&&selected.size>=5000){status.textContent='除外設定は最大5,000枚です。';return;}
        selected.has(photo.id)?selected.delete(photo.id):selected.add(photo.id);const top=scroll.scrollTop;render();scroll.scrollTop=top;(grid.querySelector<HTMLButtonElement>(`[data-album-photo="${photo.id}"]`)??apply).focus({preventScroll:true});
      });fragment.append(button);
    }
    grid.replaceChildren(fragment);prev.disabled=loading||busy||page===1;next.disabled=loading||busy||page===pages;get('[data-album-page]').textContent=`${page} / ${pages}`;apply.disabled=loading||busy||failed||!photos;apply.textContent=busy?'反映しています…':created?'選択して設定を反映':'選択して作成';
    search.disabled=busy;filter.disabled=busy;reload.disabled=busy;dialog.querySelectorAll<HTMLButtonElement>('[data-album-cancel]').forEach(b=>b.disabled=busy);
    if(!loading&&!failed&&!busy)status.textContent=matched.length?'':photos?.length?'条件に合う写真はありません。':'提出済みの写真はまだありません。新しく提出された写真は表示候補になります。';
  };
  const load=async()=>{
    if(busy||loading)return;loading=true;failed=false;reload.hidden=true;status.classList.remove('error');status.textContent='写真一覧を読み込んでいます…';render();
    try{const response=await fetch(`/api/member/exhibitions/${options.exhibitionId}/album-photos`,{cache:'no-store',signal:AbortSignal.timeout(30000)}),value=await readExhibitionResponse(response);if(!response.ok||!value.ok||!Array.isArray(value.photos))throw new Error(value.message??'写真一覧を取得できませんでした。');photos=value.photos;selected=new Set(value.excludedAssetIds);revision=value.revision;created=value.albumCreated;page=1;}
    catch(error){failed=true;reload.hidden=false;status.classList.add('error');status.textContent=error instanceof Error?error.message:'写真一覧を取得できませんでした。';}
    finally{loading=false;render();}
  };
  for(const control of [search,filter])control.addEventListener('input',()=>{page=1;render();});
  for(const [button,delta] of [[prev,-1],[next,1]] as const)button.addEventListener('click',()=>{page+=delta;render();scroll.scrollTop=0;});
  reload.addEventListener('click',()=>void load());dialog.querySelectorAll('[data-album-cancel]').forEach(b=>b.addEventListener('click',()=>{if(!busy)dialog.close();}));
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)dialog.close();}},true);
  dialog.addEventListener('close',()=>{dialog.remove();(options.trigger.isConnected?options.trigger:document.querySelector<HTMLButtonElement>('[data-lightroom-create]'))?.focus({preventScroll:true});},{once:true});
  apply.addEventListener('click',async()=>{
    if(busy||loading||failed||!photos)return;busy=true;status.classList.remove('error');status.textContent='選択を反映しています…';render();
    try{await options.save([...selected],revision);dialog.close();}
    catch(error){failed=true;reload.hidden=false;status.classList.add('error');status.textContent=(error instanceof Error?error.message:'反映できませんでした。')+' 一覧と保存済みの設定を読み直して確認してください。';}
    finally{busy=false;if(dialog.isConnected)render();}
  });
  dialog.showModal();search.focus();void load();return dialog;
}
