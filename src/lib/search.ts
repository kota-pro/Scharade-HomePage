import { getContent, pageDefinitions } from "./siteContent.ts";
import { getAllContents, getAllPortfolios } from "./microcms.ts";
import { getAlbums } from "./lightroom.ts";
import type { Blog } from "../types/microcms.ts";
import { linkToPost } from "../utils/linkToPost.ts";
import { isListedPortfolio } from "../data/portfolioVisibility.ts";
type Entry = { title: string; url: string; content: string };
const plain = (value: unknown): string =>
  typeof value === "string"
    ? value
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : Array.isArray(value)
      ? value.map(plain).join(" ")
      : value && typeof value === "object"
        ? Object.values(value).map(plain).join(" ")
        : "";
export async function searchPublic(query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [], partial: false };
  const entries: Entry[] = Object.entries(pageDefinitions)
    .filter(([key]) => key !== "common")
    .map(([key, page]) => ({
      title: page.title,
      url: page.path,
      content: plain(getContent(key as keyof typeof pageDefinitions)),
    }));
  const results = await Promise.allSettled([
    getAllPortfolios(),
    getAllContents<Blog>("blog"),
    getAlbums(),
  ]);
  const [portfolios, blogs, albums] = results;
  if (portfolios.status === "fulfilled")
    entries.push(
      ...portfolios.value.filter(isListedPortfolio).map((p) => ({
        title: p.name,
        url: `/Portfolio/${encodeURIComponent(p.id)}`,
        content: plain([p.name, p.self_introduction, p.hashtags, p.camera]),
      })),
    );
  if (blogs.status === "fulfilled")
    entries.push(
      ...blogs.value.map((p) => ({
        title: p.title,
        url: linkToPost(p.slug),
        content: plain([p.title, p.body, p.excerpt, p.tags]),
      })),
    );
  if (albums.status === "fulfilled")
    entries.push(
      ...albums.value
        .filter((a) => !a.hidden)
        .map((a) => ({
          title: a.payload.name,
          url: `/Gallery/${encodeURIComponent(a.id)}`,
          content: plain([a.payload.name, a.created]),
        })),
    );
  return {
    results: entries
      .filter((e) =>
        terms.every((t) =>
          (e.title + " " + e.content).toLowerCase().includes(t),
        ),
      )
      .map(({ title, url, content }) => ({
        title,
        url,
        excerpt: content.slice(0, 180),
      })),
    partial: results.some((r) => r.status === "rejected"),
  };
}
