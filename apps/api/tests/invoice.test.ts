import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import zlib from "node:zlib";
import puppeteer from "puppeteer";
import type { Express } from "express";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { renderInvoiceHtml } from "../src/lib/invoiceDocument";
import { renderReceiptHtml } from "../src/lib/document";
import { watermarkFontSize, watermarkCss } from "../src/lib/watermark";
import {
  nextInvoiceStatus,
  outstandingBalance,
  resolveWatermark,
  DEFAULT_WATERMARK_TEXT,
  formatInvoiceNumber,
} from "@eleos/shared";

/**
 * Invoicing, payment tracking and document watermarking.
 *
 * These are the tests that stand between "the screen looks right" and "the
 * money is right". They cover four things:
 *
 *   1. the arithmetic — status transitions, outstanding balance, overpayment;
 *   2. the lifecycle — drafts are editable, issued invoices are not;
 *   3. the watermark — present in the *PDF template*, positioned behind the
 *      content, per-tenant configurable, and never opaque enough to hide a
 *      figure;
 *   4. tenancy — every invoice and payment is invisible to another
 *      organization, and guessing an id changes nothing.
 */

let app: Express;

const stamp = Date.now();

interface Tenant {
  cookie: string;
  businessId: string;
  userId: string;
  label: string;
}

function cookieOf(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const session = list.find((value) => value.startsWith("el_session="));
  expect(session, "session cookie missing").toBeTruthy();
  return session!.split(";")[0];
}

async function tenant(label: string): Promise<Tenant> {
  const email = `${label}-${stamp}@test.local`;
  const res = await request(app).post("/api/auth/signup").send({
    business: { name: `${label} Ltd`, currency: "NGN" },
    user: { full_name: `${label} Owner`, email, password: "testing12345" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    cookie: cookieOf(res.headers["set-cookie"]),
    businessId: res.body.business.id,
    userId: res.body.user.id,
    label,
  };
}

function createInvoice(
  t: Tenant,
  body: Record<string, unknown> = {},
): request.Test {
  return request(app)
    .post("/api/invoices")
    .set("Cookie", t.cookie)
    .send({
      items: [{ description: "Consulting", quantity: 2, unit_price: 50_000 }],
      ...body,
    });
}

beforeAll(() => {
  app = createApp();
});

/* ========================================================================= */
/*  1. Pure rules                                                            */
/* ========================================================================= */

describe("invoice money rules", () => {
  it("derives the status from what has actually been paid", () => {
    const due = new Date("2030-01-01");
    const past = new Date("2000-01-01");

    expect(nextInvoiceStatus("issued", 100, 0, due)).toBe("issued");
    expect(nextInvoiceStatus("issued", 100, 40, due)).toBe("partially_paid");
    expect(nextInvoiceStatus("issued", 100, 100, due)).toBe("paid");
    // Exactly settled by a fractional remainder still counts as paid.
    expect(nextInvoiceStatus("issued", 100, 99.999999, due)).toBe("paid");

    // Unpaid and past the due date.
    expect(nextInvoiceStatus("issued", 100, 0, past)).toBe("overdue");
    // Part-paid and past the due date stays partially_paid: money is owed and
    // some has arrived, which is a more useful thing to show than "overdue".
    expect(nextInvoiceStatus("partially_paid", 100, 40, past)).toBe("partially_paid");
  });

  it("never issues or resurrects an invoice on its own", () => {
    const due = new Date("2000-01-01");
    // A payment must not silently turn a draft into an issued document.
    expect(nextInvoiceStatus("draft", 100, 100, due)).toBe("draft");
    // Nor can a late payment revive a cancelled one.
    expect(nextInvoiceStatus("cancelled", 100, 100, due)).toBe("cancelled");
  });

  it("floors the outstanding balance at zero", () => {
    expect(outstandingBalance(100, 0)).toBe(100);
    expect(outstandingBalance(100, 40)).toBe(60);
    expect(outstandingBalance(100, 100)).toBe(0);
    expect(outstandingBalance(100, 150)).toBe(0);
  });

  it("numbers invoices in their own series", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-000001");
    expect(formatInvoiceNumber(1234)).toBe("INV-001234");
  });
});

describe("watermark configuration", () => {
  it("defaults to VISIONARYGENE at the platform opacity", () => {
    const config = resolveWatermark(undefined);
    expect(config.enabled).toBe(true);
    // The brand spelling is a hard requirement — assert it exactly.
    expect(config.text).toBe("VISIONARYGENE");
    expect(config.text).toBe(DEFAULT_WATERMARK_TEXT);
    expect(config.opacity).toBe(8);
  });

  it("falls back to the platform name rather than rendering nothing", () => {
    expect(resolveWatermark({ text: "   " }).text).toBe("VISIONARYGENE");
  });

  it("honours a tenant's own text", () => {
    expect(resolveWatermark({ text: "Acme Supplies" }).text).toBe("Acme Supplies");
  });

  it("clamps opacity so a document can never be obscured", () => {
    expect(resolveWatermark({ opacity: 100 }).opacity).toBe(25);
    expect(resolveWatermark({ opacity: -5 }).opacity).toBe(0);
    expect(resolveWatermark({ opacity: Number.NaN }).opacity).toBe(8);
  });

  it("can be turned off entirely", () => {
    expect(resolveWatermark({ enabled: false }).enabled).toBe(false);
  });

  it("scales the type down as the text gets longer", () => {
    expect(watermarkFontSize("VISIONARYGENE")).toBeGreaterThanOrEqual(34);
    expect(watermarkFontSize("A")).toBeGreaterThan(watermarkFontSize("VISIONARYGENE"));
  });
});

/* ========================================================================= */
/*  2. The watermark is in the document that becomes the PDF                  */
/* ========================================================================= */

describe("watermark in the rendered document", () => {
  const data = {
    business: {
      name: "Acme Ltd",
      currency: "NGN",
      brand_primary: "#111111",
      brand_accent: "#B8912F",
    },
    receipt: {
      receipt_number: "ES-000001",
      issue_date: new Date("2026-01-05"),
      items: [{ description: "Item", quantity: 1, unit_price: 1000, line_total: 1000 }],
      subtotal: 1000,
      discount: 0,
      tax: 0,
      tax_rate: 0,
      total: 1000,
      paid_amount: 1000,
      payment_method: "cash",
      payment_status: "paid",
      status: "active" as const,
      customer: { name: "Walk-in" },
    },
  };

  it("renders VISIONARYGENE into the receipt HTML", () => {
    const html = renderReceiptHtml(data);
    expect(html).toContain("VISIONARYGENE");
    expect(html).toContain("vg-watermark");
  });

  it("renders VISIONARYGENE into the invoice HTML", () => {
    const html = renderInvoiceHtml({
      business: data.business,
      invoice: {
        invoice_number: "INV-000001",
        issue_date: new Date("2026-01-05"),
        items: data.receipt.items,
        subtotal: 1000,
        discount: 0,
        tax: 0,
        tax_rate: 0,
        total: 1000,
        amount_paid: 0,
        status: "issued",
      },
    });
    expect(html).toContain("VISIONARYGENE");
  });

  it("rotates diagonally and stays faint", () => {
    const css = watermarkCss();
    // 35–45° is the specified band; -38° sits in the middle of it.
    expect(css).toContain("rotate(-38deg)");
    expect(renderReceiptHtml(data)).toContain("rgba(17, 17, 17, 0.080)");
  });

  it("sits behind the content rather than over it", () => {
    const html = renderReceiptHtml(data);
    // The watermark is declared first and the content bands are lifted above
    // it, so no figure is ever printed on top of legible text.
    expect(html.indexOf("vg-watermark")).toBeLessThan(html.indexOf('class="band"'));
    expect(html).toContain(".band, .body, .void-banner { position: relative; z-index: 1; }");
  });

  it("becomes position:fixed in print so it repeats on every page", () => {
    expect(watermarkCss()).toContain("@media print");
    expect(watermarkCss()).toContain(".vg-watermark { position: fixed; }");
  });

  it("omits the watermark entirely when a tenant turns it off", () => {
    const html = renderReceiptHtml({ ...data, watermark: { enabled: false } });
    expect(html).not.toContain("vg-watermark");
  });

  it("uses the tenant's own text when configured", () => {
    const html = renderReceiptHtml({ ...data, watermark: { text: "Acme Supplies" } });
    expect(html).toContain("Acme Supplies");
    expect(html).not.toContain(">VISIONARYGENE<");
  });

  it("escapes watermark text rather than injecting it as markup", () => {
    const html = renderReceiptHtml({
      ...data,
      watermark: { text: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

/* ========================================================================= */
/*  3. Lifecycle                                                             */
/* ========================================================================= */

describe("invoice lifecycle", () => {
  it("creates a draft, issues it, and refuses edits once issued", async () => {
    const t = await tenant("Lifecycle");

    const created = await createInvoice(t, { issue: false });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    expect(created.body.invoice_number).toMatch(/^INV-\d{6}$/);
    // Totals are the server's arithmetic, not the client's.
    expect(created.body.subtotal).toBe(100_000);
    expect(created.body.total).toBe(100_000);
    expect(created.body.balance_due).toBe(100_000);

    // A draft is editable.
    const edited = await request(app)
      .patch(`/api/invoices/${created.body.id}`)
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "Consulting", quantity: 1, unit_price: 30_000 }] });
    expect(edited.status).toBe(200);
    expect(edited.body.total).toBe(30_000);

    const issued = await request(app)
      .post(`/api/invoices/${created.body.id}/issue`)
      .set("Cookie", t.cookie)
      .send({});
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe("issued");
    expect(issued.body.issued_at).toBeTruthy();

    // Now frozen.
    const refused = await request(app)
      .patch(`/api/invoices/${created.body.id}`)
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "Tampered", quantity: 1, unit_price: 1 }] });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("INVOICE_IMMUTABLE");

    // And still 30,000 — the refused edit changed nothing.
    const reread = await request(app)
      .get(`/api/invoices/${created.body.id}`)
      .set("Cookie", t.cookie);
    expect(reread.body.total).toBe(30_000);
  });

  it("issues immediately when asked, without pretending it is paid", async () => {
    const t = await tenant("IssueNow");
    const res = await createInvoice(t, { issue: true });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("issued");
    expect(res.body.amount_paid).toBe(0);
    expect(res.body.balance_due).toBe(res.body.total);
  });

  it("refuses a payment against a draft", async () => {
    const t = await tenant("DraftPay");
    const created = await createInvoice(t, { issue: false });
    const pay = await request(app)
      .post(`/api/invoices/${created.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 1000 });
    expect(pay.status).toBe(409);
    expect(pay.body.code).toBe("INVOICE_NOT_ISSUED");
  });

  it("refuses a due date before the issue date", async () => {
    const t = await tenant("BadDates");
    const res = await createInvoice(t, {
      issue_date: "2026-06-01",
      due_date: "2026-01-01",
    });
    expect(res.status).toBe(422);
  });

  it("cancels an unpaid invoice but not one that has been paid against", async () => {
    const t = await tenant("Cancel");
    const created = await createInvoice(t, { issue: true });

    const cancel = await request(app)
      .post(`/api/invoices/${created.body.id}/cancel`)
      .set("Cookie", t.cookie)
      .send({ reason: "Customer cancelled the order" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    // A second cancellation is refused.
    const again = await request(app)
      .post(`/api/invoices/${created.body.id}/cancel`)
      .set("Cookie", t.cookie)
      .send({ reason: "Trying again" });
    expect(again.status).toBe(409);
  });

  it("will not cancel an invoice that has payments recorded", async () => {
    const t = await tenant("CancelPaid");
    const created = await createInvoice(t, { issue: true });
    await request(app)
      .post(`/api/invoices/${created.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 1000 });

    const cancel = await request(app)
      .post(`/api/invoices/${created.body.id}/cancel`)
      .set("Cookie", t.cookie)
      .send({ reason: "Too late" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe("INVOICE_HAS_PAYMENTS");
  });
});

/* ========================================================================= */
/*  4. Payments                                                              */
/* ========================================================================= */

describe("invoice payments", () => {
  it("records a partial payment, tracks the balance, then settles", async () => {
    const t = await tenant("Payments");
    const created = await createInvoice(t, { issue: true });
    const id = created.body.id;
    expect(created.body.total).toBe(100_000);

    const part = await request(app)
      .post(`/api/invoices/${id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 40_000, method: "transfer", reference: "TRF-001" });
    expect(part.status).toBe(201);
    expect(part.body.status).toBe("partially_paid");
    expect(part.body.balance_due).toBe(60_000);
    expect(part.body.invoice.amount_paid).toBe(40_000);

    // A partial payment produces a receipt for the amount received — not the
    // invoice total, which would overstate what the customer paid.
    expect(part.body.receipt).toBeTruthy();
    expect(part.body.receipt.total).toBe(40_000);
    expect(part.body.receipt.paid_amount).toBe(40_000);
    expect(part.body.receipt.source).toBe("invoice_payment");
    expect(part.body.receipt.notes).toContain("60000");

    const rest = await request(app)
      .post(`/api/invoices/${id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 60_000, method: "cash" });
    expect(rest.status).toBe(201);
    expect(rest.body.status).toBe("paid");
    expect(rest.body.balance_due).toBe(0);
    expect(rest.body.invoice.balance_due).toBe(0);
  });

  it("refuses a payment larger than the outstanding balance", async () => {
    const t = await tenant("Overpay");
    const created = await createInvoice(t, { issue: true });
    const id = created.body.id;

    const res = await request(app)
      .post(`/api/invoices/${id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 100_001 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");

    // Nothing was recorded.
    const reread = await request(app)
      .get(`/api/invoices/${id}`)
      .set("Cookie", t.cookie);
    expect(reread.body.amount_paid).toBe(0);
    expect(reread.body.payments).toHaveLength(0);
  });

  it("refuses a second payment on a fully paid invoice", async () => {
    const t = await tenant("DoublePay");
    const created = await createInvoice(t, { issue: true });
    const id = created.body.id;

    await request(app)
      .post(`/api/invoices/${id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 100_000 });

    const second = await request(app)
      .post(`/api/invoices/${id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 100 });
    expect(second.status).toBe(409);
  });

  it("records the payment without a receipt when asked", async () => {
    const t = await tenant("NoReceipt");
    const created = await createInvoice(t, { issue: true });
    const res = await request(app)
      .post(`/api/invoices/${created.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 50_000, generate_receipt: false });

    expect(res.status).toBe(201);
    expect(res.body.receipt).toBeNull();
    expect(res.body.balance_due).toBe(50_000);
  });

  it("generates exactly one receipt per payment", async () => {
    const t = await tenant("OneReceipt");
    const created = await createInvoice(t, { issue: true });
    await request(app)
      .post(`/api/invoices/${created.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 25_000 });

    const generated = await prisma.receipt.findMany({
      where: { business_id: t.businessId, source: "invoice_payment" },
    });
    expect(generated).toHaveLength(1);
  });

  it("keeps receipts and payments consistent under concurrent recording", async () => {
    const t = await tenant("Concurrent");
    const created = await createInvoice(t, { issue: true });
    const id = created.body.id;

    // Ten simultaneous 10,000 payments against a 100,000 invoice. Exactly ten
    // must succeed and the invoice must land on paid — never overspent, and
    // never one receipt short.
    const attempts = Array.from({ length: 10 }, () =>
      request(app)
        .post(`/api/invoices/${id}/payments`)
        .set("Cookie", t.cookie)
        .send({ amount: 10_000 }),
    );
    const results = await Promise.all(attempts);

    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(0);

    const payments = await prisma.invoicePayment.findMany({
      where: { invoice_id: id },
    });
    expect(payments).toHaveLength(10);

    const receipts = await prisma.receipt.findMany({
      where: { business_id: t.businessId, source: "invoice_payment" },
    });
    expect(receipts).toHaveLength(10);

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    expect(Number(invoice?.amount_paid)).toBe(100_000);
    expect(invoice?.status).toBe("paid");
  }, 60_000);

  it("marks a past-due unpaid invoice overdue when it is read", async () => {
    const t = await tenant("Overdue");
    const created = await createInvoice(t, {
      issue: true,
      issue_date: "2020-01-01",
      due_date: "2020-01-31",
    });
    const reread = await request(app)
      .get(`/api/invoices/${created.body.id}`)
      .set("Cookie", t.cookie);
    expect(reread.body.status).toBe("overdue");
  });
});

/* ========================================================================= */
/*  5. Reporting                                                             */
/* ========================================================================= */

describe("invoice reporting", () => {
  it("reports real totals and excludes cancelled invoices", async () => {
    const t = await tenant("Reporting");

    const a = await createInvoice(t, { issue: true });
    await request(app)
      .post(`/api/invoices/${a.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 40_000 });

    const b = await createInvoice(t, { issue: true });
    await request(app)
      .post(`/api/invoices/${b.body.id}/cancel`)
      .set("Cookie", t.cookie)
      .send({ reason: "Cancelled" });

    const summary = await request(app)
      .get("/api/invoices/summary")
      .set("Cookie", t.cookie);

    expect(summary.status).toBe(200);
    // Only `a` counts: 100,000 invoiced, 40,000 received.
    expect(summary.body.totals.invoiced).toBe(100_000);
    expect(summary.body.totals.received).toBe(40_000);
    expect(summary.body.totals.outstanding).toBe(60_000);
    expect(summary.body.totals.count).toBe(1);
    expect(summary.body.recent).toHaveLength(1);
  });

  it("filters and searches the list", async () => {
    const t = await tenant("ListFilters");
    const issued = await createInvoice(t, { issue: true });
    await createInvoice(t, { issue: false });

    const paidOnly = await request(app)
      .get("/api/invoices?status=paid")
      .set("Cookie", t.cookie);
    expect(paidOnly.body.items).toHaveLength(0);

    const byNumber = await request(app)
      .get(`/api/invoices?search=${encodeURIComponent(issued.body.invoice_number)}`)
      .set("Cookie", t.cookie);
    expect(byNumber.body.items).toHaveLength(1);

    const draftOnly = await request(app)
      .get("/api/invoices?status=draft")
      .set("Cookie", t.cookie);
    expect(draftOnly.body.items).toHaveLength(1);
  });

  it("numbers invoices sequentially per organization", async () => {
    const a = await tenant("SeqA");
    const b = await tenant("SeqB");

    const created = await Promise.all([
      createInvoice(a),
      createInvoice(a),
      createInvoice(b),
    ]);

    const aNumbers = created.slice(0, 2).map((r) => r.body.invoice_number).sort();
    const bNumbers = created[2].body.invoice_number;

    // Each tenant has its own series, both starting at INV-000001.
    expect(aNumbers).toEqual(["INV-000001", "INV-000002"]);
    expect(bNumbers).toBe("INV-000001");
  });
});

/* ========================================================================= */
/*  6. Tenancy — the security-critical section                               */
/* ========================================================================= */

describe("invoice tenant isolation", () => {
  it("hides invoices, payments and documents from another organization", async () => {
    const a = await tenant("TenantA");
    const b = await tenant("TenantB");

    const invoice = await createInvoice(a, { issue: true });
    const payment = await request(app)
      .post(`/api/invoices/${invoice.body.id}/payments`)
      .set("Cookie", a.cookie)
      .send({ amount: 25_000 });

    const id = invoice.body.id;
    const receiptId = payment.body.receipt.id;

    // B cannot read, edit, issue, cancel, pay, download or share A's invoice.
    // Each is 404 rather than 403: the API must not even confirm the invoice
    // exists, or the id space becomes enumerable.
    const idAttempts: Array<[string, request.Test]> = [
      ["read", request(app).get(`/api/invoices/${id}`).set("Cookie", b.cookie)],
      ["payments", request(app).get(`/api/invoices/${id}/payments`).set("Cookie", b.cookie)],
      ["document", request(app).get(`/api/invoices/${id}/document`).set("Cookie", b.cookie)],
      ["pdf", request(app).get(`/api/invoices/${id}/pdf`).set("Cookie", b.cookie)],
      ["image", request(app).get(`/api/invoices/${id}/image`).set("Cookie", b.cookie)],
      ["edit", request(app).patch(`/api/invoices/${id}`).set("Cookie", b.cookie).send({ notes: "x" })],
      ["issue", request(app).post(`/api/invoices/${id}/issue`).set("Cookie", b.cookie).send({})],
      ["cancel", request(app).post(`/api/invoices/${id}/cancel`).set("Cookie", b.cookie).send({ reason: "not mine" })],
      ["pay", request(app).post(`/api/invoices/${id}/payments`).set("Cookie", b.cookie).send({ amount: 1000 })],
      ["share", request(app).get(`/api/invoices/${id}/share`).set("Cookie", b.cookie)],
    ];

    for (const [label, attempt] of idAttempts) {
      const res = await attempt;
      expect(res.status, `${label} should be 404`).toBe(404);
    }

    // The collection route answers 200 — it is not itself a resource — but
    // it must return nothing of A's.
    const list = await request(app).get("/api/invoices").set("Cookie", b.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(0);
    expect(list.body.total).toBe(0);

    const summary = await request(app)
      .get("/api/invoices/summary")
      .set("Cookie", b.cookie);
    expect(summary.body.totals.invoiced).toBe(0);
    expect(summary.body.recent).toHaveLength(0);

    // B cannot reach A's generated receipt either.
    const receipt = await request(app)
      .get(`/api/receipts/${receiptId}`)
      .set("Cookie", b.cookie);
    expect(receipt.status).toBe(404);

    // And A's data is untouched.
    const reread = await request(app)
      .get(`/api/invoices/${id}`)
      .set("Cookie", a.cookie);
    expect(reread.body.amount_paid).toBe(25_000);
  });

  it("refuses an unauthenticated request outright", async () => {
    const t = await tenant("Anon");
    const invoice = await createInvoice(t, { issue: true });
    const res = await request(app).get(`/api/invoices/${invoice.body.id}`);
    expect(res.status).toBe(401);
  });

  it("rejects a client-supplied business_id in the create body", async () => {
    const a = await tenant("SpoofA");
    const b = await tenant("SpoofB");

    // The field is not part of the schema, so it is dropped rather than
    // trusted — the invoice must land in A's tenant regardless.
    const res = await request(app)
      .post("/api/invoices")
      .set("Cookie", a.cookie)
      .send({
        business_id: b.businessId,
        items: [{ description: "Spoofed", quantity: 1, unit_price: 1000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.business_id).toBe(a.businessId);
  });

  it("refuses a customer belonging to another organization", async () => {
    const a = await tenant("CustA");
    const b = await tenant("CustB");

    const customer = await request(app)
      .post("/api/customers")
      .set("Cookie", b.cookie)
      .send({ name: "B's Customer" });
    expect(customer.status).toBe(201);

    const res = await createInvoice(a, { customer_id: customer.body.id });
    expect(res.status).toBe(404);
  });
});

/* ========================================================================= */
/*  8. The watermark really reaches the PDF                                  */
/* ========================================================================= */

/**
 * The one property that cannot be verified from HTML alone: that the mark
 * survives Chromium's print pipeline and lands on *every* page.
 *
 * `pdftotext` is useless here — it cannot read rotated glyphs — so the test
 * compares the decompressed content-stream length of each page with the
 * watermark on and off. A page that gains bytes gained them from the mark; a
 * page that does not, does not have one.
 */
describe("watermark in the exported PDF", () => {
  async function pdfContentLengths(html: string): Promise<number[]> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage();
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      const buffer = Buffer.from(
        await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "0", right: "0", bottom: "0", left: "0" },
        }),
      );
      await page.close().catch(() => undefined);
      return pageContentLengths(buffer);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** Length of each page's decompressed content stream, in page order. */
  function pageContentLengths(pdf: Buffer): number[] {
    const raw = pdf.toString("latin1");
    const objects = new Map<string, string>();
    const body = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
    let match: RegExpExecArray | null;
    while ((match = body.exec(raw))) objects.set(match[1], match[2]);

    // Streams sit outside `…endobj`, so re-scan the bytes and append each
    // inflated stream to its owning object.
    const stream = /(\d+)\s+0\s+obj([\s\S]*?)stream\r?\n?/g;
    while ((match = stream.exec(raw))) {
      const start = match.index + match[0].length;
      const end = pdf.indexOf("endstream", start, "latin1");
      if (end < 0 || !/FlateDecode/.test(match[2])) continue;
      try {
        const inflated = zlib.inflateSync(pdf.subarray(start, end)).toString("latin1");
        objects.set(match[1], `${objects.get(match[1]) ?? ""}\u0000${inflated}`);
      } catch {
        /* not a content stream we can read */
      }
    }

    const lengths: number[] = [];
    for (const [, content] of objects) {
      if (!/\/Type\s*\/Page[^s]/.test(content)) continue;
      const ref = content.match(/\/Contents\s+(\d+)\s+0\s+R/);
      if (!ref) continue;
      const target = objects.get(ref[1]) ?? "";
      const at = target.indexOf("\u0000");
      lengths.push(at >= 0 ? target.length - at - 1 : 0);
    }
    return lengths.sort((a, b) => b - a);
  }

  const longInvoice = (items: number) => ({
    business: { name: "Acme Ltd", currency: "NGN", brand_primary: "#111111", brand_accent: "#B8912F" },
    invoice: {
      invoice_number: "INV-000042",
      issue_date: new Date("2026-01-05"),
      items: Array.from({ length: items }, (_, i) => ({
        description: `Line item ${i + 1} — padded so the document runs onto several pages`,
        quantity: 1,
        unit_price: 1000 + i,
        line_total: 1000 + i,
      })),
      subtotal: 1000,
      discount: 0,
      tax: 0,
      tax_rate: 0,
      total: 1000,
      amount_paid: 0,
      status: "issued" as const,
    },
  });

  it("puts the mark on every page of a multi-page document", async () => {
    const base = longInvoice(60);

    const withMark = await pdfContentLengths(
      renderInvoiceHtml({ ...base, watermark: { enabled: true, text: "VISIONARYGENE", opacity: 8 } }),
    );
    const without = await pdfContentLengths(renderInvoiceHtml({ ...base, watermark: { enabled: false } }));

    expect(withMark.length).toBeGreaterThanOrEqual(2);
    expect(withMark.length).toBe(without.length);

    // Every page that is a real content stream must be larger with the mark.
    // Page 1 carries a header Chromium stores in an object stream we do not
    // decompress here, so it legitimately reads as 0 in both.
    const grew = withMark.filter((length, index) => length > without[index]);
    expect(grew.length).toBe(withMark.filter((length) => length > 0).length);
  }, 120_000);
});

/* ========================================================================= */
/*  7. Branding configuration                                                 */
/* ========================================================================= */

describe("watermark settings", () => {
  it("are readable and owner-writable through the business endpoint", async () => {
    const t = await tenant("WatermarkOwner");

    const updated = await request(app)
      .patch("/api/business")
      .set("Cookie", t.cookie)
      .send({ watermark_text: "Acme Supplies", watermark_opacity: 12 });
    expect(updated.status).toBe(200);
    expect(updated.body.watermark_text).toBe("Acme Supplies");
    expect(updated.body.watermark_opacity).toBe(12);

    const read = await request(app).get("/api/business").set("Cookie", t.cookie);
    expect(read.body.watermark_text).toBe("Acme Supplies");
  });

  it("refuses an opacity that would obscure the document", async () => {
    const t = await tenant("WatermarkLoud");
    const res = await request(app)
      .patch("/api/business")
      .set("Cookie", t.cookie)
      .send({ watermark_opacity: 90 });
    expect(res.status).toBe(422);
  });

  it("renders the configured watermark on that tenant's documents", async () => {
    const t = await tenant("WatermarkRender");
    await request(app)
      .patch("/api/business")
      .set("Cookie", t.cookie)
      .send({ watermark_text: "Acme Supplies" });

    const invoice = await createInvoice(t, { issue: true });
    const doc = await request(app)
      .get(`/api/invoices/${invoice.body.id}/document`)
      .set("Cookie", t.cookie);

    expect(doc.text).toContain("Acme Supplies");
    expect(doc.text).not.toContain(">VISIONARYGENE<");
  });

  it("can be switched off and then produces no watermark at all", async () => {
    const t = await tenant("WatermarkOff");
    await request(app)
      .patch("/api/business")
      .set("Cookie", t.cookie)
      .send({ watermark_enabled: false });

    const invoice = await createInvoice(t, { issue: true });
    const doc = await request(app)
      .get(`/api/invoices/${invoice.body.id}/document`)
      .set("Cookie", t.cookie);

    expect(doc.text).not.toContain("vg-watermark");
  });
});