import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { signShareToken, verifyShareToken } from "../src/lib/tokens";
import { computeTotals } from "@eleos/shared";

/**
 * Business-rule tests.
 *
 * These cover the five rules the system is built around:
 *   1. every query is scoped to a business
 *   2. issued receipts are immutable (void + reissue only)
 *   3. receipt numbers are unique and sequential per business
 *   4. share links cannot be forged or guessed
 *   5. totals are always computed server-side
 */

let app: Express;

const stamp = Date.now();

interface Tenant {
  cookie: string;
  businessId: string;
  userId: string;
  prefix: string;
}

async function createTenant(label: string, prefix: string): Promise<Tenant> {
  const email = `${label}-${stamp}@test.local`;
  const password = "testing12345";

  const signup = await request(app).post("/api/auth/signup").send({
    business: { name: `${label} Ltd`, currency: "NGN", number_prefix: prefix },
    user: { full_name: `${label} Owner`, email, password },
  });

  expect(signup.status, JSON.stringify(signup.body)).toBe(201);

  const cookie = extractCookie(signup.headers["set-cookie"]);
  return { cookie, businessId: signup.body.business.id, userId: signup.body.user.id, prefix };
}

function extractCookie(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const session = list.find((value) => value.startsWith("el_session="));
  expect(session, "session cookie missing").toBeTruthy();
  return session!.split(";")[0];
}

const VALID_ITEM = { description: "Silk scarf", quantity: 2, unit_price: 1500 };

async function createReceipt(tenant: Tenant, overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post("/api/receipts")
    .set("Cookie", tenant.cookie)
    .send({
      items: [VALID_ITEM],
      discount: 0,
      tax_rate: 7.5,
      payment_method: "cash",
      payment_status: "paid",
      ...overrides,
    });
  return response;
}

let tenantA: Tenant;
let tenantB: Tenant;

beforeAll(async () => {
  app = createApp();
  tenantA = await createTenant("alpha", "AA");
  tenantB = await createTenant("beta", "BB");
});

afterAll(async () => {
  // Deleted in dependency order: receipts (and their items) first, then the
  // users they point at — `Receipt.created_by` is ON DELETE RESTRICT.
  for (const tenant of [tenantA, tenantB]) {
    await prisma.receipt.deleteMany({ where: { business_id: tenant.businessId } });
    await prisma.customer.deleteMany({ where: { business_id: tenant.businessId } });
    await prisma.user.deleteMany({ where: { business_id: tenant.businessId } });
    await prisma.business.deleteMany({ where: { id: tenant.businessId } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("authentication", () => {
  it("refuses access without a session", async () => {
    const response = await request(app).get("/api/receipts");
    expect(response.status).toBe(401);
  });

  it("rejects a wrong password with the same message as an unknown email", async () => {
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: `nobody-${stamp}@test.local`, password: "whatever123" });
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: `alpha-${stamp}@test.local`, password: "wrong-password" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it("stores a bcrypt hash, never the password", async () => {
    const user = await prisma.user.findUnique({
      where: { email: `alpha-${stamp}@test.local` },
    });
    expect(user).toBeTruthy();
    expect(user!.password_hash).not.toContain("testing12345");
    expect(user!.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it("does not accept a tampered session token", async () => {
    const response = await request(app)
      .get("/api/receipts")
      .set("Cookie", "el_session=eyJhbGciOiJIUzI1NiJ9.forged.signature");
    expect(response.status).toBe(401);
  });

  // Regression: the signup form sends `phone: form.phone || null`, but
  // phoneField was `.optional()` — which admits `undefined` and not `null` —
  // so every browser signup 422'd with "expected string, received null".
  // The suite missed it because createTenant omits the key entirely.
  it("signs up when phone is sent as null, as the browser does", async () => {
    const email = `null-phone-${stamp}@test.local`;
    const response = await request(app).post("/api/auth/signup").send({
      business: { name: "Null Phone Ltd", currency: "NGN" },
      user: {
        full_name: "Null Phone Owner",
        email,
        password: "testing12345",
        phone: null,
      },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.user.phone).toBeNull();

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored?.phone).toBeNull();
  });

  it("still stores a phone when one is provided", async () => {
    const email = `with-phone-${stamp}@test.local`;
    const response = await request(app).post("/api/auth/signup").send({
      business: { name: "With Phone Ltd", currency: "NGN" },
      user: {
        full_name: "With Phone Owner",
        email,
        password: "testing12345",
        phone: "0803 000 0000",
      },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.user.phone).toBe("0803 000 0000");
  });
});

// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  it("returns 404 when another business's receipt is requested by id", async () => {
    const created = await createReceipt(tenantA);
    expect(created.status).toBe(201);

    const foreign = await request(app)
      .get(`/api/receipts/${created.body.id}`)
      .set("Cookie", tenantB.cookie);

    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("NOT_FOUND");
  });

  it("never lists another business's receipts", async () => {
    await createReceipt(tenantA, { items: [{ description: "Only for A", quantity: 1, unit_price: 900 }] });
    await createReceipt(tenantB, { items: [{ description: "Only for B", quantity: 1, unit_price: 700 }] });

    const list = await request(app).get("/api/receipts?limit=100").set("Cookie", tenantB.cookie);
    expect(list.status).toBe(200);

    const numbers = list.body.items.map((r: { receipt_number: string }) => r.receipt_number);
    expect(numbers.every((n: string) => n.startsWith("BB-"))).toBe(true);
    expect(list.body.items.some((r: { business_id: string }) => r.business_id !== tenantB.businessId)).toBe(false);
  });

  it("refuses to void a receipt belonging to another business", async () => {
    const created = await createReceipt(tenantA);
    const response = await request(app)
      .post(`/api/receipts/${created.body.id}/void`)
      .set("Cookie", tenantB.cookie)
      .send({ reason: "not mine" });

    expect(response.status).toBe(404);
  });

  it("refuses to attach a customer from another business", async () => {
    const customer = await request(app)
      .post("/api/customers")
      .set("Cookie", tenantA.cookie)
      .send({ name: "Foreign Customer" });
    expect(customer.status).toBe(201);

    const response = await createReceipt(tenantB, { customer_id: customer.body.id });
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("receipt immutability", () => {
  it("blocks any update that touches money fields at the ORM boundary", async () => {
    const created = await createReceipt(tenantA);
    const id = created.body.id as string;

    const attempts: Array<Record<string, unknown>> = [
      { total: 1 },
      { subtotal: 1 },
      { discount: 9999 },
      { tax: 0 },
      { tax_rate: 0 },
      { paid_amount: 0 },
      { receipt_number: "AA-999999" },
      { payment_method: "card" },
      { issue_date: new Date("2020-01-01") },
    ];

    for (const data of attempts) {
      await expect(
        prisma.receipt.update({
          where: { id, business_id: tenantA.businessId },
          data,
        }),
      ).rejects.toMatchObject({ status: 409, code: "RECEIPT_IMMUTABLE" });
    }

    // The row is untouched.
    const after = await prisma.receipt.findFirst({
      where: { id, business_id: tenantA.businessId },
      include: { items: true },
    });
    expect(Number(after!.total)).toEqual(created.body.total);
    expect(after!.receipt_number).toBe(created.body.receipt_number);
    expect(after!.items).toHaveLength(1);
  });

  it("blocks nested line-item writes", async () => {
    const created = await createReceipt(tenantA);

    await expect(
      prisma.receipt.update({
        where: { id: created.body.id, business_id: tenantA.businessId },
        data: { items: { deleteMany: {} } },
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_IMMUTABLE" });
  });

  it("has no HTTP route that edits a receipt's financials", async () => {
    const created = await createReceipt(tenantA);
    const url = `/api/receipts/${created.body.id}`;

    const patch = await request(app).patch(url).set("Cookie", tenantA.cookie).send({ total: 1 });
    const put = await request(app).put(url).set("Cookie", tenantA.cookie).send({ total: 1 });
    const del = await request(app).delete(url).set("Cookie", tenantA.cookie);

    for (const response of [patch, put, del]) {
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("NOT_FOUND");
    }
  });

  it("allows the only legal mutation: status → void", async () => {
    const created = await createReceipt(tenantA);

    const voided = await request(app)
      .post(`/api/receipts/${created.body.id}/void`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "wrong size" });

    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe("void");
    expect(voided.body.void_reason).toBe("wrong size");
    expect(voided.body.voided_at).toBeTruthy();

    // The row still exists — receipts are never deleted.
    const row = await prisma.receipt.findFirst({
      where: { id: created.body.id, business_id: tenantA.businessId },
    });
    expect(row).toBeTruthy();
    expect(row!.status).toBe("void");

    // Voiding twice is a conflict, not a silent overwrite.
    const again = await request(app)
      .post(`/api/receipts/${created.body.id}/void`)
      .set("Cookie", tenantA.cookie)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_VOID");
  });

  it("reissues into a new receipt linked to the voided original", async () => {
    const created = await createReceipt(tenantA);

    const reissued = await request(app)
      .post(`/api/receipts/${created.body.id}/reissue`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "corrected line item" });

    expect(reissued.status).toBe(201);
    expect(reissued.body.id).not.toBe(created.body.id);
    expect(reissued.body.receipt_number).not.toBe(created.body.receipt_number);
    expect(reissued.body.original_receipt_id).toBe(created.body.id);
    expect(reissued.body.total).toBe(created.body.total);
    expect(reissued.body.items).toHaveLength(created.body.items.length);

    const original = await request(app)
      .get(`/api/receipts/${created.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(original.body.status).toBe("void");
  });
});

// ---------------------------------------------------------------------------

describe("receipt numbering", () => {
  it("issues unique, contiguous numbers under concurrent creates", async () => {
    const count = 15;
    const responses = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        createReceipt(tenantA, {
          items: [{ description: `Concurrent ${index}`, quantity: 1, unit_price: 100 + index }],
        }),
      ),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);

    const numbers = responses
      .map((r) => r.body.receipt_number as string)
      .filter(Boolean);

    expect(numbers).toHaveLength(count);
    expect(new Set(numbers).size).toBe(count);
    expect(numbers.every((n) => n.startsWith(`${tenantA.prefix}-`))).toBe(true);

    const sequences = numbers
      .map((n) => Number(n.split("-")[1]))
      .sort((a, b) => a - b);

    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1);
    }

    // The two businesses draw from independent counters.
    const foreign = numbers.filter((n) => n.startsWith(`${tenantB.prefix}-`));
    expect(foreign).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("server-side totals", () => {
  it("recomputes totals instead of trusting the client", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Cookie", tenantA.cookie)
      .send({
        items: [
          { description: "Beaded top", quantity: 3, unit_price: 4500 },
          { description: "Sash", quantity: 1, unit_price: 1200 },
        ],
        discount: 1000,
        tax_rate: 7.5,
        payment_method: "cash",
        payment_status: "paid",
        // Hostile / buggy client values — the schema must ignore them.
        total: 0.01,
        subtotal: 0.01,
        tax: 0,
        paid_amount: 999_999_999,
      });

    expect(response.status).toBe(201);

    const expected = computeTotals(
      [
        { description: "Beaded top", quantity: 3, unit_price: 4500 },
        { description: "Sash", quantity: 1, unit_price: 1200 },
      ],
      1000,
      7.5,
    );

    expect(response.body.subtotal).toBe(expected.subtotal); // 14700
    expect(response.body.discount).toBe(expected.discount); // 1000
    expect(response.body.tax).toBe(expected.tax); // 952.5
    expect(response.body.total).toBe(expected.total); // 14652.5
    expect(response.body.paid_amount).toBe(expected.total);
    expect(response.body.total).not.toBe(0.01);
  });

  it("rejects a receipt with no line items", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Cookie", tenantA.cookie)
      .send({ items: [], payment_method: "cash", payment_status: "paid" });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a negative quantity", async () => {
    const response = await createReceipt(tenantA, {
      items: [{ description: "Negative", quantity: -2, unit_price: 100 }],
    });
    expect(response.status).toBe(422);
  });

  // Regression, same class as the signup phone bug: the receipt form posts
  // `notes: notes.trim() || null`, which `.optional()` rejected outright — so
  // the core "create a receipt without notes" flow 422'd.
  it("accepts notes sent as null, as the receipt form does", async () => {
    const response = await createReceipt(tenantA, { notes: null });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.notes).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("share links", () => {
  it("round-trips a valid token", () => {
    const { token, expiresAt } = signShareToken("receipt-123", 3600);
    const verified = verifyShareToken(token);

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.receiptId).toBe("receipt-123");
      expect(verified.expiresAt.getTime()).toBe(expiresAt.getTime());
    }
  });

  it("rejects a tampered payload", () => {
    const { token } = signShareToken("receipt-123", 3600);
    const [payload, signature] = token.split(".");

    // Point the token at a different receipt while keeping the signature.
    const forgedPayload = Buffer.from("receipt-999.9999999999999").toString("base64url");
    const forged = `${forgedPayload}.${signature}`;

    expect(payload).not.toBe(forgedPayload);
    expect(verifyShareToken(forged).ok).toBe(false);
    expect(verifyShareToken(forged)).toMatchObject({ reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    const { token } = signShareToken("receipt-123", -10);
    expect(verifyShareToken(token)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects garbage", () => {
    for (const bad of ["", ".", "a.b.c", "not-a-token", "%%%.%%%"]) {
      expect(verifyShareToken(bad).ok).toBe(false);
    }
  });

  it("serves a real receipt over a valid link and 403s a forged one", async () => {
    const created = await createReceipt(tenantA);
    const { token } = signShareToken(created.body.id, 3600);

    const ok = await request(app).get(`/api/public/r/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.receipt.receipt_number).toBe(created.body.receipt_number);

    // Internal tenancy metadata must not travel on a public link.
    expect(ok.body.receipt.business_id).toBeUndefined();
    expect(ok.body.receipt.created_by).toBeUndefined();
    expect(ok.body.receipt.customer_id).toBeUndefined();

    const forged = await request(app).get(`/api/public/r/${token.slice(0, -3)}AAA`);
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe("LINK_INVALID");

    const expired = signShareToken(created.body.id, -1);
    const expiredResponse = await request(app).get(`/api/public/r/${expired.token}`);
    expect(expiredResponse.status).toBe(403);
    expect(expiredResponse.body.code).toBe("LINK_EXPIRED");
  });

  it("keeps a receipt readable through a share link after it is voided", async () => {
    const created = await createReceipt(tenantA);
    await request(app)
      .post(`/api/receipts/${created.body.id}/void`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "changed my mind" });

    const { token } = signShareToken(created.body.id, 3600);
    const response = await request(app).get(`/api/public/r/${token}`);

    expect(response.status).toBe(200);
    expect(response.body.receipt.status).toBe("void");
  });
});

// ---------------------------------------------------------------------------

describe("documents", () => {
  it("renders the branded HTML document for the owner", async () => {
    const created = await createReceipt(tenantA);
    const response = await request(app)
      .get(`/api/receipts/${created.body.id}/document`)
      .set("Cookie", tenantA.cookie);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");

    const html = response.text;
    expect(html).toContain(created.body.receipt_number);
    expect(html).toContain("#FBF7EE"); // cream body
    expect(html).toContain("#111111"); // black header band
    expect(html).toContain("#B8912F"); // gold accent
    expect(html).toContain("Silk scarf");
    expect(html).toContain("Total");
    expect(html).toContain("Thank you for your business.");
  });

  it("escapes customer-supplied content in the document", async () => {
    const created = await createReceipt(tenantA, {
      items: [{ description: '<script>alert("xss")</script>', quantity: 1, unit_price: 100 }],
    });
    expect(created.status).toBe(201);

    const response = await request(app)
      .get(`/api/receipts/${created.body.id}/document`)
      .set("Cookie", tenantA.cookie);

    expect(response.text).not.toContain("<script>alert(");
    expect(response.text).toContain("&lt;script&gt;");
  });

  it("renders a preview without persisting anything", async () => {
    const before = await prisma.receipt.count({ where: { business_id: tenantA.businessId } });

    const response = await request(app)
      .post("/api/receipts/preview")
      .set("Cookie", tenantA.cookie)
      .send({
        items: [{ description: "Preview only", quantity: 1, unit_price: 500 }],
        discount: 0,
        tax_rate: 0,
        payment_method: "cash",
        payment_status: "pending",
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain("Preview only");

    const after = await prisma.receipt.count({ where: { business_id: tenantA.businessId } });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("business settings", () => {
  it("updates profile fields and keeps the receipt prefix", async () => {
    const response = await request(app)
      .patch("/api/business")
      .set("Cookie", tenantA.cookie)
      .send({
        name: "Renamed Boutique",
        address: "12 Test Street",
        brand_accent: "#C0A062",
      });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Renamed Boutique");
    expect(response.body.address).toBe("12 Test Street");
    expect(response.body.brand_accent).toBe("#C0A062");
    expect(response.body.number_prefix).toBe(tenantA.prefix);
  });

  it("rejects an invalid hex colour", async () => {
    const response = await request(app)
      .patch("/api/business")
      .set("Cookie", tenantA.cookie)
      .send({ brand_accent: "gold" });

    expect(response.status).toBe(422);
    expect(response.body.details.brand_accent).toBeTruthy();
  });

  it("does not leak another business's settings", async () => {
    const response = await request(app).get("/api/business").set("Cookie", tenantB.cookie);
    expect(response.body.name).toBe("beta Ltd");
    expect(response.body.name).not.toBe("Renamed Boutique");
  });
});

// ---------------------------------------------------------------------------

describe("customers", () => {
  it("creates, lists, edits and deletes within one business", async () => {
    const created = await request(app)
      .post("/api/customers")
      .set("Cookie", tenantA.cookie)
      .send({ name: "Test Customer", phone: "+234 800 000 0000" });
    expect(created.status).toBe(201);

    const list = await request(app)
      .get("/api/customers?search=Test Customer")
      .set("Cookie", tenantA.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.some((c: { id: string }) => c.id === created.body.id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/customers/${created.body.id}`)
      .set("Cookie", tenantA.cookie)
      .send({ name: "Renamed Customer", phone: "", email: "" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Renamed Customer");

    const deleted = await request(app)
      .delete(`/api/customers/${created.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(deleted.status).toBe(200);

    const gone = await request(app)
      .get(`/api/customers/${created.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(gone.status).toBe(404);
  });

  it("never lists another business's customers", async () => {
    await request(app)
      .post("/api/customers")
      .set("Cookie", tenantA.cookie)
      .send({ name: "Alpha Only" });

    const list = await request(app)
      .get("/api/customers?search=Alpha Only")
      .set("Cookie", tenantB.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(0);
  });
});
