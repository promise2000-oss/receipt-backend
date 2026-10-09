import { describe, expect, it } from "vitest";
import {
  MAX_LOGO_EDGE,
  MIN_LOGO_EDGE,
  assertLogoDimensions,
  imageDimensions,
} from "../src/lib/image";
import { AppError } from "../src/lib/errors";

/**
 * Header-only fixtures: these build the bytes a real encoder would write for
 * the fields we read, and deliberately stop before any pixel data — which is
 * also the proof that nothing here needs to (or can) decode an image to find
 * out how big it is.
 */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.writeUInt32BE(0, 24);
  buffer.write("IDAT", 28, "ascii");
  return buffer;
}

function gif(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(13);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

function jpeg(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  // JFIF APP0: marker, length 16, 14 payload bytes.
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer.writeUInt16BE(16, 4);
  // SOI + APP0 puts the next marker at offset 20.
  buffer[20] = 0xff;
  buffer[21] = 0xc0;
  buffer.writeUInt16BE(17, 22);
  buffer[24] = 8; // sample precision
  buffer.writeUInt16BE(height, 25);
  buffer.writeUInt16BE(width, 27);
  return buffer;
}

function webpLossless(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(24, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8L", 12, "ascii");
  buffer.writeUInt32LE(12, 16);
  buffer[20] = 0x2f;
  buffer.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return buffer;
}

function webpExtended(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer[24] = (width - 1) & 0xff;
  buffer[25] = ((width - 1) >> 8) & 0xff;
  buffer[26] = ((width - 1) >> 16) & 0xff;
  buffer[27] = (height - 1) & 0xff;
  buffer[28] = ((height - 1) >> 8) & 0xff;
  buffer[29] = ((height - 1) >> 16) & 0xff;
  return buffer;
}

function webpLossy(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer[23] = 0x9d;
  buffer[24] = 0x01;
  buffer[25] = 0x2a;
  buffer.writeUInt16LE(width & 0x3fff, 26);
  buffer.writeUInt16LE(height & 0x3fff, 28);
  return buffer;
}

const code = (fn: () => void): string => {
  try {
    fn();
    return "(no error)";
  } catch (error) {
    return error instanceof AppError ? error.code : `not-an-AppError: ${error}`;
  }
};

describe("imageDimensions", () => {
  it("reads PNG, GIF, JPEG and all three WebP flavours", () => {
    expect(imageDimensions(png(1024, 512), "image/png")).toEqual({
      width: 1024,
      height: 512,
    });
    expect(imageDimensions(gif(64, 64), "image/gif")).toEqual({
      width: 64,
      height: 64,
    });
    expect(imageDimensions(jpeg(800, 600), "image/jpeg")).toEqual({
      width: 800,
      height: 600,
    });
    expect(imageDimensions(webpLossless(77, 31), "image/webp")).toEqual({
      width: 77,
      height: 31,
    });
    expect(imageDimensions(webpExtended(1920, 1080), "image/webp")).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(imageDimensions(webpLossy(640, 480), "image/webp")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads SVG size, converting real units", () => {
    expect(
      imageDimensions(Buffer.from('<svg width="256" height="128"></svg>'), "image/svg+xml"),
    ).toEqual({ width: 256, height: 128 });

    // 2 inches is 192 CSS pixels, as is 144 points at 96 px/in.
    expect(
      imageDimensions(Buffer.from('<svg width="2in" height="144pt"></svg>'), "image/svg+xml"),
    ).toEqual({ width: 192, height: 192 });
  });

  it("falls back to the viewBox when the SVG has no intrinsic size", () => {
    expect(
      imageDimensions(Buffer.from('<svg viewBox="0 0 640 480"></svg>'), "image/svg+xml"),
    ).toEqual({ width: 640, height: 480 });
    expect(
      imageDimensions(
        Buffer.from('<svg width="100%" viewBox="0 -10 300 200"></svg>'),
        "image/svg+xml",
      ),
    ).toEqual({ width: 300, height: 200 });
  });

  it("returns null when the bytes do not match the declared type", () => {
    expect(imageDimensions(png(10, 10), "image/gif")).toBeNull();
    expect(imageDimensions(gif(10, 10), "image/png")).toBeNull();
    expect(imageDimensions(Buffer.from("not an image at all"), "image/jpeg")).toBeNull();
    expect(imageDimensions(Buffer.from("<svg></svg>"), "image/svg+xml")).toBeNull();
    expect(imageDimensions(Buffer.alloc(0), "image/png")).toBeNull();
    expect(imageDimensions(png(10, 10), "application/pdf")).toBeNull();
  });

  it("does not need the pixels to know the size", () => {
    // Header only, but declaring a size that would be ~6 GB decoded. Reading
    // it must be instant and allocation-free, then refused on those grounds.
    const claim = png(50_000, 50_000);
    expect(imageDimensions(claim, "image/png")).toEqual({
      width: 50_000,
      height: 50_000,
    });
    expect(claim.length).toBeLessThan(64);
  });
});

describe("assertLogoDimensions", () => {
  it("accepts anything inside the window", () => {
    expect(() => assertLogoDimensions(png(MIN_LOGO_EDGE, MIN_LOGO_EDGE), "image/png")).not.toThrow();
    expect(() => assertLogoDimensions(png(MAX_LOGO_EDGE, MAX_LOGO_EDGE), "image/png")).not.toThrow();
    expect(() => assertLogoDimensions(png(512, 512), "image/png")).not.toThrow();
    // A wide banner is fine — only the shortest edge has to be usable.
    expect(() => assertLogoDimensions(png(MAX_LOGO_EDGE, 32), "image/png")).not.toThrow();
  });

  it("refuses a logo too small to reproduce", () => {
    expect(code(() => assertLogoDimensions(png(8, 8), "image/png"))).toBe("IMAGE_TOO_SMALL");
    expect(code(() => assertLogoDimensions(png(512, 4), "image/png"))).toBe("IMAGE_TOO_SMALL");
    expect(
      code(() =>
        assertLogoDimensions(Buffer.from('<svg width="4" height="4"></svg>'), "image/svg+xml"),
      ),
    ).toBe("IMAGE_TOO_SMALL");
  });

  it("refuses a logo large enough to be expensive to render", () => {
    expect(code(() => assertLogoDimensions(png(8193, 8193), "image/png"))).toBe("IMAGE_TOO_LARGE");
    expect(code(() => assertLogoDimensions(png(40_000, 40_000), "image/png"))).toBe(
      "IMAGE_TOO_LARGE",
    );
  });

  it("refuses bytes it cannot establish a size for", () => {
    // These are the values that would otherwise sail through to the PDF engine
    // and be discovered there instead.
    expect(code(() => assertLogoDimensions(Buffer.from("plainly text"), "image/png"))).toBe(
      "BAD_IMAGE",
    );
    expect(
      code(() => assertLogoDimensions(Buffer.from("<svg>no size</svg>"), "image/svg+xml")),
    ).toBe("BAD_IMAGE");
    expect(code(() => assertLogoDimensions(png(512, 512), "image/gif"))).toBe("BAD_IMAGE");
  });

  it("reports failures as 422 client errors", () => {
    try {
      assertLogoDimensions(png(4, 4), "image/png");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(422);
      expect((error as AppError).message).toMatch(/at least/i);
    }
  });
});
