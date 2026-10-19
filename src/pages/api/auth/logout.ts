import type { APIRoute } from "astro";
import { deleteSession } from "../../../lib/auth.ts";
import { json } from "../../../lib/http.ts";
import { sessionCookieName, mfaCookieName, cookieOptions } from "../../../lib/sessionCookies.ts";

export const POST: APIRoute = async ({ cookies, request }) => {
  const id = cookies.get(sessionCookieName(request))?.value;
  if (id) await deleteSession(id);
  cookies.delete("session", { path: "/" });
  cookies.delete(sessionCookieName(request), cookieOptions(request, 0));
  cookies.delete(mfaCookieName(request), cookieOptions(request, 0));
  return json({ ok: true });
};
