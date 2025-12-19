export const prerender = false;

import type { APIRoute } from "astro";
import { fetchHighResImageBuffer } from "../../../../lib/lightroom";

export const GET: APIRoute = async ({ params }) => {
  const assetId = params.id;
  if (!assetId) return new Response("Not Found", { status: 404 });

  const imageBuffer = await fetchHighResImageBuffer(assetId);

  if (!imageBuffer) {
    return new Response("Image Not Found", { status: 404 });
  }

  return new Response(imageBuffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
