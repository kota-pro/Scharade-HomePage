import { isListedPortfolio } from "../data/portfolioVisibility.ts";
import { optimizeMicrocmsImage } from "../utils/microcmsImage.ts";
import { isSiteManagement } from "./accountVisibility.ts";
import { readUsers, type User } from "./auth.ts";
import { readBlogReviews, type BlogReview } from "./blogReview.ts";
import { safeMediaUrl } from "./contentSecurity.ts";
import { getPortfolios, type Portfolio } from "./microcms.ts";

export type BlogByline = { name: string; icon: string; portfolioHref?: string };
const club = { name: "写団シャレード", icon: "/icons/logo.svg" };

function publicPortfolioId(user?: User) {
  const id = user?.portfolioId;
  return id && user.approved && !isSiteManagement(user) && isListedPortfolio({ id }) ? id : undefined;
}

async function portfolioBylines(ids: string[]): Promise<Map<string, BlogByline>> {
  if (!ids.length) return new Map();
  const contents: Portfolio[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { contents: portfolios } = await getPortfolios({
      ids: batch.join(","), limit: batch.length, fields: ["id", "name", "icon"],
    });
    const requested = new Set(batch);
    contents.push(...portfolios.filter(portfolio => requested.has(portfolio.id)));
  }
  return new Map(contents.filter(portfolio => portfolio.name?.trim()).map(portfolio => {
    const icon = safeMediaUrl(portfolio.icon?.url);
    return [portfolio.id, {
      name: portfolio.name,
      icon: icon ? optimizeMicrocmsImage(icon, { width: 96 }) : "/images/placeholder_icon.jpeg",
      portfolioHref: `/Portfolio/${encodeURIComponent(portfolio.id)}`,
    }];
  }));
}

export function blogBylineUserId(review?: BlogReview) {
  return review?.bylineUserId !== undefined ? review.bylineUserId : review?.author?.userId;
}

export async function getBlogAuthorOptions(users = readUsers()) {
  const accounts = users.flatMap(user => {
    const portfolioId = publicPortfolioId(user);
    return portfolioId ? [{ id: user.id, portfolioId }] : [];
  });
  const bylines = await portfolioBylines([...new Set(accounts.map(account => account.portfolioId))]);
  return accounts.flatMap(({ id, portfolioId }) => {
    const byline = bylines.get(portfolioId);
    return byline ? [{ id, ...byline }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function resolveBlogByline(id: string | null | undefined): Promise<BlogByline | undefined> {
  if (id === undefined) return undefined;
  const user = id === null ? undefined : readUsers().find(user => user.id === id);
  return user ? getNewBlogByline(user) : club;
}

export async function getBlogBylines(postIds: string[]) {
  const reviews = readBlogReviews();
  const authored = postIds.flatMap(id => {
    const author = Object.hasOwn(reviews, id) ? blogBylineUserId(reviews[id]) : undefined;
    return author === undefined ? [] : [[id, author] as const];
  });
  if (!authored.length) return new Map<string, BlogByline>();
  const users = new Map(readUsers().map(user => [user.id, user]));
  const portfolios = authored.map(([id, userId]) => [id, publicPortfolioId(userId === null ? undefined : users.get(userId))] as const);
  const bylines = await portfolioBylines([...new Set(portfolios.flatMap(([, id]) => id ? [id] : []))]).catch(() => new Map<string, BlogByline>());
  return new Map(portfolios.map(([id, portfolioId]) => [id, (portfolioId && bylines.get(portfolioId)) || club]));
}

export async function getNewBlogByline(user: User): Promise<BlogByline> {
  const id = publicPortfolioId(user);
  return id ? (await portfolioBylines([id]).catch(() => new Map<string, BlogByline>())).get(id) ?? club : club;
}
