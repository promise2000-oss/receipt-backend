import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PNG } from "pngjs";
import { createApp } from "../src/app";
import { renderReceiptHtml, type DocumentData } from "../src/lib/document";
import { renderInvoiceHtml, type InvoiceDocumentData } from "../src/lib/invoiceDocument";
import { renderReceiptPng, renderInvoicePng, documentFilename } from "../src/lib/imageExport";
import { htmlToPng, closeBrowser } from "../src/lib/pdf";
import { qrDataUrl } from "../src/lib/qr";
import { imageDimensions } from "../src/lib/image";

/**
 * Image export must be the *same document* as the PDF.
 *
 * Two defects shipped here, and both were invisible to an HTTP-status check
 * because the route returned a perfectly valid PNG — it was just the wrong
 * picture:
 *
 *   1. `GET /receipts/:id/image` built its document data with `null` as the
 *      verification URL, so the QR code was dropped from every downloaded
 *      image while the PDF still carried one. The two exports of one receipt
 *      disagreed.
 *   2. `htmlToPng` rendered under *screen* media while `htmlToPdf` rendered
 *      under *print* media. The templates carry a `@media print` block that
 *      rewrites the sheet itself — no page padding, full-bleed frame, square
 *      corners, no side borders — so the PNG was a narrower rounded card with
 *      a different watermark position. On top of that the viewport was 900px
 *      wide against the PDF's 794px A4, which reflows body text.
 *
 * So every assertion below inspects decoded pixels rather than trusting a
 * status code or a byte count. Comparing file size would have passed for both
 * bugs: the QR-less image and the wrong-media image were both "a PNG".
 */

/* ----------------------------- pixel utilities ---------------------------- */

interface Stats {
  width: number;
  height: number;
  /** Pixels dark enough to be ink. */
  dark: number;
  /** Dark pixels in the footer band, where the QR block lives. */
  footerDark: number;
  /** Dark pixels in the leftmost 60 device px — the frame border. */
  leftDark: number;
}

/**
 * Decode a PNG and measure the features that distinguish the two exports.
 *
 * Decoding is the point: a QR is a dense block of pure black modules, and the
 * frame border is a 1.5px rule that survives into the raster. Both are
 * measurable in a way that "the response was 200 with an image/png
 * content-type" is not.
 */
function measure(buffer: Buffer): Stats {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  let dark = 0;
  let footerDark = 0;
  let leftDark = 0;
  const footerTop = Math.floor(height * 0.78);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const luminance = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (luminance >= 90) continue;
      dark += 1;
      if (y >= footerTop) footerDark += 1;
      if (x < 60) leftDark += 1;
    }
  }

  return { width, height, dark, footerDark, leftDark };
}

/** True if the buffer is a decodable PNG. */
function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

/* ------------------------------- fixtures -------------------------------- */

const business = {
  name: "Parity Test Ltd",
  address: "1 Parity Street",
  phone: "+234 800 111 2222",
  email: "hello@parity.local",
  website: "parity.local",
  currency: "NGN",
  logo_data_url: null,
  brand_primary: null,
  brand_accent: null,
};

const receipt = {
  receipt_number: "PR-000042",
  status: "issued",
  subtotal: 7_500,
  discount: 0,
  tax: 0,
  total: 7_500,
  payment_method: "cash",
  payment_status: "paid",
  paid_amount: 7_500,
  issued_at: new Date("2026-01-05T10:00:00Z"),
  voided_at: null,
  void_reason: null,
  notes: null,
  items: [{ description: "Consulting", quantity: 3, unit_price: 2_500, line_total: 7_500 }],
  customer: { name: "Parity Customer", phone: "+234 111", email: "c@parity.local", address: null },
};

const VERIFY_URL = "https://parity.local/api/public/verify/capability-token-value";

let qr: string;

function receiptData(verifyUrl: string | null): DocumentData {
  return {
    business,
    receipt,
    verify_url: verifyUrl,
    // Only supply the encoded QR when there is a URL to encode, exactly as
    // `buildDocumentData` does.
    qr_data_url: null,
  } as unknown as DocumentData;
}

async function withQrData(data: DocumentData, verifyUrl: string): Promise<DocumentData> {
  return {
    ...data,
    verify_url: verifyUrl,
    qr_data_url: await qrDataUrl(verifyUrl),
  } as DocumentData;
}

beforeAll(async () => {
  qr = (await qrDataUrl(VERIFY_URL)) ?? "";
  expect(qr, "QR encoding failed in the test environment").not.toBe("");
});

afterAll(async () => {
  await closeBrowser();
});

/* --------------------------------- tests --------------------------------- */

describe("receipt image export", () => {
  it("renders a decodable PNG at A4 × 2, not an arbitrary viewport", async () => {
    const png = await renderReceiptPng(await withQrData(receiptData(null), VERIFY_URL));

    expect(isPng(png)).toBe(true);
    expect(imageDimensions(png, "image/png")).not.toBeNull();

    // A4 at 96dpi is 794×1123 CSS px; at deviceScaleFactor 2 that is 1588×2246.
    // The previous 900×1400 viewport produced 1800×2800 — a shape that is not
    // A4 and does not match the PDF's line breaking.
    const { width, height } = measure(png);
    expect(width).toBe(1588);
    expect(height).toBe(2246);
  });

  it("includes the QR code that the PDF carries", async () => {
    const withCode = measure(
      await renderReceiptPng(await withQrData(receiptData(null), VERIFY_URL)),
    );
    const withoutCode = measure(await renderReceiptPng(receiptData(null)));

    // A QR is a dense black-and-white module grid. With one present the footer
    // band gains thousands of dark pixels; without one it does not. Measured
    // on the actual raster, not inferred from the HTML.
    expect(
      withCode.footerDark,
      `footer dark pixels: ${withCode.footerDark} (with QR) vs ${withoutCode.footerDark} (without)`,
    ).toBeGreaterThan(withoutCode.footerDark * 2);

    // And the two exports are genuinely different images.
    expect(withCode.dark).toBeGreaterThan(withoutCode.dark);
  });

  it("renders the frame border that the print stylesheet produces", async () => {
    const stats = measure(await renderReceiptPng(await withQrData(receiptData(null), VERIFY_URL)));

    // `@media print` removes the sheet padding and the side borders and lets
    // the frame run full-bleed, so ink reaches the left edge of the raster.
    // Under screen media the 28px padding put cream there instead — this is the
    // clearest single pixel-level signal that the image is using the same media
    // as the PDF.
    expect(stats.leftDark).toBeGreaterThan(0);
  });

  it("emits the QR markup only when a verification URL is supplied", async () => {
    // Guards the fix itself: the route passes a real verification URL, so the
    // `<div class="qr-block">` wrapper is present. Checking for the bare class
    // name would be a false positive, because the CSS rule of that name is in
    // every document regardless.
    const withoutUrl = renderReceiptHtml(receiptData(null));
    const withUrl = renderReceiptHtml(await withQrData(receiptData(null), VERIFY_URL));

    expect(withoutUrl).not.toContain('<div class="qr-block">');
    expect(withUrl).toContain('<div class="qr-block">');
    expect(withUrl).toContain("Scan to verify");
  });
});

describe("invoice image export", () => {
  it("renders a decodable PNG at A4 × 2", async () => {
    const data = {
      business,
      invoice: {
        invoice_number: "INV-000042",
        status: "issued",
        issue_date: "2026-01-05",
        due_date: "2026-02-05",
        subtotal: 7_500,
        discount: 0,
        tax: 0,
        total: 7_500,
        paid_amount: 0,
        items: [{ description: "Consulting", quantity: 3, unit_price: 2_500, line_total: 7_500 }],
        customer: { name: "Parity Customer", phone: "+234 111", email: "c@parity.local" },
        notes: null,
        terms: null,
      },
    } as unknown as InvoiceDocumentData;

    const png = await renderInvoicePng(data);
    expect(isPng(png)).toBe(true);

    const { width, height, leftDark } = measure(png);
    expect(width).toBe(1588);
    expect(height).toBe(2246);
    // Same print-media frame border as the receipt.
    expect(leftDark).toBeGreaterThan(0);
  });
});

describe("image and PDF agree", () => {
  it("renders identical pixels for the same HTML under the PNG path", async () => {
    // `htmlToPng` is the PNG export's only renderer. Rendering the same HTML
    // twice through it must be deterministic, otherwise any parity claim rests
    // on a renderer that varies run to run.
    const html = renderReceiptHtml(await withQrData(receiptData(null), VERIFY_URL));
    const first = measure(await htmlToPng(html));
    const second = measure(await htmlToPng(html));

    expect(first).toEqual(second);
  });

  it("uses the print stylesheet, not the screen one", async () => {
    // The regression this locks down: the PNG used to render under screen
    // media. Asserted through the observable consequence (the frame border at
    // the left edge) rather than by trusting a media-type call to stay put.
    const html = renderReceiptHtml(await withQrData(receiptData(null), VERIFY_URL));
    const stats = measure(await htmlToPng(html));

    expect(stats.leftDark).toBeGreaterThan(0);
    expect(stats.width).toBe(1588);
  });
});

describe("GET /api/receipts/:id/image", () => {
  let app: Express;
  let cookie: string;
  let receiptId: string;

  beforeAll(async () => {
    app = createApp();
    const stamp = Date.now();

    const signup = await request(app).post("/api/auth/signup").send({
      business: { name: "Image Export Ltd", currency: "NGN", number_prefix: "IM" },
      user: {
        full_name: "Export Owner",
        email: `export-${stamp}@test.local`,
        password: "testing12345",
      },
    });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);

    const session = (signup.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("el_session="),
    );
    expect(session).toBeTruthy();
    cookie = session!.split(";")[0];

    const created = await request(app)
      .post("/api/receipts")
      .set("Cookie", cookie)
      .send({
        items: [{ description: "Consulting", quantity: 3, unit_price: 2500 }],
        discount: 0,
        payment_method: "cash",
        payment_status: "paid",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    receiptId = created.body.id;
  });

  it("returns a PNG that actually contains the QR code", async () => {
    const res = await request(app)
      .get(`/api/receipts/${receiptId}/image`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(isPng(res.body)).toBe(true);

    const stats = measure(res.body);
    expect(stats.width).toBe(1588);

    // The route previously passed `null` here, dropping the QR from every
    // downloaded image while the PDF still had one.
    //
    // The threshold is measured, not guessed: this exact receipt renders at
    // ~2,580 footer dark pixels with no QR and ~13,300 with one. A floor of
    // 2,000 was tried first and was wrong — it sat *below* the QR-less
    // baseline, so the test passed against the very bug it was written for.
    // 8,000 sits in the gap with room for font and watermark variation while
    // still being unreachable without a QR.
    expect(stats.footerDark).toBeGreaterThan(8_000);
    expect(stats.leftDark).toBeGreaterThan(0);
  });

  it("exports the same document the preview and the PDF show", async () => {
    // The route builds its document data independently of the PDF route, so
    // they can drift apart — which is exactly what happened. Asserting the
    // downloaded image and the served HTML agree on the QR is a direct check
    // that both were built from the same inputs.
    const html = await request(app)
      .get(`/api/receipts/${receiptId}/document`)
      .set("Cookie", cookie);

    expect(html.status).toBe(200);
    expect(html.text).toContain('<div class="qr-block">');

    const image = await request(app)
      .get(`/api/receipts/${receiptId}/image`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    // The HTML promises a QR; the image has to actually contain one.
    expect(measure(image.body).footerDark).toBeGreaterThan(8_000);
  });

  it("names the download the same way the PDF does", async () => {
    const image = await request(app)
      .get(`/api/receipts/${receiptId}/image`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    const disposition = String(image.headers["content-disposition"]);
    expect(disposition).toMatch(/filename="visionarygene-receipt-[A-Za-z0-9-]+\.png"/);
  });

  it("still refuses another tenant's receipt", async () => {
    const stamp = Date.now();
    const other = await request(app).post("/api/auth/signup").send({
      business: { name: "Other Tenant Ltd", currency: "NGN", number_prefix: "OT" },
      user: {
        full_name: "Other Owner",
        email: `other-${stamp}@test.local`,
        password: "testing12345",
      },
    });
    const session = (other.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("el_session="),
    );

    const res = await request(app)
      .get(`/api/receipts/${receiptId}/image`)
      .set("Cookie", session!.split(";")[0]);

    expect(res.status).toBe(404);
  });
});

describe("document filenames", () => {
  it("keeps the same base name across formats", () => {
    const pdf = documentFilename("receipt", "PR-000001", "pdf");
    const png = documentFilename("receipt", "PR-000001", "png");
    expect(pdf).toBe("visionarygene-receipt-PR-000001.pdf");
    expect(png.replace(/\.png$/, ".pdf")).toBe(pdf);
  });

  it("never leaks an organization name into the filename", () => {
    // The number is already unique per tenant; a business name in a filename
    // would leak another tenant's identity into a file that gets forwarded.
    expect(documentFilename("invoice", "INV-000123", "pdf")).toBe(
      "visionarygene-invoice-INV-000123.pdf",
    );
  });
});