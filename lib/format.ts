// Presentation-only number/currency formatting shared by the ranked-table UI.
// Deliberately NOT in lib/scoring.ts — this is display formatting, not scoring
// logic, and lib/scoring.ts stays framework-free / display-free per its header
// comment ("Pure, framework-free, unit-testable").

export function fmtUSD(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

export function fmtGross(n: number, currency: string): string {
  const usd = fmtUSD(n);
  return currency === "USD" ? usd : `${usd} ${currency}`;
}

export function fmtPerMonth(n: number): string {
  return `${fmtUSD(n)}/mo`;
}

export function fmtPerDay(n: number): string {
  return `${fmtUSD(n)}/day`;
}
