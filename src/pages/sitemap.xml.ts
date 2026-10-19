export const prerender = false;

import { getPortfolios, microcmsClient } from "../lib/microcms.ts";
import { getAlbums } from "../lib/lightroom.ts";
import type { Blog } from "../types/microcms.ts";
import { buildSitemapEntries, renderSitemap } from "../lib/sitemap.ts";

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

    if (
      response.contents.length < limit ||
      entries.length >= response.totalCount
    ) {
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

    if (
      response.contents.length < limit ||
      entries.length >= response.totalCount
    ) {
      break;
    }

    offset += limit;
  }

  return entries;
}

export async function GET() {
  const entries = await buildSitemapEntries({
    blogs: fetchAllBlogs,
    portfolios: fetchAllPortfolioIds,
    albums: getAlbums,
  });
  const xml = renderSitemap(entries);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
