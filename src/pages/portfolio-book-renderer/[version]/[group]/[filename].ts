import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { APIRoute } from "astro";
import pdfjs from "pdfjs-dist/package.json";

const packageRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assets = {
  cmaps: /^[\w-]+\.bcmap$/,
  standard_fonts: /^[\w-]+\.(?:ttf|pfb)$/,
  wasm: /^(?:openjpeg|jbig2)_nowasm_fallback\.js$/,
};

export const GET: APIRoute = async ({ params }) => {
  const group = params.group as keyof typeof assets;
  if (params.version !== pdfjs.version || !Object.hasOwn(assets, group) || !assets[group].test(params.filename ?? ""))
    return new Response(null, { status: 404 });
  try {
    const bytes = await fs.readFile(path.join(packageRoot, group, params.filename!));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": group === "wasm" ? "text/javascript; charset=utf-8" : "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
    throw error;
  }
};
