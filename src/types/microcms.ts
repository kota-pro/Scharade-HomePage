import type {
  MicroCMSContentId,
  MicroCMSDate,
  MicroCMSImage,
  MicroCMSListResponse,
} from "microcms-js-sdk";

export type Tag = {
  name: string;
  slug: string;
} & MicroCMSContentId &
  MicroCMSDate;

export type Blog = {
  title: string;
  slug: string;
  excerpt?: string;
  body?: string;
  pictures?: MicroCMSImage[];
  tags: string[];
} & MicroCMSContentId &
  MicroCMSDate;
export type Gallery = {
  gallery_title: string;
  date?: string;
  tags?: string[];
  pictures?: MicroCMSImage[];
  top_image: MicroCMSImage;
};

export type BlogListResponse = MicroCMSListResponse<Blog>;
