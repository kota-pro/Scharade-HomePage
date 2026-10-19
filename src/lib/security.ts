import type { User } from "./auth.ts";

export function securityResponse(response: Response, url: URL, user?: User | null, preview = false) {
  const headers = new Headers(response.headers), path = url.pathname;
  const privatePath = /^\/(?:Admin|Member|Exhibition|Mfa|ReviewAccount|ResetPassword)(?:\/|$)/.test(path) || path.startsWith("/api/") || preview;
  if (privatePath || user || headers.get("Content-Type")?.includes("text/html") || response.status >= 300) headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (/^\/(?:Mfa|ReviewAccount|ResetPassword)(?:\/|$)/.test(path) || url.searchParams.has("token") || url.searchParams.has("sig")) headers.set("Referrer-Policy", "no-referrer");
  else if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000");
  if (privatePath) headers.set("X-Robots-Tag", "noindex, nofollow");
  // Astro emits the full per-document hash policy. Early API/redirect responses
  // still get a restrictive policy, even when rendering was bypassed.
  if (!headers.has("Content-Security-Policy") && !headers.get("Content-Type")?.includes("text/html")) headers.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
