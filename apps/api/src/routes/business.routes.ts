import { Router } from "express";
import multer from "multer";
import { businessUpdateSchema } from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError, notFound } from "../lib/errors";
import { asyncH, parse } from "../middleware/validate";
import { requireAuth, requireOwner } from "../middleware/requireAuth";
import { record, AUDIT_ACTIONS } from "../lib/audit";
import { logoKey, getStorage } from "../lib/storage";
import { assertLogoDimensions } from "../lib/image";
import { toBusinessDTO } from "../mappers";

export const businessRouter = Router();

businessRouter.use(requireAuth);

/** 3 MB is generous for a logo and keeps memory-storage uploads predictable. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];
    if (!allowed.includes(file.mimetype)) {
      cb(new AppError("Logo must be a PNG, JPEG, WebP or SVG file.", 422, "BAD_FILE_TYPE"));
      return;
    }
    cb(null, true);
  },
});

businessRouter.get(
  "/",
  asyncH(async (req, res) => {
    const business = await prisma.business.findFirst({
      where: { id: req.auth!.businessId },
    });
    if (!business) throw notFound("Business");
    res.json(await toBusinessDTO(business));
  }),
);

businessRouter.patch(
  "/",
  requireOwner,
  asyncH(async (req, res) => {
    const input = parse(businessUpdateSchema, req.body);

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) data[key] = value;
    }

    const business = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data,
    });

    // A branding or watermark change is recorded separately from a plain
    // details edit: it changes what every future document looks like, which is
    // exactly the kind of event an owner needs to be able to find later.
    const BRANDING_FIELDS = ["brand_primary", "brand_accent"] as const;
    const WATERMARK_FIELDS = [
      "watermark_enabled",
      "watermark_text",
      "watermark_opacity",
    ] as const;

    const touched = Object.keys(data);
    const branding = touched.filter((f) =>
      (BRANDING_FIELDS as readonly string[]).includes(f),
    );
    const watermark = touched.filter((f) =>
      (WATERMARK_FIELDS as readonly string[]).includes(f),
    );

    await record({
      businessId: req.auth!.businessId,
      actorId: req.auth!.userId,
      action: AUDIT_ACTIONS.orgUpdated,
      resourceType: "business",
      resourceId: req.auth!.businessId,
      metadata: { fields: touched },
    });

    if (branding.length > 0) {
      await record({
        businessId: req.auth!.businessId,
        actorId: req.auth!.userId,
        action: AUDIT_ACTIONS.orgBrandingChanged,
        resourceType: "business",
        resourceId: req.auth!.businessId,
        metadata: { fields: branding },
      });
    }

    if (watermark.length > 0) {
      await record({
        businessId: req.auth!.businessId,
        actorId: req.auth!.userId,
        action: AUDIT_ACTIONS.orgWatermarkChanged,
        resourceType: "business",
        resourceId: req.auth!.businessId,
        metadata: { fields: watermark },
      });
    }

    res.json(await toBusinessDTO(business));
  }),
);

businessRouter.post(
  "/logo",
  requireOwner,
  upload.single("logo"),
  asyncH(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new AppError("Choose a logo file to upload.", 422, "FILE_REQUIRED");
    }

    // Before anything is written: type and byte size came from multer, and the
    // pixel size is the last thing that could make this expensive to render.
    assertLogoDimensions(file.buffer, file.mimetype);

    const key = logoKey(req.auth!.businessId, file.originalname || "logo");
    await getStorage().put(key, file.buffer, file.mimetype);

    const current = await prisma.business.findFirst({
      where: { id: req.auth!.businessId },
      select: { logo_url: true },
    });
    if (!current) throw notFound("Business");

    const business = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data: { logo_url: key },
    });

    // Replace, don't accumulate: the previous file is private storage garbage.
    if (current.logo_url && current.logo_url !== key) {
      await getStorage().remove(current.logo_url).catch(() => undefined);
    }

    res.json(await toBusinessDTO(business));
  }),
);

businessRouter.delete(
  "/logo",
  requireOwner,
  asyncH(async (req, res) => {
    const current = await prisma.business.findFirst({
      where: { id: req.auth!.businessId },
      select: { logo_url: true },
    });
    if (!current) throw notFound("Business");

    const business = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data: { logo_url: null },
    });

    if (current.logo_url) {
      await getStorage().remove(current.logo_url).catch(() => undefined);
    }

    res.json(await toBusinessDTO(business));
  }),
);
