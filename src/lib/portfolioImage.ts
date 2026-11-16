import type { Sharp } from "sharp";
import { PORTFOLIO_PHOTO_SAVE_LIMIT } from "../types/portfolioUpload.ts";

export async function fitPortfolioImage(image: Sharp, width: number, height: number, limit = PORTFOLIO_PHOTO_SAVE_LIMIT) {
  const longestSide = Math.max(width, height);
  let side = Math.floor(longestSide * Math.min(1, 8192 / longestSide, Math.sqrt(20_000_000 / (width * height))));
  if (side === longestSide && width * height <= 10_000_000) {
    const lossless = await image.clone().webp({ lossless: true, effort: 3 }).toBuffer({ resolveWithObject: true });
    if (lossless.data.length <= limit) return lossless;
  }
  while (side > 0) {
    const resized = image.clone().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" });
    const encode = (quality: number) => resized.clone()
      .webp({ quality, alphaQuality: 100, effort: 3, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    const highestQuality = await encode(100);
    if (highestQuality.data.length <= limit) return highestQuality;

    let best = await encode(84);
    if (best.data.length > limit) {
      const scale = Math.max(.5, Math.min(.96, Math.sqrt(limit / best.data.length) * .98));
      side = Math.floor(side * scale);
      continue;
    }
    let low = 85, high = 99;
    while (low <= high) {
      const quality = Math.floor((low + high) / 2);
      const candidate = await encode(quality);
      if (candidate.data.length <= limit) {
        best = candidate;
        low = quality + 1;
      } else high = quality - 1;
    }
    return best;
  }
  throw new Error("Image cannot be encoded within the upload limit");
}

export async function encodePortfolioUpload(image: Sharp, width: number, height: number, signal?: AbortSignal) {
  const limit = PORTFOLIO_PHOTO_SAVE_LIMIT;
  const longestSide = Math.max(width, height);
  let side = Math.max(1, Math.floor(longestSide * Math.min(1, 7200 / longestSide, Math.sqrt(16_000_000 / (width * height)))));
  signal?.throwIfAborted();
  if (side === longestSide && width * height <= 1_000_000) {
    const lossless = await image.clone().webp({ lossless: true, effort: 1 }).toBuffer();
    signal?.throwIfAborted();
    if (lossless.length <= limit) return lossless;
  }
  // Keep the first encode at high quality. Use its actual size to avoid a
  // series of full-resolution retries when detailed photographs exceed the media limit.
  for (const quality of [92, 84, 76]) {
    signal?.throwIfAborted();
    if (quality === 76) side = Math.min(side, 1600);
    const data = await image.clone()
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .webp({ quality, alphaQuality: 100, effort: 2 })
      .toBuffer();
    signal?.throwIfAborted();
    if (data.length <= limit) return data;
    side = Math.max(1, Math.floor(side * Math.min(0.94, Math.sqrt(limit / data.length) * 0.95)));
  }
  throw new Error("Image cannot be encoded within the upload limit");
}
