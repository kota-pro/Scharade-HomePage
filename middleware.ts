import type { AstroRequest } from "astro";
import { getUserFromRequest } from "./src/lib/auth";

function jsonResponse(body: Record<string, unknown>, status = 401) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequest(context: AstroRequest) {
  const { route, request } = context;
  const url = new URL(request.url);
  const { user } = getUserFromRequest(request);

  if (url.pathname.startsWith("/api/portfolio")) {
    if (!user) {
      return jsonResponse({ ok: false, message: "Authentication required." }, 401);
    }
    if (!user.approved) {
      return jsonResponse({ ok: false, message: "Your account is pending approval." }, 403);
    }
    if (!user.portfolioId) {
      return jsonResponse({ ok: false, message: "Portfolio not linked to your account." }, 403);
    }
    return route?.isStatic ? null : undefined;
  }

  if (url.pathname.toLowerCase() === "/portfolio/edit") {
    if (!user) {
      url.searchParams.set("next", url.pathname);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/Login?next=${encodeURIComponent(url.pathname)}`,
        },
      });
    }
  }

  return route?.isStatic ? null : undefined;
}
