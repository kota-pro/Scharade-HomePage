// 一覧・サイト内検索・サイトマップに掲載しないPortfolioのmicroCMS ID。
// 名前や管理者権限では判定せず、指定した管理専用プロフィールだけを除外する。
// 個別ページと管理画面からの編集は引き続き利用できる。
const UNLISTED_PORTFOLIO_IDS = new Set(["w_rozcjvv"]); // サイト管理

// アカウントを削除し、作品を卒業生として保存するPortfolio。
// 所有者の再連携が起きても、編集は管理者ロールに限定する。
const ARCHIVED_PORTFOLIO_IDS = new Set(["wpfqu4-8h10"]);

export const isArchivedPortfolio = (portfolio: { id: string }): boolean =>
  ARCHIVED_PORTFOLIO_IDS.has(portfolio.id);

export function isListedPortfolio(portfolio: { id: string }): boolean {
  return !UNLISTED_PORTFOLIO_IDS.has(portfolio.id);
}
