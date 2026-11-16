import type { PhotoMetadata } from "./photos";

export { PORTFOLIO_UPLOAD_LIMIT as PORTFOLIO_BOOK_FILE_LIMIT } from "./portfolioUpload.ts";
export const PORTFOLIO_BOOK_LIMIT = 100;
export const PORTFOLIO_BOOK_BLANK_LIMIT = 100;

export type BookDirection = "left" | "right";
export type BookPageLayout = "spread" | "single";

export type PortfolioBook = {
  id: string;
  pdfId: string;
  coverId: string;
  coverPage: number | null;
  direction: BookDirection;
  metadata: PhotoMetadata;
  pageLayout?: BookPageLayout;
  blankPagesAfter?: number[];
};

export type PortfolioBookDetails = PortfolioBook & {
  pageCount: number;
  pdfName: string;
  width: number;
  height: number;
};

export type BookReaderOptions = Pick<PortfolioBook, "direction" | "pageLayout" | "blankPagesAfter"> & { source: string };

export function portfolioBookMediaUrl(portfolioId: string, assetId: string, draft = false) {
  const path = `${encodeURIComponent(portfolioId)}/${encodeURIComponent(assetId)}`;
  return draft
    ? `/api/portfolio/books/${path}`
    : `/Portfolio/${encodeURIComponent(portfolioId)}/book-media/${encodeURIComponent(assetId)}`;
}

export function bookPagesInView(active: number, total: number, single: boolean) {
  if (single || active === 1) return [active];
  const first = active - active % 2;
  return first < total ? [first, first + 1] : [first];
}

export function bookPageAt(position: number, blanks: readonly number[]) {
  let pdfPage = position;
  for (const [blankIndex, after] of blanks.entries()) {
    const blankPosition = after + blankIndex + 1;
    if (position === blankPosition) return { pdfPage: after, blankIndex };
    if (position < blankPosition) break;
    pdfPage--;
  }
  return { pdfPage, blankIndex: undefined };
}
