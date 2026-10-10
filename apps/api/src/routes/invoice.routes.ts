import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  computeTotals,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoicePaymentSchema,
  invoiceShareSchema,
  invoiceUpdateSchema,
  nextInvoiceStatus,
  outstandingBalance,
  assertPaymentWithinBalance,
  type InvoiceDTO,
  type InvoiceTotals,
} from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError, conflict, notFound } from "../lib/errors";
import { asyncH, parse, pathParam } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { nextInvoiceNumber, nextReceiptNumber } from "../lib/receiptNumber";
import { ensureInvoicePdf, getOrCreateInvoicePdf } from "../lib/invoicePdfStore";
import { buildInvoiceDocumentData } from "../lib/invoiceDocumentData";
import { renderInvoiceHtml } from "../lib/invoiceDocument";
import { renderInvoicePng, documentFilename } from "../lib/imageExport";
import { signShareToken } from "../lib/tokens";
import { absoluteUrl } from "../lib/url";
import { env } from "../lib/env";
import {
  logoDataUrl,
  num,
  toInvoiceDTO,
  toInvoiceDTOWithPdf,
  toReceiptDTO,
  type InvoiceWithRelations,
} from "../mappers";

/**
 * Invoices.
 *
 * Three rules shape this whole file:
 *
 *  1. **Totals are computed here.** `subtotal`, `tax` and `total` come from
 *     `computeTotals` on the parsed input; nothing the browser sent is trusted.
 *  2. **Every query is keyed by `req.auth.businessId`.** An id from another
 *     tenant resolves to `404`, never to `403` — the API must not confirm that
 *     someone else's invoice exists.
 *  3. **A payment and its receipt are written in one transaction.** If the
 *     receipt cannot be created the payment rolls back with it, so money can
 *     never be recorded without its document and never documented twice.
 */

export const invoiceRouter = Router();

invoiceRouter.use(requireAuth);

const INVOICE_INCLUDE = {
  items: { orderBy: { position: "asc" as const } },
  payments: { orderBy: { paid_at: "asc" as const } },
  customer: true,
} as const;

async function loadInvoice(businessId: string, id: string): Promise<InvoiceWithRelations> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, business_id: businessId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) throw notFound("Invoice");
  return invoice;
}

async function loadBusiness(businessId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId } });
  if (!business) throw notFound("Business");
  return business;
}

/**
 * Bring a stored invoice's `status` back in line with its money.
 *
 * `overdue` is time-dependent: an invoice that was `issued` yesterday and is
 * past its due date today is overdue, but nothing wrote that anywhere. Every
 * read path calls this, so history, totals and the detail screen agree with
 * what the date actually says.
 *
 * A cancelled invoice is never resurrected and a draft is never auto-issued —
 * see `nextInvoiceStatus`.
 */
async function syncInvoiceStatus(invoice: InvoiceWithRelations): Promise<InvoiceWithRelations> {
  const expected = nextInvoiceStatus(
    invoice.status,
    num(invoice.total),
    num(invoice.amount_paid),
    invoice.due_date,
  );
  if (expected === invoice.status) return invoice;

  return prisma.invoice.update({
    where: { id: invoice.id, business_id: invoice.business_id },
    data: { status: expected },
    include: INVOICE_INCLUDE,
  });
}

/* ---------------------------------------------------------------------------
 * List / search
 * ------------------------------------------------------------------------ */

invoiceRouter.get(
  "/",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const q = req.query;

    const search = String(q.search ?? "").trim();
    const status = String(q.status ?? "all");
    const from = q.from ? String(q.from) : "";
    const to = q.to ? String(q.to) : "";
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25) || 25));

    const where: Prisma.InvoiceWhereInput = { business_id: businessId };

    const validStatuses = ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"];
    if (validStatuses.includes(status)) where.status = status as never;

    if (from || to) {
      where.issue_date = {
        ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
      };
    }

    if (search) {
      where.OR = [
        { invoice_number: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { items: { some: { description: { contains: search, mode: "insensitive" } } } },
        { po_reference: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Overdue is derived, so it is reconciled after the rows are read rather
    // than filtered in SQL — otherwise a query for `overdue` would silently
    // miss invoices that crossed their due date since the last write.
    const synced = await Promise.all(rows.map(syncInvoiceStatus));

    res.json({
      items: synced.map(toInvoiceDTO),
      total,
      page,
      limit,
    });
  }),
);

/** Aggregates for the invoice dashboard. Every figure is a real aggregate. */
invoiceRouter.get(
  "/summary",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const now = new Date();

    // Cancelled invoices are excluded from every figure: they are a record of
    // what was called off, not of what is owed or what was received.
    const where: Prisma.InvoiceWhereInput = { business_id: businessId, status: { not: "cancelled" } };

    const [aggregate, overdueAgg, business, recent] = await Promise.all([
      prisma.invoice.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, amount_paid: true },
      }),
      prisma.invoice.aggregate({
        where: {
          ...where,
          due_date: { lte: now },
          // Still owing: anything short of fully settled. Expressed as a NOT
          // so it does not depend on field-reference support in the aggregate.
          NOT: { amount_paid: { gte: prisma.invoice.fields.total } },
        },
        _sum: { total: true, amount_paid: true },
      }),
      prisma.business.findFirst({ where: { id: businessId }, select: { currency: true } }),
      prisma.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: { created_at: "desc" },
        take: 5,
      }),
    ]);

    const invoiced = num(aggregate._sum.total);
    const received = num(aggregate._sum.amount_paid);
    const overdueInvoiced = num(overdueAgg._sum.total);
    const overdueReceived = num(overdueAgg._sum.amount_paid);

    const totals: InvoiceTotals = {
      invoiced,
      received,
      outstanding: outstandingBalance(invoiced, received),
      overdue: outstandingBalance(overdueInvoiced, overdueReceived),
      count: aggregate._count._all,
    };

    res.json({
      currency: business?.currency ?? "NGN",
      totals,
      recent: (await Promise.all(recent.map(syncInvoiceStatus))).map(toInvoiceDTO),
    });
  }),
);

/* ---------------------------------------------------------------------------
 * Create
 * ------------------------------------------------------------------------ */

invoiceRouter.post(
  "/",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(invoiceCreateSchema, req.body);

    // Tenant check first: a customer id from another business is "not found".
    if (input.customer_id) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customer_id, business_id: businessId },
        select: { id: true },
      });
      if (!customer) throw notFound("Customer");
    }

    // Always recomputed server-side. The client's numbers are a preview.
    const totals = computeTotals(input.items, input.discount, input.tax_rate);
    const issueDate = input.issue_date ? new Date(`${input.issue_date}T00:00:00`) : new Date();
    const dueDate = input.due_date ? new Date(`${input.due_date}T00:00:00`) : null;

    const invoice = await prisma.$transaction(async (tx) => {
      const invoice_number = await nextInvoiceNumber(tx, businessId);
      const now = new Date();

      return tx.invoice.create({
        data: {
          business_id: businessId,
          customer_id: input.customer_id ?? null,
          invoice_number,
          issue_date: issueDate,
          due_date: dueDate,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          tax_rate: input.tax_rate,
          total: totals.total,
          // Issue-now invoices are `issued`, not `paid`: creating a document
          // is not the same as being paid for it.
          status: input.issue ? "issued" : "draft",
          notes: input.notes,
          terms: input.terms,
          po_reference: input.po_reference,
          issued_at: input.issue ? now : null,
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
        include: INVOICE_INCLUDE,
      });
    });

    res.status(201).json(await toInvoiceDTOWithPdf(invoice));
  }),
);

/** Live preview — the same HTML the PDF is made from, without saving. */
invoiceRouter.post(
  "/preview",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(invoiceCreateSchema, req.body);
    const business = await loadBusiness(businessId);

    let customer: { name: string; phone: string | null; email: string | null } | null = null;
    if (input.customer_id) {
      const found = await prisma.customer.findFirst({
        where: { id: input.customer_id, business_id: businessId },
      });
      if (!found) throw notFound("Customer");
      customer = { name: found.name, phone: found.phone, email: found.email };
    }

    const totals = computeTotals(input.items, input.discount, input.tax_rate);
    const logo = await logoDataUrl(business.logo_url);

    const html = renderInvoiceHtml({
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
      watermark: {
        enabled: business.watermark_enabled,
        text: business.watermark_text,
        opacity: business.watermark_opacity,
      },
      invoice: {
        // A placeholder number — a preview must not consume a real one.
        invoice_number: "INV-000000",
        issue_date: input.issue_date ? new Date(`${input.issue_date}T00:00:00`) : new Date(),
        due_date: input.due_date ? new Date(`${input.due_date}T00:00:00`) : null,
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
        amount_paid: 0,
        status: input.issue ? "issued" : "draft",
        notes: input.notes,
        terms: input.terms,
        po_reference: input.po_reference,
        customer,
      },
    });

    res.status(200).type("html").send(html);
  }),
);

/* ---------------------------------------------------------------------------
 * Read one
 * ------------------------------------------------------------------------ */

invoiceRouter.get(
  "/:id",
  asyncH(async (req, res) => {
    const invoice = await syncInvoiceStatus(
      await loadInvoice(req.auth!.businessId, pathParam(req, "id")),
    );
    res.json(await toInvoiceDTOWithPdf(invoice));
  }),
);

/** The exact HTML the invoice PDF is built from — used by the preview iframe. */
invoiceRouter.get(
  "/:id/document",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const business = await loadBusiness(businessId);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).type("html").send(renderInvoiceHtml(await buildInvoiceDocumentData(invoice, business)));
  }),
);

/* ---------------------------------------------------------------------------
 * Edit — drafts only
 * ------------------------------------------------------------------------ */

invoiceRouter.patch(
  "/:id",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(invoiceUpdateSchema, req.body);
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));

    if (invoice.status !== "draft") {
      throw conflict(
        "An issued invoice cannot be edited. Cancel it and issue a corrected one instead.",
        "INVOICE_IMMUTABLE",
      );
    }

    // Totals are recomputed from the *stored* lines merged with the patch, so
    // a partial update can never leave subtotal disagreeing with the items.
    const items =
      input.items ??
      invoice.items.map((item) => ({
        description: item.description,
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
      }));

    const discount = input.discount ?? num(invoice.discount);
    const taxRate = input.tax_rate ?? num(invoice.tax_rate);
    const totals = computeTotals(items, discount, taxRate);

    const updated = await prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.invoiceItem.deleteMany({ where: { invoice_id: invoice.id } });
        await tx.invoiceItem.createMany({
          data: items.map((item, index) => ({
            invoice_id: invoice.id,
            position: index,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: Math.round(item.quantity * item.unit_price * 100) / 100,
          })),
        });
      }

      return tx.invoice.update({
        where: { id: invoice.id, business_id: businessId },
        data: {
          ...(input.due_date !== undefined ? { due_date: input.due_date ? new Date(`${input.due_date}T00:00:00`) : null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.terms !== undefined ? { terms: input.terms } : {}),
          ...(input.po_reference !== undefined ? { po_reference: input.po_reference } : {}),
          // `items`, `total`, `subtotal`, `tax` and `tax_rate` are in the ORM
          // immutability list, so a draft edit goes through the item table
          // plus these explicitly-denormalised figures.
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          tax_rate: taxRate,
          total: totals.total,
        },
        include: INVOICE_INCLUDE,
      });
    });

    res.json(toInvoiceDTO(updated));
  }),
);

/* ---------------------------------------------------------------------------
 * Lifecycle: issue / cancel
 * ------------------------------------------------------------------------ */

invoiceRouter.post(
  "/:id/issue",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));

    if (invoice.status !== "draft") {
      throw conflict("This invoice has already been issued.", "ALREADY_ISSUED");
    }

    const now = new Date();

    /**
     * Freeze a snapshot of what the customer was told.
     *
     * An invoice outlives the settings that produced it: rename the customer,
     * change the currency, restyle the logo, and a document already in the
     * customer's inbox must not change shape underneath them. The snapshot is
     * taken at issue and is what a re-render after those edits would show.
     */
    const snapshot = {
      business_name: (await loadBusiness(businessId)).name,
      customer_name: invoice.customer?.name ?? null,
      customer_phone: invoice.customer?.phone ?? null,
      customer_email: invoice.customer?.email ?? null,
      invoice_number: invoice.invoice_number,
      issue_date: invoice.issue_date.toISOString(),
      due_date: invoice.due_date ? invoice.due_date.toISOString() : null,
      subtotal: num(invoice.subtotal),
      discount: num(invoice.discount),
      tax: num(invoice.tax),
      tax_rate: num(invoice.tax_rate),
      total: num(invoice.total),
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
        line_total: num(item.line_total),
      })),
    };

    const issued = await prisma.invoice.update({
      where: { id: invoice.id, business_id: businessId },
      data: {
        status: "issued",
        issued_at: now,
        issued_snapshot: snapshot,
      },
      include: INVOICE_INCLUDE,
    });

    res.json(await toInvoiceDTOWithPdf(issued));
  }),
);

invoiceRouter.post(
  "/:id/cancel",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(invoiceCancelSchema, req.body);
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));

    if (invoice.status === "cancelled") {
      throw conflict("This invoice has already been cancelled.", "ALREADY_CANCELLED");
    }
    if (num(invoice.amount_paid) > 0) {
      throw conflict(
        "This invoice has payments recorded against it. Void the payments first.",
        "INVOICE_HAS_PAYMENTS",
      );
    }

    const cancelled = await prisma.invoice.update({
      where: { id: invoice.id, business_id: businessId },
      data: {
        status: "cancelled",
        cancelled_at: new Date(),
        cancel_reason: input.reason,
      },
      include: INVOICE_INCLUDE,
    });

    res.json(await toInvoiceDTOWithPdf(cancelled));
  }),
);

/* ---------------------------------------------------------------------------
 * Payments
 * ------------------------------------------------------------------------ */

invoiceRouter.get(
  "/:id/payments",
  asyncH(async (req, res) => {
    const invoice = await loadInvoice(req.auth!.businessId, pathParam(req, "id"));
    res.json({
      items: invoice.payments.map((payment) => ({
        id: payment.id,
        invoice_id: payment.invoice_id,
        amount: num(payment.amount),
        paid_at: payment.paid_at.toISOString(),
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
        created_by: payment.created_by,
        created_at: payment.created_at.toISOString(),
      })),
      total: invoice.payments.length,
      balance_due: outstandingBalance(num(invoice.total), num(invoice.amount_paid)),
    });
  }),
);

/**
 * Record a payment, and generate its receipt, in one transaction.
 *
 * The order of operations inside the transaction is the whole design:
 *
 *  - the invoice row is locked (`SELECT … FOR UPDATE` via the conditional
 *    update) so two simultaneous payments cannot both read the same balance
 *    and both believe there is room;
 *  - the amount is checked against *that* balance, so an overpayment is
 *    refused rather than silently accepted;
 *  - the payment, the running `amount_paid` and the receipt are written
 *    together. If the receipt cannot be created the whole thing rolls back,
 *    so a payment can never exist without its document and a document can
 *    never exist twice — `receipts.invoice_payment_id` is UNIQUE, which is
 *    the database's own guarantee of the second half.
 *
 * The PDF is deliberately *not* part of the transaction: it is a rendering
 * artefact, not money. It is generated lazily on first download, so a slow
 * or failed render can never roll back a payment the customer already made.
 */
invoiceRouter.post(
  "/:id/payments",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const userId = req.auth!.userId;
    const input = parse(invoicePaymentSchema, req.body);

    const invoice = await loadInvoice(businessId, pathParam(req, "id"));

    if (invoice.status === "draft") {
      throw conflict(
        "Issue this invoice before recording a payment against it.",
        "INVOICE_NOT_ISSUED",
      );
    }
    if (invoice.status === "cancelled") {
      throw conflict("This invoice has been cancelled.", "INVOICE_CANCELLED");
    }
    if (invoice.status === "paid") {
      throw conflict("This invoice is already fully paid.", "INVOICE_PAID");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-read under the row lock the update takes, so the balance we check
      // against is the committed one.
      const locked = await tx.invoice.update({
        where: { id: invoice.id, business_id: businessId },
        data: { updated_at: new Date() },
        include: { customer: true },
      });

      const total = num(locked.total);
      const alreadyPaid = num(locked.amount_paid);

      const check = assertPaymentWithinBalance(input.amount, total, alreadyPaid);
      if (!check.ok) {
        throw new AppError(
          `That is more than the ${check.outstanding.toFixed(2)} still outstanding on this invoice.`,
          409,
          "PAYMENT_EXCEEDS_BALANCE",
          { outstanding: check.outstanding },
        );
      }

      const amountPaid = Math.round((alreadyPaid + input.amount) * 100) / 100;
      const paidAt = input.paid_at ? new Date(`${input.paid_at}T00:00:00`) : new Date();

      const payment = await tx.invoicePayment.create({
        data: {
          business_id: businessId,
          invoice_id: invoice.id,
          amount: input.amount,
          paid_at: paidAt,
          method: input.method as never,
          reference: input.reference,
          notes: input.notes,
          created_by: userId,
        },
      });

      // A receipt acknowledges *this payment*, so its total is the amount
      // received — not the invoice total. A partial payment therefore yields
      // a receipt for the part that actually arrived.
      let receiptId: string | null = null;
      if (input.generate_receipt) {
        const balanceAfter = outstandingBalance(total, amountPaid);
        const receiptNumber = await nextReceiptNumber(tx, businessId);

        const receipt = await tx.receipt.create({
          data: {
            business_id: businessId,
            customer_id: locked.customer_id,
            receipt_number: receiptNumber,
            source: "invoice_payment",
            invoice_payment_id: payment.id,
            issue_date: paidAt,
            subtotal: input.amount,
            discount: 0,
            tax: 0,
            tax_rate: 0,
            total: input.amount,
            paid_amount: input.amount,
            payment_method: input.method as never,
            payment_status: balanceAfter <= 0 ? "paid" : "partial",
            notes: [
              `Payment for invoice ${locked.invoice_number}`,
              input.reference ? `Reference: ${input.reference}` : null,
              balanceAfter > 0 ? `Balance remaining: ${balanceAfter.toFixed(2)}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            created_by: userId,
            items: {
              create: [
                {
                  position: 0,
                  description: `Payment against invoice ${locked.invoice_number}`,
                  quantity: 1,
                  unit_price: input.amount,
                  line_total: input.amount,
                },
              ],
            },
          },
        });
        receiptId = receipt.id;
      }

      const status = nextInvoiceStatus(
        locked.status,
        total,
        amountPaid,
        locked.due_date,
      );

      await tx.invoice.update({
        where: { id: locked.id, business_id: businessId },
        data: { amount_paid: amountPaid, status },
      });

      return { payment, receiptId, amountPaid, balanceAfter: outstandingBalance(total, amountPaid), status };
    });

    const refreshed = await loadInvoice(businessId, invoice.id);

    let receipt = null;
    if (result.receiptId) {
      const found = await prisma.receipt.findFirst({
        where: { id: result.receiptId, business_id: businessId },
        include: { items: { orderBy: { position: "asc" } }, customer: true },
      });
      if (found) receipt = await toReceiptDTO(found);
    }

    res.status(201).json({
      payment: {
        id: result.payment.id,
        invoice_id: result.payment.invoice_id,
        amount: num(result.payment.amount),
        paid_at: result.payment.paid_at.toISOString(),
        method: result.payment.method,
        reference: result.payment.reference,
        notes: result.payment.notes,
        receipt_id: result.receiptId,
        created_by: result.payment.created_by,
        created_at: result.payment.created_at.toISOString(),
      },
      receipt,
      invoice: await toInvoiceDTOWithPdf(refreshed),
      balance_due: result.balanceAfter,
      status: result.status,
    });
  }),
);

/* ---------------------------------------------------------------------------
 * Documents: PDF and PNG
 * ------------------------------------------------------------------------ */

invoiceRouter.get(
  "/:id/pdf",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const business = await loadBusiness(businessId);

    const buffer = await getOrCreateInvoicePdf(invoice, business);
    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${documentFilename("invoice", invoice.invoice_number, "pdf")}"`,
      )
      .setHeader("Cache-Control", "private, max-age=0, must-revalidate")
      .send(buffer);
  }),
);

/** High-quality PNG of the same document the PDF is built from. */
invoiceRouter.get(
  "/:id/image",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const business = await loadBusiness(businessId);

    const buffer = await renderInvoicePng(await buildInvoiceDocumentData(invoice, business));

    res
      .status(200)
      .setHeader("Content-Type", "image/png")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${documentFilename("invoice", invoice.invoice_number, "png")}"`,
      )
      .setHeader("Cache-Control", "private, max-age=0, must-revalidate")
      .send(buffer);
  }),
);

/** Ensure the PDF exists and hand back the refreshed invoice. */
invoiceRouter.post(
  "/:id/generate-pdf",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const business = await loadBusiness(businessId);
    await ensureInvoicePdf(invoice, business);
    res.json(await toInvoiceDTOWithPdf(await loadInvoice(businessId, invoice.id)));
  }),
);

/* ---------------------------------------------------------------------------
 * Share — an expiring capability URL, never a predictable path
 * ------------------------------------------------------------------------ */

invoiceRouter.get(
  "/:id/share",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const ttl = Number(req.query.ttl ?? env.shareTtlSeconds) || env.shareTtlSeconds;
    const { token, expiresAt } = signShareToken(invoice.id, ttl);
    res.json({
      token,
      url: absoluteUrl(req, `/api/public/invoices/${token}/document`),
      expires_at: expiresAt.toISOString(),
    });
  }),
);

invoiceRouter.post(
  "/:id/share",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const input = parse(invoiceShareSchema, req.body ?? {});
    const invoice = await loadInvoice(businessId, pathParam(req, "id"));
    const { token, expiresAt } = signShareToken(invoice.id, input.ttl_seconds);
    res.json({
      token,
      url: absoluteUrl(req, `/api/public/invoices/${token}/document`),
      expires_at: expiresAt.toISOString(),
    });
  }),
);

export type { InvoiceDTO };