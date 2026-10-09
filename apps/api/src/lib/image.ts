import { AppError } from "./errors";

/**
 * Pixel-dimension bounds for uploaded brand art.
 *
 * Type and byte size are enforced by multer's `fileFilter`/`limits`, but those
 * alone do not stop a 40,000×40,000 PNG that weighs 80 KB: it decodes to a
 * multi-gigabyte bitmap in whichever renderer looks at it — the browser on the
 * receipt page, or the PDF engine when the logo is stamped onto the document.
 * Reading the header is cheap, so the check belongs before the bytes are stored
 * rather than after something has already tried to draw them.
 */
export const MIN_LOGO_EDGE = 16;
export const MAX_LOGO_EDGE = 8192;

export interface Dimensions {
  width: number;
  height: number;
}

/** `in`/`cm`/`mm`/`pt` resolved against the 96 CSS px an inch is defined as. */
const UNIT_SCALE: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

function lengthAttribute(text: string, name: string): number | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*["']\\s*([0-9]*\\.?[0-9]+)\\s*([a-z%]*)\\s*["']`,
    "i",
  ).exec(text);
  if (!match) return null;
  const scale = UNIT_SCALE[(match[2] || "px").toLowerCase()];
  // A percentage or unknown unit means nothing on its own — fall through to
  // the viewBox rather than inventing a size.
  if (scale === undefined) return null;
  return parseFloat(match[1]) * scale;
}

/**
 * SVG is text, so it needs its own reader: `width`/`height` when stated (with
 * real unit conversion), otherwise the viewBox, which is what a scalable logo
 * actually declares.
 */
function svgDimensions(text: string): Dimensions | null {
  const width = lengthAttribute(text, "width");
  const height = lengthAttribute(text, "height");
  if (width && height) return { width, height };

  const viewBox = /\bviewBox\s*=\s*["']\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+([0-9.eE]+)\s+([0-9.eE]+)\s*["']/i.exec(
    text,
  );
  if (viewBox) {
    const width = parseFloat(viewBox[1]);
    const height = parseFloat(viewBox[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/** PNG's fixed eight-byte signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buffer: Buffer): Dimensions | null {
  // 8-byte signature, 4-byte length, "IHDR", then width then height (BE32).
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifDimensions(buffer: Buffer): Dimensions | null {
  // GIF87a and GIF89a both open with "GIF8"; without this a PNG handed over
  // as a GIF would be read as whatever those offset bytes happen to be.
  if (buffer.length < 10 || buffer.toString("ascii", 0, 4) !== "GIF8") return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/** Start-of-frame markers that carry the frame size (progressive SOF9+ included). */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(buffer: Buffer): Dimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    // Fill bytes and standalone markers (RSTn, SOI, EOI) carry no length.
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (offset + 9 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): Dimensions | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8X") {
    // flags, reserved, then canvas size minus one as three little-endian bytes.
    return {
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
    };
  }

  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }

  if (chunk === "VP8 ") {
    // Frame tag, then 0x9D 0x01 0x2A sync code, then the two 14-bit sizes.
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  return null;
}

/**
 * Read a bitmap's pixel size from its header, or `null` when the format does
 * not cooperate (or the magic bytes do not match the declared MIME type, which
 * is worth noticing on its own).
 *
 * No pixels are decoded — only the fixed header positions — so this cannot be
 * made to allocate anything large regardless of what the file claims.
 */
export function imageDimensions(buffer: Buffer, mime: string): Dimensions | null {
  switch (mime) {
    case "image/png":
      return pngDimensions(buffer);
    case "image/gif":
      return gifDimensions(buffer);
    case "image/jpeg":
      return jpegDimensions(buffer);
    case "image/webp":
      return webpDimensions(buffer);
    case "image/svg+xml": {
      // An XML prolog or doctype may sit before the root, so look for the
      // element itself rather than assuming the file opens with it.
      const text = buffer.toString("utf8", 0, 8192);
      return /<svg\b/i.test(text) ? svgDimensions(text) : null;
    }
    default:
      return null;
  }
}

/**
 * Validate an uploaded logo's pixel dimensions.
 *
 * Undecodable headers are rejected rather than waved through: the image goes
 * straight into a receipt and a PDF, both of which will try to decode it, so
 * "we could not establish it is a real, sane image" is a reason to stop here
 * instead of finding out downstream.
 */
export function assertLogoDimensions(buffer: Buffer, mime: string): void {
  const size = imageDimensions(buffer, mime);
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    throw new AppError(
      "That file's dimensions could not be read — please upload a standard PNG, JPEG, WebP, GIF or SVG.",
      422,
      "BAD_IMAGE",
    );
  }

  const edge = Math.max(size.width, size.height);
  const shortest = Math.min(size.width, size.height);

  if (shortest < MIN_LOGO_EDGE) {
    throw new AppError(
      `Logo must be at least ${MIN_LOGO_EDGE}×${MIN_LOGO_EDGE} pixels.`,
      422,
      "IMAGE_TOO_SMALL",
    );
  }
  if (edge > MAX_LOGO_EDGE) {
    throw new AppError(
      `Logo must be no larger than ${MAX_LOGO_EDGE}×${MAX_LOGO_EDGE} pixels.`,
      422,
      "IMAGE_TOO_LARGE",
    );
  }
}
