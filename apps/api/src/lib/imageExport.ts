import { htmlToPng } from "./pdf";
import { renderReceiptHtml, type DocumentData } from "./document";
import { renderInvoiceHtml, type InvoiceDocumentData } from "./invoiceDocument";

/**
 * High-quality PNG export of a document.
 *
 * Rendered from the *same* HTML the PDF is produced from, in the same
 * headless browser, at 2× device scale. That is the whole point: the exported
 * image is the document — same watermark, same branding, same totals — rather
 * than a screenshot of the app's preview pane, which would carry whatever
 * padding, background and chrome the surrounding UI happened to have.
 *
 * `fullPage` captures the document's true height, so a long itemisation is
 * never cut off. Where a document really does run past one page, the caller
 * gets one tall image rather than a silently truncated first page — losing
 * the tail of a receipt would be worse than an extra-long export.
 */

export async function renderReceiptPng(data: DocumentData): Promise<Buffer> {
  return htmlToPng(renderReceiptHtml(data));
}

export async function renderInvoicePng(data: InvoiceDocumentData): Promise<Buffer> {
  return htmlToPng(renderInvoiceHtml(data));
}

/**
 * A download filename for an exported document.
 *
 * Namespaced by document type rather than by organization: the number is
 * already unique per organization, and putting a business name into a
 * filename would leak another tenant's identity into a file the user may
 * forward, upload or email. Also strips anything that could break a
 * `Content-Disposition` header or a filesystem.
 */
export function documentFilename(
  kind: "receipt" | "invoice",
  documentNumber: string,
  extension: "pdf" | "png",
): string {
  const safe = documentNumber.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  return `visionarygene-${kind}-${safe}.${extension}`;
}