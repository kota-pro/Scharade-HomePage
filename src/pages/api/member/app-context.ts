import type { APIRoute } from "astro";
import { readActivities } from "../../../lib/activities.ts";
import { json } from "../../../lib/http.ts";

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  const unread = readActivities().notifications.filter(
    (n) => n.recipientIds.includes(user.id) && !n.readBy[user.id],
  ).length;
  return json({
    ok: true,
    protocolVersion: 1,
    user: {
      id: user.id,
      name: user.name,
      role: user.role ?? "member",
      portfolioId: user.portfolioId ?? null,
      authVersion: user.authVersion ?? 0,
    },
    unread,
  });
};
