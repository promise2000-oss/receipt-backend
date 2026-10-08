import { Router } from "express";
import {
  computeTotals,
  emailReceiptSchema,
  receiptCreateSchema,
  reissueReceiptSchema,
  shareReceiptSchema,
  voidReceiptSchema,
  type ReceiptDTO,
} from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError, conflict, notFound } from "../lib/errors";
import { asyncH, parse, pathParam } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { nextReceiptNumber } from "../lib/receiptNumber";
import { ensureReceiptPdf } from "../lib/pdfStore";
import { buildDocumentData } from "../lib/documentData";
import { renderReceiptHtml } from "../lib/document";
import { logoDataUrl } from "../mappers";
import { formatReceiptNumber } from "@eleos/shared";
import { signShareToken } from "../lib/tokens";
import { absoluteUrl } from "../lib/url";
import { getMailer } from "../lib/mail";
import { env } from "../lib/env";
import { toReceiptDTOs, toReceiptDTO, type ReceiptWithRelations } from "../mappers";

export const receiptRouter = Router();

receiptRouter.use(requireAuth);

const RECEIPT_INCLUDE = {
  items: { orderBy: { position: "asc" as const } },
  customer: true,
} as const;

async function loadReceipt(businessId: string, id: string): Promise<ReceiptWithRelations> {
  const receipt = await prisma.receipt.findFirst({
    where: { id, business_id: businessId },
    include: RECEIPT_INCLUDE,
  });
  if (!receipt) throw notFound("Receipt");
  return receipt;
}

async function loadBusinessFor(businessId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId } });
  if (!business) throw notFound("Business");
  return business;
}

/** Render + store the PDF once, then reuse it for every subsequent download. */
async function ensurePdf(receipt: ReceiptWithRelations, businessId: string) {
  const business = await loadBusinessFor(businessId);
  return ensureReceiptPdf(receipt, business);
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

receiptRouter.get(
  "/",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const q = req.query;

    const search = String(q.search ?? "").trim();
    const status = String(q.status ?? "all");
    const paymentStatus = String(q.payment_status ?? "all");
    const from = q.from ? String(q.from) : "";
    const to = q.to ? String(q.to) : "";
    const min = q.min !== undefined && q.min !== "" ? Number(q.min) : null;
    const max = q.max !== undefined && q.max !== "" ? Number(q.max) : null;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25) || 25));

    const where: Record<string, unknown> = { business_id: businessId };

    if (status === "active" || status === "void") where.status = status;
    if (paymentStatus === "paid" || paymentStatus === "partial" || paymentStatus === "pending") {
      where.payment_status = paymentStatus;
    }

    if (from || to) {
      where.issue_date = {
        ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
      };
    }

    if (min !== null || max !== null) {
      where.total = {
        ...(min !== null ? { gte: min } : {}),
        ...(max !== null ? { lte: max } : {}),
      };
    }

    if (search) {
      where.OR = [
        { receipt_number: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { items: { some: { description: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.receipt.count({ where }),
      prisma.receipt.findMany({
        where,
        include: RECEIPT_INCLUDE,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      items: await toReceiptDTOs(rows),
      total,
      page,
      limit,
    });
  }),
);

// ---------------------------------------------------------------------------
// Create — the only way a receipt comes into existence
// ---------------------------------------------------------------------------

receiptRouter.post(
  "/",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(receiptCreateSchema, req.body);

    // Tenant check: a customer id from another business is "not found".
    if (input.customer_id) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customer_id, business_id: businessId },
        select: { id: true },
      });
      if (!customer) throw notFound("Customer");
    }

    // Totals are ALWAYS recomputed server-side. The client's numbers are a
    // preview, never the source of truth.
    const totals = computeTotals(input.items, input.discount, input.tax_rate);

    const paidAmount =
      input.paid_amount !== undefined
        ? Math.min(Math.max(input.paid_amount, 0), totals.total)
        : input.payment_status === "paid"
          ? totals.total
          : input.payment_status === "partial"
            ? Math.round(totals.total / 2 * 100) / 100
            : 0;

    const issueDate = input.issue_date
      ? new Date(`${input.issue_date}T00:00:00`)
      : new Date();

    const receipt = await prisma.$transaction(async (tx) => {
      // Number assignment shares the transaction with the insert: if the
      // insert fails the counter rolls back with it.
      const receipt_number = await nextReceiptNumber(tx, businessId);

      return tx.receipt.create({
        data: {
          business_id: businessId,
          customer_id: input.customer_id ?? null,
          receipt_number,
          issue_date: issueDate,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          tax_rate: input.tax_rate,
          total: totals.total,
          paid_amount: paidAmount,
          payment_method: input.payment_method as never,
          payment_status: input.payment_status as never,
          notes: input.notes ?? null,
          created_by: req.auth!.userId,
          items: {
            create: input.items.map((item, index) => ({
              position: index,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: Math.round(item.quantity * item.unit_price * 100) / 100,
            })),
          },
        },
        include: RECEIPT_INCLUDE,
      });
    });

    res.status(201).json(await toReceiptDTO(receipt));
  }),
);

/**
 * Renders the receipt document without saving it.
 *
 * The builder posts its draft here and shows the result in an iframe, so the
 * live preview is literally the same HTML the PDF is produced from — the two
 * can never drift apart.
 */
receiptRouter.post(
  "/preview",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(receiptCreateSchema, req.body);

    const business = await loadBusinessFor(businessId);

    let customer: { name: string; phone: string | null; email: string | null } | null =
      null;
    if (input.customer_id) {
      const found = await prisma.customer.findFirst({
        where: { id: input.customer_id, business_id: businessId },
      });
      if (!found) throw notFound("Customer");
      customer = { name: found.name, phone: found.phone, email: found.email };
    }

    const totals = computeTotals(input.items, input.discount, input.tax_rate);
    const paidAmount =
      input.paid_amount !== undefined
        ? Math.min(Math.max(input.paid_amount, 0), totals.total)
        : input.payment_status === "paid"
          ? totals.total
          : input.payment_status === "partial"
            ? Math.round((totals.total / 2) * 100) / 100
            : 0;

    // Show the number this receipt *will* receive (read-only, never consumed).
    const previewNumber = formatReceiptNumber(
      business.number_prefix,
      business.receipt_counter + 1,
    );

    const logo = await logoDataUrl(business.logo_url);

    const html = renderReceiptHtml({
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
        receipt_number: previewNumber,
        issue_date: input.issue_date
          ? new Date(`${input.issue_date}T00:00:00`)
          : new Date(),
        items: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: Math.round(item.quantity * item.unit_price * 100) / 100,
        })),
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        tax_rate: input.tax_rate,
        total: totals.total,
        paid_amount: paidAmount,
        payment_method: input.payment_method,
        payment_status: input.payment_status,
        status: "active",
        notes: input.notes ?? null,
        customer,
      },
    });

    res.status(200).type("html").send(html);
  }),
);

// ---------------------------------------------------------------------------
// Read one
// ---------------------------------------------------------------------------

receiptRouter.get(
  "/:id",
  asyncH(async (req, res) => {
    const receipt = await loadReceipt(req.auth!.businessId, pathParam(req, "id"));
    res.json(await toReceiptDTO(receipt));
  }),
);

/** The exact HTML the PDF is built from — shown in the preview iframe. */
receiptRouter.get(
  "/:id/document",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));
    const business = await loadBusinessFor(businessId);
    const html = renderReceiptHtml(await buildDocumentData(receipt, business));
    res.status(200).type("html").send(html);
  }),
);

/** Streams the branded PDF for this receipt (generates it on first request). */
receiptRouter.get(
  "/:id/pdf",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));

    const { buffer } = await ensurePdf(receipt, businessId);
    const filename = `${receipt.receipt_number}.pdf`;

    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .setHeader("Cache-Control", "private, max-age=0, must-revalidate")
      .send(buffer);
  }),
);

/** Ensure the PDF exists and return its signed URL (used by the UI). */
receiptRouter.post(
  "/:id/generate-pdf",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));
    await ensurePdf(receipt, businessId);
    const refreshed = await loadReceipt(businessId, receipt.id);
    res.json(await toReceiptDTO(refreshed));
  }),
);

// ---------------------------------------------------------------------------
// Void / reissue
// ---------------------------------------------------------------------------

receiptRouter.post(
  "/:id/void",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(voidReceiptSchema, req.body ?? {});
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));

    if (receipt.status === "void") {
      throw conflict("This receipt has already been voided.", "ALREADY_VOID");
    }

    const updated = await prisma.receipt.update({
      where: { id: receipt.id, business_id: businessId },
      data: {
        status: "void",
        voided_at: new Date(),
        void_reason: input.reason ?? null,
      },
      include: RECEIPT_INCLUDE,
    });

    res.json(await toReceiptDTO(updated));
  }),
);

/**
 * Corrections never edit a receipt in place: the original is voided and a
 * fresh one is issued with a new number, linked back to the original.
 */
receiptRouter.post(
  "/:id/reissue",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(reissueReceiptSchema, req.body ?? {});
    const original = await loadReceipt(businessId, pathParam(req, "id"));

    const reissued = await prisma.$transaction(async (tx) => {
      if (original.status !== "void") {
        await tx.receipt.update({
          where: { id: original.id, business_id: businessId },
          data: {
            status: "void",
            voided_at: new Date(),
            void_reason: input.reason ?? "Superseded by reissue",
          },
        });
      }

      const receipt_number = await nextReceiptNumber(tx, businessId);

      return tx.receipt.create({
        data: {
          business_id: businessId,
          customer_id: original.customer_id,
          receipt_number,
          issue_date: original.issue_date,
          subtotal: original.subtotal,
          discount: original.discount,
          tax: original.tax,
          tax_rate: original.tax_rate,
          total: original.total,
          paid_amount: original.paid_amount,
          payment_method: original.payment_method,
          payment_status: original.payment_status,
          notes: original.notes,
          original_receipt_id: original.id,
          created_by: req.auth!.userId,
          items: {
            create: original.items.map((item) => ({
              position: item.position,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: item.line_total,
            })),
          },
        },
        include: RECEIPT_INCLUDE,
      });
    });

    res.status(201).json(await toReceiptDTO(reissued));
  }),
);

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

receiptRouter.post(
  "/:id/share",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(shareReceiptSchema, req.body ?? {});
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));

    const { token, expiresAt } = signShareToken(receipt.id, input.ttl_seconds);

    res.json({
      token,
      url: absoluteUrl(req, `/api/public/r/${token}/document`),
      expires_at: expiresAt.toISOString(),
    });
  }),
);

receiptRouter.post(
  "/:id/email",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(emailReceiptSchema, req.body);
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));
    const business = await loadBusinessFor(businessId);

    const { token, expiresAt } = signShareToken(receipt.id);
    const viewUrl = absoluteUrl(req, `/api/public/r/${token}/document`);

    // Attach the branded PDF so the recipient gets the document itself.
    const { buffer } = await ensurePdf(receipt, businessId);

    const subject = `Receipt ${receipt.receipt_number} from ${business.name}`;
    const text = [
      `Hello,`,
      ``,
      `Please find your receipt ${receipt.receipt_number} from ${business.name}.`,
      ``,
      `Total: ${Number(receipt.total)} ${business.currency}`,
      `Issued: ${receipt.issue_date.toDateString()}`,
      ``,
      `View online: ${viewUrl}`,
      `This link expires on ${expiresAt.toUTCString()}.`,
      ``,
      `Thank you for your business.`,
    ].join("\n");

    const result = await getMailer().send({
      to: input.to,
      subject,
      text,
      html: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>"),
    });

    res.json({
      ...result,
      to: input.to,
      view_url: viewUrl,
      expires_at: expiresAt.toISOString(),
      pdf_attached: buffer.length > 0,
    });
  }),
);

receiptRouter.get(
  "/:id/share",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const receipt = await loadReceipt(businessId, pathParam(req, "id"));
    const ttl = Number(req.query.ttl ?? env.shareTtlSeconds) || env.shareTtlSeconds;
    const { token, expiresAt } = signShareToken(receipt.id, ttl);
    res.json({
      token,
      url: absoluteUrl(req, `/api/public/r/${token}/document`),
      expires_at: expiresAt.toISOString(),
    });
  }),
);

export type { ReceiptDTO };
