import { PrismaClient } from "@prisma/client";
import { AppError } from "./errors";
import { IMMUTABLE_RECEIPT_FIELDS } from "@eleos/shared";

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
const TENANT_MODELS = new Set(["user", "customer", "receipt"]);

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

function createScopedClient(): PrismaClient {
  const base = new PrismaClient();

  const scoped = base.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const lower = String(model).charAt(0).toLowerCase() + String(model).slice(1);

          if (TENANT_MODELS.has(lower) && WRITE_OPERATIONS.has(String(operation))) {
            assertTenantWrite(lower, String(operation), args as Args);
          }
          if (lower === "receipt") {
            assertReceiptImmutable(String(operation), args as Args);
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
