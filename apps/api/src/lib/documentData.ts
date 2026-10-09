import type { Business } from "@prisma/client";
import type { DocumentData } from "./document";
import { qrDataUrl } from "./qr";
import { logoDataUrl, num, type ReceiptWithRelations } from "../mappers";

/**
 * Turn a loaded receipt + business into the shape the document renderer wants.
 *
 * `verifyUrl` is the public verification page this receipt's QR code should
 * resolve to. It is passed in by the route rather than derived here so the
 * library stays free of Express and can honour the deployment's public origin.
 */
export async function buildDocumentData(
  receipt: ReceiptWithRelations,
  business: Business,
  verifyUrl?: string | null,
): Promise<DocumentData> {
  const logo = await logoDataUrl(business.logo_url);
  const qr = verifyUrl ? await qrDataUrl(verifyUrl) : null;

  return {
    business: {
      name: business.name,
      logo_data_url: logo,
      address: business.address,
      phone: business.phone,
      email: business.email,
      website: business.website,
      currency: business.currency,
      brand_primary: business.brand_primary,
      brand_accent: business.brand_accent,
    },
    logo_data_url: logo,
    verify_url: verifyUrl ?? null,
    qr_data_url: qr,
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
