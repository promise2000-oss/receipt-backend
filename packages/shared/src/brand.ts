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

/* -------------------------------------------------------------------------- */
/*                             Document watermarking                            */
/* -------------------------------------------------------------------------- */

/**
 * The platform's own attribution, spelled exactly as the brand requires.
 *
 * This is the default watermark on every generated receipt and invoice unless
 * an organization changes it. It is a single source of truth so the API, the
 * document template and the tests cannot drift onto different spellings.
 */
export const DEFAULT_WATERMARK_TEXT = "VISIONARYGENE";

/**
 * The default is deliberately faint. The watermark identifies the platform;
 * it must never compete with the figures a customer is trying to read.
 * 8% sits inside the 5–10% band the product spec asks for.
 */
export const DEFAULT_WATERMARK_OPACITY = 8;

/** Hard ceiling, enforced server-side and in the update schema alike. */
export const MAX_WATERMARK_OPACITY = 25;

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  /** 0–100, inclusive. */
  opacity: number;
}

/**
 * Resolve a tenant's watermark settings into something safe to render.
 *
 * Every field is re-derived here rather than trusted from the record, so a
 * stored value can never produce an unreadable document:
 *
 *  - `enabled: false` wins outright and drops the watermark entirely;
 *  - blank text falls back to the platform name, because an empty watermark
 *    would silently produce a document with no attribution at all;
 *  - opacity is clamped to 0–MAX, so even a hand-edited database row cannot
 *    set a watermark opaque enough to obscure the totals underneath it.
 *
 * Long text is trimmed to a sane length for the same reason — an unbroken
 * 200-character string rotated across the page is a smear, not a watermark.
 */
export function resolveWatermark(input: Partial<WatermarkConfig> | null | undefined): WatermarkConfig {
  const enabled = input?.enabled !== false;

  const rawText = (input?.text ?? "").toString().trim();
  const text = rawText.length === 0 ? DEFAULT_WATERMARK_TEXT : rawText.slice(0, 40);

  const requested = Number(input?.opacity);
  const opacity = Number.isFinite(requested)
    ? Math.min(MAX_WATERMARK_OPACITY, Math.max(0, requested))
    : DEFAULT_WATERMARK_OPACITY;

  return { enabled, text, opacity };
}

/** The rgba() the watermark is painted in, from the resolved config. */
export function watermarkStyle(config: WatermarkConfig): string {
  return `rgba(17, 17, 17, ${(config.opacity / 100).toFixed(3)})`;
}
