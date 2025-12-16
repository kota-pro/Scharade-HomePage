import type { Blog } from "../types/microcms";

export const getPublishedDate = (blog: Blog) =>
  blog.publishedAt ?? blog.createdAt ?? blog.updatedAt ?? blog.revisedAt;

export const formatDate = (value?: string): string => {
  if (!value) return "公開日未定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "公開日未定";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export const toTabSlug = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
};

export const normalizeTags = (tags: string[] | undefined) => {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : [tags];
};

export const buildTabs = (posts: Blog[]) => {
  const allTags = Array.from(
    new Set(posts.flatMap((post) => normalizeTags(post.tags))),
  ).sort();

  return [
    {
      label: "All tags",
      slug: "all",
      posts,
    },
    ...allTags.map((tagString) => {
      const slug = toTabSlug(tagString) ?? "tag";

      return {
        label: tagString,
        slug,
        posts: posts.filter((post) =>
          normalizeTags(post.tags).includes(tagString),
        ),
      };
    }),
  ];
};
