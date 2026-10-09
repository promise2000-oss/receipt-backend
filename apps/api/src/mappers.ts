import type { Business, Customer, Receipt, ReceiptItem, User } from "@prisma/client";
import type {
  BusinessDTO,
  CustomerDTO,
  ReceiptDTO,
  ReceiptItemDTO,
  UserDTO,
} from "@eleos/shared";
import { getStorage } from "./lib/storage";

/** Prisma Decimal → plain number, safely. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    business_id: user.business_id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    created_at: user.created_at.toISOString(),
  };
}

/**
 * `logo_url` in the database is a private storage key. It leaves the API as a
 * signed, expiring URL so the bucket/disk is never publicly listable.
 */
export async function toBusinessDTO(business: Business): Promise<BusinessDTO> {
  return {
    id: business.id,
    name: business.name,
    logo_url: business.logo_url
      ? await getStorage().url(business.logo_url, 60 * 60 * 24)
      : null,
    address: business.address,
    phone: business.phone,
    email: business.email,
    website: business.website,
    currency: business.currency,
    brand_primary: business.brand_primary,
    brand_accent: business.brand_accent,
    number_prefix: business.number_prefix,
    created_at: business.created_at.toISOString(),
    updated_at: business.updated_at.toISOString(),
  };
}

export function toCustomerDTO(customer: Customer, receiptCount?: number): CustomerDTO {
  const dto: CustomerDTO = {
    id: customer.id,
    business_id: customer.business_id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    created_at: customer.created_at.toISOString(),
  };
  if (typeof receiptCount === "number") dto.receipt_count = receiptCount;
  return dto;
}

export type ReceiptWithRelations = Receipt & {
  items: ReceiptItem[];
  customer: Customer | null;
};

export function toReceiptItemDTO(item: ReceiptItem): ReceiptItemDTO {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: num(item.quantity),
    unit_price: num(item.unit_price),
    line_total: num(item.line_total),
  };
}

export async function toReceiptDTO(receipt: ReceiptWithRelations): Promise<ReceiptDTO> {
  return {
    id: receipt.id,
    business_id: receipt.business_id,
    customer_id: receipt.customer_id,
    customer: receipt.customer
      ? {
          id: receipt.customer.id,
          name: receipt.customer.name,
          phone: receipt.customer.phone,
          email: receipt.customer.email,
        }
      : null,
    receipt_number: receipt.receipt_number,
    issue_date: receipt.issue_date.toISOString(),
    subtotal: num(receipt.subtotal),
    discount: num(receipt.discount),
    tax: num(receipt.tax),
    tax_rate: num(receipt.tax_rate),
    total: num(receipt.total),
    paid_amount: num(receipt.paid_amount),
    payment_method: receipt.payment_method,
    payment_status: receipt.payment_status,
    status: receipt.status,
    notes: receipt.notes,
    pdf_url: receipt.pdf_url
      ? await getStorage().url(receipt.pdf_url, 60 * 60)
      : null,
    voided_at: receipt.voided_at ? receipt.voided_at.toISOString() : null,
    void_reason: receipt.void_reason,
    original_receipt_id: receipt.original_receipt_id,
    created_by: receipt.created_by,
    created_at: receipt.created_at.toISOString(),
    items: receipt.items.map(toReceiptItemDTO),
  };
}

export async function toReceiptDTOs(
  receipts: ReceiptWithRelations[],
): Promise<ReceiptDTO[]> {
  return Promise.all(receipts.map(toReceiptDTO));
}

/** Load the business logo as an inline data URL for the document renderer. */
export async function logoDataUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const buffer = await getStorage().getBuffer(key);
  if (!buffer) return null;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : ext === "svg"
            ? "image/svg+xml"
            : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
