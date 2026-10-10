import type {
  Business,
  Customer,
  Invoice,
  InvoiceItem,
  InvoicePayment,
  Receipt,
  ReceiptItem,
  User,
} from "@prisma/client";
import type {
  BusinessDTO,
  CustomerDTO,
  InvoiceDTO,
  InvoiceItemDTO,
  InvoicePaymentDTO,
  ReceiptDTO,
  ReceiptItemDTO,
  UserDTO,
} from "@eleos/shared";
import { outstandingBalance } from "@eleos/shared";
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
    watermark_enabled: business.watermark_enabled,
    watermark_text: business.watermark_text,
    watermark_opacity: business.watermark_opacity,
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
    source: receipt.source,
    invoice_payment_id: receipt.invoice_payment_id,
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

/* --------------------------------- Invoicing ----------------------------- */

export function toInvoiceItemDTO(item: InvoiceItem): InvoiceItemDTO {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: num(item.quantity),
    unit_price: num(item.unit_price),
    line_total: num(item.line_total),
  };
}

export function toInvoicePaymentDTO(payment: InvoicePayment): InvoicePaymentDTO {
  return {
    id: payment.id,
    invoice_id: payment.invoice_id,
    amount: num(payment.amount),
    paid_at: payment.paid_at.toISOString(),
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    // Resolved by the relation the caller includes; absent on a bare row.
    receipt_id: (payment as InvoicePayment & { receipt?: { id: string } | null }).receipt?.id ?? null,
    created_by: payment.created_by,
    created_at: payment.created_at.toISOString(),
  };
}

export type InvoiceWithRelations = Invoice & {
  items: InvoiceItem[];
  payments: InvoicePayment[];
  customer: Customer | null;
};

/**
 * `balance_due` is computed here from the stored totals, never taken from a
 * request body — the number a customer is shown as owing is derived, on the
 * server, from money that was itself validated on the way in.
 */
export function toInvoiceDTO(invoice: InvoiceWithRelations): InvoiceDTO {
  const total = num(invoice.total);
  const amountPaid = num(invoice.amount_paid);

  return {
    id: invoice.id,
    business_id: invoice.business_id,
    customer_id: invoice.customer_id,
    customer: invoice.customer
      ? {
          id: invoice.customer.id,
          name: invoice.customer.name,
          phone: invoice.customer.phone,
          email: invoice.customer.email,
        }
      : null,
    invoice_number: invoice.invoice_number,
    issue_date: invoice.issue_date.toISOString(),
    due_date: invoice.due_date ? invoice.due_date.toISOString() : null,
    subtotal: num(invoice.subtotal),
    discount: num(invoice.discount),
    tax: num(invoice.tax),
    tax_rate: num(invoice.tax_rate),
    total,
    amount_paid: amountPaid,
    balance_due: outstandingBalance(total, amountPaid),
    status: invoice.status,
    notes: invoice.notes,
    terms: invoice.terms,
    po_reference: invoice.po_reference,
    pdf_url: null,
    issued_at: invoice.issued_at ? invoice.issued_at.toISOString() : null,
    cancelled_at: invoice.cancelled_at ? invoice.cancelled_at.toISOString() : null,
    cancel_reason: invoice.cancel_reason,
    created_by: invoice.created_by,
    created_at: invoice.created_at.toISOString(),
    items: invoice.items.map(toInvoiceItemDTO),
    payments: invoice.payments.map(toInvoicePaymentDTO),
  };
}

/** As above, but resolves the stored PDF key into a signed URL. */
export async function toInvoiceDTOWithPdf(
  invoice: InvoiceWithRelations,
): Promise<InvoiceDTO> {
  const dto = toInvoiceDTO(invoice);
  if (!invoice.pdf_url) return dto;
  return { ...dto, pdf_url: await getStorage().url(invoice.pdf_url, 60 * 60) };
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
