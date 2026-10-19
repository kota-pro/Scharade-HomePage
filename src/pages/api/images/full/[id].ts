import type { APIRoute } from "astro";
import { galleryImage } from "../../../../lib/galleryImage.ts";
export const GET: APIRoute = (context) => galleryImage(context, 2048);
