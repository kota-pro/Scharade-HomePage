import { activityRichTextPlain } from "./activityRichText.ts";
import { eventCategoryLabels } from "./activityTypes.ts";
import { readActivities } from "./activities.ts";
import { isStaff, type User } from "./auth.ts";
import { readExhibitions } from "./exhibitions.ts";
import { galleryAlbumAllowed, getGalleryAlbums } from "./galleryCatalog.ts";
import { visibleMemberNotifications } from "./memberActivityVisibility.ts";
import { listTools, publicationOpen, viewQuestion } from "./memberTools.ts";
import { toolLabels } from "./memberToolTypes.ts";
import { getAllContents, getAllPortfolios } from "./microcms.ts";
import { getContent, pageDefinitions } from "./siteContent.ts";
import { isListedPortfolio } from "../data/portfolioVisibility.ts";
import type { Blog } from "../types/microcms.ts";
import { linkToPost } from "../utils/linkToPost.ts";

export const searchCategoryLabels = {
  all: "すべて",
  activity: "Activity",
  portfolio: "Portfolio",
  gallery: "Gallery",
  notifications: "通知",
  events: "企画",
  exhibitions: "写真展",
  tools: "質問・投票",
  pages: "その他のページ",
} as const;
type SearchCategory = keyof typeof searchCategoryLabels;
type EntryCategory = Exclude<SearchCategory, "all">;
type Entry = { title: string; url: string; content: string };
type SearchResult = Omit<Entry, "content"> & { category: EntryCategory; excerpt: string };
const memberCategories = new Set<SearchCategory>(["notifications", "events", "exhibitions", "tools"]);

export function searchCategory(value: string | null): SearchCategory {
  return value && Object.hasOwn(searchCategoryLabels, value) ? value as SearchCategory : "all";
}

export function searchCategories(user?: User | null) {
  return (Object.keys(searchCategoryLabels) as SearchCategory[])
    .filter(category => user?.approved || !memberCategories.has(category));
}

const plain = (value: unknown): string => {
  if (typeof value === "string") return activityRichTextPlain(value).replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join(" ");
  if (value && typeof value === "object") return plain(Object.values(value));
  return "";
};
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

export async function searchSite(query: string, category: SearchCategory, user?: User | null) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const allowed = new Set(searchCategories(user));
  if (!terms.length || !allowed.has(category)) return { results: [], partial: false };

  const sources: Promise<SearchResult[]>[] = [];
  function addSource(kind: EntryCategory, load: () => Entry[] | Promise<Entry[]>) {
    if (!allowed.has(kind) || (category !== "all" && category !== kind)) return;
    sources.push(Promise.resolve().then(load).then(entries => entries
      .filter(entry => {
        const text = normalize(entry.title + " " + entry.content);
        return terms.every(term => text.includes(term));
      })
      .map(({ title, url, content }) => ({ title, url, category: kind, excerpt: content.slice(0, 180) }))));
  }

  function sitePages(kind: "pages" | "portfolio" | "gallery") {
    return Object.entries(pageDefinitions).flatMap(([key, page]) => {
      const group = key === "portfolio" || key === "gallery" ? key : "pages";
      return key === "common" || group !== kind ? [] : [{
        title: page.title,
        url: page.path,
        content: plain(getContent(key as keyof typeof pageDefinitions)),
      }];
    });
  }

  addSource("pages", () => sitePages("pages"));
  addSource("portfolio", () => sitePages("portfolio"));
  addSource("gallery", () => sitePages("gallery"));
  addSource("portfolio", async () => (await getAllPortfolios()).filter(isListedPortfolio).map(p => ({
    title: p.name,
    url: `/Portfolio/${encodeURIComponent(p.id)}`,
    content: plain([p.name, p.self_introduction, p.hashtags, p.camera]),
  })));
  addSource("activity", async () => (await getAllContents<Blog>("blog")).map(p => ({
    title: p.title,
    url: linkToPost(p.slug),
    content: plain([p.title, p.excerpt, p.body, p.tags]),
  })));
  addSource("gallery", async () => (await getGalleryAlbums()).filter(album => galleryAlbumAllowed(album, user)).map(album => ({
    title: album.payload.name,
    url: `/Gallery/${encodeURIComponent(album.id)}`,
    content: plain([album.payload.name, album.created]),
  })));

  if (user?.approved) {
    let activities: ReturnType<typeof readActivities> | undefined;
    let exhibitions: ReturnType<typeof readExhibitions>["exhibitions"] | undefined;
    const getActivities = () => activities ??= readActivities();
    const getExhibitions = () => exhibitions ??= readExhibitions().exhibitions;

    addSource("notifications", () => visibleMemberNotifications(getActivities(), getExhibitions(), user.id).reverse().map(notice => ({
      title: notice.title,
      url: `/Member/notifications/${encodeURIComponent(notice.id)}`,
      content: plain([notice.bodyHtml || notice.body, notice.senderName]),
    })));
    addSource("events", () => getActivities().events
      .filter(event => event.status !== "draft" && (isStaff(user) || event.recipientIds.includes(user.id)))
      .map(event => ({
        title: event.title,
        url: `/Member/events/${encodeURIComponent(event.id)}`,
        content: plain([event.descriptionHtml || event.description, event.theme, event.meeting,
          event.itineraryHtml || event.itinerary, event.ownerName, eventCategoryLabels[event.category ?? "other"]]),
      })));
    addSource("exhibitions", () => getExhibitions()
      .filter(exhibition => exhibition.participation?.state === "published" &&
        (isStaff(user) || exhibition.participation.recipientIds.includes(user.id)))
      .map(exhibition => ({
        title: exhibition.title,
        url: `/Member/exhibitions/${encodeURIComponent(exhibition.id)}`,
        content: plain([exhibition.title, exhibition.openingSchedule?.startDate, exhibition.openingSchedule?.endDate]),
      })));
    addSource("tools", () => listTools()
      .filter(tool => tool.status === "published" && (viewQuestion(tool, user) || publicationOpen(tool, user)))
      .map(tool => ({
        title: tool.question,
        url: `/Member/tools/${encodeURIComponent(tool.id)}`,
        content: plain([tool.question, toolLabels[tool.kind]]),
      })));
  }

  const settled = await Promise.allSettled(sources);
  return {
    results: settled.flatMap(result => result.status === "fulfilled" ? result.value : []),
    partial: settled.some(result => result.status === "rejected"),
  };
}
