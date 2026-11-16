import type { PhotoMetadata } from "../types/photos.ts";
import { photoCameraModel } from "./photoCamera.ts";
import { photoLensModel } from "./photoMetadata.ts";

export const photoExifFields = {
  pick: ["Make", "Model", "FileSource", "LensModel", "FNumber", "ExposureTime", "ISO"],
  gps: false,
  makerNote: false,
  userComment: false,
};

export function readPhotoExifValues(values?: Record<string, unknown>): PhotoMetadata {
  if (!values) return {};
  const result: PhotoMetadata = {};
  const camera = photoCameraModel(values.Make, values.Model, values.FileSource);
  if (camera) result.camera = camera;
  const lens = photoLensModel(values.LensModel);
  if (lens) result.lens = lens;
  if (Number(values.FNumber) > 0) result.fNumber = String(Number(values.FNumber));
  if (Number(values.ISO) > 0) result.iso = String(Number(values.ISO));
  const exposure = Number(values.ExposureTime);
  if (exposure > 0) result.shutterSpeed = exposure < 1 ? `1/${Math.round(1 / exposure)}` : String(exposure);
  return result;
}
