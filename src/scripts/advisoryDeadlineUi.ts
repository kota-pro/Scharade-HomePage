import {beforeEventDay, deadlinePassed, eventDayStart, overdueWarningHtml} from '../lib/advisoryWarnings.ts';

/** One timer per next boundary; resynchronize after a suspended tab returns. */
export function watchAdvisoryClock(paint:()=>void, dates:()=>Array<string|number|undefined>) {
  let timer:number|undefined, disposed=false;
  const refresh=()=>{
    clearTimeout(timer);if(disposed)return;paint();const now=Date.now();
    const next=dates().map(d=>typeof d==='number'?d:Date.parse(d??'')).filter(d=>Number.isFinite(d)&&d>now).sort((a,b)=>a-b)[0];
    if(next!==undefined)timer=window.setTimeout(refresh,Math.min(2147483647,next-now+10));
  };
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  const hide=(event:PageTransitionEvent)=>{if(event.persisted)clearTimeout(timer);else dispose();};
  const dispose=()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',refresh);window.removeEventListener('pagehide',hide);};
  document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',refresh);window.addEventListener('pagehide',hide);refresh();
  return {refresh,dispose};
}

export function paintDeadlineWarning(target:HTMLElement|null, visible:boolean, message?:string) {
  if(!target)return;
  if(visible&&!target.firstElementChild)target.innerHTML=overdueWarningHtml(message);
  target.hidden=!visible;
}

export function bindVoteDeadline(root:HTMLElement) {
  let previous:boolean|undefined;
  const allowed=()=>root.dataset.voteAvailable==='true'&&(!root.dataset.voteOpens||Date.parse(root.dataset.voteOpens)<=Date.now())&&beforeEventDay(root.dataset.eventStart);
  const paint=()=>{
    const open=allowed();
    if(!open||open!==previous)root.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(control=>control.disabled=!open);
    root.querySelectorAll<HTMLElement>('form').forEach(form=>form.dataset.advisoryClosed=String(!open));previous=open;
    paintDeadlineWarning(root.querySelector('[data-vote-warning]'),open&&deadlinePassed(root.dataset.voteDeadline),'参加投票の提出期限を過ぎています。開催日前日までは回答できます。');
    const cutoff=root.querySelector<HTMLElement>('[data-event-cutoff]');if(cutoff)cutoff.hidden=beforeEventDay(root.dataset.eventStart);
  };
  const clock=watchAdvisoryClock(paint,()=>[root.dataset.voteOpens,root.dataset.voteDeadline,eventDayStart(root.dataset.eventStart)]);
  root.addEventListener('submit',event=>{clock.refresh();if(!allowed()){event.preventDefault();event.stopImmediatePropagation();}},true);
  return clock;
}
