import { createPhotoLikers } from "./photoLikers";
const dialog = document.querySelector<HTMLDialogElement>("#photo-notifications");
if (dialog) setupPhotoNotifications(dialog);
function setupPhotoNotifications(dialog: HTMLDialogElement) {
  const bells = [...document.querySelectorAll<HTMLButtonElement>("[data-photo-notification-bell]")];
  const readAll = dialog.querySelector<HTMLButtonElement>("[data-photo-read-all]")!, status = dialog.querySelector<HTMLElement>("[data-photo-notifications-status]")!, list = dialog.querySelector<HTMLUListElement>("ul")!;
  let loading = false, busy = false, unread = 0, generation = 0, opener: HTMLElement | undefined;
  function badges(count: number) {
    unread = count;
    for (const bell of bells) {
      bell.hidden = bell.dataset.placement === "welcome" && count === 0;
      bell.querySelector<HTMLElement>(".photo-unread-dot")!.hidden = count === 0;
      bell.setAttribute("aria-label", count ? `写真のいいね通知（未読${count}件）` : "写真のいいね通知");
    }
    readAll.disabled = !count || busy;
  }
  async function refresh(force = false) {
    if ((loading && !force) || document.hidden) return;
    const requestGeneration = ++generation;
    loading = true;
    try {
      const response = await fetch("/api/member/photo-notifications"), data = await response.json();
      if (requestGeneration !== generation) return;
      if (!response.ok || !data.ok) { if (response.status === 401) { badges(0); list.replaceChildren(); } throw new Error(data.message || "通知を取得できませんでした。"); }
      badges(data.unread);
      list.replaceChildren();
      for (const notice of data.notifications) {
        const item = document.createElement("li"), link = document.createElement(notice.href ? "a" : "div");
        link.className = "photo-notification-photo";
        if (link instanceof HTMLAnchorElement) link.href = notice.href;
        if (notice.src) { const image = document.createElement("img"); image.src = notice.src; image.alt = ""; image.loading = "lazy"; link.append(image); }
        const text = document.createElement("span"); text.textContent = `${notice.title}に${notice.count}件のいいねがありました。`; link.append(text); item.append(link);
        if (notice.likers?.length) item.append(createPhotoLikers(notice.likers, notice.count));
        list.append(item);
      }
      status.textContent = unread ? "" : "未読のいいね通知はありません。";
    } catch (error) { if (requestGeneration === generation && dialog.open) status.textContent = error instanceof Error ? error.message : "通知を取得できませんでした。"; }
    finally { if (requestGeneration === generation) loading = false; }
  }
  for (const bell of bells) bell.addEventListener("click", () => { opener = bell; dialog.showModal(); status.textContent = "通知を読み込んでいます…"; void refresh(); });
  dialog.querySelector("[data-photo-notifications-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => opener?.focus({ preventScroll: true }));
  readAll.addEventListener("click", async () => {
    if (busy || !unread) return;
    busy = true; readAll.disabled = true;
    try {
      const response = await fetch("/api/member/photo-notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "all" }) }), data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "既読にできませんでした。");
      generation++; badges(data.unread); list.replaceChildren(); status.textContent = "未読のいいね通知はありません。"; await refresh(true);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "既読にできませんでした。"; }
    finally { busy = false; readAll.disabled = !unread; }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.addEventListener("focus", () => void refresh());
  document.addEventListener("photo:likes-changed", () => void refresh(true));
  window.setInterval(() => void refresh(), 30_000);
  void refresh();
}
