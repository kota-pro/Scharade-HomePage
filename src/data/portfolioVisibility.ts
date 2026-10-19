// 一覧・サイト内検索・サイトマップに掲載しないPortfolioのmicroCMS ID。
// 名前や管理者権限では判定せず、指定した管理専用プロフィールだけを除外する。
// 個別ページと管理画面からの編集は引き続き利用できる。
const UNLISTED_PORTFOLIO_IDS = new Set(["w_rozcjvv"]); // サイト管理

export function isListedPortfolio(portfolio: { id: string }): boolean {
  return !UNLISTED_PORTFOLIO_IDS.has(portfolio.id);
}
