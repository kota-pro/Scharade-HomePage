export type QrBrand = "scharade" | "instagram" | "x";
export const qrLogoPaths: Record<QrBrand,string> = { scharade: "/icons/logo.svg", instagram: "/icons/Instagram.svg", x: "/icons/X.svg" };
export function qrBrand(value: string, origin: string): QrBrand | null {
  try {
    const url=new URL(value), own=new URL(origin), host=url.hostname.toLowerCase().replace(/^www\./,"");
    if(url.protocol!=="https:" && url.origin!==own.origin) return null;
    if ((url.origin===own.origin || ["scharade.jp"].includes(host)) && /^\/Portfolio\/[^/]+\/?$/.test(url.pathname)) return "scharade";
    if(["instagram.com","m.instagram.com"].includes(host)) return "instagram";
    if(["x.com","twitter.com","mobile.twitter.com"].includes(host)) return "x";
  } catch {}
  return null;
}
