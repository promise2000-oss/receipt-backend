import {
  resolveWatermark,
  watermarkStyle,
  type WatermarkConfig,
} from "@eleos/shared";

/**
 * The VisionaryGene document watermark.
 *
 * This is painted into the HTML template that Puppeteer turns into the PDF,
 * so it is a real layer of the exported file — not a CSS overlay the browser
 * happens to show on screen. Anything drawn here survives being printed,
 * saved, emailed or screenshotted, which is the entire point of a watermark.
 *
 * Two positioning rules do the work:
 *
 *  - **Screen / single page** — `position: absolute` inside `.frame`, centred.
 *    The frame is the document box, so the mark lands in the middle of the
 *    page regardless of how long the receipt is.
 *  - **Print / multi-page** — `position: fixed`, which Chromium repeats on
 *    *every* page it paginates. A three-page invoice therefore carries the
 *    watermark three times, which is what "position the watermark
 *    appropriately on each page" has to mean in practice.
 *
 * It sits at `z-index: 0` beneath the header band, table and totals, and its
 * opacity is capped by `resolveWatermark`, so no tenant can turn it into a
 * veil over its own figures.
 */

/** Degrees of rotation. Mid-way through the 35–45° band the spec asks for. */
export const WATERMARK_ROTATION_DEG = -38;

/**
 * Font size for a given watermark string.
 *
 * Computed rather than left to CSS so the result is deterministic and can be
 * asserted in a unit test: a longer string has to be smaller to keep the
 * rotated run inside the page instead of bleeding off both edges. Measured
 * against the ~760px document width at 96dpi.
 */
export function watermarkFontSize(text: string): number {
  const length = Math.max(1, text.trim().length);
  // ~0.62em average advance for the uppercase display face in use.
  const projected = length * 0.62;
  const maxSize = Math.floor(760 / projected);
  return Math.max(34, Math.min(132, maxSize));
}

/**
 * The watermark's CSS rule — emitted only when the watermark is actually on.
 *
 * Returning the stylesheet alongside the markup keeps the two in sync by
 * construction: a document with the watermark disabled carries neither the
 * rule nor the element, so a tenant who turns it off gets a genuinely
 * unwatermarked file rather than a dead CSS class.
 */
export function watermarkCss(enabled = true): string {
  if (!enabled) return "";

  return `
  /* ---- VisionaryGene watermark -----------------------------------------
     absolute on screen (centred in the document box), fixed in print so
     Chromium repeats it on every page. Behind everything: z-index 0. */
  .vg-watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(${WATERMARK_ROTATION_DEG}deg);
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-weight: 800;
    letter-spacing: 0.14em;
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }

  @media print {
    .vg-watermark { position: fixed; }
  }`;
}

/**
 * The watermark element, or an empty string when the tenant has turned it off.
 *
 * Returns markup rather than a bare string so the caller interpolates it in
 * exactly one place, and so `aria-hidden` keeps it out of the accessibility
 * tree — it is decoration over a document that already states its issuer.
 */
export function watermarkHtml(input: Partial<WatermarkConfig> | null | undefined): string {
  const config = resolveWatermark(input);
  if (!config.enabled) return "";

  return `<div class="vg-watermark" aria-hidden="true" style="font-size:${watermarkFontSize(
    config.text,
  )}px;color:${watermarkStyle(config)};">${escapeText(config.text)}</div>`;
}

/**
 * CSS + markup in one call, resolved once.
 *
 * The templates call this rather than the two functions separately so the
 * stylesheet and the element can never disagree about whether the watermark is
 * on — the bug that would otherwise leave a disabled tenant's PDF carrying
 * latent styling for an element that isn't there.
 */
export function renderWatermark(
  input: Partial<WatermarkConfig> | null | undefined,
): { css: string; html: string } {
  const config = resolveWatermark(input);
  if (!config.enabled) return { css: "", html: "" };

  return {
    css: watermarkCss(true),
    html: watermarkHtml(config),
  };
}

/**
 * Escape the watermark text.
 *
 * It is owner-supplied and lands inside a `<div>`, so it is escaped exactly
 * like every other interpolated value in the document — a tenant cannot inject
 * markup into its own PDF, let alone into another tenant's.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}