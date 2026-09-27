import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getStorage } from "../lib/storage";
import { verifyFileToken } from "../lib/tokens";
import { pathParam } from "../middleware/validate";

export const filesRouter = Router();

/**
 * Private object storage. Nothing is served without a valid HMAC + expiry,
 * and the endpoint is rate limited so a token can't be brute-forced.
 */
const fileLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many file requests. Slow down.", code: "RATE_LIMITED" },
});

filesRouter.get("/:token", fileLimiter, async (req, res, next) => {
  try {
    const key = verifyFileToken(pathParam(req, "token"));
    if (!key) {
      res
        .status(403)
        .json({ message: "This file link is invalid or has expired.", code: "LINK_INVALID" });
      return;
    }

    const object = await getStorage().get(key);
    if (!object) {
      res.status(404).json({ message: "File not found.", code: "NOT_FOUND" });
      return;
    }

    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (object.contentType === "application/pdf") {
      res.setHeader("Content-Disposition", `inline; filename="${key.split("/").pop()}"`);
    }

    object.stream.on("error", next);
    object.stream.pipe(res);
  } catch (error) {
    next(error);
  }
});
