export type BreadcrumbItem = { label: string; href?: string };
export function breadcrumbsFor(
  pathname: string,
  title?: string,
): BreadcrumbItem[] {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return [{ label: "Home" }];
  const home = { label: "Home", href: "/" };
  const routes: Record<string, string> = {
    "/About_us": "About us",
    "/Activity": "Activity",
    "/Gallery": "Gallery",
    "/Portfolio": "Portfolio",
    "/Contact": "Contact",
    "/Disclaimer": "Disclaimer",
    "/SearchResult": "検索結果",
    "/Login": "ログイン",
    "/Signup": "会員登録",
    "/ForgotPassword": "パスワード再設定",
    "/ResetPassword": "パスワード再設定",
    "/sitemap": "サイトマップ",
    "/404": "ページが見つかりません",
    "/Admin": "管理画面",
    "/Member": "メンバーページ",
  };
  if (routes[path]) return [home, { label: routes[path] }];
  if (path.startsWith("/Admin/grouping-roster")) return [home, { label: "管理画面", href: "/Admin" }, ...(path === "/Admin/grouping-roster" ? [] : [{ label: "班分け用名簿", href: "/Admin/grouping-roster" }]), { label: title || "班分け用名簿" }];
  if (path.startsWith("/Member/") && path !== "/Member/advance") {
    const trail: BreadcrumbItem[] = [home, { label: "メンバーページ", href: "/Member" }];
    if (path.startsWith("/Member/manage/") && path !== "/Member/manage/") trail.push({ label: "運営", href: "/Member/manage" });
    trail.push({ label: title || "企画・通知" });
    return trail;
  }
  if (path === "/Member/advance")
    return [home, { label: "メンバーページ", href: "/Member" }, { label: "立替申請" }];
  if (path === "/Portfolio/edit")
    return [
      home,
      { label: "Portfolio", href: "/Portfolio" },
      { label: "編集" },
    ];
  if (path.startsWith("/posts/"))
    return [
      home,
      { label: "Activity", href: "/Activity" },
      { label: title || "記事" },
    ];
  if (path.startsWith("/Gallery/"))
    return [
      home,
      { label: "Gallery", href: "/Gallery" },
      { label: title || "アルバム" },
    ];
  if (path.startsWith("/Portfolio/"))
    return [
      home,
      { label: "Portfolio", href: "/Portfolio" },
      { label: title?.replace(/\s*\|\s*Portfolio$/, "") || "プロフィール" },
    ];
  return [home, { label: title || "ページが見つかりません" }];
}
