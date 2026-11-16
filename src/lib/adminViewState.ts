import type { Session, User } from "./auth.ts";
import { roleLabels } from "./roles.ts";
import { canProxyAccount, previewRoles, type PreviewRole } from "./adminViewPolicy.ts";

export type { PreviewRole } from "./adminViewPolicy.ts";
export type AdminViewState = { key: string; startedAt: string } & (
  { mode: "account"; userId: string; authVersion: number } |
  { mode: "role"; role: PreviewRole }
);
export type AdminView = AdminViewState & { label: string; unavailable: boolean; readOnly: boolean };
/** Recheck when a route resolves auth again after awaiting input, so a concurrent
 * tab switch cannot redirect an in-flight save into the newly selected account. */
export function matchesAdminViewRequest(request: Request, view: AdminView | null) {
  const pathname = new URL(request.url).pathname;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    ["/api/auth/admin-view", "/api/auth/session", "/api/auth/logout"].includes(pathname) ||
    pathname === "/api/photos/state" && request.method === "POST") return true;
  return (request.headers.get("x-admin-view") || "") === (view?.key || "");
}
export function resolveAdminView(actor: User | null, session: Session | null, users: User[]) {
  const state = session?.adminView;
  if (!state || !actor) return { user: actor, adminView: null as AdminView | null };
  // Recheck the original actor on every request, including sessions created
  // before a role change. Never fall back to a writable identity mid-preview.
  if (!(state.mode === "account" ? canProxyAccount(actor) : previewRoles(actor).includes(state.role)))
    return { user: null, adminView: { ...state, label: "利用できない表示モード", unavailable: true, readOnly: true } as AdminView };
  if (state.mode === "account") {
    const target = users.find(user => user.id === state.userId);
    const unavailable = !target?.approved || !!target.mustResetPassword || (target.authVersion ?? 0) !== state.authVersion;
    return { user: unavailable ? null : target!, adminView: { ...state, label: target?.name || "利用できないアカウント", unavailable, readOnly: unavailable } as AdminView };
  }
  const label = state.role === "guest" ? "未ログイン" : roleLabels[state.role];
  const user: User | null = state.role === "guest" ? null : {
    id: `preview-${session!.id}`, name: `${label}の表示確認`, email: "", approved: true,
    role: state.role, providers: {}, createdAt: state.startedAt, portfolioId: null,
  };
  return { user, adminView: { ...state, label, unavailable: false, readOnly: true } as AdminView };
}
