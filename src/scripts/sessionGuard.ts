type Status = { serverNow: number; expiresAt: number; warningMs: number };

export function setupSessionGuard() {
  const root = document.querySelector<HTMLElement>("[data-session-guard]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
  const title = dialog.querySelector<HTMLElement>("h2")!;
  const description = dialog.querySelector<HTMLElement>("#session-dialog-description")!;
  const countdown = dialog.querySelector<HTMLElement>("[data-session-countdown]")!;
  const message = dialog.querySelector<HTMLElement>("[data-session-message]")!;
  const renew = dialog.querySelector<HTMLButtonElement>("[data-session-renew]")!;
  const logout = dialog.querySelector<HTMLButtonElement>("[data-session-logout]")!;
  const login = dialog.querySelector<HTMLAnchorElement>("[data-session-login]")!;
  const recheck = dialog.querySelector<HTMLButtonElement>("[data-session-recheck]")!;
  // Tokens and account identifiers never enter HTML, localStorage or channel messages.
  login.href = `/Login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("scharade-session") : null;
  let status: Status = { serverNow: Number(root.dataset.serverNow), expiresAt: Number(root.dataset.expiresAt), warningMs: Number(root.dataset.warningMs) };
  let observedAt = performance.now(), busy = false, expired = false, requestSequence = 0;
  let lastActivitySent = performance.now();
  function render() {
    const remaining = status.expiresAt - (status.serverNow + performance.now() - observedAt);
    expired = expired || remaining <= 0;
    if (!expired && remaining > status.warningMs) { if (dialog.open) dialog.close(); return; }
    title.textContent = expired ? "ログインの確認が必要です" : "ログインを延長しますか？";
    description.textContent = expired
      ? "ログインの有効期限が切れたか、ログイン状態が変更されました。このページを残したまま新しいタブでログインし、入力中の内容を確認してから操作を再開してください。"
      : "ログインの有効期限が近づいています。作業を続ける場合は延長してください。";
    countdown.textContent = expired ? "" : `残り ${Math.floor(Math.ceil(remaining / 1000) / 60)}分${String(Math.ceil(remaining / 1000) % 60).padStart(2, "0")}秒`;
    renew.hidden = expired; logout.hidden = expired; login.hidden = !expired; recheck.hidden = !expired;
    if (!document.hidden && !dialog.open) dialog.showModal();
  }
  function accept(value: Status) {
    if (![value.serverNow, value.expiresAt, value.warningMs].every(Number.isFinite)) throw new Error("ログイン状態を確認できませんでした。");
    status = value; observedAt = performance.now(); expired = false; message.textContent = ""; render();
  }
  async function sync(action?: "renew" | "activity") {
    if (busy) return;
    const sequence = ++requestSequence;
    if (action) busy = true;
    renew.disabled = Boolean(action); logout.disabled = Boolean(action);
    try {
      const response = await fetch("/api/auth/session", { method: action ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000),
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) } : {}) });
      const body = await response.json();
      if (sequence !== requestSequence) return;
      if (response.status === 401 || body.authenticated === false) { expired = true; render(); return; }
      if (!response.ok || !body.ok) throw new Error(body.message || "ログイン状態を確認できませんでした。");
      accept(body);
      if (action === "renew") channel?.postMessage("renewed");
    } catch (error) {
      if (dialog.open) message.textContent = error instanceof Error && error.name !== "TimeoutError" ? error.message : "通信を確認し、もう一度お試しください。";
    } finally { if (action) { busy = false; renew.disabled = false; logout.disabled = false; } }
  }
  dialog.addEventListener("cancel", event => event.preventDefault());
  renew.addEventListener("click", () => { void sync("renew"); });
  recheck.addEventListener("click", () => { void sync(); });
  logout.addEventListener("click", async () => {
    if (busy) return;
    busy = true; renew.disabled = true; logout.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("ログアウトできませんでした。通信を確認して再度お試しください。");
      channel?.postMessage("logged-out"); location.assign("/Login");
    } catch (error) { message.textContent = error instanceof Error ? error.message : "通信を確認してください。"; }
    finally { busy = false; renew.disabled = false; logout.disabled = false; }
  });
  // Actual foreground input refreshes inactivity; periodic status polling never does.
  const activity = (event: Event) => {
    if (!event.isTrusted || document.hidden || !document.hasFocus() || busy || expired || dialog.open || performance.now() - lastActivitySent < 60_000) return;
    lastActivitySent = performance.now(); void sync("activity");
  };
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(name, activity, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); void sync(); } });
  window.addEventListener("focus", () => { render(); void sync(); });
  channel?.addEventListener("message", () => { void sync(); });
  const displayTimer = window.setInterval(render, 1000);
  const pollTimer = window.setInterval(() => { if (!document.hidden) void sync(); }, 60_000);
  window.addEventListener("pagehide", () => { clearInterval(displayTimer); clearInterval(pollTimer); channel?.close(); }, { once: true });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  render(); void sync();
}
