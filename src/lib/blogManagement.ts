import { createHash } from "node:crypto";
import { audit } from "./audit.ts";
import { isStaff, readUsers, type User } from "./auth.ts";
import { cached, invalidateCache } from "./cache.ts";
import { env } from "./config.ts";
import { ContentManagementError } from "./contentManagement.ts";
import { safeMediaUrl, sanitizeArticleHtml } from "./contentSecurity.ts";
import { fetchWithTimeout } from "./http.ts";
import { withStoreLock } from "./store.ts";
import type { Blog } from "../types/microcms.ts";
import { MEMBERS_BLOG_TAG, normalizeTags, orderBlogTags } from "../utils/blog.ts";
import { blogIdentity, blogReview, canReviewBlog, canSubmitBlog, readBlogReviews, removeBlogReview, saveBlogReview, type BlogReview } from "./blogReview.ts";
import { blogBylineUserId, getBlogAuthorOptions } from "./blogBylines.ts";
import { isSiteManagement } from "./accountVisibility.ts";
import { RICH_TEXT_SIZES } from "../utils/portfolioIntroduction.ts";

export type BlogStatus = "draft" | "published" | "published-with-draft" | "closed";
type Metadata = {
  id: string; status: string | string[]; createdAt?: string; updatedAt: string; publishedAt?: string | null; draftKey?: string | null;
};
export const blogStatusLabels: Record<BlogStatus, string> = {
  draft: "下書き", published: "公開中", "published-with-draft": "公開中・CMS下書きあり", closed: "公開終了",
};
export type BlogEditorOptions = {
  tags: string[]; colors: { label: string; value: string }[]; sizes: { label: string; value: string }[];
  classes: { label: string; value: string }[]; presetColorsOnly: boolean;
  bodyKind?: string;
};
export const emptyBlogOptions: BlogEditorOptions = { tags: [], colors: [], sizes: [], classes: [], presetColorsOnly: false };
export const managementBodyOptions: BlogEditorOptions = {
  ...emptyBlogOptions,
  sizes: RICH_TEXT_SIZES.map(({ pixels }) => ({ value: `${pixels}px`, label: `${pixels}px` })),
};
type CmsBlog = { title: string; slug: string; excerpt: string; body: string; tags: string[]; pictures: string[] };
const contentPath = "/api/v1/blog";
const managementPath = "/api/v1/contents/blog";
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const cmsUnavailable = () => new ContentManagementError("microCMSに接続できません。時間をおいて再試行してください。", 503);
const notFound = () => new ContentManagementError("記事が見つかりません。", 404);
const conflict = () => new ContentManagementError("別の画面で記事が変更されました。入力を控えてから再読み込みしてください。", 409);

function blogId(id: string) {
  if (!validId(id)) throw notFound();
  return encodeURIComponent(id);
}

async function cmsRequest(path: string, management: boolean, options: RequestInit = {}) {
  const domain = env("MICROCMS_SERVICE_DOMAIN");
  const key = env("MICROCMS_SERVER_API_KEY");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(domain) || !key) throw cmsUnavailable();
  const headers = new Headers(options.headers);
  headers.set("X-MICROCMS-API-KEY", key);
  const host = management ? "microcms-management.io" : "microcms.io";
  return fetchWithTimeout(`https://${domain}.${host}${path}`, { ...options, headers, cache: "no-store" });
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return { method, body: JSON.stringify(value), headers: { "Content-Type": "application/json" } };
}

function checkResponse(response: Response) {
  if (response.ok) return;
  if (response.status === 400 || response.status === 422) throw new ContentManagementError("microCMSが入力内容を受け付けませんでした。記事の必須項目・書式・メディアを確認してください。");
  if (response.status === 401 || response.status === 403) throw new ContentManagementError("microCMSのブログ操作権限を確認してください。", 503);
  if (response.status === 429) throw new ContentManagementError("microCMSが混み合っています。少し待って再試行してください。", 429);
  if (response.status === 404) throw notFound();
  throw cmsUnavailable();
}

async function mutatePublishedContent(path: string, management: boolean, options: RequestInit) {
  let response: Response;
  try {
    response = await cmsRequest(path, management, options);
  } catch (error) {
    // The CMS may have applied the write before the connection was lost.
    invalidateCache("cms:");
    throw error;
  }
  if (response.ok || response.status >= 500) invalidateCache("cms:");
  checkResponse(response);
}

async function metadata(id: string): Promise<Metadata | null> {
  const response = await cmsRequest(`${managementPath}/${blogId(id)}`, true);
  if (response.status === 404) return null;
  checkResponse(response);
  const value = await response.json() as Metadata;
  if (value.id !== id || typeof value.updatedAt !== "string") throw cmsUnavailable();
  return value;
}

function statusOf(item: Metadata): BlogStatus {
  const flags = new Set(Array.isArray(item.status) ? item.status : [item.status]);
  if (flags.has("PUBLISH_AND_DRAFT") || flags.has("PUBLISH") && flags.has("DRAFT")) return "published-with-draft";
  if (flags.has("PUBLISH")) return "published";
  if (flags.has("DRAFT")) return "draft";
  if (flags.has("CLOSED")) return "closed";
  throw cmsUnavailable();
}

function itemSummary(item: Metadata) {
  const status = statusOf(item);
  return { id: item.id, status, createdAt: item.createdAt ?? item.updatedAt, updatedAt: item.updatedAt, publishedAt: item.publishedAt ?? null, slugLocked: status !== "draft" || Boolean(item.publishedAt) };
}

async function content(item: Metadata, fields?: string): Promise<Blog | null> {
  const status = statusOf(item);
  if (status === "closed") return null;
  if (status === "draft" && !item.draftKey) throw cmsUnavailable();
  const query = new URLSearchParams({ depth: "1" });
  if (fields) query.set("fields", fields);
  if (status === "draft") query.set("draftKey", item.draftKey!);
  const response = await cmsRequest(`${contentPath}/${blogId(item.id)}?${query}`, false);
  checkResponse(response);
  const post = await response.json() as Blog;
  if (post.id !== item.id) throw cmsUnavailable();
  return post;
}

export async function getEditableBlog(id: string, ownerId?: string) {
  if (ownerId !== undefined && !ownsBlogDraft(id, ownerId)) return null;
  const item = await metadata(id);
  return item ? { ...itemSummary(item), post: await content(item), review: blogReview(id, item.updatedAt) } : null;
}

export function ownsBlogDraft(id: string, userId: string) {
  return validId(id) && blogReview(id, "").author?.userId === userId;
}

export function canEditOwnBlog(item: { status: BlogStatus; review: BlogReview }) {
  return item.status === "draft" && (item.review.state === "draft" || item.review.state === "returned");
}

const indexFields = "id,title,tags,createdAt";
const catalogKey = "cms:blog-management-catalog";
const catalogPageSize = 100;
type BlogIndexData = Pick<Blog, "id" | "title" | "tags" | "createdAt">;

async function readBlogCatalog() {
  const metadataItems = new Map<string, Metadata>();
  for (let offset = 0; ; offset += catalogPageSize) {
    const response = await cmsRequest(`${managementPath}?limit=${catalogPageSize}&offset=${offset}`, true);
    checkResponse(response);
    const data = await response.json() as { contents: Metadata[]; totalCount: number };
    if (!Array.isArray(data.contents) || !Number.isSafeInteger(data.totalCount)) throw cmsUnavailable();
    for (const item of data.contents) metadataItems.set(item.id, item);
    if (!data.contents.length || offset + data.contents.length >= data.totalCount) break;
  }
  return blogIndexData([...metadataItems.values()]);
}

async function blogIndexData(metadataItems: Metadata[]) {
  const publishedIds = metadataItems.filter(item => ["published", "published-with-draft"].includes(statusOf(item))).map(item => item.id);
  const posts = new Map<string, BlogIndexData>();
  for (let index = 0; index < publishedIds.length; index += catalogPageSize) {
    const ids = publishedIds.slice(index, index + catalogPageSize);
    const query = new URLSearchParams({ ids: ids.join(","), fields: indexFields, limit: String(ids.length) });
    const results = await cmsRequest(`${contentPath}?${query}`, false);
    checkResponse(results);
    const { contents } = await results.json() as { contents: BlogIndexData[] };
    contents.forEach(post => posts.set(post.id, post));
  }
  const drafts = metadataItems.filter(item => statusOf(item) === "draft");
  for (let index = 0; index < drafts.length; index += 4) {
    await Promise.all(drafts.slice(index, index + 4).map(async item => {
      const post = await content(item, indexFields);
      if (post) posts.set(item.id, post);
    }));
  }
  return { metadataItems, posts };
}

function blogIndexRows({ metadataItems, posts }: Awaited<ReturnType<typeof blogIndexData>>) {
  const reviews = readBlogReviews();
  const users = new Map(readUsers().filter(user => !isSiteManagement(user)).map(user => [user.id, user.name]));
  return metadataItems.map(item => {
    const post = posts.get(item.id);
    const review = blogReview(item.id, item.updatedAt, reviews);
    const author = blogBylineUserId(review);
    const authorName = author ? users.get(author) ?? "写団シャレード" : author === null ? "写団シャレード" : "記録なし";
    return {
      ...itemSummary(item), title: post?.title || item.id, tags: normalizeTags(post?.tags),
      createdAt: post?.createdAt || item.createdAt || item.updatedAt,
      author: authorName, authorId: author && users.has(author) ? author : authorName === "記録なし" ? "unknown" : "club",
      reviewState: review.state,
    };
  });
}

export async function getManageableBlogs() {
  return blogIndexRows(await cached(catalogKey, readBlogCatalog, 30_000));
}

export async function getOwnBlogs(user: User) {
  const ids = Object.entries(readBlogReviews()).filter(([, review]) => review.author?.userId === user.id).map(([id]) => id);
  const found: Metadata[] = [];
  for (let index = 0; index < ids.length; index += 4) {
    const results = await Promise.all(ids.slice(index, index + 4).map(metadata));
    for (const item of results) if (item) found.push(item);
  }
  return blogIndexRows(await blogIndexData(found));
}

function items(input: unknown, valueKeys: string[]) {
  if (!Array.isArray(input)) return [];
  return input.flatMap(entry => {
    if (typeof entry === "string") return [{ value: entry, label: entry }];
    if (!entry || typeof entry !== "object") return [];
    const value = valueKeys.map(key => entry[key]).find(value => typeof value === "string");
    return typeof value === "string" ? [{ value, label: String(entry.label ?? entry.name ?? entry.title ?? value) }] : [];
  });
}

export function getBlogEditorOptions() {
  return cached("cms:blog-editor-options", async () => {
    const response = await cmsRequest("/api/v1/apis/blog", true);
    checkResponse(response);
    const fields = (await response.json()).apiFields;
    if (!Array.isArray(fields)) throw cmsUnavailable();
    const body = fields.find(field => field.fieldId === "body");
    const tags = fields.find(field => field.fieldId === "tags");
    return {
      tags: orderBlogTags(items(tags?.selectItems, ["value"]).map(item => item.value)),
      colors: items(body?.richEditorV2ColorList, ["value", "color"]).filter(item => /^#[a-f0-9]{3,8}$/i.test(item.value)),
      sizes: items(body?.richEditorV2FontSizeList, ["value", "size", "fontSize"]).filter(item => /^\d{1,3}(?:px|pt|%)$/.test(item.value)),
      classes: items(body?.customClassList, ["class", "className", "value"]).filter(item => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(item.value)),
      presetColorsOnly: body?.richEditorV2HideColorPicker === true,
      bodyKind: typeof body?.kind === "string" ? body.kind : undefined,
    } satisfies BlogEditorOptions;
  });
}

async function requireRichTextSchema() {
  const schema = await getBlogEditorOptions().catch(() => null);
  if (!schema)
    throw new ContentManagementError("本文を保存するにはmicroCMSの「API情報の取得」権限が必要です。", 503);
  if (schema.bodyKind !== "richEditorV2")
    throw new ContentManagementError("microCMSのブログ本文を現行のリッチエディタに設定してください。", 409);
}

function textField(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw new ContentManagementError(`${label}を${max}文字以内で入力してください。`);
  return value;
}

function listField(value: unknown, label: string, max: number) {
  if (!Array.isArray(value) || value.length > max || !value.every(item => typeof item === "string"))
    throw new ContentManagementError(`${label}を確認してください。`);
  return [...new Set<string>(value)];
}

function slugField(value: unknown) {
  const slug = textField(value, "記事URL", 150, true).trim();
  if (/[/\\\x00-\x1f\x7f]/.test(slug) || slug === "." || slug === "..")
    throw new ContentManagementError("記事URLにスラッシュ・制御文字は使用できません。");
  try { encodeURIComponent(slug); } catch { throw new ContentManagementError("記事URLの文字を確認してください。"); }
  return slug;
}

export function parseBlogInput(input: Record<string, unknown>, current?: Blog | null, slugLocked = false): CmsBlog {
  const slug = current && (input.slug === undefined || input.slug === current.slug) ? current.slug : slugField(input.slug);
  if (slugLocked && slug !== current?.slug) throw new ContentManagementError("初回公開後は記事URLを変更できません。");
  const title = input.title === undefined && current ? current.title : textField(input.title, "タイトル", 200, true);
  const excerpt = input.excerpt === undefined ? current?.excerpt ?? "" : textField(input.excerpt, "概要", 1000);
  const oldBody = current?.body ?? "";
  const rawBody = input.body === undefined ? oldBody : textField(input.body, "本文", 180_000);
  const body = input.body === undefined || rawBody === oldBody ? oldBody : sanitizeArticleHtml(rawBody);
  const tags = input.tags === undefined ? current?.tags ?? [] : orderBlogTags(listField(input.tags, "タグ", 50).map(tag => textField(tag, "タグ", 100, true)));
  const pictures = input.pictures === undefined ? current?.pictures?.map(image => image.url) ?? [] : listField(input.pictures, "記事写真", 50);
  if (input.pictures !== undefined && pictures.some(url => !safeMediaUrl(url))) throw new ContentManagementError("記事写真はmicroCMSのメディアを選択してください。");
  return { title, slug, excerpt, body, tags, pictures };
}

export function previewBlog(input: Record<string, unknown>): Blog {
  const fields = parseBlogInput({ ...input, slug: "preview" });
  const now = new Date().toISOString();
  return {
    ...fields, id: "", createdAt: now, updatedAt: now,
    ...(typeof input.publishedAt === "string" && Number.isFinite(Date.parse(input.publishedAt)) ? { publishedAt: input.publishedAt } : {}),
    pictures: fields.pictures.map(url => ({ url, width: 0, height: 0 })),
  };
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changesFor(values: CmsBlog, before: Blog) {
  const existing = { ...before, excerpt: before.excerpt ?? "", body: before.body ?? "", tags: before.tags ?? [], pictures: before.pictures?.map(picture => picture.url) ?? [] };
  return Object.fromEntries(Object.entries(values).filter(([field, value]) => !sameValue(existing[field as keyof CmsBlog], value)));
}

function contentDigest(post: Blog) {
  return createHash("sha256").update(JSON.stringify(parseBlogInput({}, post))).digest("hex");
}

async function ensureUniqueSlug(slug: string, id: string) {
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const response = await cmsRequest(`${contentPath}?fields=id,slug&limit=${limit}&offset=${offset}`, false);
    checkResponse(response);
    const data = await response.json() as { contents: Array<Pick<Blog, "id" | "slug">>; totalCount: number };
    if (data.contents.some(post => post.id !== id && post.slug === slug))
      throw new ContentManagementError("同じ記事URLが使われています。別のURLを入力してください。", 409);
    if (!data.contents.length || offset + limit >= data.totalCount) return;
  }
}

async function changeStatus(id: string, status: "PUBLISH" | "DRAFT") {
  await mutatePublishedContent(`${managementPath}/${blogId(id)}/status`, true, jsonRequest("PATCH", { status: [status] }));
}

export async function parseBlogByline(value: unknown, user: User, current?: BlogReview) {
  if (value === undefined) return current?.bylineUserId;
  if (!isStaff(user)) throw new ContentManagementError("執筆者の表示設定は運営以上が変更できます。", 403);
  if (value === "default") return undefined;
  if (value === "club") return null;
  if (typeof value === "string" && (value === current?.bylineUserId ||
    (await getBlogAuthorOptions(readUsers().filter(account => account.id === value))).length > 0)) return value;
  throw new ContentManagementError("公開Portfolioのある会員を執筆者に選んでください。");
}

export async function createBlogDraft(input: Record<string, unknown>, user: User) {
  if (!user.approved) throw new ContentManagementError("承認済みの会員アカウントが必要です。", 403);
  const { requestId } = input;
  if (typeof requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))
    throw new ContentManagementError("作成画面を再読み込みしてください。");
  const id = "b-" + createHash("sha256").update(JSON.stringify([user.id, requestId.toLowerCase()])).digest("hex").slice(0, 30);
  const values = parseBlogInput({ ...input, tags: input.tags ?? [MEMBERS_BLOG_TAG] });
  return withStoreLock("blog-management", async () => {
    if (await metadata(id)) return id;
    if (values.body) await requireRichTextSchema();
    const review = blogReview(id, "");
    const bylineUserId = await parseBlogByline(input.byline, user, review);
    if (!review.author || bylineUserId !== review.bylineUserId)
      saveBlogReview(id, review, { author: review.author ?? blogIdentity(user), bylineUserId });
    const body = Object.fromEntries(Object.entries(values).filter(([, value]) => value.length));
    checkResponse(await cmsRequest(`${contentPath}/${id}?status=draft`, false, jsonRequest("PUT", body)));
    invalidateCache(catalogKey);
    await audit(user.id, "blog.create", id);
    return id;
  });
}

export async function updateBlog(id: string, input: Record<string, unknown>, user: User) {
  return withStoreLock("blog-management", async () => {
    const staff = isStaff(user);
    if (!user.approved || (!staff && !ownsBlogDraft(id, user.id))) throw notFound();
    if (!staff && input.action !== "save" && input.action !== "submit")
      throw new ContentManagementError("承認・公開の操作は運営以上が行えます。", 403);
    const item = await metadata(id);
    if (!item) throw notFound();
    const { status, slugLocked } = itemSummary(item);
    if (input.updatedAt !== item.updatedAt) throw conflict();
    const review = blogReview(id, item.updatedAt);
    if (!staff && !canEditOwnBlog({ status, review }))
      throw new ContentManagementError("下書きと差し戻された記事を編集できます。", 409);
    if (input.action === "unpublish") {
      if (status !== "published") throw new ContentManagementError("この公開状態はmicroCMSの画面から変更してください。", 409);
      saveBlogReview(id, review, { state: "draft", submittedBy: undefined, approvedVersion: undefined, returnReason: undefined });
      await changeStatus(id, "DRAFT");
      await audit(user.id, "blog.unpublish", id);
      return;
    }
    const action = input.action;
    if (!["save", "submit", "approve", "return", "publish"].some(value => value === action))
      throw new ContentManagementError("記事の操作を確認してください。");
    if (status === "closed" || action !== "save" && status !== "draft")
      throw new ContentManagementError("この公開状態はmicroCMSの画面から変更してください。", 409);
    if ((status === "draft" || input.byline !== undefined) && input.workflowRevision !== review.revision) throw conflict();
    const before = await content(item);
    if (!before) throw notFound();
    const values = parseBlogInput(input, before, slugLocked);
    const changes = changesFor(values, before);
    const bylineUserId = await parseBlogByline(input.byline, user, review);
    const bylineChanged = bylineUserId !== review.bylineUserId;
    if (action !== "save") {
      if (Object.keys(changes).length || bylineChanged) throw new ContentManagementError("変更を保存してから操作してください。", 409);
      if (action === "submit") {
        if (!canSubmitBlog(review, user)) throw new ContentManagementError("この下書きを承認申請できません。", 403);
        if (!before.title?.trim() || !before.slug?.trim())
          throw new ContentManagementError("承認申請にはタイトルと記事URLを入力してください。");
        saveBlogReview(id, review, { state: "pending", submittedBy: blogIdentity(user), returnReason: undefined });
      } else if (action === "approve" || action === "return") {
        if (!canReviewBlog(review, user)) throw new ContentManagementError("承認待ちの記事は、執筆者・申請者とは別の運営以上が確認してください。", 403);
        if (action === "approve") {
          saveBlogReview(id, review, { state: "approved", approvedVersion: { updatedAt: item.updatedAt, digest: contentDigest(before) } });
        } else {
          const returnReason = textField(input.reason, "差し戻し理由", 1000, true).trim();
          saveBlogReview(id, review, { state: "returned", returnReason });
        }
      } else {
        if (review.state !== "approved" || review.approvedVersion?.digest !== contentDigest(before))
          throw new ContentManagementError("保存されている最新版の承認を得てから公開してください。", 409);
        await ensureUniqueSlug(values.slug, id);
        await changeStatus(id, "PUBLISH");
        saveBlogReview(id, review, { state: "draft", submittedBy: undefined, approvedVersion: undefined, returnReason: undefined });
      }
      await audit(user.id, `blog.${action}`, id);
      return;
    }
    let nextReview = review;
    const hasContentChanges = Object.keys(changes).length > 0;
    if (hasContentChanges) {
      // Only changed fields are rewritten. In particular, metadata edits must not round-trip legacy rich text.
      if (Object.hasOwn(changes, "body")) await requireRichTextSchema();
      const path = `${contentPath}/${blogId(id)}`;
      const update = jsonRequest("PATCH", changes);
      if (status === "draft") {
        if (review.state === "approved" && !bylineChanged)
          saveBlogReview(id, review, { state: "pending", approvedVersion: undefined });
        checkResponse(await cmsRequest(`${path}?status=draft`, false, update));
        invalidateCache(catalogKey);
      }
      else await mutatePublishedContent(path, false, update);
    }
    if (bylineChanged) {
      if (status === "draft" && review.state === "approved") nextReview = { ...review, state: "pending", approvedVersion: undefined };
      saveBlogReview(id, review, { ...nextReview, bylineUserId });
    }
    if (hasContentChanges || bylineChanged) await audit(user.id, "blog.update", id);
  });
}

export async function deleteBlog(id: string, input: Record<string, unknown>, user: User) {
  if (input.confirmation !== "delete") throw new ContentManagementError("削除する内容を確認してください。");
  return withStoreLock("blog-management", async () => {
    const item = await metadata(id);
    if (!item) { removeBlogReview(id); return; }
    if (input.updatedAt !== item.updatedAt) throw conflict();
    await mutatePublishedContent(`${contentPath}/${blogId(id)}`, false, { method: "DELETE" });
    removeBlogReview(id);
    await audit(user.id, "blog.delete", id);
  });
}

export async function uploadBlogMedia(file: File): Promise<string> {
  const data = new FormData();
  data.set("file", file, file.name);
  const response = await cmsRequest("/api/v1/media", true, { method: "POST", body: data });
  checkResponse(response);
  const value = safeMediaUrl((await response.json()).url);
  if (!value) throw cmsUnavailable();
  return value;
}

export async function listBlogMedia(fileName: string, token: string, imageOnly: boolean) {
  if (fileName.length > 100 || token.length > 4096) throw new ContentManagementError("メディアの検索条件を確認してください。");
  const query = token ? new URLSearchParams({ token }) : new URLSearchParams({ limit: "24", imageOnly: String(imageOnly) });
  if (!token && fileName) query.set("fileName", fileName);
  const response = await cmsRequest(`/api/v2/media?${query}`, true);
  checkResponse(response);
  const data = await response.json();
  if (!Array.isArray(data.media) || !Number.isSafeInteger(data.totalCount)) throw cmsUnavailable();
  return {
    total: data.totalCount, fetched: data.media.length,
    token: typeof data.token === "string" ? data.token : "",
    media: data.media.flatMap((entry: { url: unknown; alt?: string; width?: number; height?: number }) => {
      const url = safeMediaUrl(entry?.url);
      if (!url) return [];
      const image = Number.isSafeInteger(entry.width) && Number.isSafeInteger(entry.height) && entry.width! > 0 && entry.height! > 0;
      if (!imageOnly && (image || !isBlogAttachment(url))) return [];
      if (imageOnly && !image) return [];
      return [{ url, alt: typeof entry.alt === "string" ? entry.alt : "", width: entry.width, height: entry.height }];
    }),
  };
}

export function isBlogAttachment(value: string) {
  const url = new URL(value);
  return url.hostname === "files.microcms-assets.io" &&
    /\.(?:pdf|zip|docx|xlsx|pptx|txt|csv|mp3|mp4)$/i.test(url.pathname);
}
