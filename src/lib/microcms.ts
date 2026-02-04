import { createClient, type MicroCMSQueries } from "microcms-js-sdk";

const serviceDomain = import.meta.env.MICROCMS_SERVICE_DOMAIN;
const apiKey = import.meta.env.MICROCMS_API_KEY;
const CLIENT_ID = import.meta.env.ADOBE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.ADOBE_CLIENT_SECRET;
const REFRESH_TOKEN = import.meta.env.ADOBE_REFRESH_TOKEN;
const CATALOG_ID = import.meta.env.LIGHTROOM_CATALOG_ID;

export type LightroomAlbum = {
  id: string;
  created: string;
  updated: string;
  payload: {
    name: string;
    cover?: {
      id: string;
    };
  };
};

export type Portfolio = {
  id: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  revisedAt: string;
  name: string;
  self_introduction?: string;
  instagram?: string;
  generation?: number;
  hashtags?: string[];
  x_url?: string;
  camera?: string;
  icon?: {
    url: string;
    height: number;
    width: number;
  };
  pictures: {
    url: string;
    height: number;
    width: number;
  }[];
};

export const microcmsClient = createClient({
  serviceDomain,
  apiKey,
});

export const getPortfolioDetail = async <T>(
  contentId: string,
  queries?: MicroCMSQueries,
) => {
  return await microcmsClient.getListDetail<T>({
    endpoint: "portfolio",
    contentId,
    queries,
  });
};

export const getPortfolios = async (queries?: MicroCMSQueries) => {
  return await microcmsClient.getList<Portfolio>({
    endpoint: "portfolio",
    queries,
  });
};

async function getAccessToken(): Promise<string> {
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

  if (!response.ok)
    throw new Error(`Failed to refresh token: ${response.statusText}`);
  const data = await response.json();
  return data.access_token;
}

export async function getAlbums(): Promise<LightroomAlbum[]> {
  const accessToken = await getAccessToken();
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums?subtype=collection`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": CLIENT_ID },
  });

  if (!response.ok) {
    console.error("API Error (getAlbums):", await response.text());
    return [];
  }

  const text = await response.text();
  const jsonString = text.replace(/^while\s*\(1\)\s*\{\}\s*/, "");
  const data = JSON.parse(jsonString);
  return data.resources || [];
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
  const url = `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/assets/${assetId}/renditions/thumbnail2x`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": CLIENT_ID,
      Accept: "image/jpeg",
    },
  });

  if (!response.ok) {
    return null;
  }
  return await response.arrayBuffer();
}

export async function getAlbumPhotos(albumId: string): Promise<any[]> {
  const accessToken = await getAccessToken();
  let allPhotos: any[] = [];

  let nextHref: string | null =
    `https://lr.adobe.io/v2/catalogs/${CATALOG_ID}/albums/${albumId}/assets?limit=100`;

  while (nextHref) {
    const url = nextHref.startsWith("http")
      ? nextHref
      : `https://lr.adobe.io${nextHref}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-API-Key": CLIENT_ID,
      },
    });

    if (!response.ok) {
      console.error(`API Error (getAlbumPhotos):`, await response.text());
      break;
    }

    const text = await response.text();
    const jsonString = text.replace(/^while\s*\(1\)\s*\{\}\s*/, "");
    const data = JSON.parse(jsonString);

    const resources = data.resources || [];
    const photos = resources.map((resource: any) => {
      let aspectRatio = 1;
      if (resource.asset?.payload?.capturePixels) {
        const { width, height } = resource.asset.payload.capturePixels;
        if (width && height) aspectRatio = width / height;
      }

      return {
        id: resource.asset?.id || resource.id,
        name: resource.payload?.importSource?.fileName || "Photo",
        aspectRatio: aspectRatio,
      };
    });

    allPhotos = [...allPhotos, ...photos];

    if (data.links && data.links.next && data.links.next.href) {
      nextHref = data.links.next.href;
    } else {
      nextHref = null;
    }
  }

  return allPhotos;
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
    return null;
  }

  return await response.arrayBuffer();
}
