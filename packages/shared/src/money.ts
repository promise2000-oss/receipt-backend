import { currencySymbol } from "./brand";

/** Round half-up to 2 decimal places. Money is never left to float drift. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A single line item as entered by the receipt builder. */
export interface LineInput {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface ComputedTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** quantity × unit price, rounded. */
export function lineTotal(quantity: number, unitPrice: number): number {
  return round2(Number(quantity || 0) * Number(unitPrice || 0));
}

/**
 * Single source of truth for receipt arithmetic.
 *
 * subtotal  = Σ line totals
 * net       = subtotal − discount
 * tax       = net × tax_rate%      (discount is applied before tax)
 * total     = net + tax
 *
 * The API recomputes this on every create; the client uses the same function
 * for the live preview, so the preview can never disagree with the PDF.
 */
export function computeTotals(
  items: LineInput[],
  discount = 0,
  taxRate = 0,
): ComputedTotals {
  const subtotal = round2(
    items.reduce(
      (sum, item) =>
        sum + lineTotal(Number(item.quantity || 0), Number(item.unit_price || 0)),
      0,
    ),
  );
  const safeDiscount = round2(Math.min(Math.max(Number(discount || 0), 0), subtotal));
  const net = round2(subtotal - safeDiscount);
  const tax = round2((net * Math.max(Number(taxRate || 0), 0)) / 100);
  return { subtotal, discount: safeDiscount, tax, total: round2(net + tax) };
}

/** Format an amount for display, e.g. `₦125,000.00`. */
export function formatMoney(amount: number, currency = "NGN"): string {
  const value = Number(amount || 0);
  const code = (currency || "").toUpperCase();
  const symbol = currencySymbol(code);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  if (!symbol) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code || "USD",
      }).format(value);
    } catch {
      return `${code} ${formatted}`.trim();
    }
  }
  return `${symbol}${formatted}`;
}

/** Parse a user-typed amount ("₦12,500.50", "12500.50") into a number. */
export function parseAmount(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
