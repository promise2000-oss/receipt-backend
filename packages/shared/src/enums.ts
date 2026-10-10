import { round2 } from "./money";

export type Role = "owner" | "staff";
export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export type PaymentStatus = "paid" | "partial" | "pending";
export type ReceiptStatus = "active" | "void";

/**
 * Invoice lifecycle.
 *
 * `overdue` is the one state that is not set by an explicit user action — it
 * is derived from "issued, not settled, past the due date" — but it is stored
 * rather than computed at read time so history can filter on it directly.
 */
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

/** What a receipt was generated from. */
export type ReceiptSource = "standalone" | "invoice_payment";

/** A `draft` is editable; everything else is frozen in its money fields. */
export const EDITABLE_INVOICE_STATUSES: InvoiceStatus[] = ["draft"];

/** States from which no further transition is possible. */
export const TERMINAL_INVOICE_STATUSES: InvoiceStatus[] = ["paid", "cancelled"];

/**
 * Which state an invoice moves to once `amount_paid` changes.
 *
 * Kept as one function so the API, the tests and any future job that sweeps
 * for overdue invoices all agree. `draft` and `cancelled` are returned
 * unchanged: a payment never silently issues an invoice, and a cancelled
 * invoice never resurrects itself because a late payment landed.
 */
export function nextInvoiceStatus(
  current: InvoiceStatus,
  total: number,
  amountPaid: number,
  dueDate: Date | null,
  now: Date = new Date(),
): InvoiceStatus {
  if (current === "draft" || current === "cancelled") return current;

  const settled = round2(amountPaid) >= round2(total);
  if (settled) return "paid";

  const partial = round2(amountPaid) > 0;
  if (partial) return "partially_paid";

  // Issued, nothing received, and the due date has passed.
  if (dueDate && dueDate.getTime() < now.getTime()) return "overdue";
  return "issued";
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "transfer",
  "card",
  "other",
];

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "paid",
  "partial",
  "pending",
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  transfer: "Bank Transfer",
  card: "Card",
  other: "Other",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Paid",
  partial: "Partially Paid",
  pending: "Pending",
};

/**
 * Fields that become permanently frozen the moment a receipt is issued.
 * The API rejects any update that touches one of them — corrections are made
 * by voiding and reissuing, never by editing totals.
 */
export const IMMUTABLE_RECEIPT_FIELDS = [
  "items",
  "receipt_items",
  "receiptItem",
  "subtotal",
  "discount",
  "tax",
  "tax_rate",
  "total",
  "paid_amount",
  "issue_date",
  "receipt_number",
  "payment_method",
] as const;

/**
 * The same rule for invoices. An issued invoice is money someone may already
 * have paid against, so its figures freeze the moment it leaves `draft`;
 * corrections are cancel + reissue.
 *
 * `amount_paid` is deliberately absent: it is derived from the payment rows
 * and is the one field a payment is *supposed* to move. `status` is absent
 * for the same reason — the lifecycle advances on its own.
 */
export const IMMUTABLE_INVOICE_FIELDS = [
  "items",
  "invoice_items",
  "invoiceItem",
  "subtotal",
  "discount",
  "tax",
  "tax_rate",
  "total",
  "issue_date",
  "invoice_number",
  "customer_id",
  "po_reference",
  "terms",
] as const;
