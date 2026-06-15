export type GalleryAlbumCategory =
  | "camp"
  | "shooting"
  | "exhibition"
  | "other";

export type GalleryAlbumMeta = {
  category?: GalleryAlbumCategory;
  hidden?: boolean;
};

// Lightroom album id ごとのサイト側メタデータ
// id が分かる album はここに書くのが一番確実です。
// 未設定の album は category: "other" として扱われます。
export const GALLERY_ALBUM_METADATA: Record<string, GalleryAlbumMeta> = {
  // "album-id-for-camp": { category: "camp" },
  // "album-id-for-shooting": { category: "shooting" },
  // "album-id-for-exhibition": { category: "exhibition" },
  // "album-id-for-private": { hidden: true },
};

// Lightroom album 名ごとのサイト側メタデータ
// Lightroom API から親フォルダ情報が取れない場合は、ここで分類します。
// 例: "箱根グランピング": { category: "camp" },
// 例: "非公開のアルバム名": { hidden: true },
export const GALLERY_ALBUM_NAME_METADATA: Record<string, GalleryAlbumMeta> = {
  "箱根グランピング": { category: "camp" },
};

export const GALLERY_CATEGORY_ORDER: GalleryAlbumCategory[] = [
  "camp",
  "shooting",
  "exhibition",
  "other",
];

export const GALLERY_CATEGORY_LABELS: Record<GalleryAlbumCategory, string> = {
  camp: "合宿",
  shooting: "撮影会",
  exhibition: "展示",
  other: "その他",
};
