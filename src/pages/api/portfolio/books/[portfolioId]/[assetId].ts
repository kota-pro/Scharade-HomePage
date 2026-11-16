import type { APIRoute } from "astro";
import { canEditPortfolio, getUserFromRequest } from "../../../../../lib/auth.ts";
import { portfolioBookResponse } from "../../../../../lib/portfolioBooks.ts";

export const GET: APIRoute = ({ request, params }) => {
  const { user } = getUserFromRequest(request);
  if (!user || !canEditPortfolio(user, params.portfolioId ?? "")) return new Response(null, { status: 404 });
  return portfolioBookResponse(request, params.portfolioId!, params.assetId!, user.id);
};
export const HEAD = GET;
