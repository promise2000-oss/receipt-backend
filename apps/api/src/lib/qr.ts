import QRCode from "qrcode";

/**
 * Receipt verification QR codes.
 *
 * Rendered as **vector SVG** rather than a raster so the code stays sharp at
 * any print size — a PNG resampled down to the ~35 mm the layout gives it can
 * blur module edges enough to stop scanning.
 *
 * Contrast is fixed at pure black on pure white with a 4-module quiet zone and
 * a white plate painted underneath, so the code keeps its quiet space even
 * when the receipt sits on a tinted background. No logo is overlaid: that
 * would spend the error-correction budget on decoration and make the code
 * fragile on a laser-printed sheet.
 *
 * Returns a `data:` URL so the renderer does not have to trust string
 * interpolation, or null if encoding fails — a missing QR is always better
 * than a broken document.
 */
export async function qrDataUrl(text: string): Promise<string | null> {
  if (!text) return null;

  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  } catch {
    return null;
  }
}
