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

/** Render an HTML document to an A4 PDF buffer. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });

    // Give webfonts a chance to arrive, but never block the receipt on them —
    // the fallback stack renders correctly, just with different metrics.
    // (String form: the API package has no DOM lib, and this code runs in the
    // browser context, not here.)
    await Promise.race([
      page.evaluate("document.fonts && document.fonts.ready"),
      new Promise((resolve) => setTimeout(resolve, 4_000)),
    ]);

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
 * PDF is built from, in the same headless browser, means the exported image
 * and the exported PDF are the same document — watermark, branding, totals and
 * all.
 *
 * `scale: 2` doubles the pixel density, so the PNG is roughly 1588px wide on
 * A4 and stays crisp when a customer opens it on a phone or prints it.
 */
export async function htmlToPng(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // A4 at 96dpi. `fullPage` then captures however tall the document
    // actually is, so a long itemisation is never cut off at the fold.
    await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });

    await Promise.race([
      page.evaluate("document.fonts && document.fonts.ready"),
      new Promise((resolve) => setTimeout(resolve, 4_000)),
    ]);

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
