import { deleteBlog, updateBlog } from "../../../../../lib/blogManagement.ts";
import { managementBody, staffContentRoute } from "../../../../../lib/contentManagement.ts";
import { json } from "../../../../../lib/http.ts";

export const PATCH = staffContentRoute(async ({ params, request, locals }) => {
  await updateBlog(params.id ?? "", await managementBody(request), locals.user!);
  return json({ ok: true });
});

export const DELETE = staffContentRoute(async ({ params, request, locals }) => {
  await deleteBlog(params.id ?? "", await managementBody(request), locals.user!);
  return json({ ok: true });
});
