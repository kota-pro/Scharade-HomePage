export const PORTFOLIO_OFFICES = ["幹事長", "副幹事長", "会計"] as const;
export type PortfolioOffice = (typeof PORTFOLIO_OFFICES)[number];

export function isPortfolioOffice(value: unknown): value is PortfolioOffice {
  return PORTFOLIO_OFFICES.some((office) => office === value);
}

export function portfolioOffice(value: unknown): PortfolioOffice | "" {
  const label = typeof value === "string" ? value.trim() : "";
  return isPortfolioOffice(label) ? label : "";
}

export function portfolioOfficeOrder(office: PortfolioOffice | "") {
  return office ? PORTFOLIO_OFFICES.indexOf(office) : PORTFOLIO_OFFICES.length;
}
