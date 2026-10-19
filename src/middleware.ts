import { defineMiddleware } from "astro:middleware";
import { getUserFromRequest, isAdmin, isStaff, touchSession } from "./lib/auth.ts";
import { json, isSameOrigin, boundedBody, HttpInputError } from "./lib/http.ts";
import { checkRateLimit } from "./lib/rateLimit.ts";
import { securityResponse } from "./lib/security.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  const guarded = async () => {
  const { request, url } = context;
  const pathname = url.pathname;
  // Presentation hint only. This never grants access or relaxes API origin checks.
  context.locals.appShell = /\bScharadeApp\/1\b/.test(request.headers.get("user-agent") ?? "");
  const authentication = getUserFromRequest(request);
  context.locals.user = authentication.user;
  if (authentication.session) await touchSession(authentication.session);
  const user = context.locals.user;
  context.locals.preview =
    url.searchParams.get("preview") === "draft" && isAdmin(user);
  const memberPage = pathname === "/Member" || pathname.startsWith("/Member/");
  const publicEventPage = /^\/Member\/events\/[^/]+\/?$/.test(pathname);
  const memberApi = pathname.startsWith("/api/member/");
  const exhibitionPage = pathname.startsWith("/Exhibition/");
  const exhibitionApi = pathname.startsWith("/api/exhibitions/");
  if (((memberPage && !publicEventPage) || memberApi || exhibitionPage || exhibitionApi) && !user?.approved) {
    if (memberApi || exhibitionApi) return json({ ok: false, message: "ログインが必要です。" }, 401);
    return context.redirect(`/Login?next=${encodeURIComponent(pathname + url.search)}`, 302);
  }

  if ((pathname === "/Member/manage" || pathname.startsWith("/Member/manage/")) && !isStaff(user)) {
    return new Response("運営以上の権限が必要です。", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  if (
    pathname.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method)
  ) {
    if (!isSameOrigin(request))
      return json(
        { ok: false, message: "このサイトの画面から操作してください。" },
        403,
      );
    const size = Number(request.headers.get("content-length") ?? 0);
    const upload = pathname.endsWith("/upload") || pathname.endsWith("/media");
    if (size > (upload ? 21 * 1024 * 1024 : 512 * 1024))
      return json({ ok: false, message: "送信内容が大きすぎます。" }, 413);
    if (!(await checkRateLimit(context)))
      return json(
        {
          ok: false,
          message: "操作が集中しています。時間をおいてお試しください。",
        },
        429,
      );
    if (!upload) {
      try { await boundedBody(request.clone(), 512 * 1024); }
      catch (error) {
        void request.body?.cancel().catch(() => {});
        if (error instanceof HttpInputError) return json({ ok: false, message: error.message }, error.status);
        return json({ ok: false, message: "送信内容を読み取れません。" }, 400);
      }
    }
  }
  if (
    pathname === "/Admin" ||
    pathname.startsWith("/Admin/") ||
    pathname.startsWith("/api/admin/")
  ) {
    if (!isAdmin(user)) {
      if (pathname.startsWith("/api/"))
        return json(
          { ok: false, message: "管理者権限が必要です。" },
          user ? 403 : 401,
        );
      if (!user)
        return context.redirect(
          `/Login?next=${encodeURIComponent(pathname + url.search)}`,
          302,
        );
      return new Response("管理者権限が必要です。", {
        status: 403,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }
  if (pathname.startsWith("/api/portfolio/")) {
    if (!user) return json({ ok: false, message: "ログインが必要です。" }, 401);
    if (!user.approved)
      return json({ ok: false, message: "承認をお待ちください。" }, 403);
  }
  if (pathname.replace(/\/$/, "") === "/Portfolio/edit" && !user)
    return context.redirect(
      `/Login?next=${encodeURIComponent(pathname + url.search)}`,
      302,
    );
  const response = await next();
  if (
    response.headers.get("Content-Type")?.includes("text/html") ||
    user ||
    context.locals.preview ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/Admin")
  )
    response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  if (pathname.startsWith("/Admin") || memberPage || memberApi || exhibitionPage || exhibitionApi || context.locals.preview)
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
  };
  try { return securityResponse(await guarded(), context.url, context.locals.user, context.locals.preview); }
  catch { return securityResponse(json({ ok: false, message: "現在操作を完了できません。時間をおいて再度お試しください。" }, 503), context.url); }
});
