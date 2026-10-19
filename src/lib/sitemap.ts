import { publicPages } from "../data/publicPages.ts";
import { isListedPortfolio } from "../data/portfolioVisibility.ts";
import { linkToPost } from "../utils/linkToPost.ts";
import { SITE_URL } from "./config.ts";

export type SitemapEntry = { loc: string; lastmod?: string };
export type SitemapSources = {
  blogs: () => Promise<
    Array<{ slug: string; updatedAt?: string; publishedAt?: string }>
  >;
  portfolios: () => Promise<Array<{ id: string; updatedAt?: string }>>;
  albums: () => Promise<
    Array<{ id: string; hidden: boolean; updated?: string }>
  >;
};

function formatLastmod(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function buildSitemapEntries(
  sources: SitemapSources,
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = publicPages.map(({ href }) => ({
    loc: new URL(href, SITE_URL).href,
  }));
  // A failed integration must not remove the fixed pages or other integrations.
  const [blogs, portfolios, albums] = await Promise.allSettled([
    Promise.resolve().then(sources.blogs),
    Promise.resolve().then(sources.portfolios),
    Promise.resolve().then(sources.albums),
  ]);
  if (blogs.status === "fulfilled") {
    for (const post of blogs.value) {
      if (!post.slug?.trim()) continue;
      entries.push({
        loc: new URL(linkToPost(post.slug), SITE_URL).href,
        lastmod: formatLastmod(post.updatedAt ?? post.publishedAt),
      });
    }
  }
  if (portfolios.status === "fulfilled") {
    for (const portfolio of portfolios.value.filter(isListedPortfolio)) {
      entries.push({
        loc: new URL(`/Portfolio/${encodeURIComponent(portfolio.id)}`, SITE_URL)
          .href,
        lastmod: formatLastmod(portfolio.updatedAt),
      });
    }
  }
  if (albums.status === "fulfilled") {
    for (const album of albums.value.filter((album) => !album.hidden)) {
      entries.push({
        loc: new URL(`/Gallery/${encodeURIComponent(album.id)}`, SITE_URL).href,
        lastmod: formatLastmod(album.updated),
      });
    }
  }
  const unique = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    const previous = unique.get(entry.loc);
    if (
      !previous ||
      (entry.lastmod && (!previous.lastmod || entry.lastmod > previous.lastmod))
    )
      unique.set(entry.loc, entry);
  }
  return [...unique.values()];
}

export function renderSitemap(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}\n  </url>`,
    )
    .join("\n")}\n</urlset>`;
}
