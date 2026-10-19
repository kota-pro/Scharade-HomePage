import {
  GALLERY_ALBUM_METADATA,
  GALLERY_ALBUM_NAME_METADATA,
  type GalleryAlbumCategory,
} from "../data/galleryAlbums.ts";
import { getAdobeAccessToken } from "./adobeAuth.ts";

import { env } from "./config.ts";
import { cached } from "./cache.ts";
import { fetchWithTimeout } from "./http.ts";
import { signGalleryValue, verifyGalleryValue } from "./galleryTokens.ts";
const CLIENT_ID = env("ADOBE_CLIENT_ID");
const CATALOG_ID = env("LIGHTROOM_CATALOG_ID");
const LIGHTROOM_API_BASE_URL = "https://lr.adobe.io";
const LIGHTROOM_MAX_PAGE_LIMIT = 500;

export type LightroomAlbum = {
  id: string;
  created: string;
  updated: string;
  category: GalleryAlbumCategory;
  hidden: boolean;
  payload: {
    name: string;
    cover?: {
      id: string;
    };
  };
};

export type LightroomPhoto = {
  id: string;
  name: string;
};

export type LightroomPhotoPage = {
  photos: LightroomPhoto[];
  nextCursor: string | null;
};

const CATEGORY_LABEL_TO_KEY: Record<string, GalleryAlbumCategory | "hidden"> = {
  合宿: "camp",
  撮影会: "shooting",
  展示: "exhibition",
  その他: "other",
  非公開: "hidden",
};

function normalizeCategoryLabel(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function normalizeAlbumName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function collectContainerLabels(
  value: unknown,
  labels: string[],
  seen: Set<unknown>,
  allowName = false,
) {
  if (value == null) return;
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) =>
      collectContainerLabels(entry, labels, seen, allowName),
    );
    return;
  }

  const record = value as Record<string, unknown>;
  const candidateKeys = [
    "parent",
    "parents",
    "path",
    "paths",
    "ancestor",
    "ancestors",
    "folder",
    "folders",
    "collectionSet",
    "collectionSets",
    "collection_set",
    "collection_sets",
    "container",
    "containers",
    "group",
    "groups",
  ];

  candidateKeys.forEach((key) => {
    const entry = record[key];
    if (typeof entry === "string") {
      labels.push(entry);
      return;
    }
    collectContainerLabels(entry, labels, seen, true);
  });

  if (allowName && typeof record.name === "string") {
    labels.push(record.name);
  }
}

function resolveAlbumCategory(rawAlbum: Record<string, unknown>) {
  const labels: string[] = [];
  const seen = new Set<unknown>();
  collectContainerLabels(rawAlbum, labels, seen);

  if (
    labels.some(
      (label) =>
        CATEGORY_LABEL_TO_KEY[normalizeCategoryLabel(label)] === "hidden",
    )
  )
    return "hidden";
  for (const label of labels) {
    const resolved = CATEGORY_LABEL_TO_KEY[normalizeCategoryLabel(label)];
    if (resolved) return resolved;
  }

  return null;
}

function collectKnownIds(
  value: unknown,
  knownIds: Set<string>,
  result: Set<string>,
  seen: Set<unknown>,
) {
  if (value == null) return;

  if (typeof value === "string") {
    const parts = value.split(/[\/\\?#&=]+/);
    parts.forEach((part) => {
      if (knownIds.has(part)) result.add(part);
    });
    return;
  }

  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectKnownIds(entry, knownIds, result, seen));
    return;
  }

  Object.values(value as Record<string, unknown>).forEach((entry) => {
    collectKnownIds(entry, knownIds, result, seen);
  });
}

function findKnownIds(value: unknown, knownIds: Set<string>) {
  const result = new Set<string>();
  collectKnownIds(value, knownIds, result, new Set<unknown>());
  return result;
}

export function resolveLightroomUrl(
  value: string,
  base = `${LIGHTROOM_API_BASE_URL}/`,
) {
  const url = new URL(value, base);
  if (
    url.origin !== LIGHTROOM_API_BASE_URL ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`/v2/catalogs/${CATALOG_ID}/`)
  )
    throw new Error("Invalid Lightroom URL");
  return url.toString();
}
async function fetchLightroomJson(accessToken: string, url: string) {
  const response = await fetchWithTimeout(resolveLightroomUrl(url), {
    headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": CLIENT_ID },
  });
  if (!response.ok) throw new Error(`Lightroom API: ${response.status}`);
  return JSON.parse(
    (await response.text()).replace(/^while\s*\(1\)\s*\{\}\s*/, ""),
  );
}
async function fetchPaginatedLightroomResources(
  accessToken: string,
  initialUrl: string,
) {
  const resources: Array<Record<string, unknown>> = [];
  let nextUrl: string | null = initialUrl;
  const seen = new Set<string>();
  while (nextUrl) {
    if (seen.has(nextUrl) || seen.size >= 100)
      throw new Error("Invalid Lightroom pagination");
    seen.add(nextUrl);
    const data = await fetchLightroomJson(accessToken, nextUrl);
    resources.push(...(Array.isArray(data.resources) ? data.resources : []));
    nextUrl =
      typeof data.links?.next?.href === "string"
        ? resolveLightroomUrl(data.links.next.href, data.base || nextUrl)
        : null;
  }
  return resources;
}
async function mapLimited<T, R>(
  items: T[],
  action: (item: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        result[current] = await action(items[current]);
      }
    }),
  );
  return result;
}

function mapLightroomResourceToPhoto(
  resource: Record<string, any>,
): LightroomPhoto {
  const assetId = resource.asset?.id;
  return {
    id: assetId || resource.id,
    name: resource.payload?.importSource?.fileName || "Photo",
  };
}

async function getAlbumDetail(accessToken: string, albumId: string) {
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums/${albumId}`;
  const data = await fetchLightroomJson(accessToken, url);
  return data?.resource ?? data;
}

async function listAlbumsBySubtype(accessToken: string, subtype: string) {
  const url =
    `${LIGHTROOM_API_BASE_URL}/v2/catalogs/${CATALOG_ID}/albums` +
    `?subtype=${subtype}&limit=${LIGHTROOM_MAX_PAGE_LIMIT}`;
  return fetchPaginatedLightroomResources(accessToken, url);
}

async function loadAlbums(): Promise<LightroomAlbum[]> {
  const accessToken = await getAdobeAccessToken();

  const [collections, collectionSets] = await Promise.all([
    listAlbumsBySubtype(accessToken, "collection"),
    listAlbumsBySubtype(accessToken, "collection_set"),
  ]);

  const collectionIds = new Set(
    collections
      .map((album) => (typeof album.id === "string" ? album.id : null))
      .filter((id): id is string => Boolean(id)),
  );
  const collectionSetIds = new Set(
    collectionSets
      .map((album) => (typeof album.id === "string" ? album.id : null))
      .filter((id): id is string => Boolean(id)),
  );

  const collectionSetDetails = await mapLimited(
    collectionSets,
    async (collectionSet) => {
      const id = typeof collectionSet.id === "string" ? collectionSet.id : "";
      const detail = id ? await getAlbumDetail(accessToken, id) : null;
      return detail ? { ...collectionSet, ...detail } : collectionSet;
    },
  );

  const categoryByAlbumId = new Map<string, GalleryAlbumCategory | "hidden">();
  const categoryByCollectionSetId = new Map<
    string,
    GalleryAlbumCategory | "hidden"
  >();

  collectionSetDetails.forEach((collectionSet) => {
    const id = typeof collectionSet.id === "string" ? collectionSet.id : "";
    const resolvedCategory = resolveAlbumCategory(collectionSet);
    const name = normalizeCategoryLabel(
      typeof collectionSet.payload === "object" &&
        collectionSet.payload !== null &&
        "name" in collectionSet.payload &&
        typeof collectionSet.payload.name === "string"
        ? collectionSet.payload.name
        : "",
    );
    const nameCategory = CATEGORY_LABEL_TO_KEY[name];
    const category = resolvedCategory ?? nameCategory ?? null;

    if (!id || !category) return;

    categoryByCollectionSetId.set(id, category);

    findKnownIds(collectionSet, collectionIds).forEach((albumId) => {
      if (categoryByAlbumId.get(albumId) !== "hidden")
        categoryByAlbumId.set(albumId, category);
    });
  });

  const collectionDetails = await mapLimited(collections, async (album) => {
    const id = typeof album.id === "string" ? album.id : "";
    const detail = id ? await getAlbumDetail(accessToken, id) : null;
    return detail ? { ...album, ...detail } : album;
  });

  return collectionDetails.map((album) => {
    const albumId = typeof album.id === "string" ? album.id : "";
    const payload =
      typeof album.payload === "object" && album.payload !== null
        ? (album.payload as { name?: string })
        : {};
    const albumName = normalizeAlbumName(payload.name ?? "");
    const idMeta = GALLERY_ALBUM_METADATA[albumId] ?? {};
    const nameMeta = GALLERY_ALBUM_NAME_METADATA[albumName] ?? {};
    const resolvedCategory = resolveAlbumCategory(album);
    const parentSetIds = findKnownIds(album, collectionSetIds);
    const parentCategories = Array.from(parentSetIds).map((id) =>
      categoryByCollectionSetId.get(id),
    );
    const parentCategory = parentCategories.includes("hidden")
      ? "hidden"
      : parentCategories.find(Boolean);
    const collectionSetCategory =
      categoryByAlbumId.get(albumId) ?? parentCategory;
    const hiddenByResponse =
      resolvedCategory === "hidden" ||
      collectionSetCategory === "hidden" ||
      parentCategory === "hidden";
    const responseCategory =
      resolvedCategory && resolvedCategory !== "hidden"
        ? resolvedCategory
        : null;
    const setCategory =
      collectionSetCategory && collectionSetCategory !== "hidden"
        ? collectionSetCategory
        : null;
    const hidden = Boolean(
      idMeta.hidden ||
        nameMeta.hidden ||
        hiddenByResponse ||
        normalizeCategoryLabel(albumName).startsWith("非公開"),
    );
    const category =
      idMeta.category ??
      nameMeta.category ??
      responseCategory ??
      setCategory ??
      "other";

    return {
      ...(album as Omit<LightroomAlbum, "category" | "hidden">),
      id: albumId,
      category,
      hidden,
    };
  });
}

export function getAlbums(): Promise<LightroomAlbum[]> {
  return cached("lr:albums", loadAlbums, 30_000);
}
export async function getAlbumTitle(albumId: string) {
  return (
    (await getAlbums()).find((a) => a.id === albumId)?.payload?.name ?? null
  );
}
export function validLightroomId(id: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}
export async function getAlbumPhotosPage(
  albumId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<LightroomPhotoPage> {
  if (!validLightroomId(albumId)) throw new Error("Invalid album ID");
  const path = `/v2/catalogs/${CATALOG_ID}/albums/${albumId}/assets`;
  const limit = Math.max(1, Math.min(100, options.limit ?? 30));
  let target = `${LIGHTROOM_API_BASE_URL}${path}?limit=${limit}`;
  if (options.cursor) {
    const cursor = verifyGalleryValue(options.cursor, "cursor");
    if (cursor.album !== albumId || typeof cursor.url !== "string")
      throw new Error("Invalid cursor");
    target = resolveLightroomUrl(cursor.url);
    if (new URL(target).pathname !== path)
      throw new Error("Invalid cursor path");
  }
  return cached(
    `lr:photos:${target}`,
    async () => {
      const data = await fetchLightroomJson(
        await getAdobeAccessToken(),
        target,
      );
      const next =
        typeof data.links?.next?.href === "string"
          ? resolveLightroomUrl(data.links.next.href, data.base || target)
          : null;
      if (next && new URL(next).pathname !== path)
        throw new Error("Invalid next page");
      return {
        photos: (Array.isArray(data.resources) ? data.resources : [])
          .map(mapLightroomResourceToPhoto)
          .filter((photo: LightroomPhoto) => validLightroomId(photo.id)),
        nextCursor: next
          ? signGalleryValue({ kind: "cursor", album: albumId, url: next })
          : null,
      };
    },
    30_000,
  );
}
export async function getAlbumCoverId(albumId: string): Promise<string | null> {
  return (
    (await getAlbumPhotosPage(albumId, { limit: 1 })).photos[0]?.id ?? null
  );
}
export async function fetchRendition(
  assetId: string,
  size: 640 | 2048,
): Promise<ArrayBuffer | null> {
  if (!validLightroomId(assetId)) return null;
  const token = await getAdobeAccessToken();
  const response = await fetchWithTimeout(
    `${LIGHTROOM_API_BASE_URL}/v2/catalogs/${CATALOG_ID}/assets/${assetId}/renditions/${size}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": CLIENT_ID,
        Accept: "image/jpeg",
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lightroom image: ${response.status}`);
  return response.arrayBuffer();
}
