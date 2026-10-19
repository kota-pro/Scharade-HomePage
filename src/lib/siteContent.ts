import {
  siteDefaults,
  type PageKey,
  type SiteDefaults,
} from "../data/siteDefaults.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { invalidateCache } from "./cache.ts";
import { audit } from "./audit.ts";

export const pageDefinitions: Record<PageKey, { title: string; path: string }> =
  {
    common: { title: "共通情報", path: "/About_us" },
    home: { title: "Index / Home", path: "/" },
    about: { title: "About us", path: "/About_us" },
    gallery: { title: "Gallery", path: "/Gallery" },
    portfolio: { title: "Portfolio", path: "/Portfolio" },
    contact: { title: "Contact", path: "/Contact" },
    disclaimer: { title: "Disclaimer", path: "/Disclaimer" },
  };
export function isPageKey(key: string): key is PageKey {
  return Object.hasOwn(pageDefinitions, key);
}
export type ContentDocument<T = unknown> = {
  revision: number;
  draft: T;
  published: T;
  previous: T | null;
  updatedAt: string | null;
  publishedAt: string | null;
};
type State = {
  schemaVersion: 1;
  pages: Partial<Record<PageKey, ContentDocument>>;
};

export function contentDocument<K extends PageKey>(
  key: K,
): ContentDocument<SiteDefaults[K]> {
  const state = readData<State>("site-content.json", {
    schemaVersion: 1,
    pages: {},
  });
  if (state.schemaVersion !== 1 || !state.pages)
    throw new Error("サイト情報の保存形式が正しくありません。");
  const saved = state.pages[key];
  if (saved) return saved as ContentDocument<SiteDefaults[K]>;
  return {
    revision: 0,
    draft: structuredClone(siteDefaults[key]),
    published: structuredClone(siteDefaults[key]),
    previous: null,
    updatedAt: null,
    publishedAt: null,
  };
}
export function getContent<K extends PageKey>(
  key: K,
  preview = false,
): SiteDefaults[K] {
  const document = contentDocument(key);
  return preview ? document.draft : document.published;
}

export function contentText(text: string, common: SiteDefaults["common"]) {
  return text.replace(
    /\{\{(feeHalfYear|feeAnnual|entranceFee|members|name|address)\}\}/g,
    (_, key: keyof SiteDefaults["common"]) => String(common[key]),
  );
}

/** The initial values also define the allowed structure; unknown fields are rejected. */
export function validateContent(
  key: PageKey,
  input: unknown,
): SiteDefaults[PageKey] {
  function visit(template: unknown, value: unknown, field = ""): unknown {
    if (Array.isArray(template)) {
      if (!Array.isArray(value) || value.length > 100)
        throw new Error("項目数は100件以内にしてください。");
      return value.map((v) => visit(template[0], v, field));
    }
    if (template && typeof template === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("入力形式が正しくありません。");
      const definition = template as Record<string, unknown>;
      const object = value as Record<string, unknown>;
      if (Object.keys(object).some((k) => !Object.hasOwn(definition, k)))
        throw new Error("編集できない項目が含まれています。");
      return Object.fromEntries(
        Object.entries(definition).map(([k, t]) => [k, visit(t, object[k], k)]),
      );
    }
    if (typeof template === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 10_000_000
      )
        throw new Error("数値を確認してください。");
      return value;
    }
    if (typeof value !== "string" || value.length > 20_000)
      throw new Error("文章は20,000文字以内で入力してください。");
    const text = value.trim();
    if (["url", "image", "instagram", "x", "mapUrl"].includes(field) && text) {
      if (
        text.startsWith("/") &&
        !text.startsWith("//") &&
        !/[\\\r\n]/.test(text)
      )
        return text;
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        throw new Error("リンクまたは写真のURLを確認してください。");
      }
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("HTTPSのURLを指定してください。");
      if (
        field === "image" &&
        !(
          url.hostname === "images.microcms-assets.io" ||
          url.hostname.endsWith(".microcms-assets.io")
        )
      )
        throw new Error("写真はアップロードした画像を選択してください。");
    }
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
      throw new Error("メールアドレスを確認してください。");
    return text;
  }
  return visit(siteDefaults[key], input) as SiteDefaults[PageKey];
}

export class ContentConflict extends Error {}
export async function changeContent(
  key: PageKey,
  action: "save" | "publish" | "restore",
  revision: number,
  data: unknown,
  actorId: string,
) {
  const result = await withStoreLock("site-content", () => {
    const document = contentDocument(key);
    if (revision !== document.revision)
      throw new ContentConflict(
        "別の操作で更新されました。画面を再読み込みして確認してください。",
      );
    const now = new Date().toISOString();
    if (action === "save")
      document.draft = validateContent(key, data) as typeof document.draft;
    if (action === "publish") {
      document.previous = structuredClone(document.published);
      document.published = structuredClone(document.draft);
      document.publishedAt = now;
    }
    if (action === "restore") {
      if (!document.previous) throw new Error("復元できる公開版がありません。");
      const previous = document.previous;
      document.previous = document.published;
      document.published = previous;
      document.draft = structuredClone(previous);
      document.publishedAt = now;
    }
    document.revision++;
    document.updatedAt = now;
    const state = readData<State>("site-content.json", {
      schemaVersion: 1,
      pages: {},
    });
    state.pages[key] = document;
    writeData("site-content.json", state);
    return document;
  });
  invalidateCache();
  await audit(actorId, `content.${action}`, key);
  return result;
}
