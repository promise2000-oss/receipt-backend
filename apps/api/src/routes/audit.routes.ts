import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncH } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/requireAuth";

/**
 * Reading the audit trail.
 *
 * Read-only by construction: this router registers `GET` and nothing else, so
 * there is no route — here or anywhere else in the API — that can update or
 * delete an audit row. The log is append-only by the absence of any other
 * affordance, not by a convention someone has to remember.
 *
 * Every query is filtered by `req.auth.businessId`, so one organization can
 * never see another's activity.
 */

export const auditRouter = Router();

auditRouter.use(requireAuth);

/**
 * `report.read` rather than a dedicated `audit.read`.
 *
 * Reading the log is reporting: an owner reviewing who voided a receipt, or a
 * viewer checking the workspace's history, are both reporting tasks. Splitting
 * it into a separate permission would let somebody see that "40 voids happened
 * last month" without being able to see the rows behind it.
 */
auditRouter.get(
  "/",
  requirePermission("report.read"),
  asyncH(async (req, res) => {
    const q = req.query;

    const action = String(q.action ?? "").trim();
    const resourceType = String(q.resource_type ?? "").trim();
    const resourceId = String(q.resource_id ?? "").trim();
    const from = q.from ? String(q.from) : "";
    const to = q.to ? String(q.to) : "";
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50) || 50));

    // The tenant scope is set here and nowhere else — it is never assembled
    // from anything the caller sent.
    const where: Prisma.AuditEventWhereInput = { business_id: req.auth!.businessId };

    if (action) where.action = action;
    if (resourceType) where.resource_type = resourceType;
    if (resourceId) where.resource_id = resourceId;
    if (from || to) {
      where.created_at = {
        ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
      };
    }

    const [total, rows, actions] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: { select: { id: true, full_name: true, email: true } },
        },
      }),
      prisma.auditEvent.findMany({
        where: { business_id: req.auth!.businessId },
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        metadata: row.metadata ?? null,
        created_at: row.created_at.toISOString(),
        actor: row.actor
          ? { id: row.actor.id, full_name: row.actor.full_name, email: row.actor.email }
          : null,
      })),
      total,
      page,
      limit,
      /** The action vocabulary actually present in this tenant's log. */
      actions: actions.map((row) => row.action),
    });
  }),
);