export type Role = "owner" | "staff";
export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export type PaymentStatus = "paid" | "partial" | "pending";
export type ReceiptStatus = "active" | "void";

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
