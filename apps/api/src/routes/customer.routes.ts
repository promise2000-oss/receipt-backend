import { Router } from "express";
import { customerSchema } from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError, notFound } from "../lib/errors";
import { asyncH, parse, pathParam } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/requireAuth";
import { toCustomerDTO } from "../mappers";

export const customerRouter = Router();

customerRouter.use(requireAuth);

/**
 * All customer queries are keyed by `business_id` from the session — a
 * customer id belonging to another tenant simply resolves to "not found".
 */
customerRouter.get(
  "/",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const search = String(req.query.search ?? "").trim();

    const where = {
      business_id: businessId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 200,
      include: { _count: { select: { receipts: true } } },
    });

    res.json({
      items: customers.map((c) => toCustomerDTO(c, c._count.receipts)),
      total: customers.length,
    });
  }),
);

/**
 * Read access is granted to every role; writes are not.
 *
 * A `viewer` can look up a customer's receipt history — which is the point of
 * giving them read access — but cannot create, rename or delete one.
 */
customerRouter.post(
  "/",
  requirePermission("customer.create"),
  asyncH(async (req, res) => {
    const input = parse(customerSchema, req.body);

    const customer = await prisma.customer.create({
      data: {
        business_id: req.auth!.businessId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
      },
    });

    res.status(201).json(toCustomerDTO(customer, 0));
  }),
);

customerRouter.patch(
  "/:id",
  requirePermission("customer.update"),
  asyncH(async (req, res) => {
    const input = parse(customerSchema, req.body);

    const existing = await prisma.customer.findFirst({
      where: { id: pathParam(req, "id"), business_id: req.auth!.businessId },
    });
    if (!existing) throw notFound("Customer");

    const customer = await prisma.customer.update({
      where: { id: existing.id, business_id: req.auth!.businessId },
      data: {
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
      },
    });

    res.json(toCustomerDTO(customer));
  }),
);

customerRouter.delete(
  "/:id",
  requirePermission("customer.delete"),
  asyncH(async (req, res) => {
    const existing = await prisma.customer.findFirst({
      where: { id: pathParam(req, "id"), business_id: req.auth!.businessId },
      select: { id: true },
    });
    if (!existing) throw notFound("Customer");

    // Receipts keep their own record: the FK is ON DELETE SET NULL, so
    // removing a customer never removes issued receipts.
    await prisma.customer.delete({
      where: { id: existing.id, business_id: req.auth!.businessId },
    });

    res.json({ ok: true });
  }),
);

customerRouter.get(
  "/:id",
  asyncH(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: pathParam(req, "id"), business_id: req.auth!.businessId },
      include: { _count: { select: { receipts: true } } },
    });
    if (!customer) throw notFound("Customer");
    res.json(toCustomerDTO(customer, customer._count.receipts));
  }),
);
