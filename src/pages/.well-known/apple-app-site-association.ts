import type { APIRoute } from "astro";
import { env } from "../../lib/config.ts";
import { json } from "../../lib/http.ts";

export const GET: APIRoute = () => {
  const team = env("APPLE_TEAM_ID");
  if (!/^[A-Z0-9]{10}$/.test(team))
    return json({ ok: false, message: "アプリの関連付けは準備中です。" }, 503);
  return new Response(
    JSON.stringify({
      applinks: {
        details: [
          {
            appIDs: [`${team}.jp.scharade.app`],
            components: [
              "/Member*",
              "/Admin*",
              "/Exhibition/*",
              "/Portfolio*",
              "/Login",
              "/Signup",
              "/Mfa",
              "/ForgotPassword",
              "/ResetPassword",
              "/ReviewAccount",
              "/AccountDeletion",
              "/AppPrivacy",
            ].map((path) => ({ "/": path })),
          },
        ],
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
};
