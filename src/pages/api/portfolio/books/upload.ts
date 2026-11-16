import type { APIRoute } from "astro";
import { canEditPortfolio, getUserFromRequest } from "../../../../lib/auth.ts";
import { boundedFormData, HttpInputError, json } from "../../../../lib/http.ts";
import { ImageBusyError } from "../../../../lib/imageSecurity.ts";
import { getPortfolioDetail } from "../../../../lib/microcms.ts";
import { PortfolioBookInputError, stagePortfolioBookAsset } from "../../../../lib/portfolioBooks.ts";
import { PORTFOLIO_BOOK_FILE_LIMIT } from "../../../../types/portfolioBooks.ts";

export const POST: APIRoute = async ({ request }) => {
  const { user } = getUserFromRequest(request);
  try {
    const form = await boundedFormData(request, PORTFOLIO_BOOK_FILE_LIMIT + 65536);
    const file = form.get("file"), portfolioId = form.get("portfolioId"), kind = form.get("kind");
    if (!user || typeof portfolioId !== "string" || !canEditPortfolio(user, portfolioId))
      return json({ ok: false, message: "このPortfolioを編集する権限がありません。" }, 403);
    if (!(file instanceof File) || !file.size || (kind !== "pdf" && kind !== "cover"))
      return json({ ok: false, message: "アップロードするPDFまたは表紙画像を選択してください。" }, 400);
    if (file.size > PORTFOLIO_BOOK_FILE_LIMIT)
      return json({ ok: false, message: "1ファイル20MB以下で選択してください。" }, 413);
    await getPortfolioDetail(portfolioId);
    const asset = await stagePortfolioBookAsset(portfolioId, user.id, kind, file);
    return json({ ok: true, asset: asset.kind === "pdf"
      ? { id: asset.id, name: asset.name, pageCount: asset.pageCount }
      : { id: asset.id, width: asset.width, height: asset.height } });
  } catch (error) {
    if (error instanceof HttpInputError || error instanceof PortfolioBookInputError)
      return json({ ok: false, message: error.message }, error.status);
    if (error instanceof ImageBusyError)
      return json({ ok: false, message: "処理が混み合っています。少し待ってから再度お試しください。" }, 429);
    return json({ ok: false, message: "素材を保存できませんでした。ファイルを確認して再度お試しください。" }, 502);
  }
};
