import type { APIRoute } from "astro";
import {
  activityAction,
  ActivityError,
  readActivities,
  memberEvent,
} from "../../../lib/activities.ts";
import { readUsers } from "../../../lib/auth.ts";
import { json } from "../../../lib/http.ts";
import { readExhibitions } from "../../../lib/exhibitions.ts";
import { visibleMemberNotifications } from "../../../lib/memberActivityVisibility.ts";
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const user = locals.user,
      data = readActivities(),
      id = url.searchParams.get("eventId");
    if (id) {
      const event = data.events.find((e) => e.id === id);
      if (!event)
        return json({ ok: false, message: "企画が見つかりません。" }, 404);
      return json({
        ok: true,
        event: memberEvent(data, event, user, readUsers()),
      });
    }
    const notices = visibleMemberNotifications(data, readExhibitions().exhibitions, user.id);
    const offset = Math.max(
      0,
      Math.floor(Number(url.searchParams.get("offset")) || 0),
    );
    return json({
      ok: true,
      unread: notices.filter((n) => !n.readBy[user.id]).length,
      total: notices.length,
      notifications: notices
        .reverse()
        .slice(offset, offset + 30)
        .map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          senderName: n.senderName,
          eventId: n.eventId,
          exhibitionId: n.exhibitionId,
          toolId: n.toolId,
          createdAt: n.createdAt,
          readAt: n.readBy[user.id] || null,
        })),
    });
  } catch (error) {
    if (error instanceof ActivityError)
      return json({ ok: false, message: error.message }, error.status);
    return json(
      { ok: false, message: "企画・通知を読み込めませんでした。" },
      503,
    );
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    return json(
      await activityAction(
        locals.user.id,
        await request.json().catch(() => null),
      ),
    );
  } catch (error) {
    if (error instanceof ActivityError)
      return json({ ok: false, message: error.message }, error.status);
    console.error("[activities] request failed");
    return json(
      {
        ok: false,
        message: "保存できませんでした。時間をおいて再度お試しください。",
      },
      503,
    );
  }
};
