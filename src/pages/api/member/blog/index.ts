import { createBlogDraft } from "../../../../lib/blogManagement.ts";
import { managementBody, memberContentRoute } from "../../../../lib/contentManagement.ts";
import { json } from "../../../../lib/http.ts";

export const POST = memberContentRoute(async ({ request, locals }) =>
  json({ ok: true, id: await createBlogDraft(await managementBody(request), locals.user!) }, 201),
);
