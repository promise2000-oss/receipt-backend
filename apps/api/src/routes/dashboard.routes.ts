import { Router } from "express";
import type { Prisma } from "@prisma/client";
import type { DashboardSummaryDTO, TotalsCard } from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { asyncH } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { toReceiptDTOs } from "../mappers";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek(): Date {
  // Week starts on Monday.
  const today = startOfToday();
  const day = today.getDay(); // 0 = Sunday
  const offset = day === 0 ? 6 : day - 1;
  today.setDate(today.getDate() - offset);
  return today;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function endOfToday(): Date {
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return end;
}

async function windowedTotal(
  businessId: string,
  from: Date,
  to: Date,
  extra: Prisma.ReceiptWhereInput = {},
): Promise<TotalsCard> {
  const result = await prisma.receipt.aggregate({
    where: {
      business_id: businessId,
      // Voided receipts never count towards revenue.
      status: "active",
      issue_date: { gte: from, lt: to },
      ...extra,
    },
    _count: { _all: true },
    _sum: { total: true },
  });

  return {
    count: result._count._all,
    total: Number(result._sum.total ?? 0),
  };
}

/**
 * Three summary cards (Today / This Week / This Month) plus outstanding
 * balance and the most recent receipts.
 */
dashboardRouter.get(
  "/summary",
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const now = new Date();

    const [today, week, month, outstanding, recent, business] = await Promise.all([
      windowedTotal(businessId, startOfToday(), endOfToday()),
      windowedTotal(businessId, startOfWeek(), endOfToday()),
      windowedTotal(businessId, startOfMonth(), endOfToday()),
      windowedTotal(businessId, new Date(0), now, {
        payment_status: { in: ["pending", "partial"] },
      }),
      prisma.receipt.findMany({
        where: { business_id: businessId },
        include: { items: { orderBy: { position: "asc" } }, customer: true },
        orderBy: { created_at: "desc" },
        take: 8,
      }),
      prisma.business.findFirst({
        where: { id: businessId },
        select: { currency: true },
      }),
    ]);

    const payload: DashboardSummaryDTO = {
      currency: business?.currency ?? "NGN",
      today,
      week,
      month,
      outstanding,
      recent: await toReceiptDTOs(recent),
    };

    res.json(payload);
  }),
);
