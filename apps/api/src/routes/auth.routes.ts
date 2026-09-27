import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  loginSchema,
  signupSchema,
  type AuthDTO,
} from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import {
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  signSession,
  verifyPassword,
} from "../lib/auth";
import { asyncH, parse } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { toBusinessDTO, toUserDTO } from "../mappers";

export const authRouter = Router();

async function loadAuthContext(userId: string, businessId: string): Promise<AuthDTO> {
  const [user, business] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, business_id: businessId } }),
    prisma.business.findFirst({ where: { id: businessId } }),
  ]);

  if (!user || !business) {
    throw new AppError("Your account is no longer available.", 401, "UNAUTHORIZED");
  }

  return { user: toUserDTO(user), business: await toBusinessDTO(business) };
}

/**
 * Signup creates the Business and its owner User in a single transaction —
 * a half-registered account (business without owner, or the reverse) is
 * never observable.
 */
authRouter.post(
  "/signup",
  asyncH(async (req, res) => {
    const input = parse(signupSchema, req.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.user.email },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        "An account with that email already exists. Try signing in instead.",
        409,
        "EMAIL_TAKEN",
        { field: "user.email" },
      );
    }

    const passwordHash = await hashPassword(input.user.password);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: {
            name: input.business.name,
            email: input.business.email ?? input.user.email,
            phone: input.business.phone ?? null,
            address: input.business.address ?? null,
            currency: input.business.currency ?? "NGN",
            number_prefix: input.business.number_prefix || "ES",
          },
        });

        const user = await tx.user.create({
          data: {
            business_id: business.id,
            full_name: input.user.full_name,
            email: input.user.email,
            password_hash: passwordHash,
            phone: input.user.phone ?? null,
            role: "owner",
          },
        });

        return { user, business };
      });

      setSessionCookie(
        res,
        signSession({
          userId: result.user.id,
          businessId: result.business.id,
          role: "owner",
          email: result.user.email,
        }),
      );

      res.status(201).json({
        user: toUserDTO(result.user),
        business: await toBusinessDTO(result.business),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          "An account with that email already exists.",
          409,
          "EMAIL_TAKEN",
        );
      }
      throw error;
    }
  }),
);

authRouter.post(
  "/login",
  asyncH(async (req, res) => {
    const input = parse(loginSchema, req.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Same error for unknown email and wrong password: never reveal which.
    const valid = user ? await verifyPassword(input.password, user.password_hash) : false;
    if (!user || !valid) {
      throw new AppError("Incorrect email or password.", 401, "INVALID_CREDENTIALS");
    }

    setSessionCookie(
      res,
      signSession({
        userId: user.id,
        businessId: user.business_id,
        role: user.role,
        email: user.email,
      }),
    );

    res.json(await loadAuthContext(user.id, user.business_id));
  }),
);

authRouter.post(
  "/logout",
  asyncH(async (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncH(async (req, res) => {
    const auth = req.auth!;
    res.json(await loadAuthContext(auth.userId, auth.businessId));
  }),
);
