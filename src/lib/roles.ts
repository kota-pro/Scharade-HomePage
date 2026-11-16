export type Role = "member" | "staff" | "executive" | "admin";
type AccountRole = { approved?: boolean; role?: string } | null | undefined;
const ranks: Record<Role, number> = { member: 0, staff: 1, executive: 2, admin: 3 };
export function accountRole(user: AccountRole): Role {
  return user?.role && Object.hasOwn(ranks, user.role) ? user.role as Role : "member";
}
export function hasRole(user: AccountRole, minimum: Role) {
  return Boolean(user?.approved && ranks[accountRole(user)] >= ranks[minimum]);
}
export const isStaff = (user: AccountRole) => hasRole(user, "staff");
export const isExecutive = (user: AccountRole) => hasRole(user, "executive");
export const isAdmin = (user: AccountRole) => hasRole(user, "admin");
export function canManageAccount(actor: AccountRole, target: AccountRole) {
  return isAdmin(actor) || Boolean(isExecutive(actor) && target && ranks[accountRole(target)] < ranks.executive);
}
export const roleLabels: Record<Role, string> = { member: "一般会員", staff: "運営", executive: "幹部", admin: "管理者" };
