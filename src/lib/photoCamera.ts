/** FileSource 1/2 identify scanned originals; scanner names also occur without that tag. */
export function isPhotoScanner(make: unknown, model: unknown, source?: unknown) {
  const code = Array.isArray(source) || ArrayBuffer.isView(source) ? Number((source as ArrayLike<unknown>)[0]) : Number(source);
  if (code === 1 || code === 2) return true;
  const text = `${make ?? ""} ${model ?? ""} ${typeof source === "string" ? source : ""}`;
  return /scan|\b(?:noritsu|qss[-_\s]?\d*|flextight|opticfilm|perfection|frontier|sp[-\s]?(?:500|2000|3000))\b|epson.*\bgt[-\s]?x\d+\b/i.test(text);
}

/** Use the camera's model, without adding the EXIF manufacturer or scan hardware. */
export function photoCameraModel(make: unknown, model: unknown, source?: unknown) {
  if (isPhotoScanner(make, model, source)) return "";
  const value = typeof model === "string" ? model.trim() : "";
  if (/^(?:.*\b(?:corporation|corp\.?|co\.?[,]?\s*ltd\.?|inc\.?))$/i.test(value)) return "";
  return value.replace(/^.*?\b(?:corporation|corp\.?|co\.?[,]?\s*ltd\.?|inc\.?)[,\s]+/i, "").trim();
}
