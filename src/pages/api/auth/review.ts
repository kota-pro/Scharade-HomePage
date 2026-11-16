import type { APIRoute } from "astro";
import { validateReviewParameters } from "../../../lib/signupReview.ts";
import { applyAccountReview } from "../../../lib/accountReview.ts";
export const GET: APIRoute = async ({ url, redirect }) =>
  redirect(`/ReviewAccount${url.search}`, 302);
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const params = new URLSearchParams(
    Array.from(form.entries()).map(([k, v]) => [k, String(v)]),
  );
  const token = validateReviewParameters(params);
  if (!token) return redirect("/ReviewAccount?result=invalid", 303);
  const result = await applyAccountReview(token.userId, token.action);
  const retry = new URLSearchParams();
  if (["email-failed", "setup-failed", "setup-unlinked"].includes(result))
    for (const key of ["action", "userId", "expires", "sig"])
      retry.set(key, params.get(key) ?? "");
  retry.set("result", result);
  return redirect(`/ReviewAccount?${retry}`, 303);
};
