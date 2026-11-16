import crypto from "node:crypto";
import { getAuthenticationFromRequest, isStaff, readSessions, readUsers } from "./auth.ts";
import { adminViewPath, canProxyAccount, previewRoles } from "./adminViewPolicy.ts";
import { withStoreLock, writeData } from "./store.ts";
import { audit } from "./audit.ts";
import { HttpInputError } from "./http.ts";
import type { PreviewRole } from "./adminViewState.ts";

export async function changeAdminView(request: Request, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpInputError("操作を選択してください。", 400);
  const body = input as Record<string, unknown>;
  if (!['account', 'role', 'stop'].includes(String(body.action)) || Object.keys(body).some(key => !['action', 'userId', 'role'].includes(key))) throw new HttpInputError("操作を選択してください。", 400);
  return withStoreLock("auth", async () => {
    const { user: actor, session } = getAuthenticationFromRequest(request);
    if (!actor || !session) throw new HttpInputError("ログインしてください。", 401);
    const sessions = readSessions(), current = sessions.find(item => item.id === session.id)!;
    if (body.action === "stop") {
      if (current.adminView) await audit(actor!.id, "admin.view.stop", current.adminView.key);
      delete current.adminView;
      writeData("sessions.json", sessions);
      return { ok: true, href: adminViewPath(actor) };
    }
    if (!isStaff(actor)) throw new HttpInputError("運営以上の権限が必要です。", 403);
    const common = { key: crypto.randomUUID(), startedAt: new Date().toISOString() };
    if (body.action === "account") {
      if (!canProxyAccount(actor)) throw new HttpInputError("代理ログインには幹部以上の権限が必要です。", 403);
      if (typeof body.userId !== "string" || body.userId.length > 128) throw new HttpInputError("アカウントを選択してください。", 400);
      const target = readUsers().find(item => item.id === body.userId);
      if (!target) throw new HttpInputError("アカウントが見つかりません。", 404);
      await audit(actor!.id, "admin.view.account.start", target.id);
      current.adminView = { ...common, mode: "account", userId: target.id, authVersion: target.authVersion ?? 0 };
      writeData("sessions.json", sessions);
      return { ok: true, href: target.approved && !target.mustResetPassword ? "/Member" : "/" };
    }
    if (!['executive', 'staff', 'member', 'guest'].includes(String(body.role))) throw new HttpInputError("表示する権限を選択してください。", 400);
    const role = body.role as PreviewRole;
    if (!previewRoles(actor).includes(role)) throw new HttpInputError("このロールの表示確認は利用できません。", 403);
    await audit(actor!.id, "admin.view.role.start", role);
    current.adminView = { ...common, mode: "role", role };
    writeData("sessions.json", sessions);
    return { ok: true, href: role === "guest" ? "/" : role === "executive" ? "/Admin" : role === "staff" ? "/Management" : "/Member" };
  });
}
