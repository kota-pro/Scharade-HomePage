import type { PhotoMetadata } from "../types/photos.ts";
import { photoCameraModel } from "./photoCamera.ts";
import { photoLensModel } from "./photoMetadata.ts";
/** Lightroom exposes embedded XMP; read only the camera namespaces used by the viewer. */
export function lightroomPhotoMetadata(payload: Record<string, any>): PhotoMetadata {
  const xmp = payload.xmp ?? {}, tiff = xmp.tiff ?? {}, exif = xmp.exif ?? {}, aux = xmp.aux ?? {};
  const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 1000) : "";
  const rational = (value: unknown): number => {
    if (Array.isArray(value)) return value.length === 2 ? Number(value[0]) / Number(value[1]) : Number(value[0]);
    if (typeof value === "string" && /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)) { const [a, b] = value.split("/").map(Number); return a / b; }
    return Number(value);
  };
  const result: PhotoMetadata = {}, make = text(tiff.Make ?? xmp["tiff:Make"]), model = text(tiff.Model ?? xmp["tiff:Model"]);
  const source = exif.FileSource ?? xmp["exif:FileSource"];
  const camera = photoCameraModel(make, model, source);
  if (camera) result.camera = camera;
  const lens = photoLensModel(aux.Lens) || photoLensModel(exif.LensModel) || photoLensModel(xmp["aux:Lens"]);
  if (lens) result.lens = lens.slice(0, 1000);
  const rawIso = exif.ISOSpeedRatings ?? exif.ISO ?? xmp["exif:ISOSpeedRatings"];
  const fNumber = rational(exif.FNumber ?? xmp["exif:FNumber"]), exposure = rational(exif.ExposureTime ?? xmp["exif:ExposureTime"]), iso = rational(Array.isArray(rawIso) ? rawIso[0] : rawIso);
  if (Number.isFinite(fNumber) && fNumber > 0) result.fNumber = String(fNumber);
  if (Number.isFinite(exposure) && exposure > 0) result.shutterSpeed = exposure < 1 ? `1/${Math.round(1 / exposure)}` : String(exposure);
  if (Number.isFinite(iso) && iso > 0) result.iso = String(iso);
  return result;
}
