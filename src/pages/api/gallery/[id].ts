import type { APIRoute } from "astro";
import { getAlbumPhotos, getAlbumPhotosPage } from "../../../lib/lightroom";

export const GET: APIRoute = async ({ params, url }) => {
  const albumId = params.id;

  if (!albumId) {
    return new Response(JSON.stringify({ error: "Album id is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cursor = url.searchParams.get("cursor");
  const fetchRemaining = url.searchParams.get("remaining") === "1";
  const offset = Number(url.searchParams.get("offset") ?? "0");

  try {
    if (fetchRemaining) {
      const photos = await getAlbumPhotos(albumId);
      const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;

      return new Response(
        JSON.stringify({
          photos: photos.slice(safeOffset),
          nextCursor: null,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const page = await getAlbumPhotosPage(albumId, { cursor });

    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Gallery API] Failed to load album photos:", error);
    return new Response(
      JSON.stringify({ error: "Failed to load album photos." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
