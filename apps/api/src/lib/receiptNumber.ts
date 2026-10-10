import type { PrismaClient, Prisma } from "@prisma/client";
import { formatInvoiceNumber, formatReceiptNumber } from "@eleos/shared";

/**
 * Per-business sequential receipt numbers, e.g. ES-000214.
 *
 * `UPDATE businesses SET receipt_counter = receipt_counter + 1 ... RETURNING`
 * takes a row lock on the business for the duration of the transaction, so
 * concurrent creators serialise instead of colliding. The unique index on
 * (business_id, receipt_number) is the last line of defence.
 *
 * Counter bumps are never rolled back into a "reused" number only if the
 * surrounding transaction commits; if it aborts the counter does roll back
 * with it, which is exactly what we want (no gaps on failed inserts).
 */
export async function nextReceiptNumber(
  tx: Prisma.TransactionClient | PrismaClient,
  businessId: string,
): Promise<string> {
  const business = await tx.business.update({
    where: { id: businessId },
    data: { receipt_counter: { increment: 1 } },
    select: { receipt_counter: true, number_prefix: true },
  });

  return formatReceiptNumber(business.number_prefix, business.receipt_counter);
}

/**
 * Per-business sequential invoice numbers — `INV-000042`.
 *
 * Identical locking strategy to receipts, but on its own `invoice_counter`
 * column. The two series are independent on purpose: issuing an invoice must
 * not leave a hole in the receipt numbering a shopkeeper may already have
 * promised a customer, and vice versa.
 */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient | PrismaClient,
  businessId: string,
): Promise<string> {
  const business = await tx.business.update({
    where: { id: businessId },
    data: { invoice_counter: { increment: 1 } },
    select: { invoice_counter: true },
  });

  // `number_prefix` is deliberately not reused: a receipt prefix like "ES"
  // reads as a sales document, and an invoice carrying it would be
  // indistinguishable from one in a stack of paperwork.
  return formatInvoiceNumber(business.invoice_counter);
}
