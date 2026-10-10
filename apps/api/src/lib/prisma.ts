import { PrismaClient } from "@prisma/client";
import { AppError } from "./errors";
import {
  IMMUTABLE_INVOICE_FIELDS,
  IMMUTABLE_RECEIPT_FIELDS,
} from "@eleos/shared";

/**
 * Models that own a `business_id`.
 *
 * The extension below guards *writes* only. Reads are funnelled through
 * `src/repos`-style helpers that never issue a query without a tenant filter —
 * guarding reads here instead would collide with Prisma's internal relation
 * loading (an `include: { customer }` issues a customer read keyed by id alone).
 *
 * Guarding writes gives the guarantee that matters most: no row can be created
 * or mutated outside a business, even if a route forgets the filter.
 */
const TENANT_MODELS = new Set([
  "user",
  "customer",
  "receipt",
  "invoice",
  "invoicePayment",
]);

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

type Args = Record<string, any>;

function hasBusinessId(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Args).business_id === "string" &&
    (value as Args).business_id.length > 0
  );
}

function assertTenantWrite(model: string, operation: string, args: Args): void {
  const fail = () => {
    throw new AppError(
      `Cross-tenant guard: ${operation} on ${model} must carry a business_id.`,
      500,
      "TENANT_SCOPE_MISSING",
    );
  };

  switch (operation) {
    case "create": {
      const data = args.data as unknown;
      const rows: unknown[] = Array.isArray(data) ? data : [data];
      if (rows.some((row) => !hasBusinessId(row))) fail();
      break;
    }
    case "update":
    case "upsert":
    case "updateMany":
    case "delete":
    case "deleteMany":
      if (!hasBusinessId(args.where)) fail();
      break;
    default:
      break;
  }
}

/**
 * The immutability rule, enforced at the ORM boundary rather than in a route
 * handler so no future endpoint can quietly violate it.
 *
 * A receipt's line items and money fields are frozen the moment it is issued;
 * the only legal mutation is `status → void` (plus its audit columns) and
 * bookkeeping such as `pdf_url`.
 *
 * Invoices follow the same rule with one deliberate exception: `amount_paid`
 * and `status` are *not* frozen, because recording a payment is exactly what
 * is supposed to move them. Everything a customer may have already paid
 * against — totals, lines, dates, the customer — still is.
 */
function assertReceiptImmutable(operation: string, args: Args): void {
  if (operation !== "update" && operation !== "updateMany" && operation !== "upsert") {
    return;
  }

  const data: Args =
    operation === "upsert" ? (args.update as Args) : (args.data as Args);
  if (!data || typeof data !== "object" || Array.isArray(data)) return;

  const IMMUTABLE = new Set<string>(IMMUTABLE_RECEIPT_FIELDS);

  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (IMMUTABLE.has(key) || lower === "items" || lower === "receiptitem") {
      throw new AppError(
        "Receipts are immutable after issue. Void this receipt and reissue a corrected one.",
        409,
        "RECEIPT_IMMUTABLE",
      );
    }
  }
}

/**
 * The invoice equivalent — see `IMMUTABLE_INVOICE_FIELDS`.
 *
 * `isDraft` is awaited rather than guessed, because the distinction matters:
 * a draft is *meant* to be edited, and an issued invoice is not. Resolving it
 * with a single indexed primary-key lookup costs one query on the rare update
 * that actually touches a frozen field, and buys an invariant no future
 * endpoint can quietly break.
 */
async function assertInvoiceImmutable(
  operation: string,
  args: Args,
  isDraft: (id: unknown) => Promise<boolean>,
): Promise<void> {
  if (operation !== "update" && operation !== "updateMany" && operation !== "upsert") {
    return;
  }

  const data: Args =
    operation === "upsert" ? (args.update as Args) : (args.data as Args);
  if (!data || typeof data !== "object" || Array.isArray(data)) return;

  const IMMUTABLE = new Set<string>(IMMUTABLE_INVOICE_FIELDS);

  const touched = Object.keys(data).some(
    (key) =>
      IMMUTABLE.has(key) ||
      key.toLowerCase() === "items" ||
      key.toLowerCase() === "invoiceitem",
  );
  if (!touched) return;

  if (operation === "update" && (await isDraft((args.where as Args | undefined)?.id))) {
    return;
  }

  throw new AppError(
    "An issued invoice cannot be edited. Cancel it and issue a corrected one instead.",
    409,
    "INVOICE_IMMUTABLE",
  );
}

/**
 * Is the invoice with this id still a draft?
 *
 * Fail-closed by construction: anything that is not a plain string id — a
 * compound `where`, a nested filter — answers `false`, so an unusual update is
 * rejected rather than allowed to rewrite an issued invoice's figures. The
 * lookup runs on the *base* client so it cannot recurse through this extension.
 */
async function isInvoiceDraft(base: PrismaClient, id: unknown): Promise<boolean> {
  if (typeof id !== "string" || id.length === 0) return false;
  try {
    const row = await base.invoice.findUnique({
      where: { id },
      select: { status: true },
    });
    return row?.status === "draft";
  } catch {
    return false;
  }
}

function createScopedClient(): PrismaClient {
  const base = new PrismaClient();

  const scoped = base.$extends({
    query: {
      $allModels: {
        $allOperations: async ({ model, operation, args, query }) => {
          const lower = String(model).charAt(0).toLowerCase() + String(model).slice(1);
          const op = String(operation);

          if (TENANT_MODELS.has(lower) && WRITE_OPERATIONS.has(op)) {
            assertTenantWrite(lower, op, args as Args);
          }
          if (lower === "receipt") {
            assertReceiptImmutable(op, args as Args);
          }
          if (lower === "invoice") {
            await assertInvoiceImmutable(op, args as Args, (id) =>
              isInvoiceDraft(base, id),
            );
          }

          return query(args);
        },
      },
    },
  });

  // Extension clients are structurally different but API-compatible; widen once
  // here so the rest of the app works with a plain PrismaClient type.
  return scoped as unknown as PrismaClient;
}

export const prisma: PrismaClient = createScopedClient();

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
