/** Scheduled deadlines warn; explicit reception closure still blocks submissions. */
export const deadlinePassed=(deadline:string|undefined,now=Date.now())=>!!deadline&&Number.isFinite(Date.parse(deadline))&&now>=Date.parse(deadline);
export function eventDayStart(startsAt?:string){
 const time=Date.parse(startsAt??'');return Number.isFinite(time)?Date.parse(new Date(time+9*3600000).toISOString().slice(0,10)+'T00:00:00+09:00'):Infinity;
}
export const beforeEventDay=(startsAt:string|undefined,now=Date.now())=>now<eventDayStart(startsAt);
export const warningSvg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.134 2.5a1 1 0 0 1 1.732 0L14.928 13a1 1 0 0 1-.866 1.5H1.938a1 1 0 0 1-.866-1.5zM8 11a1 1 0 1 0 0 2a1 1 0 0 0 0-2m0-6a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1"/></svg>';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const warningMark=(label:string)=>`<span class="advisory-warning-icon" role="img" aria-label="${esc(label)}" title="${esc(label)}">${warningSvg}</span>`;
export const overdueWarningHtml=(message='提出期限を過ぎています。引き続き提出できます。')=>`<p class="advisory-warning" data-deadline-warning role="status">${warningMark('提出期限超過')}<span>${esc(message)}</span></p>`;
