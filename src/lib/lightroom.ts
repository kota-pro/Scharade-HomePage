import {
  GALLERY_ALBUM_METADATA,
  GALLERY_ALBUM_NAME_METADATA,
  type GalleryAlbumCategory,
} from "../data/galleryAlbums";

const CLIENT_ID = import.meta.env.ADOBE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.ADOBE_CLIENT_SECRET;
const REFRESH_TOKEN = import.meta.env.ADOBE_REFRESH_TOKEN;
const CATALOG_ID = import.meta.env.LIGHTROOM_CATALOG_ID;

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

const CATEGORY_LABEL_TO_KEY: Record<string, GalleryAlbumCategory | "hidden"> = {
  "合宿": "camp",
  "撮影会": "shooting",
  "展示": "exhibition",
  "その他": "other",
  "非公開": "hidden",
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
    value.forEach((entry) => collectContainerLabels(entry, labels, seen, allowName));
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

async function fetchLightroomJson(accessToken: string, url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": CLIENT_ID },
  });

  if (!response.ok) {
    console.error("API Error (Lightroom):", await response.text());
    return null;
  }

  const text = await response.text();
  const jsonString = text.replace(/^while\s*\(1\)\s*\{\}\s*/, "");
  return JSON.parse(jsonString);
}

async function getAlbumDetail(accessToken: string, albumId: string) {
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums/${albumId}`;
  const data = await fetchLightroomJson(accessToken, url);
  return data?.resource ?? data;
}

async function listAlbumsBySubtype(accessToken: string, subtype: string) {
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums?subtype=${subtype}&limit=500`;
  const data = await fetchLightroomJson(accessToken, url);
  return (data?.resources || []) as Array<Record<string, unknown>>;
}

// アクセストークンのキャッシュ（毎回リフレッシュを防ぐ）
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  // キャッシュが有効ならそれを返す（有効期限の1分前にリフレッシュ）
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("refresh_token", REFRESH_TOKEN);

  const response = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(`[Lightroom] Token refresh failed: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(
      `Adobe token refresh failed (${response.status}). リフレッシュトークンが期限切れの可能性があります。Adobe Developer Console で再取得してください。`,
    );
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  // expires_in はミリ秒単位（通常 86400000 = 24時間）
  tokenExpiresAt = Date.now() + (data.expires_in || 86_400_000);
  return data.access_token;
}

export async function getAlbums(): Promise<LightroomAlbum[]> {
  const accessToken = await getAccessToken();

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

  const collectionSetDetails = await Promise.all(
    collectionSets.map(async (collectionSet) => {
      const id = typeof collectionSet.id === "string" ? collectionSet.id : "";
      const detail = id ? await getAlbumDetail(accessToken, id) : null;
      return detail ? { ...collectionSet, ...detail } : collectionSet;
    }),
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
      categoryByAlbumId.set(albumId, category);
    });
  });

  const collectionDetails = await Promise.all(
    collections.map(async (album) => {
      const id = typeof album.id === "string" ? album.id : "";
      const detail = id ? await getAlbumDetail(accessToken, id) : null;
      return detail ? { ...album, ...detail } : album;
    }),
  );

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
    const parentCategory = Array.from(parentSetIds)
      .map((id) => categoryByCollectionSetId.get(id))
      .find(Boolean);
    const collectionSetCategory = categoryByAlbumId.get(albumId) ?? parentCategory;
    const hiddenByResponse =
      resolvedCategory === "hidden" || collectionSetCategory === "hidden";
    const responseCategory =
      resolvedCategory && resolvedCategory !== "hidden"
        ? resolvedCategory
        : null;
    const setCategory =
      collectionSetCategory && collectionSetCategory !== "hidden"
        ? collectionSetCategory
        : null;
    const hidden = idMeta.hidden ?? nameMeta.hidden ?? hiddenByResponse;
    const category =
      idMeta.category ?? nameMeta.category ?? responseCategory ?? setCategory ?? "other";

    if (import.meta.env.DEV) {
      console.log("[Gallery album]", {
        id: albumId,
        name: albumName,
        category,
        hidden,
        resolvedCategory,
        collectionSetCategory,
        parentSetIds: Array.from(parentSetIds),
      });
    }

    return {
      ...(album as Omit<LightroomAlbum, "category" | "hidden">),
      id: albumId,
      category,
      hidden,
    };
  });
}

export async function getAlbumCoverId(albumId: string): Promise<string | null> {
  const accessToken = await getAccessToken();
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums/${albumId}/assets?limit=1`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": CLIENT_ID },
  });

  if (!response.ok) {
    console.error(`API Error (getAlbumCoverId):`, await response.text());
    return null;
  }

  const text = await response.text();
  const jsonString = text.replace(/^while\s*\(1\)\s*\{\}\s*/, "");
  const data = JSON.parse(jsonString);

  if (!data.resources || data.resources.length === 0) return null;

  const firstResource = data.resources[0];

  if (firstResource.asset && firstResource.asset.id) {
    return firstResource.asset.id;
  }

  if (firstResource.id) {
    return firstResource.id;
  }

  return null;
}

export async function fetchImageBuffer(
  assetId: string,
): Promise<ArrayBuffer | null> {
  const accessToken = await getAccessToken();
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/assets/${assetId}/renditions/640`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": CLIENT_ID,
      Accept: "image/jpeg",
    },
  });

  if (!response.ok) return null;
  return await response.arrayBuffer();
}

export async function getAlbumPhotos(albumId: string): Promise<any[]> {
  const accessToken = await getAccessToken();

  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums/${albumId}/assets?limit=100`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": CLIENT_ID,
    },
  });

  if (!response.ok) {
    console.error(`API Error (getAlbumPhotos):`, await response.text());
    return [];
  }

  const text = await response.text();
  const jsonString = text.replace(/^while\s*\(1\)\s*\{\}\s*/, "");
  const data = JSON.parse(jsonString);
  const resources = data.resources || [];

  return resources.map((resource: any) => {
    const assetId = resource.asset?.id;
    return {
      id: assetId || resource.id,
      name: resource.payload?.importSource?.fileName || "Photo",
    };
  });
}

export async function fetchHighResImageBuffer(
  assetId: string,
): Promise<ArrayBuffer | null> {
  const accessToken = await getAccessToken();
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/assets/${assetId}/renditions/2048`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": CLIENT_ID,
      Accept: "image/jpeg",
    },
  });

  if (!response.ok) {
    console.error(`API Error (HighRes): ${assetId} - ${response.statusText}`);
    return null;
  }

  return await response.arrayBuffer();
}
