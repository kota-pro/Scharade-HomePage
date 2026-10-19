import { env } from "./config.ts";
import { signedEnvelope } from "./signedEnvelope.ts";

export type ExhibitionGoogleConnection = "legacy" | "exhibition-drive";
export const exhibitionDriveOwner = "sharadeshashinten@gmail.com";
const variables = (connection: ExhibitionGoogleConnection) => connection === "legacy"
  ? { url: "EXHIBITION_GAS_URL", secret: "EXHIBITION_WEBHOOK_SECRET" }
  : { url: "EXHIBITION_DRIVE_GAS_URL", secret: "EXHIBITION_DRIVE_WEBHOOK_SECRET" };
function gatewayUrl(connection: ExhibitionGoogleConnection) {
  const url = new URL(env(variables(connection).url));
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.username || url.password) throw new Error("configuration");
  return url;
}
export function exhibitionGoogleConfigured(connection: ExhibitionGoogleConnection = "legacy") {
  try { gatewayUrl(connection); return env(variables(connection).secret).length >= 32; } catch { return false; }
}
export async function postExhibitionGas(value: object, timeout = 25000, connection: ExhibitionGoogleConnection = "legacy") {
  if (!exhibitionGoogleConfigured(connection)) throw new Error("configuration");
  let target = gatewayUrl(connection);
  let response = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signedEnvelope(value, env(variables(connection).secret))), redirect: "manual", signal: AbortSignal.timeout(timeout) });
  for (let hops = 0; hops < 3 && [301, 302, 303].includes(response.status); hops++) {
    const next = new URL(response.headers.get("location") ?? "", target);
    if (next.protocol !== "https:" || next.hostname !== "script.googleusercontent.com" || next.username || next.password) throw new Error("redirect");
    target = next;
    response = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeout) });
  }
  if (!response.ok) throw new Error(`upstream-${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data?.ok) throw new Error(`upstream-${String(data?.code ?? "invalid")}`);
  return data as Record<string, any>;
}
export async function checkExhibitionGoogleConnection(connection: ExhibitionGoogleConnection = "legacy") {
  const result = await postExhibitionGas({ action: "health" }, 25000, connection);
  if (connection === "exhibition-drive" && (result.gatewayVersion !== 3 || result.owner !== exhibitionDriveOwner || result.driveApi !== true)) throw new Error("drive-owner-configuration");
  return result;
}
