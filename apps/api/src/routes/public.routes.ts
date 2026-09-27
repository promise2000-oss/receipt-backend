import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppError, notFound } from "../lib/errors";
import { asyncH, pathParam } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { verifyShareToken } from "../lib/tokens";
import { getOrCreateReceiptPdf, ensureReceiptPdf } from "../lib/pdfStore";
import { buildDocumentData } from "../lib/documentData";
import { renderReceiptHtml } from "../lib/document";
import type { ReceiptWithRelations } from "../mappers";
import { num } from "../mappers";

export const publicRouter = Router();

const RECEIPT_INCLUDE = {
  items: { orderBy: { position: "asc" as const } },
  customer: true,
} as const;

async function resolveReceipt(token: string) {
  const verification = verifyShareToken(token);
  if (!verification.ok) {
    const message =
      verification.reason === "expired"
        ? "This share link has expired. Ask the sender for a new one."
        : "This share link is invalid.";
    const code = verification.reason === "expired" ? "LINK_EXPIRED" : "LINK_INVALID";
    throw new AppError(message, 403, code);
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: verification.receiptId },
    include: RECEIPT_INCLUDE,
  });
  if (!receipt) throw notFound("Receipt");

  const business = await prisma.business.findFirst({
    where: { id: receipt.business_id },
  });
  if (!business) throw notFound("Business");

  return { receipt, business, expiresAt: verification.expiresAt };
}

/** Strip internal fields — a share link must not leak tenancy metadata. */
function publicReceipt(receipt: ReceiptWithRelations) {
  return {
    id: receipt.id,
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
    voided_at: receipt.voided_at ? receipt.voided_at.toISOString() : null,
    void_reason: receipt.void_reason,
    created_at: receipt.created_at.toISOString(),
    customer: receipt.customer
      ? {
          name: receipt.customer.name,
          phone: receipt.customer.phone,
          email: receipt.customer.email,
        }
      : null,
    items: receipt.items.map((item) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      quantity: num(item.quantity),
      unit_price: num(item.unit_price),
      line_total: num(item.line_total),
    })),
  };
}

/** JSON payload for the public receipt page. No session required. */
publicRouter.get(
  "/r/:token",
  asyncH(async (req, res) => {
    const { receipt, business, expiresAt } = await resolveReceipt(pathParam(req, "token"));

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      receipt: publicReceipt(receipt),
      business: {
        name: business.name,
        // The logo is itself behind a signed URL — no anonymous bucket access.
        logo_url: business.logo_url
          ? await import("../lib/storage").then((m) =>
              m.getStorage().url(business.logo_url!, 60 * 60),
            )
          : null,
        address: business.address,
        phone: business.phone,
        email: business.email,
        currency: business.currency,
        brand_primary: business.brand_primary,
        brand_accent: business.brand_accent,
      },
      expires_at: expiresAt.toISOString(),
    });
  }),
);

/** Same HTML the PDF is made from, for the public preview iframe. */
publicRouter.get(
  "/r/:token/document",
  asyncH(async (req, res) => {
    const { receipt, business } = await resolveReceipt(pathParam(req, "token"));
    const html = renderReceiptHtml(await buildDocumentData(receipt, business));
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).type("html").send(html);
  }),
);

/** Anonymous PDF download through the capability link. */
publicRouter.get(
  "/r/:token/download",
  asyncH(async (req, res) => {
    const { receipt, business } = await resolveReceipt(pathParam(req, "token"));
    const buffer = await getOrCreateReceiptPdf(receipt, business);

    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${receipt.receipt_number}.pdf"`,
      )
      .setHeader("Cache-Control", "private, max-age=0, must-revalidate")
      .send(buffer);
  }),
);

/** Refresh/regenerate the PDF for an owner from a share link context. */
publicRouter.post(
  "/r/:token/regenerate",
  requireAuth,
  asyncH(async (req, res) => {
    const { receipt, business } = await resolveReceipt(pathParam(req, "token"));
    if (receipt.business_id !== req.auth!.businessId) throw notFound("Receipt");
    const { buffer } = await ensureReceiptPdf(receipt, business);
    res.setHeader("Content-Type", "application/pdf");
    res.send(buffer);
  }),
);
