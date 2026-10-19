export function env(name: string): string {
  return (
    process.env[name] ??
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[
      name
    ] ??
    ""
  );
}

export const SITE_URL = "https://scharade.jp";

export function siteOrigin(request?: Request) {
  const configured = env("SITE_URL");
  if (configured) return new URL(configured).origin;
  if (request && new URL(request.url).hostname === "localhost")
    return new URL(request.url).origin;
  return SITE_URL;
}
