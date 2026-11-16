const lists = new Set(["/Activity", "/Gallery", "/Portfolio"]);
const path = location.pathname.replace(/\/$/, "");
const storageKey = "scharade:list-return";
type ListPosition = { tab?: string; categories: number[]; scroll: number };

function savedVisit(): { from: string; to: string; position: ListPosition } | undefined {
  try {
    const visit = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (visit && typeof visit.from === "string" && visit.from.startsWith(`${location.origin}/`) && typeof visit.to === "string" && visit.position) return visit;
  } catch { /* Returning by browser history works when storage is unavailable. */ }
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || history.length <= 1) return;
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('#post-back-link a, nav[aria-label="パンくずリスト"] a');
  if (!link || link.target) return;
  const destination = new URL(link.href), previous = document.referrer ? new URL(document.referrer) : undefined;
  if (destination.origin !== location.origin || !lists.has(destination.pathname)) return;
  const visit = savedVisit();
  const cameFromList = previous?.origin === location.origin && previous.pathname.replace(/\/$/, "") === destination.pathname;
  if (!cameFromList && !(visit?.to === location.href && new URL(visit.from).pathname === destination.pathname)) return;
  event.preventDefault();
  history.back();
});

if (path === "/Gallery" || path === "/Portfolio") {
  const tabs = [...document.querySelectorAll<HTMLInputElement>(".tab-input, input[name='year']")];
  const categories = [...document.querySelectorAll<HTMLDetailsElement>(".category-section")];
  const position = () => ({ tab: tabs.find(item => item.checked)?.id, categories: categories.flatMap((item, index) => item.open ? [index] : []), scroll: scrollY });
  function restore(fromHistory: boolean) {
    const visit = savedVisit();
    const saved = visit?.from === location.href ? visit.position : fromHistory ? history.state?.scharadeListPosition : undefined;
    if (!saved) return;
    const tab = tabs.find(item => item.id === saved.tab);
    if (tab && !tab.checked) {
      tab.checked = true;
      tab.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (Array.isArray(saved.categories)) categories.forEach((item, index) => { item.open = saved.categories.includes(index); });
    if (visit?.from === location.href) { try { sessionStorage.removeItem(storageKey); } catch {} }
    if (Number.isFinite(saved.scroll)) requestAnimationFrame(() => scrollTo({ top: saved.scroll, behavior: "instant" }));
  }
  restore(true);
  window.addEventListener("pageshow", event => { if (event.persisted) restore(false); });
  window.addEventListener("pagehide", () => { history.replaceState({ ...history.state, scharadeListPosition: position() }, ""); });
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(".gallery-link, .member-card");
    if (!link || link.target || link.origin !== location.origin) return;
    const data = position();
    history.replaceState({ ...history.state, scharadeListPosition: data }, "");
    try { sessionStorage.setItem(storageKey, JSON.stringify({ from: location.href, to: link.href, position: data })); } catch {}
  });
}
export {};
