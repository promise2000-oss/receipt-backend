import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * The audit trail.
 *
 * A single `record()` entry point so the shape of an event is decided in one
 * place, and so every call site is forced to name a tenant. There is
 * deliberately no update and no delete: the log is append-only, and the API
 * exposes no route that can modify a row.
 *
 * Recording is best-effort by design. `record()` never throws — an audit
 * failure must not roll back the business operation the user actually asked
 * for (a receipt was genuinely issued; losing it because a log insert hit a
 * constraint would be worse than a missing log line). The one exception is a
 * missing tenant id, which is a programming error and throws immediately.
 */

/**
 * Every action the product records.
 *
 * Dotted and past-tense so an entry reads as a sentence
 * ("invoice.issue", "receipt.void") and so grouping by prefix gives a
 * per-resource view for free.
 */
export const AUDIT_ACTIONS = {
  orgCreated: "org.created",
  orgUpdated: "org.updated",
  orgBrandingChanged: "org.branding_changed",
  orgWatermarkChanged: "org.watermark_changed",

  teamInvited: "team.invited",
  teamInvitationRevoked: "team.invitation_revoked",
  teamInvitationAccepted: "team.invitation_accepted",
  teamRoleChanged: "team.role_changed",
  teamMemberRemoved: "team.member_removed",

  customerCreated: "customer.created",
  customerUpdated: "customer.updated",
  customerDeleted: "customer.deleted",

  receiptCreated: "receipt.created",
  receiptVoided: "receipt.voided",
  receiptReissued: "receipt.reissued",

  invoiceCreated: "invoice.created",
  invoiceIssued: "invoice.issued",
  invoiceCancelled: "invoice.cancelled",
  paymentRecorded: "payment.recorded",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  businessId: string;
  /** Null for a system event with no human actor. */
  actorId?: string | null;
  action: AuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  /**
   * Change detail for the reader of the log.
   *
   * Keep it to *what changed* — old/new role, which fields were edited,
   * amounts. Never put a password, a token, a customer phone number or any
   * other sensitive value in here: audit rows are readable by every role with
   * `report.read`, which includes viewers.
   */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append one event.
 *
 * Accepts a transaction client so the event can join the same transaction as
 * the change it describes — an audit entry that could roll back with its own
 * write would be a lie. When that is impractical, pass nothing and it lands on
 * the pool immediately.
 */
export async function record(
  input: AuditInput,
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  if (!input.businessId) {
    throw new Error("audit.record requires a businessId — audit rows are never global.");
  }

  const db = client ?? prismaClient;

  try {
    await db.auditEvent.create({
      data: {
        business_id: input.businessId,
        actor_id: input.actorId ?? null,
        action: input.action,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    // Never let auditing break the operation it is describing.
    // eslint-disable-next-line no-console
    console.error("[audit] failed to record event:", input.action, error);
  }
}

/**
 * The bare Prisma client, assigned once at module load.
 *
 * Held separately from `lib/prisma`'s extended client so an audit write can
 * never trip the tenant-write guard (which demands a `business_id` on every
 * row) — this call site supplies it explicitly instead.
 */
const prismaClient = new PrismaClient();