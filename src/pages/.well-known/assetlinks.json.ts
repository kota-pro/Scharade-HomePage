import type { APIRoute } from "astro";
import { env } from "../../lib/config.ts";
import { json } from "../../lib/http.ts";

export const GET: APIRoute = () => {
  const fingerprints = env("ANDROID_APP_SIGNING_SHA256")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !fingerprints.length ||
    fingerprints.some((s) => !/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(s))
  )
    return json({ ok: false, message: "アプリの関連付けは準備中です。" }, 503);
  return new Response(
    JSON.stringify([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "jp.scharade.app",
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
};
