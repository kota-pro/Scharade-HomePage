import type { APIRoute } from "astro";
import { getAlbumPhotosPage } from "../../../lib/lightroom";

export const GET: APIRoute = async ({ params, url }) => {
  const albumId = params.id;

  if (!albumId) {
    return new Response(JSON.stringify({ error: "Album id is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cursor = url.searchParams.get("cursor");

  try {
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
