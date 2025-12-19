// src/lib/microcms.ts
import { createClient, type MicroCMSQueries } from "microcms-js-sdk";

const serviceDomain = import.meta.env.MICROCMS_SERVICE_DOMAIN;
const apiKey = import.meta.env.MICROCMS_API_KEY;

if (!serviceDomain) {
  throw new Error(
    "MICROCMS_SERVICE_DOMAIN が設定されていません。`.env` を確認してください。",
  );
}

if (!apiKey) {
  throw new Error(
    "MICROCMS_API_KEY が設定されていません。`.env` を確認してください。",
  );
}

// クライアント作成
export const microcmsClient = createClient({
  serviceDomain,
  apiKey,
});

// 型定義
export type Portfolio = {
  id: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  revisedAt: string;
  name: string;
  "self-introduction": string;
  instagram?: string;
  grade: string;
  icon?: {
    url: string;
    height: number;
    width: number;
  };
  pictures: {
    url: string;
    height: number;
    width: number;
  }[];
};

// ▼ 詳細データを取得する関数
export const getPortfolioDetail = async (
  contentId: string,
  queries?: MicroCMSQueries,
) => {
  // ★重要：ここが "client" になっていたらエラーになります！
  // 必ず "microcmsClient" になっているか確認してください。
  return await microcmsClient.getListDetail<Portfolio>({
    endpoint: "portfolio",
    contentId,
    queries,
  });
};

// ▼ 一覧データを取得する関数
export const getPortfolios = async (queries?: MicroCMSQueries) => {
  return await microcmsClient.getList<Portfolio>({
    endpoint: "portfolio",
    queries,
  });
};
