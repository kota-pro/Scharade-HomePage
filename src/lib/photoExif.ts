import exifr from "exifr";
import sharp from "sharp";
import { photoExifFields, readPhotoExifValues } from "./photoExifValues.ts";

/** Inspect the uploaded bytes before conversion strips metadata. Only public camera fields are read. */
export async function extractPhotoExif(bytes: Buffer) {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 60_000_000 }).metadata();
    if (!metadata.exif) return {};
    const exif = metadata.exif.subarray(metadata.exif.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0);
    return readPhotoExifValues(await exifr.parse(exif, photoExifFields));
  } catch { return {}; } // Missing or malformed EXIF never rejects an otherwise valid photograph.
}
