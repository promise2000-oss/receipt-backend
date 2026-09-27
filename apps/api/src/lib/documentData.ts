import type { Business } from "@prisma/client";
import type { DocumentData } from "./document";
import { logoDataUrl, num, type ReceiptWithRelations } from "../mappers";

/** Turn a loaded receipt + business into the shape the document renderer wants. */
export async function buildDocumentData(
  receipt: ReceiptWithRelations,
  business: Business,
): Promise<DocumentData> {
  const logo = await logoDataUrl(business.logo_url);

  return {
    business: {
      name: business.name,
      logo_data_url: logo,
      address: business.address,
      phone: business.phone,
      email: business.email,
      currency: business.currency,
      brand_primary: business.brand_primary,
      brand_accent: business.brand_accent,
    },
    logo_data_url: logo,
    receipt: {
      receipt_number: receipt.receipt_number,
      issue_date: receipt.issue_date,
      items: receipt.items.map((item) => ({
        description: item.description,
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
        line_total: num(item.line_total),
      })),
      subtotal: num(receipt.subtotal),
      discount: num(receipt.discount),
      tax: num(receipt.tax),
      tax_rate: num(receipt.tax_rate),
      total: num(receipt.total),
      paid_amount: num(receipt.paid_amount),
      payment_method: receipt.payment_method,
      payment_status: receipt.payment_status,
      status: receipt.status,
      voided_at: receipt.voided_at,
      void_reason: receipt.void_reason,
      notes: receipt.notes,
      customer: receipt.customer
        ? {
            name: receipt.customer.name,
            phone: receipt.customer.phone,
            email: receipt.customer.email,
          }
        : null,
    },
  };
}
