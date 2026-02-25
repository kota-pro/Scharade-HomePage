import type { APIRoute } from "astro";
import crypto from "node:crypto";

function isProd() {
  return process.env.NODE_ENV === "production";
}

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({ ok: false, message: "Missing INSTAGRAM_CLIENT_ID or INSTAGRAM_REDIRECT_URI" }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  const next = url.searchParams.get("next") || "/";

  const state = crypto.randomBytes(16).toString("hex");
  cookies.set("ig_state", state, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  cookies.set("ig_next", next, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  const authUrl = new URL("https://api.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "user_profile");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return redirect(authUrl.toString());
};
