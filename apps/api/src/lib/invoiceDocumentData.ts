import type { Business } from "@prisma/client";
import type { InvoiceDocumentData } from "./invoiceDocument";
import { logoDataUrl, num, type InvoiceWithRelations } from "../mappers";

/**
 * Turn a loaded invoice + business into the shape the invoice renderer wants.
 *
 * Mirrors `documentData.ts` for receipts so the two documents are built by the
 * same discipline: the route supplies the business and the invoice, this
 * library stays free of Express, and every number is normalised from Prisma's
 * Decimal on the way in.
 */
export async function buildInvoiceDocumentData(
  invoice: InvoiceWithRelations,
  business: Business,
): Promise<InvoiceDocumentData> {
  const logo = await logoDataUrl(business.logo_url);

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
    // The tenant's own watermark settings. Omitting these would fall back to
    // the platform default, which is right — but reading them here is what
    // lets an organization turn it off or re-word it.
    watermark: {
      enabled: business.watermark_enabled,
      text: business.watermark_text,
      opacity: business.watermark_opacity,
    },
    invoice: {
      invoice_number: invoice.invoice_number,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
        line_total: num(item.line_total),
      })),
      subtotal: num(invoice.subtotal),
      discount: num(invoice.discount),
      tax: num(invoice.tax),
      tax_rate: num(invoice.tax_rate),
      total: num(invoice.total),
      amount_paid: num(invoice.amount_paid),
      status: invoice.status,
      notes: invoice.notes,
      terms: invoice.terms,
      po_reference: invoice.po_reference,
      customer: invoice.customer
        ? {
            name: invoice.customer.name,
            phone: invoice.customer.phone,
            email: invoice.customer.email,
          }
        : null,
      payments: invoice.payments.map((payment) => ({
        amount: num(payment.amount),
        paid_at: payment.paid_at,
        method: payment.method,
        reference: payment.reference,
      })),
    },
  };
}