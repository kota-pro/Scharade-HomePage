import { accountRole, isAdmin, isExecutive, isStaff, roleLabels, type Role } from "./roles.ts";

type Actor = Parameters<typeof accountRole>[0];
export type PreviewRole = Exclude<Role, "admin"> | "guest";
export const canProxyAccount = (actor: Actor) => isExecutive(actor);
export function previewRoles(actor: Actor): PreviewRole[] {
  if (isAdmin(actor)) return ["executive", "staff", "member", "guest"];
  if (isExecutive(actor)) return ["staff", "member", "guest"];
  return isStaff(actor) ? ["member", "guest"] : [];
}
export function adminViewPath(actor: Actor) {
  return isExecutive(actor) ? "/Admin/view" : isStaff(actor) ? "/Management/view" : "/Member";
}
export const adminViewReturnLabel = (actor: Actor) => `${roleLabels[accountRole(actor)]}へ戻る`;
