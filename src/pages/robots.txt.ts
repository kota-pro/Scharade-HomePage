export const prerender = false;

const SITE_URL = "https://scharade.jp";

export async function GET() {
  const content = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /Login",
    "Disallow: /Signup",
    "Disallow: /Portfolio/edit",
    "Disallow: /404",
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