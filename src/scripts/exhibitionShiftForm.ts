import {watchAdvisoryClock,paintDeadlineWarning} from './advisoryDeadlineUi.ts';
import {deadlinePassed} from '../lib/advisoryWarnings.ts';
import {overdueWarningHtml} from '../lib/advisoryWarnings.ts';
import { createDraftSync, DraftSaveError } from './exhibitionDraftSync.ts';
import { readExhibitionResponse } from './exhibitionResponse.ts';
import { operationNotice } from './siteNotice.ts';
import { esc, publishedHtml, shiftMatrixHtml, bindShiftMatrices, bindPublishedSearch, duration } from './exhibitionShiftUi.ts';
import type { ShiftAnswer } from '../lib/exhibitionShiftTypes.ts';
import type { memberShiftData } from '../lib/exhibitionShifts.ts';
type Data = ReturnType<typeof memberShiftData>;
const root = document.querySelector<HTMLElement>('[data-shift-mode="member"]');
if (root) {
  const endpoint = `/api/exhibitions/${root.dataset.exhibitionId}/shifts`;
  let data: Data, answer: ShiftAnswer, sync: ReturnType<typeof createDraftSync<ShiftAnswer>>, busy = false;
  const request = async (body?: unknown): Promise<Data> => { const response = await fetch(endpoint, body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {cache:'no-store'}); const result = await readExhibitionResponse(response); if (!response.ok) throw new DraftSaveError(result.message ?? 'シフトを読み込めませんでした。', response.status); return result as Data; };
  const pages: Record<string,number> = {};
  const deadlineClock=watchAdvisoryClock(()=>paintDeadlineWarning(root.querySelector('[data-shift-deadline]'),!!data?.canSubmit&&deadlinePassed(data?.intake.closesAt)),()=>[data?.intake.closesAt]);
  const paint = () => {
    deadlineClock.refresh();
    root.querySelectorAll<HTMLInputElement>('[data-slot]').forEach(input => {input.checked = answer.slotIds.includes(input.dataset.slot!);input.closest('.shift-choice')?.classList.toggle('is-selected',input.checked);});
    const none = root.querySelector<HTMLInputElement>('[name="none"]');if(none)none.checked=answer.none;
    const count=root.querySelector('[data-choice-count]');if(count)count.textContent=answer.none?'入れる時間はない':`${answer.slotIds.length}枠を選択 · ${duration(data.slots.filter(s=>answer.slotIds.includes(s.id)).reduce((n,s)=>n+s.minutes,0))}`;
  };
  const selectTab = (name:string, focus=false) => {
    root.querySelectorAll<HTMLButtonElement>('[data-member-tab]').forEach(button=>{const active=button.dataset.memberTab===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus({preventScroll:true});});
    root.querySelectorAll<HTMLElement>('[data-member-panel]').forEach(panel=>panel.hidden=panel.dataset.memberPanel!==name);
  };
  const init = async () => {
    data = await request(); answer = structuredClone(data.response?.draft ?? {none:false,slotIds:[]});
    const disabled=!data.canSubmit?'disabled':'';
    root.innerHTML = `<p><a class="member-back" href="/Member">メンバーページへ戻る</a></p><div class="shift-page-heading"><h2>${esc(data.exhibition.title)}</h2><p>展示シフト</p></div><p class="exhibition-muted">出展者はレイアウトフォームの提出後に回答してください。出展しない会員も回答できます。</p><div class="shift-tabs" role="tablist" aria-label="展示シフトの表示"><button type="button" role="tab" data-member-tab="answer" id="shift-member-answer-tab" aria-selected="true" aria-controls="shift-member-answer">シフト希望</button><button type="button" role="tab" data-member-tab="published" id="shift-member-published-tab" aria-selected="false" tabindex="-1" aria-controls="shift-member-published">確定シフト</button></div>
    <section data-member-panel="answer" id="shift-member-answer" role="tabpanel" aria-labelledby="shift-member-answer-tab"><div class="shift-section-heading"><h3>シフト希望を入力</h3><span class="shift-badge" data-shift-own-status>${data.required?'出展者・提出必須':'任意提出'} · ${data.response?.submitted?data.needsReview?'要再確認':'提出済み':'未提出'}</span></div>
    <p class="exhibition-muted">受付：${esc(data.intake.opensAt?new Date(data.intake.opensAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未設定')} 〜 ${esc(data.intake.closesAt?new Date(data.intake.closesAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未設定')}（日本時間）</p>
    <div data-shift-deadline>${data.overdue?overdueWarningHtml():''}</div>${data.message?`<p class="shift-info">${esc(data.message)}</p>`:''}${data.required&&!data.layoutSubmitted?`<p><a class="exhibition-button" href="/Exhibition/${data.exhibition.id}">レイアウトフォームへ</a></p>`:''}${data.needsReview?'<p class="exhibition-status error">開催日時が変更されました。選択内容を確認し、もう一度提出してください。</p>':''}
    <form class="exhibition-form" data-shift-answer><div class="shift-answer-toolbar"><div class="exhibition-actions"><button type="button" data-select-slots="all" ${disabled}>全選択</button><button type="button" data-select-slots="none" ${disabled}>全解除</button></div><strong data-choice-count role="status"></strong></div>
    ${shiftMatrixHtml(data.slots,{id:'answer',caption:'シフト希望を入力',header:date=>`<div class="shift-day-actions"><button type="button" data-select-day="${date}" data-day-choice="all" ${disabled}>この日を選択</button><button type="button" data-select-day="${date}" data-day-choice="none" ${disabled}>解除</button></div>`,cell:s=>`<label class="shift-choice"><input type="checkbox" data-slot="${esc(s.id)}" aria-label="${s.date} ${s.start}–${s.end}" ${disabled}><span><strong>${s.start}–${s.end}</strong><small>${s.minutes}分 · 入れる</small></span></label>`})}
    <label class="exhibition-check shift-none"><input type="checkbox" name="none" ${disabled}>入れる時間はない</label><div class="shift-submit-bar"><div><p data-draft-state role="status" aria-live="polite"></p><small>入力内容は自動保存します。最後に提出ボタンを押してください。</small></div><div class="exhibition-actions"><button type="button" class="exhibition-button secondary" data-save-shift ${disabled}>下書きを保存</button><button class="exhibition-button shift-primary" type="submit" ${disabled}>${data.response?.submitted?'回答を更新して提出':'シフト希望を提出'}</button></div></div>
    <div class="exhibition-actions" data-draft-recovery hidden><button type="button" class="exhibition-button secondary" data-local>この画面の回答で保存</button><button type="button" class="exhibition-button secondary" data-server>保存済みの回答に戻す</button></div><a href="/Login" data-shift-login hidden>再ログインして保存を続ける</a></form></section>
    <section data-member-panel="published" id="shift-member-published" role="tabpanel" aria-labelledby="shift-member-published-tab" hidden><div class="shift-section-heading"><h3>確定シフト</h3><span class="exhibition-muted">自分の担当は青緑色で表示</span></div>${publishedHtml(data.published,data.viewerId)}</section>`;
    bindShiftMatrices(root,pages);bindPublishedSearch(root,pages);
    root.querySelectorAll<HTMLButtonElement>('[data-member-tab]').forEach(button=>{
      button.addEventListener('click',()=>selectTab(button.dataset.memberTab!));
      button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const name=event.key==='Home'?'answer':event.key==='End'?'published':button.dataset.memberTab==='answer'?'published':'answer';selectTab(name,true);});
    });
    root.querySelectorAll<HTMLButtonElement>('[data-select-slots],[data-select-day]').forEach(button=>button.addEventListener('click',()=>{
      const day=button.dataset.selectDay, selected=button.dataset.selectSlots==='all'||button.dataset.dayChoice==='all';
      const target=new Set(data.slots.filter(s=>!day||s.date===day).map(s=>s.id));
      answer.none=false;answer.slotIds=data.slots.filter(s=>target.has(s.id)?selected:answer.slotIds.includes(s.id)).map(s=>s.id);paint();sync.touch();
    }));
    let storage: Storage | null = null; try { storage=localStorage; } catch {}
    const snapshot = (r:Data) => ({revision:r.response?.revision ?? 0,content:r.response?.draft ?? {none:false,slotIds:[]}});
    sync = createDraftSync<ShiftAnswer>({initial:snapshot(data),prefix:`exhibition-shift:${data.viewerId}:${data.exhibition.id}:${data.scheduleKey}:`,tab:crypto.randomUUID(),storage,read:()=>answer,restore:v=>{answer={none:v.none,slotIds:v.slotIds.filter(id=>data.slots.some(s=>s.id===id))};paint();},enabled:()=>data.canSubmit&&!busy,send:async(content,revision)=>{data=await request({action:'save',ownerId:data.viewerId,scheduleKey:data.scheduleKey,revision,content});deadlineClock.refresh();return snapshot(data);},fetch:async()=>{const fresh=await request();if(fresh.viewerId!==data.viewerId)throw new DraftSaveError('元のアカウントで再ログインしてください。',401);if(fresh.scheduleKey!==data.scheduleKey)throw new DraftSaveError('開催日時が変更されました。再読み込みしてください。',409);data=fresh;return snapshot(fresh);},state:s=>{const target=root.querySelector('[data-draft-state]')!;target.textContent=({saved:'下書き保存済み',pending:'変更を保存します…',saving:'保存しています…',offline:'通信を再試行しています。この端末にも保存しています。',auth:'再ログイン後に保存を続けます。入力はこの端末に残っています。',conflict:'別の画面の回答と変更が重なっています。残す回答を選んでください。',blocked:s.message??'保存できません。入力内容を確認してください。'})[s.kind];root.querySelector<HTMLElement>('[data-draft-recovery]')!.hidden=s.kind!=='conflict';root.querySelector<HTMLElement>('[data-shift-login]')!.hidden=s.kind!=='auth';}});
    paint();sync.restore();
    root.querySelector('[data-save-shift]')!.addEventListener('click',()=>void sync.flush(true).then(()=>operationNotice('下書きを保存しました。',false,'shift')).catch(error=>operationNotice(error.message,true,'shift')));
    root.querySelector('form')!.addEventListener('change', event => {const input=event.target as HTMLInputElement;if(input.name==='none'){answer.none=input.checked;if(input.checked)answer.slotIds=[];}else if(input.dataset.slot){answer.none=false;answer.slotIds=Array.from(root.querySelectorAll<HTMLInputElement>('[data-slot]:checked')).map(i=>i.dataset.slot!);}paint();sync.touch();});
    root.querySelector('[data-local]')!.addEventListener('click',()=>void sync.resolve('local').catch(error=>operationNotice(error.message,true,'shift')));root.querySelector('[data-server]')!.addEventListener('click',()=>void sync.resolve('server'));
    root.querySelector('form')!.addEventListener('submit', async event => {event.preventDefault();if(busy)return;busy=true;const button=root.querySelector<HTMLButtonElement>('[type="submit"]')!;button.disabled=true;try{await sync.flush(true);data=await request({action:'submit',ownerId:data.viewerId,scheduleKey:data.scheduleKey,revision:sync.revision(),content:answer});await sync.resume();deadlineClock.refresh();root.querySelector('[data-shift-own-status]')!.textContent=(data.required?'出展者：提出必須':'一般会員：任意提出')+' · 提出済み';button.textContent='回答を更新して提出';operationNotice('シフト希望を提出しました。',false,'shift');document.dispatchEvent(new Event('help:statechange'));}catch(error){operationNotice(error instanceof Error?error.message:'提出できませんでした。',true,'shift');}finally{busy=false;button.disabled=false;}});
  };
  void init().catch(error=>{root.innerHTML=`<p role="alert">${esc(error.message)}</p><a href="/Member">メンバーページへ戻る</a>`;});
  window.addEventListener('pagehide',()=>sync?.persist());window.addEventListener('online',()=>void sync?.resume());
  window.addEventListener('beforeunload',event=>{if(sync?.dirty()&&!sync.persist()){event.preventDefault();event.returnValue='';}});
}
