import {
  createClient,
  type MicroCMSQueries,
  type GetListRequest,
  type GetListDetailRequest,
} from "microcms-js-sdk";
import { cached } from "./cache.ts";
import { env } from "./config.ts";

export type Portfolio = {
  id: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  revisedAt: string;
  name: string;
  self_introduction?: string;
  instagram?: string;
  hashtags?: string[];
  x_url?: string;
  camera?: string;
  grade?: string | string[];
  role?: string;
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

const PORTFOLIO_GRADE_ALIASES: Record<string, string> = {
  "1st grade": "1st Grade",
  "2nd grade": "2nd Grade",
  "3rd grade": "3rd Grade",
  "4th grade": "4th Grade",
  international: "International",
  "master's program": "Master's Program",
  "masters program": "Master's Program",
  "doctor's program": "Doctor's Program",
  "doctors program": "Doctor's Program",
  doctorate: "Doctor's Program",
  博士: "Doctor's Program",
  博士課程: "Doctor's Program",
  ob: "OB/OG",
  og: "OB/OG",
  "ob/og": "OB/OG",
  "1年": "1st Grade",
  "2年": "2nd Grade",
  "3年": "3rd Grade",
  "4年": "4th Grade",
  留学生: "International",
  院生: "Master's Program",
  卒業: "OB/OG",
};

export const canonicalizePortfolioGrade = (grade: string): string => {
  const trimmed = grade.trim();
  if (!trimmed) return "";
  return (
    PORTFOLIO_GRADE_ALIASES[trimmed.toLowerCase()] ??
    PORTFOLIO_GRADE_ALIASES[trimmed] ??
    trimmed
  );
};

export const normalizePortfolioGrade = (grade: Portfolio["grade"]): string => {
  if (typeof grade === "string") return canonicalizePortfolioGrade(grade);
  if (Array.isArray(grade)) {
    return (
      grade
        .map((value) => canonicalizePortfolioGrade(String(value)))
        .find(Boolean) ?? ""
    );
  }
  return "";
};

function client() {
  const serviceDomain = env("MICROCMS_SERVICE_DOMAIN");
  const apiKey = env("MICROCMS_SERVER_API_KEY");
  if (!serviceDomain || !apiKey)
    throw new Error("microCMSが設定されていません。");
  return createClient({ serviceDomain, apiKey, retry: false });
}
export const microcmsClient = {
  getList<T>(options: GetListRequest) {
    return cached(`cms:list:${JSON.stringify(options)}`, () =>
      client().getList<T>({
        ...options,
        customRequestInit: { signal: AbortSignal.timeout(8000) },
      }),
    );
  },
  getListDetail<T>(options: GetListDetailRequest) {
    return cached(`cms:detail:${JSON.stringify(options)}`, () =>
      client().getListDetail<T>({
        ...options,
        customRequestInit: { signal: AbortSignal.timeout(8000) },
      }),
    );
  },
};
export function getPortfolioDetail<T>(
  contentId: string,
  queries?: MicroCMSQueries,
) {
  return microcmsClient.getListDetail<T>({
    endpoint: env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio",
    contentId,
    queries,
  });
}
export function getPortfolios(queries?: MicroCMSQueries) {
  return microcmsClient.getList<Portfolio>({
    endpoint: env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio",
    queries,
  });
}
export async function getAllContents<T>(
  endpoint: string,
  queries: MicroCMSQueries = {},
): Promise<T[]> {
  const contents: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await microcmsClient.getList<T>({
      endpoint,
      queries: { ...queries, limit: 100, offset },
    });
    contents.push(...page.contents);
    if (!page.contents.length || contents.length >= page.totalCount)
      return contents;
  }
}
export function getAllPortfolios() {
  return getAllContents<Portfolio>(
    env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio",
  );
}
