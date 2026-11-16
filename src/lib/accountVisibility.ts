import type { User } from "./auth.ts";

/** The legacy ID belongs to the dedicated site account, never to a personal admin. */
export function isSiteManagement(user: Pick<User, "siteManagement" | "portfolioId"> | null | undefined) {
  return Boolean(user && (user.siteManagement || user.portfolioId === "w_rozcjvv"));
}
export function isMemberAccount(user: Pick<User, "approved" | "siteManagement" | "portfolioId">) {
  return user.approved && !isSiteManagement(user);
}
