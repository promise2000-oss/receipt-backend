import type {
  PaymentMethod,
  PaymentStatus,
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
  currency: string;
  brand_primary: string;
  brand_accent: string;
  number_prefix: string;
  created_at: string;
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

export interface ReceiptQuery {
  search?: string;
  status?: ReceiptStatus | "all";
  payment_status?: PaymentStatus | "all";
  from?: string;
  to?: string;
  min?: number;
  max?: number;
  page?: number;
  limit?: number;
}

export interface ShareDTO {
  token: string;
  url: string;
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
    | "currency"
    | "brand_primary"
    | "brand_accent"
  >;
  expires_at: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}
