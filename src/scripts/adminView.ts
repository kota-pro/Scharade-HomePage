const meta = document.querySelector<HTMLMetaElement>('meta[name="admin-view-key"]');
const nativeFetch = window.fetch.bind(window);
// Pin mutations to the identity rendered in this tab. Old tabs cannot silently save
// as a different account after a switch in another tab.
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const scoped = url.pathname.startsWith("/api/") || url.pathname === "/Management/blog/preview";
  if (url.origin === location.origin && scoped && !["GET", "HEAD", "OPTIONS"].includes(method) && meta?.content) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("X-Admin-View", meta.content);
    return nativeFetch(input, { ...init, headers });
  }
  return nativeFetch(input, init);
};

document.querySelectorAll<HTMLButtonElement>("[data-admin-view-stop], [data-admin-view-account], [data-admin-view-role]").forEach(button => {
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const status = button.closest("section,aside")?.querySelector<HTMLElement>("[data-admin-view-status]") || document.querySelector<HTMLElement>("[data-admin-view-status]");
    button.disabled = true;
    if (status) status.textContent = "表示を切り替えています…";
    const payload = button.hasAttribute("data-admin-view-stop") ? { action: "stop" } : button.dataset.adminViewAccount ? { action: "account", userId: button.dataset.adminViewAccount } : { action: "role", role: button.dataset.adminViewRole };
    try {
      const response = await fetch("/api/auth/admin-view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "切り替えができませんでした。");
      location.assign(result.href);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "通信状況を確認してください。";
      button.disabled = false;
    }
  });
});
