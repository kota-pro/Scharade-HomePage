import { defineMiddleware } from "astro:middleware";
import { getUserFromRequest } from "./src/lib/auth";

function jsonResponse(body: Record<string, unknown>, status = 401) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const { user } = getUserFromRequest(request);

  if (url.pathname === "/Portfolio" || url.pathname.startsWith("/Portfolio/")) {
    const normalizedPath =
      `/portfolio${url.pathname.slice("/Portfolio".length)}` || "/portfolio";
    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = normalizedPath;
    return Response.redirect(redirectUrl, 301);
  }

  if (url.pathname.startsWith("/api/portfolio")) {
    if (!user) {
      return jsonResponse(
        { ok: false, message: "Authentication required." },
        401,
      );
    }

    if (!user.approved) {
      return jsonResponse(
        { ok: false, message: "Your account is pending approval." },
        403,
      );
    }

    if (!user.portfolioId) {
      return jsonResponse(
        { ok: false, message: "Portfolio not linked to your account." },
        403,
      );
    }
  }

  if (url.pathname.toLowerCase() === "/portfolio/edit") {
    if (!user) {
      return Response.redirect(
        `/Login?next=${encodeURIComponent(url.pathname)}`,
        302,
      );
    }
  }

  return next();
});
