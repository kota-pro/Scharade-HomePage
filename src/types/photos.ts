export type PhotoSource = "portfolio" | "blog" | "gallery";
export type PhotoRef = { source: PhotoSource; containerId: string; imageId: string; proof?: string };
export type PhotoLiker = { name: string; href?: string };
export const photoEquipmentFields = ["camera", "lens", "film"] as const;
export const photoShootingFields = [...photoEquipmentFields, "fNumber", "shutterSpeed", "iso"] as const;
export const photoMetadataFields = ["title", "caption", ...photoShootingFields] as const;
export type PhotoMetadata = Partial<Record<typeof photoMetadataFields[number], string>>;
export type PhotoShootingMetadata = Pick<PhotoMetadata, typeof photoShootingFields[number]>;
export type PhotoSeriesFrame = {
  id: string; name: string; src: string; full: string;
  x: number; y: number; width: number; height: number; rotation: number;
};
export type PhotoSeries = { title: string; width: number; height: number; photos: PhotoSeriesFrame[]; metadata?: PhotoMetadata };
export type PhotoSeriesPreview = Pick<PhotoSeries, "title" | "width" | "height"> & {
  shooting: PhotoShootingMetadata;
  photos: Omit<PhotoSeriesFrame, "name" | "full">[];
};
export type GalleryPhotoEdit = { kind: "single" }
  | { kind: "series"; layoutRevision: string }
  | { kind: "book"; pages: { src: string; name: string }[] };
export type PortfolioSeries = { id: string; metadata: PhotoMetadata; photos: import("../lib/exhibitionTypes.ts").PhotoLayout[] };
export const photoFieldLabels: Record<typeof photoMetadataFields[number], string> = {
  title: "タイトル", caption: "キャプション", camera: "カメラ", lens: "レンズ", film: "フィルム", fNumber: "F値", shutterSpeed: "シャッタースピード", iso: "ISO感度",
};
export type PhotoView = PhotoMetadata & {
  ref: PhotoRef; key: string; src: string; full: string; alt: string;
  width?: number; height?: number;
  series?: PhotoSeries;
  galleryEdit?: GalleryPhotoEdit;
  author?: { name: string; icon: string; href?: string };
  liked: boolean; count?: number; likers?: PhotoLiker[];
};
