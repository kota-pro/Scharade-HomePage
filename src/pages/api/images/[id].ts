export const prerender = false;

import type { APIRoute } from "astro";
import { fetchImageBuffer } from "../../../lib/lightroom.ts";

export const GET: APIRoute = async ({ params }) => {
  const assetId = params.id;

  console.log(`[API Request] Fetching image for ID: ${assetId}`);

  if (!assetId) {
    return new Response("Not Found", { status: 404 });
  }

  const imageBuffer = await fetchImageBuffer(assetId);

  if (!imageBuffer) {
    console.error(`[API Error] Failed to fetch buffer for ID: ${assetId}`);
    return new Response("Image Not Found", { status: 404 });
  }

  console.log(`[API Success] Image fetched: ${assetId}`);

  return new Response(imageBuffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
