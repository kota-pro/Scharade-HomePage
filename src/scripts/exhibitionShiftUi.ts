import type { ExhibitionOpeningSchedule, ShiftPerson, ShiftSlot, ShiftAssignment } from '../lib/exhibitionShiftTypes.ts';
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const dateTime = (value: string) => value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : '';
export const isoDate = (value: string) => value ? new Date(value + '+09:00').toISOString() : '';
export const personLabel = (p?: ShiftPerson) => p ? `${p.name}${p.lineName && p.lineName !== p.name ? `（LINE：${p.lineName}）` : ''}` : '担当者';
export function scheduleHtml(s?: ExhibitionOpeningSchedule) {
  const interval = (key:string, v?:{open:string;close:string}, enabled=true) => `<div class="exhibition-grid shift-hours-inputs"><label>開場時刻<input name="${key}Open" type="time" value="${v?.open ?? s?.regular.open ?? '10:00'}" ${enabled?'required':'disabled'}></label><label>閉場時刻<input name="${key}Close" type="time" value="${v?.close ?? s?.regular.close ?? '18:00'}" ${enabled?'required':'disabled'}></label></div>`;
  const special = (key:'first'|'last', title:string, date?:string) => `<section class="shift-hours-card ${s?.[key]?'is-custom':''}" data-special-day="${key}" aria-label="${title}の展示時間"><div class="shift-hours-heading"><h4>${title}</h4><span data-special-date>${date||'日付未設定'}</span></div><label class="shift-special-toggle"><input type="checkbox" name="${key==='first'?'useFirst':'useLast'}" ${s?.[key]?'checked':''}><span>この日だけ時間を変更する</span></label><p class="shift-hours-status" data-special-status></p><div data-special-inputs ${s?.[key]?'':'hidden'}>${interval(key,s?.[key],!!s?.[key])}</div></section>`;
  return `<div class="shift-schedule" data-shift-schedule><div class="exhibition-grid"><label>開催開始日<input name="startDate" type="date" required value="${s?.startDate ?? ''}"></label><label>開催終了日<input name="endDate" type="date" required value="${s?.endDate ?? ''}"></label></div><section class="shift-regular-hours"><h4>通常の展示時間</h4><p>別の時間を指定していない日は、この時間を使います。</p>${interval('regular',s?.regular)}</section><div class="shift-special-days">${special('first','初日',s?.startDate)}${special('last','最終日',s?.endDate)}</div><p class="shift-schedule-note">1日開催の場合は、初日の設定を使います。</p></div>`;
}
export function bindShiftSchedule(scope: ParentNode) {
  scope.querySelectorAll<HTMLElement>('[data-shift-schedule]').forEach(schedule=>{
    if(schedule.dataset.bound)return;schedule.dataset.bound='true';
    const input=(name:string)=>schedule.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    const refresh=()=>{
      const start=input('startDate').value,end=input('endDate').value,single=!!start&&start===end;
      schedule.querySelectorAll<HTMLElement>('[data-special-day]').forEach(card=>{
        const last=card.dataset.specialDay==='last',toggle=input(last?'useLast':'useFirst'),unavailable=last&&single,custom=toggle.checked&&!unavailable;
        toggle.disabled=unavailable;card.classList.toggle('is-custom',custom);card.classList.toggle('is-unavailable',unavailable);
        card.querySelector('[data-special-date]')!.textContent=(last?end:start)||'日付未設定';
        card.querySelector('[data-special-status]')!.textContent=unavailable?'1日開催のため、初日の設定を使います。':custom?'この日専用の展示時間を使います。':`通常の展示時間を使用（${input('regularOpen').value||'未設定'}–${input('regularClose').value||'未設定'}）`;
        card.querySelector<HTMLElement>('[data-special-inputs]')!.hidden=!custom;
        card.querySelectorAll<HTMLInputElement>('input[type="time"]').forEach(field=>{field.disabled=!custom;field.required=custom;});
      });
    };
    schedule.addEventListener('input',refresh);schedule.addEventListener('change',refresh);refresh();
  });
}
export function readSchedule(form: HTMLFormElement): ExhibitionOpeningSchedule {
  const f = new FormData(form), s = (name: string) => String(f.get(name) ?? '');
  const hours = (key: string) => ({ open: s(key + 'Open'), close: s(key + 'Close') });
  return { startDate: s('startDate'), endDate: s('endDate'), regular: hours('regular'), ...(f.has('useFirst') ? {first:hours('first')} : {}), ...(f.has('useLast') && s('startDate') !== s('endDate') ? {last:hours('last')} : {}) };
}
export const shiftAutoIcon = `<span class="shift-auto-mark" data-auto-assignment role="img" aria-label="自動配置" title="自動配置"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M6.115.59v4.115h2.88l-4.526 6.583V7.173h-2.88zm1.911 12.656l1.842-5.525a.69.69 0 0 1 .658-.475v0c.299 0 .564.191.658.475l1.842 5.525m-4.333-2h3.666"/></svg></span>`;
export const duration = (minutes: number) => `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
export function shiftReviewHtml(data:{stale:boolean;publishedNeedsReview:boolean;reviewReasons?:string[];record:{published?:unknown}}) {
  if(!data.stale&&!data.publishedNeedsReview)return '';
  const published=!!data.record.published;
  const reason=data.reviewReasons?.length?`${data.reviewReasons.map(esc).join('・')}が更新されています。`:'希望回答・開催時間・対象会員または割り当て条件に更新があります。';
  return `<div class="shift-info" data-shift-review role="status"><strong>${data.stale?'シフト案の再確認が必要です':'確認済みの案をまだ公開していません'}</strong><p>${reason}</p><p>${published?'現在の公開版は変更されていません。':'シフト表はまだ公開されていません。'}</p><p>${data.stale?'「シフト表」タブで、最新の回答から「シフト案を自動生成」するか、配置を確認して「案を確認して保存」を押してください。':'「シフト表」タブで案を確認してください。'} 公開する場合は「${published?'更新版を公開':'確定シフトを公開'}」を押してください。</p></div>`;
}
export function publishedHtml(p: {version:number;at:string;slots:ShiftSlot[];people:ShiftPerson[];assignments:Pick<ShiftAssignment,'personId'|'slotId'>[];oldSchedule?:boolean} | null, viewerId?: string) {
  if (!p) return '<p class="shift-empty">確定シフトはまだ公開されていません。</p>';
  const names = new Map(p.people.map(person => [person.id, person.name]));
  return `<div data-published-shift><div class="shift-section-heading"><p>第${p.version}版 · ${esc(new Date(p.at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}</p><span class="shift-badge">公開済み</span></div>${p.oldSchedule ? '<p class="exhibition-status error">開催時間が変更されました。更新版の公開をお待ちください。</p>' : ''}<div class="shift-search-toolbar"><label>担当者を検索<input type="search" data-published-search placeholder="名前で担当枠を検索"></label><button type="button" data-published-search-clear>検索を解除</button><button type="button" data-published-jump>一致した枠へ移動</button></div><p class="exhibition-muted" data-published-search-count role="status"></p>${shiftMatrixHtml(p.slots,{id:'published',caption:'確定シフト',compact:true,cell:s=>{const own=p.assignments.filter(a=>a.slotId===s.id);return `<div class="shift-cell-time">${s.start}–${s.end}</div><div class="shift-published-people">${[0,1].map(i=>own[i]?`<div class="shift-person ${own[i].personId===viewerId?'shift-own':''}" data-person-name="${esc(names.get(own[i].personId)??'担当者')}" title="${esc(names.get(own[i].personId)??'担当者')}"><span class="shift-person-name">${esc(names.get(own[i].personId)??'担当者')}</span>${own[i].personId===viewerId?'<small class="shift-sr-only">あなたの担当</small>':''}</div>`:'<div class="shift-person shift-shortage">担当者なし</div>').join('')}</div>`;}})}</div>`;
}
export function dialog(title: string, body: string) {
  const el = document.createElement('dialog'); el.className = 'exhibition-confirm-dialog exhibition-page shift-dialog';
  el.innerHTML = `<div class="shift-dialog-head"><p class="shift-dialog-label">Shift</p><h3>${esc(title)}</h3><button class="shift-close" aria-label="閉じる"><span></span><span></span></button></div><div class="shift-dialog-body">${body}</div>`;
  document.body.append(el); el.querySelector('.shift-close')!.addEventListener('click', () => el.close()); el.addEventListener('close', () => el.remove(), {once:true}); el.showModal(); return el;
}
export const confirmShift = (title: string, message: string, label='確認して続ける') => new Promise<boolean>(resolve => {
  const el = dialog(title, `<p class="shift-warning">${esc(message)}</p><div class="exhibition-actions"><button class="exhibition-button" data-confirm>${esc(label)}</button><button class="exhibition-button secondary" data-cancel>キャンセル</button></div>`);
  let yes = false; el.querySelector('[data-confirm]')!.addEventListener('click', () => { yes = true; el.close(); }); el.querySelector('[data-cancel]')!.addEventListener('click', () => el.close()); el.addEventListener('close', () => resolve(yes), {once:true});
});

export function shiftNavigation(id: string) {
  return `<nav class="exhibition-actions exhibition-admin-nav" aria-label="写真展管理の画面">${[
    ['', '通知・参加者・受付設定'], ['/participants', '参加者一覧'], ['/form', 'フォーム作成'], ['/layout', '展示室・壁面レイアウト'], ['/submissions', '提出内容・QR確認'], ['/shifts', '展示シフト'],
  ].map(([suffix,label]) => `<a class="exhibition-button secondary" ${suffix === '/shifts' ? 'aria-current="page"' : ''} href="/Member/manage/exhibitions/${esc(id)}${suffix}">${label}</a>`).join('')}<a class="exhibition-button secondary" href="/Member/exhibitions/${esc(id)}/shifts">会員用シフトフォーム</a></nav>`;
}
import { matchesShiftPerson, shiftDateLabel, shiftMatrixModel } from '../lib/exhibitionShiftPresentation.ts';
export { matchesShiftPerson, shiftDateLabel };
export type MatrixPages = Record<string, number>;
const timeMinutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export function shiftMatrixHtml(slots: ShiftSlot[], options: { id: string; caption: string; cell: (slot: ShiftSlot) => string; header?: (date: string) => string; outsideLabel?: string; cellClass?: (slot: ShiftSlot) => string; compact?: boolean }) {
  const { dates, rows } = shiftMatrixModel(slots);
  if (!slots.length) return '<p class="shift-empty">時間枠はまだありません。開催期間と展示時間を設定してください。</p>';
  return `<div class="shift-matrix${options.compact?' shift-matrix-compact':''}" data-shift-matrix="${esc(options.id)}"><div class="shift-matrix-toolbar"><span data-matrix-range></span><div class="shift-matrix-pager" aria-label="表示する日付"><button type="button" data-matrix-page="-1" aria-label="前の7日間">‹<span>前の7日</span></button><button type="button" data-matrix-page="1" aria-label="次の7日間"><span>次の7日</span>›</button></div></div><p class="shift-matrix-help">横に日付、縦に時間を表示しています。日付が収まらない場合は、表を左右にスクロールできます。</p><div class="shift-table-wrap shift-matrix-scroll" tabindex="0" role="region" aria-label="${esc(options.caption)}"><table class="shift-table shift-matrix-table"><caption class="shift-sr-only">${esc(options.caption)}。列は日付、行は時間です。</caption><thead><tr><th scope="col" class="shift-time-heading">時間<span>日本時間</span></th>${dates.map((date,index)=>`<th scope="col" data-matrix-day="${date}" data-day-index="${index}"><time datetime="${date}">${shiftDateLabel(date)}</time><small>${date.slice(0,4)}年</small>${options.header?.(date) ?? ''}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr${options.compact?` style="height:${Math.max(16,(timeMinutes(row.end)-timeMinutes(row.start))*.8)}px"`:''}><th scope="row" class="shift-time-heading"><time>${row.start}</time><span>– ${row.end}</span></th>${row.cells.map((cell,index)=>cell.continued ? '' : cell.slot ? `<td rowspan="${cell.span}" data-matrix-day="${cell.date}" data-day-index="${index}" data-matrix-slot="${esc(cell.slot.id)}" class="${esc(options.cellClass?.(cell.slot) ?? '')}">${options.cell(cell.slot)}</td>` : `<td data-matrix-day="${cell.date}" data-day-index="${index}" class="shift-outside"><span>${esc(options.outsideLabel ?? "展示時間外")}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
export function bindShiftMatrices(scope: ParentNode, pages: MatrixPages = {}) {
  scope.querySelectorAll<HTMLElement>('[data-shift-matrix]').forEach(matrix => {
    if (matrix.dataset.bound) return; matrix.dataset.bound = 'true';
    const id = matrix.dataset.shiftMatrix!, headers = [...matrix.querySelectorAll<HTMLElement>('thead [data-matrix-day]')], count = headers.length;
    const apply = () => {
      const page = Math.max(0, Math.min(pages[id] ?? 0, Math.ceil(count / 7) - 1)); pages[id] = page;
      matrix.style.setProperty('--shift-visible-days',String(Math.min(7,count-page*7)));
      matrix.querySelectorAll<HTMLElement>('[data-day-index]').forEach(cell => cell.hidden = Number(cell.dataset.dayIndex) < page * 7 || Number(cell.dataset.dayIndex) >= (page + 1) * 7);
      matrix.querySelector<HTMLElement>('[data-matrix-range]')!.textContent = `${headers[page * 7].querySelector('time')!.textContent} 〜 ${headers[Math.min(count - 1, (page + 1) * 7 - 1)].querySelector('time')!.textContent}`;
      matrix.querySelectorAll<HTMLButtonElement>('[data-matrix-page]').forEach(button => button.disabled = button.dataset.matrixPage === '-1' ? page === 0 : (page + 1) * 7 >= count);
    };
    matrix.addEventListener('click', event => {const b = (event.target as HTMLElement).closest<HTMLElement>('[data-matrix-page]'); if (!b) return; event.stopPropagation(); pages[id] = (pages[id] ?? 0) + Number(b.dataset.matrixPage); apply(); matrix.querySelector('.shift-matrix-scroll')!.scrollLeft = 0;});
    matrix.addEventListener('shift:reveal', event => {const date = (event as CustomEvent<string>).detail, index = headers.findIndex(h => h.dataset.matrixDay === date);if(index >= 0){pages[id]=Math.floor(index/7);apply();}});
    apply();
  });
}
export function bindPublishedSearch(scope: ParentNode, pages: MatrixPages = {}) {
  bindShiftMatrices(scope, pages);
  scope.querySelectorAll<HTMLElement>('[data-published-shift]').forEach(section => {
    const search = section.querySelector<HTMLInputElement>('[data-published-search]')!;
    const apply = () => {let count=0;section.querySelectorAll<HTMLElement>('[data-person-name]').forEach(name=>{const match=matchesShiftPerson({name:name.dataset.personName!},search.value);name.classList.toggle('shift-search-match',!!search.value.trim()&&match);name.classList.toggle('shift-search-dim',!!search.value.trim()&&!match);if(match)count++;});section.querySelector('[data-published-search-count]')!.textContent=search.value.trim()?`${count}件の担当枠に一致`:'名前で担当枠を強調できます。';};
    search.addEventListener('input',apply);section.querySelector('[data-published-search-clear]')!.addEventListener('click',()=>{search.value='';apply();search.focus({preventScroll:true});});
    section.querySelector('[data-published-jump]')!.addEventListener('click',()=>{const item=section.querySelector<HTMLElement>('.shift-search-match');if(!item)return;const td=item.closest<HTMLElement>('[data-matrix-day]')!;section.querySelector('[data-shift-matrix]')!.dispatchEvent(new CustomEvent('shift:reveal',{detail:td.dataset.matrixDay}));item.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});});apply();
  });
}
