import type { Business } from "@prisma/client";
import { prisma } from "./prisma";
import { getStorage, invoicePdfKey } from "./storage";
import { buildInvoiceDocumentData } from "./invoiceDocumentData";
import { renderInvoicePdf } from "./pdf";
import type { InvoiceWithRelations } from "../mappers";

/**
 * Render an invoice PDF and store it under a private key, then record that key
 * on the invoice. The invoice counterpart of `pdfStore.ts`.
 *
 * The stored copy is an optimisation, not the source of truth: `getOrCreate`
 * falls back to rendering fresh whenever the file is missing, so a wiped
 * ephemeral disk degrades to "slower", never to "broken".
 */
export async function ensureInvoicePdf(
  invoice: InvoiceWithRelations,
  business: Business,
): Promise<{ buffer: Buffer; key: string }> {
  const data = await buildInvoiceDocumentData(invoice, business);
  const buffer = await renderInvoicePdf(data);

  const key = invoicePdfKey(business.id, invoice.id);
  await getStorage().put(key, buffer, "application/pdf");

  await prisma.invoice.update({
    where: { id: invoice.id, business_id: business.id },
    data: { pdf_url: key },
  });

  return { buffer, key };
}

/** Return an already-stored PDF, generating it on first request. */
export async function getOrCreateInvoicePdf(
  invoice: InvoiceWithRelations,
  business: Business,
): Promise<Buffer> {
  if (invoice.pdf_url) {
    const existing = await getStorage().getBuffer(invoice.pdf_url);
    if (existing) return existing;
  }
  const { buffer } = await ensureInvoicePdf(invoice, business);
  return buffer;
}