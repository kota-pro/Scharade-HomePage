import "../scripts/require-secure-runtime.mjs";
import { defineMiddleware } from "astro:middleware";
import { getUserFromRequest, isAdmin, isStaff, isExecutive, touchSession } from "./lib/auth.ts";
import { json, isSameOrigin, boundedBody, decodeRequestBody, HttpInputError } from "./lib/http.ts";
import { checkRateLimit } from "./lib/rateLimit.ts";
import { securityResponse } from "./lib/security.ts";
import { numberErrorResponse, siteFailurePage } from './lib/siteErrorResponse.ts';
import { queueErrorReport, startErrorReportDelivery } from './lib/siteErrorReports.ts';
import { errorReportEndpoint } from './lib/siteErrorReport.ts';
import { validErrorDetail } from './lib/siteErrors.ts';
import { refreshTrustedBrowserCookie } from './lib/sessionCookies.ts';
import { withRequestIdentity } from './lib/requestIdentity.ts';
import { audit } from './lib/audit.ts';
import { matchesAdminViewRequest } from './lib/adminViewState.ts';
import { adminViewPath } from './lib/adminViewPolicy.ts';

startErrorReportDelivery();

export const onRequest = defineMiddleware(async (context, next) => {
  const guarded = async () => {
  const { request, url } = context;
  const pathname = url.pathname;
  let decodedRequest: Request | undefined;
  // Presentation hint only. This never grants access or relaxes API origin checks.
  context.locals.appShell = /\bScharadeApp\/1\b/.test(request.headers.get("user-agent") ?? "");
  const authentication = getUserFromRequest(request);
  context.locals.user = authentication.user;
  context.locals.session = authentication.session;
  context.locals.actor = authentication.actor;
  context.locals.adminView = authentication.adminView;
  // Polls/status checks must not turn an unattended tab into continued use.
  const activity = !pathname.startsWith('/api/') && !pathname.startsWith('/_') && request.method === 'GET' &&
    (request.headers.get('sec-fetch-mode') === 'navigate' || request.headers.get('accept')?.includes('text/html'));
  if (authentication.session && activity) {
    const session = await touchSession(authentication.session);
    context.locals.session = session;
    if (!session) { context.locals.user = null; context.locals.actor = null; context.locals.adminView = null; }
    else refreshTrustedBrowserCookie(context.cookies, request, session);
  }
  const viewControl = /^\/(?:Admin|Management)\/view\/?$/.test(pathname);
  if (viewControl) context.locals.user = context.locals.actor;
  const user = context.locals.user;
  const view = context.locals.adminView;
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const controlApi = ["/api/auth/admin-view", "/api/auth/session", "/api/auth/logout"].includes(pathname);
  const readApi = pathname === "/api/photos/state" && request.method === "POST";
  if (!matchesAdminViewRequest(request, view))
    return json({ ok: false, message: "ログイン先・表示モードが変わりました。画面を再読み込みしてから操作してください。" }, 409);
  if (view && !controlApi) {
    if ((view.readOnly && mutation && !readApi) || pathname.startsWith("/api/auth/") ||
      pathname === "/api/account-deletion" || pathname === "/api/member/account-deletion-requests" || pathname === "/api/member/push-devices")
      return json({ ok: false, message: view.readOnly ? "表示確認は閲覧専用です。元の権限へ戻って操作してください。" : "認証・アカウント保護の操作は代理ログインを終了して行ってください。" }, 403);
    if (pathname === "/Member/security") return context.redirect(`${adminViewPath(context.locals.actor)}?notice=security`, 302);
  }
  context.locals.preview =
    url.searchParams.get("preview") === "draft" && isAdmin(user);
  const managementPage = pathname === "/Management" || pathname.startsWith("/Management/");
  const dashboardPage = /^\/Dashboard\/?$/.test(pathname);
  const memberPage = pathname === "/Member" || pathname.startsWith("/Member/") || managementPage || dashboardPage;
  const publicEventPage = /^\/Member\/events\/[^/]+\/?$/.test(pathname);
  const publicToolPage = /^\/Member\/tools\/[^/]+\/?$/.test(pathname);
  const publicToolRead = request.method === "GET" && /^\/api\/member\/tools\/[^/]+(?:\/assets\/[^/]+)?\/?$/.test(pathname);
  const memberApi = pathname.startsWith("/api/member/");
  const exhibitionPage = pathname.startsWith("/Exhibition/");
  const exhibitionApi = pathname.startsWith("/api/exhibitions/");
  if (((memberPage && !publicEventPage && !publicToolPage) || (memberApi && !publicToolRead) || exhibitionPage || exhibitionApi) && !user?.approved) {
    if (memberApi || exhibitionApi) return json({ ok: false, message: "ログインが必要です。" }, 401);
    return context.redirect(`/Login?next=${encodeURIComponent(pathname + url.search)}`, 302);
  }

  if ((managementPage || dashboardPage || pathname === "/Member/manage" || pathname.startsWith("/Member/manage/")) && !isStaff(user)) {
    if (view) return context.redirect(`${adminViewPath(context.locals.actor)}?notice=permission`, 302);
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
    try {
      const decoded = await decodeRequestBody(request, upload ? 21 * 1024 * 1024 : 512 * 1024);
      // Pass the decoded body to both the route context and Astro's request state.
      if (decoded !== request) context.request = decodedRequest = decoded;
      if (!upload) await boundedBody((decodedRequest ?? request).clone(), 512 * 1024);
    } catch (error) {
      void request.body?.cancel().catch(() => {});
      if (error instanceof HttpInputError) return json({ ok: false, message: error.message }, error.status);
      return json({ ok: false, message: "送信内容を読み取れません。" }, 400);
    }
  }
  if (
    pathname === "/Admin" ||
    pathname.startsWith("/Admin/") ||
    pathname.startsWith("/api/admin/")
  ) {
    const executiveSection = /^\/(?:api\/admin|Admin)\/(?:accounts|account-deletion-requests|grouping-roster|club-forms|photos|accounting)(?:\/|$)/.test(pathname) || /^\/Admin\/(?:view)\/?$/.test(pathname) || /^\/Admin\/?$/.test(pathname);
    if (!(executiveSection ? isExecutive(user) : isAdmin(user))) {
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
      if (view) return context.redirect(`${adminViewPath(context.locals.actor)}?notice=permission`, 302);
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
  const identity = view && context.locals.actor ? { actorId: context.locals.actor.id, user: authentication.user, mode: view.mode, key: view.key } : undefined;
  const response = await withRequestIdentity(identity, async () => {
    if (view?.mode === "account" && mutation && !controlApi && !readApi)
      await audit(user!.id, `admin.proxy.request.${request.method}`, pathname);
    return next(decodedRequest);
  });
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
  try {
    const response = await numberErrorResponse(await guarded());
    if ((response.status >= 400 || response.headers.has('X-Error-Code')) && !context.url.pathname.startsWith(errorReportEndpoint)) {
      const code = response.headers.get('X-Error-Code') ?? (response.status >= 500 ? 'SITE-011' : 'SITE-001');
      const body = response.headers.get('Content-Type')?.includes('application/json') ? await response.clone().json().catch(() => null) : null;
      if (response.status >= 500 || validErrorDetail(code, body?.errorDetail)) void queueErrorReport({ code, detail: body?.errorDetail, route: context.routePattern || context.url.pathname, kind: 'server', method: context.request.method, status: response.status, at: Date.now() });
    }
    return securityResponse(response, context.url, context.locals.user, context.locals.preview);
  } catch (error) {
    if (!context.url.pathname.startsWith(errorReportEndpoint)) void queueErrorReport({ code: 'SITE-011', route: context.routePattern || context.url.pathname, kind: 'server', reason: 'exception', exception: error instanceof Error ? error.name : 'Unknown', method: context.request.method, status: 503, at: Date.now() }, { error });
    return securityResponse(context.url.pathname.startsWith('/api/') ? await numberErrorResponse(json({ ok: false, message: "現在操作を完了できません。時間をおいて再度お試しください。" }, 503)) : siteFailurePage(), context.url);
  }
});
