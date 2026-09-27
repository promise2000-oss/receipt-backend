/**
 * Brand tokens for the Eleosstyles Receipt System.
 *
 * The cream / black / gold palette is used by both the Next.js UI and the
 * server-rendered receipt document, so it lives here to guarantee the screen
 * and the printed PDF can never drift apart.
 */
export const BRAND = {
  /** Cream / ivory page background */
  cream: "#FBF7EE",
  /** Black header band + primary text */
  ink: "#111111",
  /** Gold accent — rules, totals, paid badge */
  gold: "#B8912F",
  /** Gold-light — hover + highlight states */
  goldLight: "#D9B45C",
  /** Secondary text */
  muted: "#6B6459",
  /** Hairline rule colour */
  rule: "#E7DFCE",
} as const;

/** Every currency the receipt builder offers out of the box. */
export const CURRENCIES: Array<{ code: string; label: string }> = [
  { code: "NGN", label: "Nigerian Naira (₦)" },
  { code: "USD", label: "US Dollar ($)" },
  { code: "GBP", label: "Pound Sterling (£)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "GHS", label: "Ghanaian Cedi (₵)" },
  { code: "KES", label: "Kenyan Shilling (KSh)" },
  { code: "ZAR", label: "South African Rand (R)" },
  { code: "CAD", label: "Canadian Dollar ($)" },
];

const SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
  CAD: "$",
  AUD: "$",
  JPY: "¥",
  INR: "₹",
};

export function currencySymbol(code: string): string {
  return SYMBOLS[(code || "").toUpperCase()] ?? "";
}
