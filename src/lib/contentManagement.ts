import type { APIContext, APIRoute } from "astro";
import { isStaff } from "./auth.ts";
import { HttpInputError, json } from "./http.ts";
import { ImageBusyError } from "./imageSecurity.ts";

export class ContentManagementError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function staffContentRoute(action: (context: APIContext) => Promise<Response>): APIRoute {
  return contentRoute(action, true);
}

export function memberContentRoute(action: (context: APIContext) => Promise<Response>): APIRoute {
  return contentRoute(action, false);
}

function contentRoute(action: (context: APIContext) => Promise<Response>, staff: boolean): APIRoute {
  return async context => {
    const user = context.locals.user;
    if (!(staff ? isStaff(user) : user?.approved) || context.locals.adminView?.readOnly)
      return json({ ok: false, message: staff ? "運営以上の権限が必要です。" : "承認済みの会員アカウントが必要です。" }, user ? 403 : 401);
    try {
      return await action(context);
    } catch (error) {
      if (error instanceof ContentManagementError || error instanceof HttpInputError || error instanceof ImageBusyError)
        return json({ ok: false, message: error.message }, error.status);
      return json({ ok: false, message: "操作を完了できませんでした。時間をおいて再度お試しください。" }, 503);
    }
  };
}

export async function managementBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContentManagementError("送信内容を確認してください。");
  return value;
}
