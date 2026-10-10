import { existsSync } from "node:fs";
import type { Browser } from "puppeteer";
import { env } from "./env";
import { renderReceiptHtml, type DocumentData } from "./document";
import { renderInvoiceHtml, type InvoiceDocumentData } from "./invoiceDocument";

let browserPromise: Promise<Browser> | null = null;
let bundledHinted = false;
let resolvedHinted = false;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--font-render-hinting=none",
  "--disable-gpu",
];

// Distro browsers. The Dockerfile guarantees at least one of these exists, and
// we probe the paths directly: Puppeteer's `channel` lookup only ever checks
// /opt/google/chrome, which Debian never populates — that dead end is what
// turned a missing bundled download into an opaque 500 on every PDF.
const DISTRO_BROWSERS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
];

async function launchBrowser(): Promise<Browser> {
  const base = { headless: true as const, args: LAUNCH_ARGS };

  if (env.puppeteerExecutablePath) {
    return puppeteerLaunch({ ...base, executablePath: env.puppeteerExecutablePath });
  }

  try {
    // Chrome for Testing, downloaded into PUPPETEER_CACHE_DIR during `npm ci`.
    return await puppeteerLaunch(base);
  } catch (bundledError) {
    if (!bundledHinted) {
      bundledHinted = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[pdf] Bundled Chrome unavailable, trying the distro browser.\n" +
          `      ${String((bundledError as Error)?.message ?? bundledError).split("\n")[0]}`,
      );
    }
  }

  for (const candidate of DISTRO_BROWSERS) {
    if (!existsSync(candidate)) continue;
    if (!resolvedHinted) {
      resolvedHinted = true;
      // eslint-disable-next-line no-console
      console.warn(`[pdf] Using distro browser at ${candidate}`);
    }
    return puppeteerLaunch({ ...base, executablePath: candidate });
  }

  throw new Error(
    "No browser available for PDF generation: neither Chrome for Testing nor a " +
      "distro chromium was found in the image (checked " +
      `${DISTRO_BROWSERS.join(", ")}).`,
  );
}

async function puppeteerLaunch(options: Parameters<typeof import("puppeteer").default.launch>[0]) {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch(options);
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null; // allow a retry on the next request
      throw error;
    });
  }
  return browserPromise;
}

/* ---------------------------------- Page --------------------------------- */

/**
 * A4 in CSS pixels at the 96dpi CSS reference.
 *
 * Derived from millimetres rather than hard-coded so the relationship to the
 * PDF stays visible: `page.pdf({ format: "A4" })` lays the sheet out in exactly
 * this box, and the PNG is rendered in exactly the same box at the same width.
 * That equality is what makes the two exports the same document — a viewport
 * even 100px wider reflows every line of body text, so the image and the PDF
 * stop showing the same thing.
 */
const CSS_PX_PER_MM = 96 / 25.4;
const A4_WIDTH_PX = Math.round(210 * CSS_PX_PER_MM); // 794
const A4_HEIGHT_PX = Math.round(297 * CSS_PX_PER_MM); // 1123

/** The shared browser, for tests that need to render under a specific media type. */
export const getBrowserForTest = getBrowser;

/**
 * Load a document into a page configured the way every export wants it.
 *
 * Both exports go through here because the differences that make an image and
 * a PDF disagree are all in this block:
 *
 *  - **`emulateMediaType("print")`** — the templates carry a `@media print`
 *    block that changes the sheet itself: it drops the 28px page padding,
 *    stretches the frame to the full bleed, squares off the rounded corners and
 *    removes the side borders. Rendering the PNG under screen media instead
 *    produced a *different document* — a narrower, rounded, padded card with
 *    the watermark in a different place — which is precisely the "why does the
 *    image not match the PDF" bug.
 *  - **A4 viewport** — so line breaking matches the PDF page.
 *
 * @param media Overridable so a test can render the same HTML both ways and
 *   compare, which is how the parity assertions are made concrete.
 */
async function prepareDocument(html: string, media: "screen" | "print" = "print") {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.emulateMediaType(media);
    await page.setViewport({
      width: A4_WIDTH_PX,
      height: A4_HEIGHT_PX,
      deviceScaleFactor: 2,
    });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });

    // Give webfonts a chance to arrive, but never block the document on them —
    // the fallback stack renders correctly, just with different metrics. (String
    // form: the API package has no DOM lib, and this runs in the page context.)
    await Promise.race([
      page.evaluate("document.fonts && document.fonts.ready"),
      new Promise((resolve) => setTimeout(resolve, 4_000)),
    ]);

    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** Render an HTML document to an A4 PDF buffer. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const page = await prepareDocument(html);

  try {
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Build the branded document and turn it into a PDF in one step. */
export async function renderReceiptPdf(data: DocumentData): Promise<Buffer> {
  return htmlToPdf(renderReceiptHtml(data));
}

/** Same, for an invoice. */
export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return htmlToPdf(renderInvoiceHtml(data));
}

/* --------------------------------- Images -------------------------------- */

/**
 * Render a document to a high-quality PNG.
 *
 * This is server-side by design. The obvious shortcut — screenshotting an
 * element in the browser — produces a picture of whatever the user's screen
 * happened to show: clipped to the viewport, styled by the app's CSS, at
 * whatever device pixel ratio the device reports. Rendering the same HTML the
 * PDF is built from, in the same headless browser, under the same print media
 * and the same A4 viewport, means the exported image and the exported PDF are
 * the same document — watermark, branding, QR, totals and all.
 *
 * `deviceScaleFactor: 2` (set in `prepareDocument`) doubles the pixel density,
 * so the PNG is 1588px wide on A4 and stays crisp when a customer opens it on a
 * phone or prints it.
 *
 * `fullPage` captures the document's true height, so a long itemisation is
 * never cut off at the fold. Where a document really does run past one page the
 * caller gets one tall image rather than a silently truncated first page —
 * losing the tail of a receipt would be worse than an extra-long export.
 */
export async function htmlToPng(html: string): Promise<Buffer> {
  const page = await prepareDocument(html);

  try {
    const png = await page.screenshot({
      fullPage: true,
      type: "png",
      // The page background is the document's own cream, so the capture has no
      // transparent gutter around it.
      omitBackground: false,
    });

    return Buffer.from(png);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => undefined);
}
