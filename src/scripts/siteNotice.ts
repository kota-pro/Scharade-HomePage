import { noticeDuration } from "../lib/noticeTiming.ts";
export type NoticeKind = "success" | "error" | "progress";
type NoticeItem = { element: HTMLElement; timer?: number; deadline: number; remaining: number; hovered: boolean; focused: boolean };
type NoticeState = { host: HTMLElement; items: Map<string, NoticeItem> };
declare global { interface Window { scharadeNotices?: NoticeState } }
function state() {
  if (window.scharadeNotices) return window.scharadeNotices;
  const host = document.createElement("div");
  host.className = "site-notices"; host.setAttribute("popover", "manual");
  host.setAttribute("aria-label", "操作の通知"); document.body.append(host);
  const result: NoticeState = { host, items: new Map() }; window.scharadeNotices = result;
  // The passive banner text lets clicks reach the underlying form. Track its
  // visual bounds so reading-time pauses still work without a hit-test surface.
  document.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse") return;
    for (const [id, item] of result.items) {
      const rect = item.element.getBoundingClientRect();
      pause(id,item,"hovered",item.element.isConnected && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    }
  },true);
  document.addEventListener("pointerout",event=>{if(event.pointerType==="mouse"&&!event.relatedTarget)for(const [id,item] of result.items)pause(id,item,"hovered",false);});
  new MutationObserver(records => {
    if (records.some(r => (r.target as HTMLElement).matches("dialog")) && result.items.size) raise(host);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  return result;
}
function raise(host: HTMLElement) {
  // A modal makes body siblings inert, including popovers; keep notices in its active subtree.
  const dialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1), parent = dialog ?? document.body;
  if (host.parentElement !== parent) parent.append(host);
  try { if (typeof host.showPopover === "function") { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } } catch { /* The fixed-position fallback remains visible. */ }
}
export function dismissNotice(id: string) {
  const s = state(), item = s.items.get(id);
  if (!item) return;
  clearTimeout(item.timer); item.element.remove(); s.items.delete(id);
  if (!s.items.size) { try { s.host.hidePopover?.(); } catch {} }
}
export function notify(message: string, kind: NoticeKind = "success", id: string = crypto.randomUUID()): string {
  if (!message) return id;
  const s = state(); let item = s.items.get(id);
  if (!item) {
    while (s.items.size >= 3) dismissNotice(s.items.keys().next().value!);
    const element = document.createElement("div"); element.className = "site-notice";
    const text = document.createElement("p"), close = document.createElement("button");
    text.className = "site-notice-text"; close.type = "button"; close.textContent = "×";
    close.setAttribute("aria-label", "通知を閉じる"); close.addEventListener("click", () => dismissNotice(id));
    element.append(text,close); s.host.append(element);
    item = { element, deadline: 0, remaining: 0, hovered: false, focused: false }; s.items.set(id,item);
    const focus = (value:boolean) => {const current=s.items.get(id);if(current)pause(id,current,"focused",value);};
    element.addEventListener("focusin",()=>focus(true));
    element.addEventListener("focusout",event=>{if(!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget))focus(false);});
  }
  clearTimeout(item.timer); item.element.dataset.kind = kind;
  item.element.setAttribute("role", kind === "error" ? "alert" : "status");
  item.element.querySelector("p")!.textContent = message;
  item.remaining = noticeDuration(message); arm(id,item);
  raise(s.host); return id;
}
function pause(id:string,item:NoticeItem,key:"hovered"|"focused",value:boolean) {
  if(item[key]===value)return;
  if(!item.hovered&&!item.focused&&item.timer!==undefined)item.remaining=Math.max(0,item.deadline-Date.now());
  clearTimeout(item.timer);item.timer=undefined;item[key]=value;
  if(!item.hovered&&!item.focused)arm(id,item);
}
function arm(id: string, item: NoticeItem) {
  clearTimeout(item.timer); item.timer = undefined;
  if (item.hovered || item.focused) return;
  item.deadline = Date.now()+item.remaining;
  item.timer = window.setTimeout(()=>dismissNotice(id),item.remaining);
}
export function operationNotice(message: string, error = false, id = "operation") {
  if (!message) { dismissNotice(id); return; }
  notify(message, error ? "error" : /(?:中|しています|している|準備しています|待っています)[…\.。]*$/.test(message) ? "progress" : "success", id);
}
export function flashNotice(message: string, kind: Exclude<NoticeKind,"progress"> = "success") {
  try { sessionStorage.setItem("scharade-notice",JSON.stringify({message,kind,at:Date.now()})); } catch {}
}
export function setupNotices() {
  state();
  try {
    const value=sessionStorage.getItem("scharade-notice"); sessionStorage.removeItem("scharade-notice");
    if(value) { const data=JSON.parse(value); if(Date.now()-data.at<60000 && typeof data.message==="string") notify(data.message,data.kind==="error"?"error":"success"); }
    else if(new URL(location.href).searchParams.get("saved")==="1") notify("保存しました。");
  } catch {}
}
