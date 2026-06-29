import { createClient, type MicroCMSQueries } from "microcms-js-sdk";
import { getAdobeAccessToken } from "./adobeAuth";

const serviceDomain = import.meta.env.MICROCMS_SERVICE_DOMAIN;
const apiKey = import.meta.env.MICROCMS_API_KEY;
const CLIENT_ID = import.meta.env.ADOBE_CLIENT_ID;
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
  grade?: string | string[];
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

const PORTFOLIO_GRADE_ALIASES: Record<string, string> = {
  "1st grade": "1st Grade",
  "2nd grade": "2nd Grade",
  "3rd grade": "3rd Grade",
  "4th grade": "4th Grade",
  international: "International",
  "master's program": "Master's Program",
  "masters program": "Master's Program",
  ob: "OB",
  "1年": "1st Grade",
  "2年": "2nd Grade",
  "3年": "3rd Grade",
  "4年": "4th Grade",
  "留学生": "International",
  "院生": "Master's Program",
  "卒業": "OB",
};

export const canonicalizePortfolioGrade = (grade: string): string => {
  const trimmed = grade.trim();
  if (!trimmed) return "";
  return PORTFOLIO_GRADE_ALIASES[trimmed.toLowerCase()] ?? PORTFOLIO_GRADE_ALIASES[trimmed] ?? trimmed;
};

export const normalizePortfolioGrade = (
  grade: Portfolio["grade"],
): string => {
  if (typeof grade === "string") return canonicalizePortfolioGrade(grade);
  if (Array.isArray(grade)) {
    return grade
      .map((value) => canonicalizePortfolioGrade(String(value)))
      .find(Boolean) ?? "";
  }
  return "";
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

export async function getAlbums(): Promise<LightroomAlbum[]> {
  const accessToken = await getAdobeAccessToken();
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
  const accessToken = await getAdobeAccessToken();
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
  const accessToken = await getAdobeAccessToken();
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
  const accessToken = await getAdobeAccessToken();
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
  const accessToken = await getAdobeAccessToken();

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
