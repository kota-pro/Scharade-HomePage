import { photoMetadataFields, photoShootingFields, type PhotoMetadata, type PhotoShootingMetadata } from "../types/photos.ts";

const zeroLensModel = /^0+(?:[.,]0+)?\s*mm(?:\s*f\s*\/?\s*0+(?:[.,]0+)?)?$/i;

export function photoLensModel(value: unknown): string {
  const lens = typeof value === "string" ? value.trim() : "";
  return zeroLensModel.test(lens.normalize("NFKC")) ? "" : lens;
}

export function normalizePhotoMetadataLens<T extends PhotoMetadata>(metadata: T): T {
  if (metadata.lens === undefined) return metadata;
  const lens = photoLensModel(metadata.lens);
  return lens === metadata.lens ? metadata : { ...metadata, lens };
}

export function photoShootingMetadata(source?: PhotoShootingMetadata): PhotoShootingMetadata {
  const metadata: PhotoShootingMetadata = {};
  for (const key of photoShootingFields) {
    const raw = key === "lens" ? photoLensModel(source?.lens) : source?.[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) metadata[key] = value;
  }
  return metadata;
}

export function parsePhotoMetadata(input: unknown): PhotoMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("写真情報の形式を確認してください。");
  const result: PhotoMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (!photoMetadataFields.includes(key as typeof photoMetadataFields[number]) || typeof value !== "string" || value.length > (key === "caption" ? 5000 : key === "title" ? 300 : 1000)) throw new Error("写真情報の入力内容・文字数を確認してください。");
    result[key as keyof PhotoMetadata] = value.replace(/\r\n?/g, "\n").trim();
  }
  return normalizePhotoMetadataLens(result);
}
