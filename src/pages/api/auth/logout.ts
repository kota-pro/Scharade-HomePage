import type { APIRoute } from "astro";
import { deleteSession, getAuthenticationFromRequest } from "../../../lib/auth.ts";
import { changeAdminView } from "../../../lib/adminViewActions.ts";
import { json } from "../../../lib/http.ts";
import { sessionCookieName, mfaCookieName, trustedBrowserCookieName, cookieOptions } from "../../../lib/sessionCookies.ts";

export const POST: APIRoute = async ({ cookies, request }) => {
  const authentication = getAuthenticationFromRequest(request);
  if (authentication.session?.adminView && authentication.user)
    return json(await changeAdminView(request, { action: "stop" }));
  const id = cookies.get(sessionCookieName(request))?.value;
  await deleteSession(id, cookies.get(trustedBrowserCookieName(request))?.value);
  cookies.delete("session", { path: "/" });
  cookies.delete(sessionCookieName(request), cookieOptions(request, 0));
  cookies.delete(mfaCookieName(request), cookieOptions(request, 0));
  cookies.delete(trustedBrowserCookieName(request), cookieOptions(request, 0));
  return json({ ok: true });
};
