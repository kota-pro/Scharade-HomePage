export const prerender = false;

import { getPortfolios, microcmsClient } from "../lib/microcms";
import { getAlbums } from "../lib/lightroom";
import type { Blog } from "../types/microcms";

const SITE_URL = "https://scharade.jp";
const STATIC_PATHS = [
  "/",
  "/About_us",
  "/Activity",
  "/Contact",
  "/Disclaimer",
  "/Gallery",
  "/sitemap",
  "/Portfolio",
];

type SitemapEntry = {
  loc: string;
  lastmod?: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toAbsoluteUrl(pathname: string) {
  return new URL(pathname, SITE_URL).toString();
}

function formatLastmod(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function fetchAllBlogs() {
  const limit = 100;
  const entries: Blog[] = [];
  let offset = 0;

  while (true) {
    const response = await microcmsClient.getList<Blog>({
      endpoint: "blog",
      queries: {
        limit,
        offset,
        orders: "-publishedAt",
      },
    });

    entries.push(...response.contents);

    if (response.contents.length < limit || entries.length >= response.totalCount) {
      break;
    }

    offset += limit;
  }

  return entries;
}

async function fetchAllPortfolioIds() {
  const limit = 100;
  const entries: Array<{ id: string; updatedAt?: string }> = [];
  let offset = 0;

  while (true) {
    const response = await getPortfolios({
      fields: ["id", "updatedAt"],
      limit,
      offset,
      orders: "-updatedAt",
    });

    entries.push(
      ...response.contents.map((content) => ({
        id: content.id,
        updatedAt: content.updatedAt,
      })),
    );

    if (response.contents.length < limit || entries.length >= response.totalCount) {
      break;
    }

    offset += limit;
  }

  return entries;
}

async function buildSitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = STATIC_PATHS.map((pathname) => ({
    loc: toAbsoluteUrl(pathname),
  }));

  const [blogsResult, portfoliosResult, albumsResult] = await Promise.allSettled([
    fetchAllBlogs(),
    fetchAllPortfolioIds(),
    getAlbums(),
  ]);

  if (blogsResult.status === "fulfilled") {
    entries.push(
      ...blogsResult.value.map((post) => ({
        loc: toAbsoluteUrl(`/posts/${post.slug}`),
        lastmod: formatLastmod(post.updatedAt ?? post.publishedAt),
      })),
    );
  }

  if (portfoliosResult.status === "fulfilled") {
    entries.push(
      ...portfoliosResult.value.map((portfolio) => ({
        loc: toAbsoluteUrl(`/Portfolio/${portfolio.id}`),
        lastmod: formatLastmod(portfolio.updatedAt),
      })),
    );
  }

  if (albumsResult.status === "fulfilled") {
    entries.push(
      ...albumsResult.value
        .filter((album) => !album.hidden)
        .map((album) => ({
          loc: toAbsoluteUrl(`/Gallery/${album.id}`),
          lastmod: formatLastmod(album.updated),
        })),
    );
  }

  return entries;
}

export async function GET() {
  const entries = await buildSitemapEntries();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (entry) => `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${
        entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""
      }\n  </url>`,
    )
    .join("\n")}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}