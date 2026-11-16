import type { PhotoSeries, PhotoSeriesFrame, PhotoSeriesPreview } from "../types/photos.ts";
import { photoShootingMetadata } from "../lib/photoMetadata.ts";

export function photoSeriesPreview({ title, width, height, photos, metadata }: PhotoSeries): PhotoSeriesPreview {
  return { title, width, height, shooting: photoShootingMetadata(metadata), photos: photos.map(({ id, src, x, y, width, height, rotation }) =>
    ({ id, src, x, y, width, height, rotation })) };
}

export function photoSeriesFrameStyle(frame: Pick<PhotoSeriesFrame, "x" | "y" | "width" | "height" | "rotation">, layout: Pick<PhotoSeries, "width" | "height">) {
  return {
    left: `${frame.x / layout.width * 100}%`,
    top: `${frame.y / layout.height * 100}%`,
    width: `${frame.width / layout.width * 100}%`,
    height: `${frame.height / layout.height * 100}%`,
    transform: `rotate(${frame.rotation}deg)`,
  };
}
