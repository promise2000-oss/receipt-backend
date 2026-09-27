import type { Browser } from "puppeteer";
import { env } from "./env";
import { renderReceiptHtml, type DocumentData } from "./document";

let browserPromise: Promise<Browser> | null = null;
let executableHinted = false;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--font-render-hinting=none",
  "--disable-gpu",
];

async function launchBrowser(): Promise<Browser> {
  const base = { headless: true as const, args: LAUNCH_ARGS };

  if (env.puppeteerExecutablePath) {
    return puppeteerLaunch({ ...base, executablePath: env.puppeteerExecutablePath });
  }

  try {
    // Bundled Chromium, downloaded during `npm install`.
    return await puppeteerLaunch(base);
  } catch (bundledError) {
    if (!executableHinted) {
      executableHinted = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[pdf] Bundled Chromium unavailable, falling back to an installed Chrome.\n" +
          `      ${String((bundledError as Error)?.message ?? bundledError).split("\n")[0]}`,
      );
    }
    // Fall back to whatever Chrome/Chromium is on the machine.
    return await puppeteerLaunch({ ...base, channel: "chrome" });
  }
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

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => undefined);
}
