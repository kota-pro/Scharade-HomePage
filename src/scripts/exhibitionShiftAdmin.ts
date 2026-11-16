import { bindShiftLongPress, shiftChangeIcon, shiftReplacementCandidates } from './exhibitionShiftReplacement.ts';
import { shiftAnswerSlots } from '../lib/exhibitionShiftPresentation.ts';
import { shiftAutoIcon, esc, dateTime, isoDate, scheduleHtml, bindShiftSchedule, readSchedule, publishedHtml, duration, personLabel, dialog, confirmShift, shiftNavigation, shiftReviewHtml, shiftMatrixHtml, bindShiftMatrices, bindPublishedSearch, matchesShiftPerson } from './exhibitionShiftUi.ts';
import { readExhibitionResponse } from './exhibitionResponse.ts';
import { operationNotice } from './siteNotice.ts';
import { canCopyAppImage, copyAppImage } from './mobileBridge.ts';
import type { staffShiftData } from '../lib/exhibitionShifts.ts';
import type { ShiftAssignment, ShiftPerson } from '../lib/exhibitionShiftTypes.ts';
type Data = ReturnType<typeof staffShiftData>;
const root = document.querySelector<HTMLElement>('[data-shift-mode="staff"]');
if (root) {
  const id = root.dataset.exhibitionId!, endpoint = `/api/member/exhibitions/${id}/shifts`;
  let data: Data, tab = 'summary', selected: string | undefined, busy = false, poll: ReturnType<typeof setTimeout> | undefined;
  const matrixPages: Record<string,number> = {};
  let responseQuery='', responseFilter='all', boardQuery='';
  const matrixScroll: Record<string,{left:number;top:number}> = {}, detailOpen: Record<string,boolean> = {};
  const person = (id:string) => data.people.find(p=>p.id===id);
  const request = async (body?: Record<string, unknown>): Promise<Data> => {
    const response = await fetch(endpoint,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:data?.record.revision,...body})}:{cache:'no-store'});
    const result = await readExhibitionResponse(response); if (!response.ok) throw Object.assign(new Error(result.message ?? '保存できませんでした。'),{status:response.status});return result as Data;
  };
  const status = (userId:string) => {const r=data.record.responses.find(r=>r.userId===userId);return !r ? 'unanswered' : !r.submitted ? 'draft' : r.submitted.scheduleKey!==data.scheduleKey ? 'review' : r.submitted.none ? 'none' : 'submitted';};
  const labels:Record<string,string>={unanswered:'未提出',draft:'下書き',review:'要再確認',none:'入れる時間はない',submitted:'提出済み'};
  const counts = () => {const required=data.requiredIds,submitted=required.filter(id=>['submitted','none'].includes(status(id))).length;return {required:required.length,submitted,optional:data.record.responses.filter(r=>!required.includes(r.userId)&&r.submitted).length,none:data.record.responses.filter(r=>r.submitted?.none&&r.submitted.scheduleKey===data.scheduleKey).length};};
  const options = () => data.people.map(p=>`<option value="${esc(p.id)}">${esc(personLabel(p))}</option>`).join('');
  const pairsHtml = (kind:'together'|'apart') => `<h4>${kind==='together'?'一度は同じ枠にする人（希望）':'同じ枠にしない人（必須）'}</h4><div class="shift-pair-list">${data.record.config.rules[kind].map(([a,b],i)=>`<button type="button" data-remove-pair="${kind}" data-index="${i}" aria-label="${esc(person(a)?.name)}と${esc(person(b)?.name)}の指定を削除">${esc(person(a)?.name)}・${esc(person(b)?.name)} ×</button>`).join('')}</div><label>名前で候補を絞る<input type="search" data-pair-search="${kind}" placeholder="氏名・LINE名・登録名"></label><div class="shift-inline"><label>1人目<select name="${kind}A"><option value="">選択</option>${options()}</select></label><label>2人目<select name="${kind}B"><option value="">選択</option>${options()}</select></label><button class="exhibition-button secondary" type="button" data-add-pair="${kind}">指定に追加</button></div>`;
  const summaryHtml = () => {const c=counts();return `<div class="shift-stats">${[[`${c.submitted}/${c.required}`,'出展者の提出'],[c.optional,'出展者以外の提出'],[c.none,'入れる時間はない'],[data.issues.missing,'案の不足人数']].map(([n,label])=>`<div class="shift-stat"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>
    <details class="exhibition-panel" ${!data.exhibition.openingSchedule?'open':''}><summary>開催期間・展示時間</summary><p>時刻は日本時間です。変更すると、提出済みの回答は再確認が必要になります。公開済みのシフト表は更新版を公開するまで残ります。</p><form class="exhibition-form" data-schedule>${scheduleHtml(data.exhibition.openingSchedule)}<div class="exhibition-actions"><button class="exhibition-button">開催日時を保存</button></div></form></details>
    <details class="exhibition-panel"><summary>シフト受付・自動割り当ての設定</summary><form class="exhibition-form" data-config><label>シフトの受付状態<select name="state">${[['draft','準備中'],['open','受付中'],['closed','受付終了']].map(([v,l])=>`<option value="${v}" ${data.record.config.state===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="exhibition-grid"><label>シフト受付開始<input type="datetime-local" name="opensAt" value="${dateTime(data.record.config.opensAt)}"></label><label>シフト受付締切<input type="datetime-local" name="closesAt" value="${dateTime(data.record.config.closesAt)}"></label></div><p class="exhibition-muted">参加投票・出展フォームとは別の受付期間です。写真展の通知が公開済みになると、全会員がアクセスできます。</p><div class="exhibition-grid"><label>1人の総担当枠数の上限<input name="maxTotal" type="number" min="1" max="10000" placeholder="上限なし" value="${data.record.config.rules.maxTotal??''}"></label><label>1人の連続担当枠数の上限<input name="maxConsecutive" type="number" min="1" max="10000" placeholder="上限なし" value="${data.record.config.rules.maxConsecutive??''}"></label></div><p class="exhibition-muted">1時間未満の最終枠も1枠として数えます。連続の判定は同じ日だけです。人数確保・同枠希望・担当回数の均等化を優先し、同条件では同学年の組み合わせを優先します。</p>${pairsHtml('together')}${pairsHtml('apart')}<div class="exhibition-actions"><button class="exhibition-button">受付・割り当て設定を保存</button></div></form></details>
    <section class="shift-section"><div class="shift-section-heading"><h3>時間ごとの希望・配置状況</h3><span class="exhibition-muted">各枠を押すと希望者を確認できます</span></div>${shiftMatrixHtml(data.slots,{id:'summary',caption:'希望人数と配置状況',cell:s=>{const n=data.record.plan.assignments.filter(a=>a.slotId===s.id).length,candidates=Object.values(data.availability).filter(ids=>ids.includes(s.id)).length;return `<button type="button" class="shift-summary-cell ${n<2?'shift-shortage':''}" data-slot-summary="${esc(s.id)}"><span class="shift-cell-time">${s.start}–${s.end}</span><strong>希望 ${candidates}人</strong><span>配置 ${n}/2${n<2?` · あと${2-n}人`:''}</span></button>`;}})}</section>
    <section class="exhibition-panel"><h3>担当者別の合計</h3><div class="shift-table-wrap"><table class="shift-table"><thead><tr><th>名前</th><th>担当枠数</th><th>実際の担当時間</th></tr></thead><tbody>${data.people.filter(p=>data.record.plan.assignments.some(a=>a.personId===p.id)).map(p=>{const own=data.record.plan.assignments.filter(a=>a.personId===p.id);return `<tr><th>${esc(p.name)}</th><td>${own.length}枠</td><td>${duration(own.reduce((n,a)=>n+(data.slots.find(s=>s.id===a.slotId)?.minutes??0),0))}</td></tr>`;}).join('')}</tbody></table></div></section>`;};
  const responsePeople = () => data.people.filter(p=>!p.guest).filter(p=>matchesShiftPerson(p,responseQuery)).filter(p=>responseFilter==='all'||responseFilter==='required'&&data.requiredIds.includes(p.id)||responseFilter==='optional'&&!data.requiredIds.includes(p.id)||status(p.id)===responseFilter);
  const rowsHtml = () => responsePeople().map(p=>{
    const r=data.record.responses.find(r=>r.userId===p.id),state=status(p.id),stage=state==='none'?'submitted':state;
    return `<li data-shift-response-row><div><strong>${esc(p.name)}</strong>${p.lineName&&p.lineName!==p.name?`<small>LINE：${esc(p.lineName)}</small>`:''}<span>${esc(p.grade??'学年未設定')}</span></div><div><span class="submission-stage" data-stage="${stage}">${labels[state]}</span><span>${data.requiredIds.includes(p.id)?'出展者・必須':'任意'}</span><small>更新：${r?esc(new Date(r.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'—'}</small></div><button type="button" class="exhibition-button secondary submission-detail-button" data-response="${esc(p.id)}" aria-label="${esc(p.name)}のシフト希望の詳細">詳細を確認</button></li>`;
  }).join('');
  const responsesHtml = () => `<section aria-labelledby="shift-response-title"><h3 id="shift-response-title">シフト希望の提出状況</h3><div class="submission-filters shift-filter"><label>名前で検索<input data-response-search type="search" value="${esc(responseQuery)}" placeholder="氏名・LINE名・登録名"></label><label>提出状況<select data-response-filter>${[['all','すべて'],['required','出展者・必須'],['optional','任意'],['unanswered','未提出'],['draft','下書き'],['submitted','提出済み'],['none','入れる時間はない'],['review','要再確認']].map(([v,l])=>`<option value="${v}" ${responseFilter===v?'selected':''}>${l}</option>`).join('')}</select></label></div><p data-response-result class="exhibition-muted" role="status" aria-live="polite"></p><ul class="submission-status-list shift-response-list" data-response-rows>${rowsHtml()}</ul><p data-response-empty hidden>条件に一致する会員はいません。</p></section>`;
  const updateResponseCount = () => {const count=responsePeople().length;root.querySelector('[data-response-result]')!.textContent=`${count}人を表示`;root.querySelector<HTMLElement>('[data-response-empty]')!.hidden=count>0;};
  const boardMatrixHtml = () => shiftMatrixHtml(data.slots,{id:'draft',caption:'編集するシフト案',compact:true,cell:s=>{
    const own=data.record.plan.assignments.filter(a=>a.slotId===s.id);
    return `<div class="shift-cell-time">${s.start}–${s.end}<span class="shift-count ${own.length<2?'is-short':''}">${own.length}/2</span></div><div class="shift-seats">${[0,1].map(i=>{const a=own[i];return `<div class="shift-seat-row ${!a?'is-empty':''}"><button type="button" class="shift-seat ${!a?'shift-shortage':''}" data-seat="${a?.id??''}" data-slot-id="${esc(s.id)}" title="${a?esc(personLabel(person(a.personId))):'担当者を追加'}" aria-pressed="${!!a&&selected===a.id}"><span class="shift-seat-name">${a?esc(person(a.personId)?.name??'担当者'):'＋ 担当者を追加'}</span>${a&&!a.manual?shiftAutoIcon:''}</button>${a?`<div class="shift-seat-controls"><button type="button" class="shift-change-person" data-replace="${a.id}" aria-label="${esc(person(a.personId)?.name)}の担当者を変更" title="希望者から担当者を変更">${shiftChangeIcon}</button><button type="button" data-pin="${a.id}" aria-pressed="${a.fixed}" aria-label="${a.fixed?'固定を解除':'固定する'}" title="${a.fixed?'固定を解除':'固定する'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10h10v10H7zM9 10V6a3 3 0 0 1 6 0${a.fixed?'v4':''}"/></svg></button><button type="button" data-remove="${a.id}" aria-label="${esc(person(a.personId)?.name)}の配置を削除" title="配置を削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>`:''}</div>`;}).join('')}</div>`;
  }});
  const applyBoardSearch = () => {
    let count=0;root.querySelectorAll<HTMLButtonElement>('[data-seat]').forEach(button=>{const a=data.record.plan.assignments.find(a=>a.id===button.dataset.seat),match=!!a&&matchesShiftPerson(person(a.personId),boardQuery);button.classList.toggle('shift-search-match',!!boardQuery.trim()&&match);button.classList.toggle('shift-search-dim',!!boardQuery.trim()&&!match);if(match)count++;});
    const status=root.querySelector('[data-board-search-count]');if(status)status.textContent=boardQuery.trim()?`${count}件の担当枠に一致`:'氏名・LINE名・登録名で担当枠を強調できます。';
  };
  const canCopyPlan = (snapshot: Data) => snapshot.record.plan.reviewed === true && !snapshot.stale
    && snapshot.slots.length > 0 && !snapshot.issues.hard.length
    && !['queued','running'].includes(snapshot.record.job?.state ?? '');
  const copyControls = () => {
    const ready = canCopyPlan(data);
    const paged = new Set(data.slots.map(slot => slot.date)).size > 7;
    return `<div class="shift-image-actions">
      <button type="button" class="exhibition-button secondary" data-shift-copy ${ready ? '' : 'disabled'}>シフト表の画像をコピー</button>
      <button type="button" class="exhibition-button secondary" data-shift-png hidden>PNGで保存</button>
      <p class="exhibition-muted">${ready ? (paged ? '表示中の日程を1枚の画像にまとめます。' : '') : '「案を確認して保存」すると画像をコピーできます。'}</p>
    </div>`;
  };
  const boardHtml = () => `<div class="shift-board-toolbar"><button type="button" class="exhibition-button shift-primary" data-action="generate" ${['queued','running'].includes(data.record.job?.state??'')?'disabled':''}>${['queued','running'].includes(data.record.job?.state??'')?'自動生成中…':'シフト案を自動生成'}</button><button type="button" class="exhibition-button secondary" data-action="review">案を確認して保存</button><button type="button" class="exhibition-button shift-primary" data-action="publish" ${['queued','running'].includes(data.record.job?.state??'')?'disabled':''}>${data.record.published?'更新版を公開':'確定シフトを公開'}</button></div>
    ${copyControls()}
    <div class="shift-search-toolbar"><label>担当者を検索<input type="search" data-board-search value="${esc(boardQuery)}" placeholder="氏名・LINE名・登録名"></label><button type="button" data-board-search-clear>検索を解除</button><button type="button" data-board-jump>一致した枠へ移動</button></div><p class="exhibition-muted" role="status" data-board-search-count></p>
    <div class="shift-board-help"><p>空き枠の「＋」から担当者を追加できます。未提出の会員も検索できます。</p><p>${selected?'選択中：別の担当者で入れ替え、空き枠で移動。':'担当者を選び、別の担当者で入れ替え、空き枠で移動。チェンジアイコン、または名前の長押しで、この時間の希望者に変更できます。'}${selected?'<button type="button" data-clear-selection>選択解除</button>':''} 手動配置は固定され、再生成でも保持されます。</p></div>
    ${data.record.job?.state==='failed'?`<p class="exhibition-status error">${esc(data.record.job.error)}</p>`:''}${data.record.job?.state==='stale'?'<p class="exhibition-status error">生成中に回答や配置が変わったため、生成結果を適用していません。再生成してください。</p>':''}${data.record.plan.generatedAt&&!data.record.plan.optimal?'<p class="exhibition-muted">制限時間内の最良案です。最適性は未確認です。</p>':''}${data.issues.unmetTogether.length?`<p class="shift-info">同枠希望が${data.issues.unmetTogether.length}組未達成です。</p>`:''}${data.issues.warnings.length?`<details><summary>手動配置などの注意 ${data.issues.warnings.length}件</summary><p class="shift-warning">${esc(data.issues.warnings.join('\n'))}</p></details>`:''}${boardMatrixHtml()}<section class="shift-section"><h3>現在の公開版</h3>${publishedHtml(data.record.published??null)}</section>`;
  const render = () => {const previousTab=root.dataset.shiftTab;root.querySelectorAll<HTMLElement>('[data-shift-matrix]').forEach(m=>{const scroller=m.querySelector<HTMLElement>('.shift-matrix-scroll')!;matrixScroll[m.dataset.shiftMatrix!]={left:scroller.scrollLeft,top:scroller.scrollTop};});root.querySelectorAll<HTMLDetailsElement>('details').forEach((d,i)=>detailOpen[`${previousTab}:${i}`]=d.open);root.dataset.shiftTab=tab;root.innerHTML=`<p><a class="member-back" href="/Member/manage/exhibitions">写真展一覧へ戻る</a></p><div class="shift-page-heading"><h2>${esc(data.exhibition.title)}</h2><p>展示シフト</p></div>${shiftNavigation(id)}${shiftReviewHtml(data)}<p class="shift-muted">Google保存：${data.record.sync.error?esc(data.record.sync.error):data.record.sync.delivered>=data.record.sync.revision&&data.record.sync.delivered?'同期済み':data.record.sync.revision?'同期待ち':'未作成'} ${data.record.sync.url?`<a href="${esc(data.record.sync.url)}" target="_blank" rel="noreferrer">保存シートを開く</a>`:''}</p><div class="shift-tabs" role="tablist" aria-label="展示シフトの管理">${[['summary','集計・概要'],['responses','提出状況'],['board','シフト表']].map(([v,l])=>`<button role="tab" id="shift-tab-${v}" aria-controls="shift-content" aria-selected="${tab===v}" tabindex="${tab===v?0:-1}" data-tab="${v}">${l}</button>`).join('')}</div><div class="exhibition-editor shift-content" id="shift-content" role="tabpanel" aria-labelledby="shift-tab-${tab}">${tab==='summary'?summaryHtml():tab==='responses'?responsesHtml():boardHtml()}</div>`;bindShiftSchedule(root);bindShiftMatrices(root,matrixPages);bindPublishedSearch(root,matrixPages);root.querySelectorAll<HTMLElement>('[data-shift-matrix]').forEach(m=>{const point=matrixScroll[m.dataset.shiftMatrix!];if(point){const scroller=m.querySelector<HTMLElement>('.shift-matrix-scroll')!;scroller.scrollLeft=point.left;scroller.scrollTop=point.top;}});root.querySelectorAll<HTMLDetailsElement>('details').forEach((d,i)=>{if(detailOpen[`${tab}:${i}`]!==undefined)d.open=detailOpen[`${tab}:${i}`];});applyBoardSearch();if(tab==='responses')updateResponseCount();schedulePoll();};
  const schedulePoll = () => {clearTimeout(poll);if(['queued','running'].includes(data.record.job?.state??''))poll=setTimeout(async()=>{if(busy){schedulePoll();return;}try{data=await request();render();}catch{}},1000);};
  const mutate = async(body:Record<string,unknown>) => {data=await request(body);selected=undefined;render();};
  const savePlan = async(assignments:ShiftAssignment[],base={revision:data.record.revision,planRevision:data.record.plan.revision},review=false) => {
    const body = { action:'plan.save', ...base, assignments, review };
    try { await mutate(body); }
    catch(error) {
      if((error as {status?:number}).status===422 && await confirmShift('手動配置の確認',(error as Error).message,'警告を確認して保存')) await mutate({...body,confirmWarnings:true});
      else throw error;
    }
  };
  const run = async(action:()=>Promise<void>) => {if(busy)return;busy=true;try{await action();operationNotice('保存しました。',false,'shift-admin');}catch(error){operationNotice(error instanceof Error?error.message:'操作できませんでした。',true,'shift-admin');}finally{busy=false;}};
  async function exportShiftImage(download: boolean) {
    if (busy || !canCopyPlan(data)) return;
    busy = true;
    const copy = root!.querySelector<HTMLButtonElement>('[data-shift-copy]')!;
    const fallback = root!.querySelector<HTMLButtonElement>('[data-shift-png]')!;
    copy.disabled = fallback.disabled = true;
    if (!download) fallback.hidden = true;
    const revision = data.record.plan.revision;
    const dates = new Set([...root!.querySelectorAll<HTMLElement>('[data-shift-matrix="draft"] thead [data-matrix-day]:not([hidden])')]
      .map(header => header.dataset.matrixDay));
    try {
      const png = (async () => {
        const latest = await request();
        if (latest.record.plan.revision !== revision || !canCopyPlan(latest)) {
          data = latest;
          selected = undefined;
          render();
          throw new Error('シフト案が更新されています。表示された案を確認してください。');
        }
        const { createShiftPng } = await import('./exhibitionShiftImage.ts');
        return createShiftPng(latest.exhibition.title, latest.slots.filter(slot => dates.has(slot.date)), latest.record.plan.assignments, latest.people);
      })();
      if (download) {
        const url = URL.createObjectURL(await png);
        const link = document.createElement('a');
        link.href = url;
        link.download = '展示シフト.png';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        operationNotice('PNGのダウンロードを開始しました。',false,'shift-admin');
        return;
      }
      const write = async () => {
        if (canCopyAppImage()) return copyAppImage(await png);
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard unavailable');
        // Begin the write during the click so Safari retains user activation.
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      };
      const [image, clipboard] = await Promise.allSettled([png, write()]);
      if (image.status === 'rejected') throw image.reason;
      if (clipboard.status === 'rejected') {
        fallback.hidden = false;
        operationNotice('画像をコピーできませんでした。PNGで保存できます。',true,'shift-admin');
      } else operationNotice('シフト表の画像をコピーしました。',false,'shift-admin');
    } catch (error) {
      operationNotice(error instanceof Error ? error.message : 'シフト表の画像を作成できませんでした。',true,'shift-admin');
    } finally {
      busy = false;
      copy.disabled = fallback.disabled = false;
    }
  }
  const choosePerson = (slotId:string) => {
    const slot=data.slots.find(s=>s.id===slotId)!;
    const el=dialog(`${slot.date} ${slot.start}–${slot.end} に追加`, `<p>シフトフォームが未提出の人も追加できます。手動追加では提出済みになりません。</p><label>会員・登録済み担当者を検索<input type="search" data-person-search placeholder="名前・LINE名で検索"></label><div class="shift-picker-results"></div><hr><label>名前を直接入力<input maxlength="150" data-guest-name placeholder="会員登録のない担当者の名前"></label><div class="exhibition-actions"><button class="exhibition-button secondary" data-add-guest>この名前で追加</button></div><p class="shift-muted">手入力の名前は、この写真展だけの担当者として保存します。</p>`);
    const results=el.querySelector('.shift-picker-results')!, search=el.querySelector<HTMLInputElement>('[data-person-search]')!;
    const paint=()=>{const q=search.value;results.innerHTML=data.people.filter(p=>matchesShiftPerson(p,q)).filter(p=>!data.record.plan.assignments.some(a=>a.slotId===slotId&&a.personId===p.id)).map(p=>`<button data-person="${esc(p.id)}">${esc(personLabel(p))}${p.searchNames?.length?`<small class="shift-search-alias">登録名：${esc(p.searchNames.join(' / '))}</small>`:''}<br><small>${p.guest?'手入力の担当者':labels[status(p.id)]} · ${data.availability[p.id]?.includes(slotId)?'この時間を希望':'希望外・未回答'}</small></button>`).join('')||'<p>該当する人はいません。</p>';};
    search.addEventListener('input',paint);paint();
    const add=async(p:ShiftPerson)=>{await savePlan([...data.record.plan.assignments,{id:crypto.randomUUID(),personId:p.id,slotId,manual:true,fixed:true}]);el.close();};
    results.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest<HTMLElement>('[data-person]');if(b)void run(()=>add(person(b.dataset.person!)!));});
    el.querySelector('[data-add-guest]')!.addEventListener('click',()=>void run(async()=>{const input=el.querySelector<HTMLInputElement>('[data-guest-name]')!;if(!input.value.trim()){input.focus();throw new Error('担当者名を入力してください。');}data=await request({action:'guest',name:input.value});paint();await add(data.record.guests.find(p=>p.name===input.value.trim())!);}));
  };
  const replacePerson = async (assignmentId:string) => {
    if(busy)return;busy=true;
    try {
      // Refresh before offering candidates; plan.save still checks the exact record/plan revisions.
      data=await request();selected=undefined;render();const snapshot=data;
      const assignment=snapshot.record.plan.assignments.find(a=>a.id===assignmentId);
      if(!assignment)throw new Error('この配置は変更されています。シフト表を確認してください。');
      const slot=snapshot.slots.find(s=>s.id===assignment.slotId);
      if(!slot)throw new Error('開催時間が変更されています。シフト表を確認してください。');
      const candidates=shiftReplacementCandidates(snapshot.people,snapshot.availability,snapshot.record.plan.assignments,slot.id);
      const companions=snapshot.record.plan.assignments.filter(a=>a.slotId===slot.id&&a.id!==assignmentId).map(a=>a.personId);
      const forbidden=(personId:string)=>snapshot.record.config.rules.apart.some(pair=>pair.includes(personId)&&companions.some(id=>pair.includes(id)));
      const el=dialog(`${person(assignment.personId)?.name??'担当者'}の担当者を変更`, `<p class="shift-info">${esc(slot.date)} ${slot.start}–${slot.end} の希望を提出した人から選択してください。</p><p>変更はシフト案に保存します。公開版には「${snapshot.record.published?'更新版を公開':'確定シフトを公開'}」で反映します。</p><label>希望者を検索<input type="search" data-replacement-search placeholder="氏名・LINE名・登録名"></label><p class="shift-muted" data-replacement-count role="status"></p><div class="shift-picker-results" data-replacement-results></div>`);
      el.dataset.shiftReplacement=assignmentId;
      const search=el.querySelector<HTMLInputElement>('[data-replacement-search]')!,results=el.querySelector<HTMLElement>('[data-replacement-results]')!;
      const paint=()=>{
        const people=candidates.filter(p=>matchesShiftPerson(p,search.value));
        el.querySelector('[data-replacement-count]')!.textContent=`希望者 ${people.length}人`;
        results.innerHTML=people.map(p=>`<button type="button" data-replacement-person="${esc(p.id)}" ${forbidden(p.id)?'disabled':''}><span>${esc(personLabel(p))}</span><small class="shift-search-alias">${esc(p.grade??'学年未設定')} · 現在 ${snapshot.record.plan.assignments.filter(a=>a.personId===p.id).length}枠担当${forbidden(p.id)?' · 同枠にしない人の指定があります':''}</small></button>`).join('')||`<p>${candidates.length?'条件に一致する希望者はいません。':'この時間に変更できる他の希望者はいません。'}</p>`;
      };
      search.addEventListener('input',paint);paint();
      results.addEventListener('click',event=>{
        const button=(event.target as Element).closest<HTMLButtonElement>('[data-replacement-person]');
        if(!button||button.disabled||busy)return;
        void run(async()=>{await savePlan(snapshot.record.plan.assignments.map(a=>a.id===assignmentId?{...a,personId:button.dataset.replacementPerson!,manual:true,fixed:true}:a),{revision:snapshot.record.revision,planRevision:snapshot.record.plan.revision});el.close();});
      });
      el.addEventListener('close',()=>root.querySelector<HTMLButtonElement>(`[data-replace="${assignmentId}"]`)?.focus({preventScroll:true}),{once:true});
    }catch(error){operationNotice(error instanceof Error?error.message:'希望者を読み込めませんでした。',true,'shift-admin');}
    finally{busy=false;}
  };
  bindShiftLongPress(root, id=>void replacePerson(id), ()=>!busy);
  const responseMatrix = (ids:string[], name:string, previousSchedule=false) => {const view=shiftAnswerSlots(ids,data.slots,previousSchedule);return `${view.recordedOnly?'<p class="shift-info">以前の日程で保存された、選択のある時間のみ表示しています。</p>':''}${shiftMatrixHtml(view.slots,{id:name,caption:'シフト希望の詳細',outsideLabel:view.recordedOnly?'記録なし':'展示時間外',cell:s=>`<div class="shift-readonly-choice ${ids.includes(s.id)?'is-selected':''}"><strong>${s.start}–${s.end}</strong><span>${ids.includes(s.id)?'入れる':'未選択'}</span></div>`})}`;};
  const details = (userId:string) => {
    const p=person(userId)!,r=data.record.responses.find(r=>r.userId===userId),s=r?.submitted;
    const el=dialog(`${p.name}のシフト希望`, `<p>${data.requiredIds.includes(userId)?'出展者・必須':'任意'} · ${labels[status(userId)]}</p>${s?`<p>提出：${esc(new Date(s.at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}</p>${s.none?'<p class="shift-info">入れる時間はない</p>':responseMatrix(s.slotIds,'response',s.scheduleKey!==data.scheduleKey)}`:'<p>提出はまだありません。</p>'}${r?`<details><summary>保存中の下書き</summary>${r.draft.none?'<p>入れる時間はない</p>':responseMatrix(r.draft.slotIds,'draft-response')}</details>`:''}`);
    bindShiftMatrices(el);
  };
  root.addEventListener('input',event=>{
    const input=event.target as HTMLInputElement;
    if(input.matches('[data-response-search],[data-response-filter]')){responseQuery=root.querySelector<HTMLInputElement>('[data-response-search]')!.value;responseFilter=root.querySelector<HTMLSelectElement>('[data-response-filter]')!.value;const body=root.querySelector('[data-response-rows]')!;body.innerHTML=rowsHtml();updateResponseCount();}
    if(input.matches('[data-board-search]')){boardQuery=input.value;applyBoardSearch();}
    if(input.dataset.pairSearch){const kind=input.dataset.pairSearch;for(const name of [kind+'A',kind+'B']){const select=root.querySelector<HTMLSelectElement>(`[name="${name}"]`)!,value=select.value;select.innerHTML='<option value="">選択</option>'+data.people.filter(p=>p.id===value||matchesShiftPerson(p,input.value)).map(p=>`<option value="${esc(p.id)}">${esc(personLabel(p))}</option>`).join('');select.value=value;}}
  });
  root.addEventListener('change',event=>{if((event.target as HTMLElement).matches('[data-response-filter]'))(event.target as HTMLElement).dispatchEvent(new Event('input',{bubbles:true}));});
  root.addEventListener('keydown',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=['summary','responses','board'],index=tabs.indexOf(tab);tab=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(index+(event.key==='ArrowRight'?1:2))%3];render();root.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.focus({preventScroll:true});});
  root.addEventListener('submit',event=>{const form=event.target as HTMLFormElement;event.preventDefault();void run(async()=>{if(form.hasAttribute('data-schedule')){if(data.exhibition.openingSchedule&&!await confirmShift('開催日時を変更','提出済みのシフト回答は再確認が必要になります。変更しますか？','変更して保存'))return;await mutate({action:'schedule',exhibitionRevision:data.exhibition.revision,openingSchedule:readSchedule(form)});}else if(form.hasAttribute('data-config')){const f=new FormData(form);await mutate({action:'settings',config:{state:f.get('state'),opensAt:isoDate(String(f.get('opensAt')??'')),closesAt:isoDate(String(f.get('closesAt')??'')),rules:{...data.record.config.rules,maxTotal:f.get('maxTotal'),maxConsecutive:f.get('maxConsecutive')}}});}});});
  root.addEventListener('click',event=>{
    const b=(event.target as HTMLElement).closest<HTMLElement>('button');if(!b||busy)return;
    if(b.hasAttribute('data-shift-copy')||b.hasAttribute('data-shift-png')){void exportShiftImage(b.hasAttribute('data-shift-png'));return;}
    if(b.dataset.tab){tab=b.dataset.tab;selected=undefined;render();return;}
    if(b.hasAttribute('data-clear-selection')){selected=undefined;render();return;}
    if(b.hasAttribute('data-board-search-clear')){boardQuery='';root.querySelector<HTMLInputElement>('[data-board-search]')!.value='';applyBoardSearch();return;}
    if(b.hasAttribute('data-board-jump')){const button=root.querySelector<HTMLElement>('[data-seat].shift-search-match');if(button){const day=button.closest<HTMLElement>('[data-matrix-day]')!;root.querySelector('[data-shift-matrix="draft"]')!.dispatchEvent(new CustomEvent('shift:reveal',{detail:day.dataset.matrixDay}));button.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});button.focus({preventScroll:true});}return;}
    if(b.dataset.slotSummary){const slot=data.slots.find(s=>s.id===b.dataset.slotSummary)!,candidates=data.people.filter(p=>data.availability[p.id]?.includes(slot.id));const el=dialog(`${slot.date} ${slot.start}–${slot.end} の希望者`, `<p>希望 ${candidates.length}人</p><div class="shift-picker-results">${candidates.map(p=>`<button type="button" data-view-user="${esc(p.id)}">${esc(personLabel(p))} · 詳細を確認</button>`).join('')||'<p>この枠を希望している人はいません。</p>'}</div>`);el.querySelectorAll<HTMLButtonElement>('[data-view-user]').forEach(button=>button.addEventListener('click',()=>details(button.dataset.viewUser!)));return;}

    if(b.dataset.response){details(b.dataset.response);return;}
    if(b.dataset.addPair||b.dataset.removePair){const kind=(b.dataset.addPair??b.dataset.removePair) as 'together'|'apart',form=root.querySelector<HTMLFormElement>('[data-config]')!,f=new FormData(form),rules=structuredClone(data.record.config.rules);if(b.dataset.addPair){const a=String(f.get(kind+'A')),c=String(f.get(kind+'B'));if(!a||!c||a===c){operationNotice('異なる2人を選択してください。',true,'shift-admin');return;}rules[kind].push([a,c]);}else rules[kind].splice(Number(b.dataset.index),1);void run(async()=>{await mutate({action:'settings',config:{...data.record.config,state:f.get('state'),opensAt:isoDate(String(f.get('opensAt')??'')),closesAt:isoDate(String(f.get('closesAt')??'')),rules:{...rules,maxTotal:f.get('maxTotal'),maxConsecutive:f.get('maxConsecutive')}}});});return;}
    if(b.dataset.replace){void replacePerson(b.dataset.replace);return;}
    if(b.dataset.pin||b.dataset.remove){void run(()=>savePlan(data.record.plan.assignments.filter(a=>a.id!==b.dataset.remove).map(a=>a.id===b.dataset.pin?{...a,fixed:!a.fixed}:a)));return;}
    if(b.hasAttribute('data-seat')){const own=b.dataset.seat,slotId=b.dataset.slotId!;if(own&&(!selected||selected===own)){selected=selected===own?undefined:own;render();return;}if(selected){const a=data.record.plan.assignments.find(a=>a.id===selected)!,other=data.record.plan.assignments.find(a=>a.id===own);const next=data.record.plan.assignments.map(x=>x.id===a.id?{...x,slotId:other?.slotId??slotId}:x.id===other?.id?{...x,slotId:a.slotId}:x);void run(()=>savePlan(next));}else choosePerson(slotId);return;}
    if(b.dataset.action)void run(async()=>{if(b.dataset.action==='review'){await savePlan(data.record.plan.assignments,undefined,true);return;}if(b.dataset.action==='generate'){await mutate({action:'generate'});return;}if(b.dataset.action==='publish'){data=await request();render();const revision=data.record.revision,planRevision=data.record.plan.revision;if(data.issues.hard.length)throw new Error(data.issues.hard.join('\n'));if(!await confirmShift('展示シフトを公開',`${data.issues.missing?`担当者が${data.issues.missing}席不足しています。\n`:''}全会員に公開・更新の通知を送ります。現在の案を公開しますか？`,'公開する'))return;await mutate({action:'publish',revision,planRevision,confirmMissing:true});}});
  });
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&selected){selected=undefined;render();}});
  void request().then(result=>{data=result;render();}).catch(error=>root.innerHTML=`<p role="alert">${esc(error.message)}</p>`);
}
