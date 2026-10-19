import type { APIRoute } from "astro";
import { updatePushDevice, PushInputError } from "../../../lib/pushDevices.ts";
import { sessionCookieName } from "../../../lib/sessionCookies.ts";
import { json } from "../../../lib/http.ts";

const update: APIRoute = async ({ request, cookies }) => {
  try {
    return json(
      await updatePushDevice(
        cookies.get(sessionCookieName(request))?.value ?? "",
        await request.json().catch(() => null),
        request.method === "DELETE",
      ),
    );
  } catch (error) {
    if (error instanceof PushInputError)
      return json({ ok: false, message: error.message }, error.status);
    return json(
      {
        ok: false,
        message:
          "通知端末を保存できませんでした。時間をおいて再試行してください。",
      },
      503,
    );
  }
};
export const POST = update;
export const DELETE = update;
