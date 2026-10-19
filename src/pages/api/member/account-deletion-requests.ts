import type { APIRoute } from "astro";
import {
  readDeletionRequests,
  deletionRequestView,
} from "../../../lib/accountDeletionRequests.ts";
import { json } from "../../../lib/http.ts";
export const GET: APIRoute = ({ locals }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  return json({
    ok: true,
    requests: readDeletionRequests()
      .requests.filter((r) => r.userId === locals.user!.id)
      .map(deletionRequestView),
  });
};
export { POST } from "../account-deletion.ts";
