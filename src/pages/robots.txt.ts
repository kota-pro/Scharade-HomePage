export const prerender = false;

import { SITE_URL } from "../lib/config.ts";

export async function GET() {
  const content = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /Login",
    "Disallow: /Signup",
    "Disallow: /Portfolio/edit",
    "Disallow: /404",
    "Disallow: /503",
    "Disallow: /Admin",
    "Disallow: /Member",
    // Public share pages must remain crawlable so their noindex is visible.
    "Allow: /Member/events/",
    "Disallow: /Exhibition",
    "Disallow: /Mfa",
    "Disallow: /SearchResult",
    "Disallow: /ReviewAccount",
    "Disallow: /ForgotPassword",
    "Disallow: /ResetPassword",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
