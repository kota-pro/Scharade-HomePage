export type PrivateSection = "home" | "events" | "account" | "staff" | "admin";

export function privateSection(pathname: string, hash = "", view = ""): PrivateSection {
  const path = pathname.replace(/\/$/, "");
  if (path === "/Admin" || path.startsWith("/Admin/")) return "admin";
  if (path === "/Management" || path.startsWith("/Management/") || path === "/Dashboard" || path === "/Member/manage" || path.startsWith("/Member/manage/")) return "staff";
  if (path.startsWith("/Member/events/") || path.startsWith("/Member/exhibitions/")) return "events";
  if (["/Member/profile", "/Member/security", "/Member/advance", "/Member/account-deletion"].includes(path)) return "account";
  if (path === "/Member") {
    if (hash === "#my-page") return "account";
    if (hash === "#events-heading" || view === "calendar" || view === "list") return "events";
  }
  return "home";
}

export function privateNavigation(access: { staff: boolean; admin: boolean; executive?: boolean }) {
  const entries: { key: PrivateSection; label: string; href: string; icon: "home" | "calendar" | "user" | "users" | "settings" }[] = [
    { key: "home", label: "ホーム", href: "/Member", icon: "home" },
    { key: "events", label: "企画", href: "/Member#events-heading", icon: "calendar" },
  ];
  if (access.staff) entries.push({ key: "staff", label: "運営", href: "/Management", icon: "users" });
  if (access.admin || access.executive) entries.push({ key: "admin", label: "管理", href: "/Admin", icon: "settings" });
  entries.push({ key: "account", label: "マイページ", href: "/Member#my-page", icon: "user" });
  return entries;
}
