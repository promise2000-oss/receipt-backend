import type { Business } from "@prisma/client";
import { prisma } from "./prisma";
import { getStorage, pdfKey } from "./storage";
import { buildDocumentData } from "./documentData";
import { renderReceiptPdf } from "./pdf";
import type { ReceiptWithRelations } from "../mappers";

/**
 * Render the branded PDF and store it under a private key, then record that
 * key on the receipt. Shared by the authenticated download route and the
 * public share download, so both always produce the identical file.
 */
export async function ensureReceiptPdf(
  receipt: ReceiptWithRelations,
  business: Business,
  verifyUrl?: string | null,
): Promise<{ buffer: Buffer; key: string }> {
  const data = await buildDocumentData(receipt, business, verifyUrl);
  const buffer = await renderReceiptPdf(data);

  const key = pdfKey(business.id, receipt.id);
  await getStorage().put(key, buffer, "application/pdf");

  await prisma.receipt.update({
    where: { id: receipt.id, business_id: business.id },
    data: { pdf_url: key },
  });

  return { buffer, key };
}

/** Return an already-stored PDF, generating it on first request. */
export async function getOrCreateReceiptPdf(
  receipt: ReceiptWithRelations,
  business: Business,
  verifyUrl?: string | null,
): Promise<Buffer> {
  if (receipt.pdf_url) {
    const existing = await getStorage().getBuffer(receipt.pdf_url);
    if (existing) return existing;
  }
  const { buffer } = await ensureReceiptPdf(receipt, business, verifyUrl);
  return buffer;
}
