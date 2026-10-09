import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import zlib from "node:zlib";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import {
  signVerifyToken,
  verifyVerifyToken,
  signShareToken,
  verifyShareToken,
} from "../src/lib/tokens";

/**
 * Organization / tenant tests.
 *
 * Covers the multi-tenant requirements that are new with this change:
 *   - the organization carries a website and an updated_at stamp
 *   - organization settings are administrator-only, enforced server-side
 *   - every receipt resolves to its own organization for verification
 *   - the QR verification capability is stable, unguessable and minimal
 *   - none of it reopens a cross-tenant hole
 */

let app: Express;

const stamp = Date.now();

interface Tenant {
  cookie: string;
  businessId: string;
  userId: string;
  prefix: string;
}

function extractCookie(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const session = list.find((value) => value.startsWith("el_session="));
  expect(session, "session cookie missing").toBeTruthy();
  return session!.split(";")[0];
}

async function createTenant(label: string, prefix: string): Promise<Tenant> {
  const email = `${label}-${stamp}@test.local`;
  const signup = await request(app).post("/api/auth/signup").send({
    business: { name: `${label} Ltd`, currency: "NGN", number_prefix: prefix },
    user: { full_name: `${label} Owner`, email, password: "testing12345" },
  });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);

  return {
    cookie: extractCookie(signup.headers["set-cookie"]),
    businessId: signup.body.business.id,
    userId: signup.body.user.id,
    prefix,
  };
}

async function createReceipt(tenant: Tenant) {
  return request(app)
    .post("/api/receipts")
    .set("Cookie", tenant.cookie)
    .send({
      items: [{ description: "Consulting", quantity: 3, unit_price: 2500 }],
      discount: 0,
      payment_method: "cash",
      payment_status: "paid",
    });
}

/** A second user in the same organization, with the staff role. */
async function addStaff(tenant: Tenant, label: string): Promise<string> {
  const email = `${label}-staff-${stamp}@test.local`;
  await prisma.user.create({
    data: {
      business_id: tenant.businessId,
      full_name: `${label} Staff`,
      email,
      password_hash: bcrypt.hashSync("testing12345", 4),
      role: "staff",
    },
  });

  const login = await request(app).post("/api/auth/login").send({
    email,
    password: "testing12345",
  });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return extractCookie(login.headers["set-cookie"]);
}

let tenantA: Tenant;
let tenantB: Tenant;

beforeAll(async () => {
  app = createApp();
  tenantA = await createTenant(`OrgA${stamp}`, "AA");
  tenantB = await createTenant(`OrgB${stamp}`, "BB");
});

// ---------------------------------------------------------------------------

describe("organization profile", () => {
  it("accepts and returns a website alongside the existing fields", async () => {
    const update = await request(app)
      .patch("/api/business")
      .set("Cookie", tenantA.cookie)
      .send({ website: "https://abc-pharmacy.example", name: "ABC Pharmacy Limited" });

    expect(update.status, JSON.stringify(update.body)).toBe(200);
    expect(update.body.website).toBe("https://abc-pharmacy.example");
    expect(update.body.name).toBe("ABC Pharmacy Limited");

    const read = await request(app).get("/api/business").set("Cookie", tenantA.cookie);
    expect(read.status).toBe(200);
    expect(read.body.website).toBe("https://abc-pharmacy.example");
  });

  it("clears the website when an empty string is sent", async () => {
    await request(app)
      .patch("/api/business")
      .set("Cookie", tenantA.cookie)
      .send({ website: "" });

    const read = await request(app).get("/api/business").set("Cookie", tenantA.cookie);
    expect(read.body.website).toBeNull();
  });

  it("bumps updated_at on every change", async () => {
    const before = await request(app).get("/api/business").set("Cookie", tenantA.cookie);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const after = await request(app)
      .patch("/api/business")
      .set("Cookie", tenantA.cookie)
      .send({ address: "12 Marina Rd" });

    expect(after.body.updated_at).toBeTruthy();
    expect(new Date(after.body.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.body.updated_at).getTime(),
    );
  });

  it("keeps each organization's profile separate", async () => {
    const a = await request(app).get("/api/business").set("Cookie", tenantA.cookie);
    const b = await request(app).get("/api/business").set("Cookie", tenantB.cookie);

    expect(a.body.id).toBe(tenantA.businessId);
    expect(b.body.id).toBe(tenantB.businessId);
    expect(a.body.name).not.toBe(b.body.name);
  });
});

// ---------------------------------------------------------------------------

describe("organization administration is owner-only", () => {
  it("lets a staff member still do their job", async () => {
    const staffCookie = await addStaff(tenantA, `s${stamp}`);

    const receipt = await request(app)
      .post("/api/receipts")
      .set("Cookie", staffCookie)
      .send({
        items: [{ description: "Staff issue", quantity: 1, unit_price: 500 }],
        payment_method: "cash",
        payment_status: "paid",
      });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);

    const list = await request(app).get("/api/receipts").set("Cookie", staffCookie);
    expect(list.status).toBe(200);
  });

  it("refuses a staff member trying to change organization settings", async () => {
    const staffCookie = await addStaff(tenantA, `s2${stamp}`);

    const rename = await request(app)
      .patch("/api/business")
      .set("Cookie", staffCookie)
      .send({ name: "Hijacked Name" });
    expect(rename.status).toBe(403);
    expect(rename.body.code).toBe("FORBIDDEN");

    const upload = await request(app)
      .post("/api/business/logo")
      .set("Cookie", staffCookie)
      .attach("logo", Buffer.from("not-an-image"), "logo.png");
    expect(upload.status).toBe(403);

    const remove = await request(app)
      .delete("/api/business/logo")
      .set("Cookie", staffCookie);
    expect(remove.status).toBe(403);

    // …and the organization is untouched.
    const read = await request(app).get("/api/business").set("Cookie", tenantA.cookie);
    expect(read.body.name).not.toBe("Hijacked Name");
  });

  it("takes the role from the session, not the request body", async () => {
    const staffCookie = await addStaff(tenantA, `s3${stamp}`);

    const attempt = await request(app)
      .patch("/api/business")
      .set("Cookie", staffCookie)
      .send({ name: "Promoted?", role: "owner" });

    expect(attempt.status).toBe(403);

    const user = await prisma.user.findFirst({
      where: { business_id: tenantA.businessId, role: "staff" },
      orderBy: { created_at: "desc" },
    });
    expect(user?.role).toBe("staff");
  });
});

// ---------------------------------------------------------------------------

describe("receipt verification", () => {
  it("returns a standalone page describing the issuing organization", async () => {
    const receipt = await createReceipt(tenantA);
    expect(receipt.status).toBe(201);

    const share = await request(app)
      .get(`/api/receipts/${receipt.body.id}/share`)
      .set("Cookie", tenantA.cookie);
    expect(share.status).toBe(200);
    expect(share.body.verify_url).toBeTruthy();

    // No cookie at all — this is what a phone scanning the QR code sends.
    const token = share.body.verify_url.split("/").pop();
    const page = await request(app).get(`/api/public/verify/${token}`);

    expect(page.status).toBe(200);
    expect(page.text).toContain("ABC Pharmacy Limited");
    expect(page.text).toContain(receipt.body.receipt_number);
    expect(page.text).toContain("Valid Receipt");
    expect(page.text).toContain("Verified");
    expect(page.text).toContain("VisionaryGene");
  });

  it("does not leak line items or customer details", async () => {
    const receipt = await request(app)
      .post("/api/receipts")
      .set("Cookie", tenantA.cookie)
      .send({
        customer: { name: "Confidential Client", phone: "0803 999 9999" },
        items: [{ description: "Secret Line Item", quantity: 1, unit_price: 1000 }],
        payment_method: "cash",
        payment_status: "paid",
      });
    expect(receipt.status).toBe(201);

    const share = await request(app)
      .get(`/api/receipts/${receipt.body.id}/share`)
      .set("Cookie", tenantA.cookie);
    const token = share.body.verify_url.split("/").pop();

    const page = await request(app).get(`/api/public/verify/${token}`);
    expect(page.status).toBe(200);

    // The minimal verification view only.
    expect(page.text).not.toContain("Secret Line Item");
    expect(page.text).not.toContain("Confidential Client");
    expect(page.text).not.toContain("0803 999 9999");
    // No tenancy ids.
    expect(page.text).not.toContain(tenantA.businessId);
    expect(page.text).not.toContain(receipt.body.id);
  });

  it("says so when the receipt has been voided", async () => {
    const receipt = await createReceipt(tenantA);
    const voided = await request(app)
      .post(`/api/receipts/${receipt.body.id}/void`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "Wrong item" });
    expect(voided.status).toBe(200);

    const share = await request(app)
      .get(`/api/receipts/${receipt.body.id}/share`)
      .set("Cookie", tenantA.cookie);
    const token = share.body.verify_url.split("/").pop();

    const page = await request(app).get(`/api/public/verify/${token}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Voided");
    expect(page.text).toContain("Wrong item");
    expect(page.text).not.toContain("Valid Receipt");
  });

  it("rejects a tampered or forged token", async () => {
    const receipt = await createReceipt(tenantA);
    const share = await request(app)
      .get(`/api/receipts/${receipt.body.id}/share`)
      .set("Cookie", tenantA.cookie);
    const token = share.body.verify_url.split("/").pop();

    const [payload, signature] = String(token).split(".");
    const last = signature.slice(-1);
    const tampered = `${payload}.${signature.slice(0, -1)}${last === "A" ? "B" : "A"}`;

    const forged = await request(app).get(`/api/public/verify/${tampered}`);
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe("VERIFY_INVALID");

    const garbage = await request(app).get("/api/public/verify/not-a-token");
    expect(garbage.status).toBe(403);

    const empty = await request(app).get("/api/public/verify/");
    expect([403, 404]).toContain(empty.status);
  });

  it("404s when the receipt behind a valid token does not exist", async () => {
    // Signature is genuine, but it signs an id that was never issued.
    const orphan = signVerifyToken("00000000-0000-0000-0000-000000000000");

    const page = await request(app).get(`/api/public/verify/${orphan}`);
    expect(page.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("verification capability tokens", () => {
  it("is deterministic — a printed QR never goes stale", () => {
    const first = signVerifyToken("receipt-abc");
    const second = signVerifyToken("receipt-abc");
    expect(first).toBe(second);

    const verified = verifyVerifyToken(first);
    expect(verified).toEqual({ ok: true, receiptId: "receipt-abc" });
  });

  it("carries no expiry, unlike a share link", async () => {
    const token = signVerifyToken("receipt-abc");

    // A share token minted for the same receipt dies after its TTL…
    const share = signShareToken("receipt-abc", -10);
    expect(verifyShareToken(share.token).ok).toBe(false);

    // …the verification token is still valid.
    expect(verifyVerifyToken(token).ok).toBe(true);
  });

  it("cannot be forged without the server secret", () => {
    const real = signVerifyToken("receipt-abc");
    const [payload, signature] = real.split(".");
    const forgedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyVerifyToken(`${payload}.${forgedSignature}`).ok).toBe(false);
    expect(verifyVerifyToken("receipt-abc").ok).toBe(false);
    expect(verifyVerifyToken("").ok).toBe(false);
  });

  it("never maps one organization's receipt onto another", async () => {
    const a = await createReceipt(tenantA);
    const b = await createReceipt(tenantB);

    const shareA = await request(app)
      .get(`/api/receipts/${a.body.id}/share`)
      .set("Cookie", tenantA.cookie);
    const shareB = await request(app)
      .get(`/api/receipts/${b.body.id}/share`)
      .set("Cookie", tenantB.cookie);

    const pageA = await request(app).get(
      `/api/public/verify/${shareA.body.verify_url.split("/").pop()}`,
    );
    const pageB = await request(app).get(
      `/api/public/verify/${shareB.body.verify_url.split("/").pop()}`,
    );

    expect(pageA.text).toContain(`${tenantA.prefix}-`);
    expect(pageB.text).toContain(`${tenantB.prefix}-`);
    expect(pageA.text).not.toContain(`${tenantB.prefix}-`);
    expect(pageB.text).not.toContain(`${tenantA.prefix}-`);
  });
});

describe("brute-force budget", () => {
  // These build their own app so the limiter is fresh: `authLimiter` is
  // constructed inside `createApp`, so hammering one here cannot starve the
  // shared `app` the rest of this file signs tenants up through.

  it("does not charge the session probe to the login rate limit", async () => {
    // `GET /auth/me` carries no credentials to guess — it only reads the
    // cookie already presented. The client calls it on every load and the
    // server calls it whenever it composes an organization page title, so
    // sharing the password budget would eventually lock a signed-in user out
    // of a session that never expired.
    const fresh = createApp();
    const seen = new Set<number>();

    for (let i = 0; i < 60; i += 1) {
      seen.add((await request(fresh).get("/api/auth/me")).status);
    }

    expect([...seen]).toEqual([401]);
  });

  it("still throttles password attempts", async () => {
    const fresh = createApp();
    const seen = new Set<number>();

    for (let i = 0; i < 55; i += 1) {
      seen.add(
        (
          await request(fresh).post("/api/auth/login").send({
            // Unknown address: rejected before any bcrypt work, so this stays
            // quick while still spending a token per attempt.
            email: `probe-${stamp}@nowhere.test`,
            password: "definitely-not-the-password",
          })
        ).status,
      );
    }

    expect(seen.has(429)).toBe(true);
    expect(seen.has(401)).toBe(true);
  });
});

describe("logo dimensions", () => {
  /**
   * A genuinely decodable PNG — raw scanlines, deflated, with real CRCs — so
   * these assertions are about the guard rather than about whether the bytes
   * merely *look* like a PNG header.
   */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  }

  function realPng(size: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: truecolour
    const raw = Buffer.alloc((size * 3 + 1) * size); // filter byte 0, black pixels
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  async function uploadLogo(tenant: Tenant, body: Buffer, filename: string) {
    return request(app)
      .post("/api/business/logo")
      .set("Cookie", tenant.cookie)
      .attach("logo", body, filename);
  }

  /**
   * The key as stored, read from the database.
   *
   * Comparing `logo_url` is a trap: it is signed per request with an issue
   * timestamp, so two reads of an unchanged logo produce different strings.
   * The key underneath is the thing that must not change.
   */
  async function storedLogoKey(): Promise<string | null> {
    const row = await prisma.business.findFirst({
      where: { id: tenantA.businessId },
      select: { logo_url: true },
    });
    return row?.logo_url ?? null;
  }

  it("stores a logo whose size is inside the allowed window", async () => {
    const before = await storedLogoKey();

    const accepted = await uploadLogo(tenantA, realPng(512), "brand.png");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.logo_url).toContain("/api/files/");

    const stored = await storedLogoKey();
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(before); // replaced (or set for the first time)
    expect(stored).toContain("brand.png");
  });

  it("refuses a logo too small to reproduce on a receipt", async () => {
    const previous = await storedLogoKey();
    expect(previous).toBeTruthy();

    const rejected = await uploadLogo(tenantA, realPng(8), "tiny.png");
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("IMAGE_TOO_SMALL");

    // Nothing was written: the previously stored logo is still the one in use.
    expect(await storedLogoKey()).toBe(previous);
  });

  it("refuses a logo large enough to be expensive to decode", async () => {
    // Header only: the guard reads the size, never the pixels, and producing
    // 8193² of real pixel data would be exactly the waste we are avoiding.
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(9000, 16);
    header.writeUInt32BE(9000, 20);
    header.write("IDAT", 28, "ascii");

    const rejected = await uploadLogo(tenantA, header, "huge.png");
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("IMAGE_TOO_LARGE");
  });

  it("refuses bytes that do not read as the type they claim", async () => {
    const rejected = await uploadLogo(tenantA, Buffer.from("plainly not a png"), "brand.png");
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("BAD_IMAGE");
  });

  it("still requires the owner role before any of this is reachable", async () => {
    const staffCookie = await addStaff(tenantA, `logo${stamp}`);
    const attempt = await request(app)
      .post("/api/business/logo")
      .set("Cookie", staffCookie)
      .attach("logo", realPng(512), "brand.png");
    expect(attempt.status).toBe(403);
    expect(attempt.body.code).toBe("FORBIDDEN");
  });
});
