import type { APIRoute } from "astro";
import { getPortfolioDetail } from "../../../../lib/microcms.ts";
import { hasPublishedPortfolioBookAsset, portfolioBookResponse } from "../../../../lib/portfolioBooks.ts";

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!, assetId = params.assetId!;
  if (!hasPublishedPortfolioBookAsset(id, assetId)) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try { await getPortfolioDetail(id, { fields: "id" }); }
  catch { return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
  return portfolioBookResponse(request, id, assetId);
};
export const HEAD = GET;
