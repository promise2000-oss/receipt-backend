import type {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  ReceiptSource,
  ReceiptStatus,
  Role,
} from "./enums";

export interface BusinessDTO {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency: string;
  brand_primary: string;
  brand_accent: string;
  number_prefix: string;
  /** Document watermarking — see `resolveWatermark`. */
  watermark_enabled: boolean;
  watermark_text: string;
  watermark_opacity: number;
  created_at: string;
  updated_at: string;
}

export interface UserDTO {
  id: string;
  business_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  created_at: string;
}

export interface AuthDTO {
  user: UserDTO;
  business: BusinessDTO;
}

export interface CustomerDTO {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
  /** Number of receipts issued to this customer (only on list queries). */
  receipt_count?: number;
}

export interface ReceiptItemDTO {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface ReceiptCustomerDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface ReceiptDTO {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer: ReceiptCustomerDTO | null;
  receipt_number: string;
  /** Standalone sale, or generated from a payment on an invoice. */
  source: ReceiptSource;
  /** Present only when `source` is `invoice_payment`. */
  invoice_payment_id: string | null;
  issue_date: string;
  subtotal: number;
  discount: number;
  tax: number;
  tax_rate: number;
  total: number;
  paid_amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  status: ReceiptStatus;
  notes: string | null;
  pdf_url: string | null;
  voided_at: string | null;
  void_reason: string | null;
  original_receipt_id: string | null;
  created_by: string;
  created_at: string;
  items: ReceiptItemDTO[];
}

/* --------------------------------- Invoicing ----------------------------- */

export interface InvoiceItemDTO {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoicePaymentDTO {
  id: string;
  invoice_id: string;
  amount: number;
  paid_at: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  /** The receipt generated from this payment, when one was requested. */
  receipt_id: string | null;
  created_by: string;
  created_at: string;
}

export interface InvoiceDTO {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer: ReceiptCustomerDTO | null;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  tax_rate: number;
  total: number;
  amount_paid: number;
  /** total − amount_paid, floored at zero. Never a client-supplied figure. */
  balance_due: number;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  po_reference: string | null;
  pdf_url: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_at: string;
  items: InvoiceItemDTO[];
  payments: InvoicePaymentDTO[];
}

export interface InvoiceTotals {
  /** Sum of every non-cancelled invoice's total. */
  invoiced: number;
  /** Sum of payments recorded against non-cancelled invoices. */
  received: number;
  /** invoiced − received. */
  outstanding: number;
  /** Total still owed on invoices whose due date has passed. */
  overdue: number;
  count: number;
}

export interface InvoiceSummaryDTO {
  currency: string;
  totals: InvoiceTotals;
  recent: InvoiceDTO[];
}

export interface TotalsCard {
  count: number;
  total: number;
}

export interface DashboardSummaryDTO {
  currency: string;
  today: TotalsCard;
  week: TotalsCard;
  month: TotalsCard;
  /** Receipts that are neither paid nor void. */
  outstanding: TotalsCard;
  recent: ReceiptDTO[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ShareDTO {
  token: string;
  url: string;
  /** Non-expiring verification page encoded into the receipt's QR code. */
  verify_url: string;
  expires_at: string;
}

/** The trimmed-down payload served on the public, no-login receipt page. */
export interface PublicReceiptDTO {
  receipt: ReceiptDTO;
  business: Pick<
    BusinessDTO,
    | "name"
    | "logo_url"
    | "address"
    | "phone"
    | "email"
    | "website"
    | "currency"
    | "brand_primary"
    | "brand_accent"
  >;
  verify_url: string;
  expires_at: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}
