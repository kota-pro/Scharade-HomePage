import type { APIRoute } from "astro";
import { isPortfolioOffice } from "../../../../../data/portfolioOffices.ts";
import { isAdmin, readUsers } from "../../../../../lib/auth.ts";
import { audit } from "../../../../../lib/audit.ts";
import { invalidateCache } from "../../../../../lib/cache.ts";
import { env } from "../../../../../lib/config.ts";
import { fetchWithTimeout, json } from "../../../../../lib/http.ts";
import { getPortfolioDetail, type Portfolio } from "../../../../../lib/microcms.ts";
import { withStoreLock } from "../../../../../lib/store.ts";

export const POST: APIRoute = async ({ locals, params, request }) => {
  const actor = locals.user;
  const forbidden = () => json({ ok: false, message: "管理者権限が必要です。" }, 403);
  if (!actor || !isAdmin(actor)) return forbidden();
  if (!params.id || params.id.length > 128) return json({ ok: false }, 404);

  const { office, previousOffice, portfolioId } = await request.json().catch(() => null) ?? {};
  if ((office !== "" && !isPortfolioOffice(office)) ||
    typeof previousOffice !== "string" || typeof portfolioId !== "string" || !portfolioId)
    return json({ ok: false, message: "掲載する役職を選択してください。" }, 400);

  const domain = env("MICROCMS_SERVICE_DOMAIN");
  const apiKey = env("MICROCMS_SERVER_API_KEY");
  const endpoint = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio";
  if (!domain || !apiKey)
    return json({ ok: false, message: "現在、役職を更新できません。" }, 503);

  const missing = () => json({ ok: false, message: "連携先のPortfolioが見つかりません。" }, 404);
  const stale = () => json({ ok: false, message: "Portfolioの連携先または役職が更新されました。ページを再読み込みしてください。" }, 409);
  const failed = () => json({ ok: false, message: "役職を保存できませんでした。時間をおいてお試しください。" }, 502);
  try {
    const response = await withStoreLock("auth", async () => {
      const users = readUsers();
      if (!isAdmin(users.find((user) => user.id === actor.id))) return forbidden();
      const account = users.find((user) => user.id === params.id);
      if (!account?.portfolioId) return missing();
      if (account.portfolioId !== portfolioId) return stale();

      invalidateCache("cms:detail:");
      const { role } = await getPortfolioDetail<Pick<Portfolio, "role">>(portfolioId, { fields: "role" });
      const currentOffice = role ?? "";
      if (currentOffice === office) return json({ ok: true });
      if (currentOffice !== previousOffice) return stale();

      const saved = await fetchWithTimeout(
        `https://${domain}.microcms.io/api/v1/${endpoint}/${encodeURIComponent(portfolioId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-MICROCMS-API-KEY": apiKey },
          body: JSON.stringify({ role: office }),
        },
      );
      if (!saved.ok) return saved.status === 404 ? missing() : failed();
      invalidateCache("cms:");
      return null;
    });
    if (response) return response;
  } catch (error) {
    return String(error).includes("response status: 404") ? missing() : failed();
  }
  await audit(actor.id, "account.portfolio-office.update", params.id).catch(() => {
    console.error("[admin/accounts] Portfolio office audit write failed");
  });
  return json({ ok: true });
};
