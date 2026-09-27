/**
 * OpenAPI component schemas.
 *
 * Request bodies are derived from the very Zod schemas the API validates with
 * (`z.toJSONSchema`), so the published request contract cannot drift away from
 * the validation rules. Response bodies are the DTOs exported by
 * `@eleos/shared`, written out as JSON Schema because they are plain
 * TypeScript interfaces.
 */
import { z } from "zod";
import {
  businessUpdateSchema,
  customerSchema,
  emailReceiptSchema,
  loginSchema,
  reissueReceiptSchema,
  receiptCreateSchema,
  shareReceiptSchema,
  signupSchema,
  voidReceiptSchema,
} from "@eleos/shared";

export type Json = Record<string, unknown>;

const str = (description?: string): Json => ({
  type: "string",
  ...(description ? { description } : {}),
});

const num = (description?: string): Json => ({
  type: "number",
  ...(description ? { description } : {}),
});

const nullable = (schema: Json): Json => ({ anyOf: [schema, { type: "null" }] });

const array = (items: Json, description?: string): Json => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

const obj = (properties: Record<string, Json>, required: string[]): Json => ({
  type: "object",
  properties,
  required,
});

export const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const TIMESTAMP = "ISO 8601 timestamp";

/** Zod v4 → JSON Schema, minus the `$schema` key OpenAPI components don't use. */
function fromZod(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json;
  delete json.$schema;
  return json;
}

/** Request bodies — generated from the schemas used at runtime. */
export const requestSchemas: Record<string, Json> = {
  SignupInput: fromZod(signupSchema),
  LoginInput: fromZod(loginSchema),
  BusinessUpdateInput: fromZod(businessUpdateSchema),
  CustomerInput: fromZod(customerSchema),
  ReceiptCreateInput: fromZod(receiptCreateSchema),
  VoidReceiptInput: fromZod(voidReceiptSchema),
  ReissueReceiptInput: fromZod(reissueReceiptSchema),
  EmailReceiptInput: fromZod(emailReceiptSchema),
  ShareReceiptInput: fromZod(shareReceiptSchema),
};

/** Response bodies — the `@eleos/shared` DTOs. */
export const responseSchemas: Record<string, Json> = {
  ApiError: obj(
    {
      message: str("Human-readable message safe to show in the UI."),
      code: str("Machine-readable error code, e.g. NOT_FOUND."),
      details: {
        description:
          "Optional field-level detail. For VALIDATION_ERROR this maps a field path to its message.",
        type: "object",
        additionalProperties: { type: "string" },
      },
    },
    ["message"],
  ),

  Health: obj(
    {
      ok: { type: "boolean" },
      service: str(),
      uptime: num("Seconds since the process started."),
    },
    ["ok", "service", "uptime"],
  ),

  Ok: obj({ ok: { type: "boolean" } }, ["ok"]),

  User: obj(
    {
      id: str(),
      business_id: str(),
      full_name: str(),
      email: str(),
      phone: nullable(str()),
      role: { type: "string", enum: ["owner", "staff"] },
      created_at: str(TIMESTAMP),
    },
    ["id", "business_id", "full_name", "email", "phone", "role", "created_at"],
  ),

  Business: obj(
    {
      id: str(),
      name: str(),
      logo_url: nullable(
        str("Signed, expiring URL to the uploaded logo (private storage)."),
      ),
      address: nullable(str()),
      phone: nullable(str()),
      email: nullable(str()),
      currency: str("ISO 4217 code, e.g. NGN."),
      brand_primary: str("Hex colour used for the receipt header band."),
      brand_accent: str("Hex colour used for the gold rules and total row."),
      number_prefix: str("Prefix of the sequential receipt number, e.g. ES."),
      created_at: str(TIMESTAMP),
    },
    [
      "id",
      "name",
      "logo_url",
      "address",
      "phone",
      "email",
      "currency",
      "brand_primary",
      "brand_accent",
      "number_prefix",
      "created_at",
    ],
  ),

  Auth: obj(
    {
      user: ref("User"),
      business: ref("Business"),
    },
    ["user", "business"],
  ),

  Customer: obj(
    {
      id: str(),
      business_id: str(),
      name: str(),
      phone: nullable(str()),
      email: nullable(str()),
      created_at: str(TIMESTAMP),
      receipt_count: {
        type: "integer",
        description: "Receipts issued to this customer (present on list and detail reads).",
      },
    },
    ["id", "business_id", "name", "phone", "email", "created_at"],
  ),

  CustomerList: obj(
    {
      items: array(ref("Customer")),
      total: { type: "integer" },
    },
    ["items", "total"],
  ),

  ReceiptItem: obj(
    {
      id: str(),
      position: { type: "integer", description: "Display order, 0-based." },
      description: str(),
      quantity: num(),
      unit_price: num(),
      line_total: num(),
    },
    ["id", "position", "description", "quantity", "unit_price", "line_total"],
  ),

  ReceiptCustomer: obj(
    {
      id: str(),
      name: str(),
      phone: nullable(str()),
      email: nullable(str()),
    },
    ["id", "name", "phone", "email"],
  ),

  Receipt: obj(
    {
      id: str(),
      business_id: str(),
      customer_id: nullable(str()),
      customer: nullable(ref("ReceiptCustomer")),
      receipt_number: str("Sequential per business, e.g. ES-000027."),
      issue_date: str(TIMESTAMP),
      subtotal: num(),
      discount: num(),
      tax: num(),
      tax_rate: num("Percentage, 0–100."),
      total: num("Always recomputed on the server."),
      paid_amount: num(),
      payment_method: { type: "string", enum: ["cash", "transfer", "card", "other"] },
      payment_status: { type: "string", enum: ["paid", "partial", "pending"] },
      status: {
        type: "string",
        enum: ["active", "void"],
        description: "Issued receipts are immutable: corrections are void + reissue.",
      },
      notes: nullable(str()),
      pdf_url: nullable(str("Signed, expiring URL once the PDF has been generated.")),
      voided_at: nullable(str(TIMESTAMP)),
      void_reason: nullable(str()),
      original_receipt_id: nullable(
        str("The receipt this one reissued, when applicable."),
      ),
      created_by: str("User id of the issuer."),
      created_at: str(TIMESTAMP),
      items: array(ref("ReceiptItem")),
    },
    [
      "id",
      "business_id",
      "customer_id",
      "customer",
      "receipt_number",
      "issue_date",
      "subtotal",
      "discount",
      "tax",
      "tax_rate",
      "total",
      "paid_amount",
      "payment_method",
      "payment_status",
      "status",
      "notes",
      "pdf_url",
      "voided_at",
      "void_reason",
      "original_receipt_id",
      "created_by",
      "created_at",
      "items",
    ],
  ),

  ReceiptList: obj(
    {
      items: array(ref("Receipt")),
      total: { type: "integer", description: "Matches across all pages." },
      page: { type: "integer" },
      limit: { type: "integer" },
    },
    ["items", "total", "page", "limit"],
  ),

  TotalsCard: obj(
    {
      count: { type: "integer" },
      total: num("Sum of receipt totals in the window."),
    },
    ["count", "total"],
  ),

  DashboardSummary: obj(
    {
      currency: str(),
      today: ref("TotalsCard"),
      week: ref("TotalsCard"),
      month: ref("TotalsCard"),
      outstanding: {
        ...ref("TotalsCard"),
        description: "Receipts that are neither paid nor void.",
      },
      recent: array(ref("Receipt"), "Up to 8 most recent receipts."),
    },
    ["currency", "today", "week", "month", "outstanding", "recent"],
  ),

  Share: obj(
    {
      token: str("Opaque share token; no receipt id is exposed."),
      url: str("Absolute URL of the public receipt page."),
      expires_at: str(TIMESTAMP),
    },
    ["token", "url", "expires_at"],
  ),

  EmailResult: obj(
    {
      delivered: { type: "boolean" },
      transport: str("mail driver that handled the message, e.g. console | smtp"),
      id: str("Provider message id, when there is one."),
      to: str(),
      view_url: str("Expiring link to the public receipt page."),
      expires_at: str(TIMESTAMP),
      pdf_attached: { type: "boolean" },
    },
    [
      "delivered",
      "transport",
      "to",
      "view_url",
      "expires_at",
      "pdf_attached",
    ],
  ),

  /** Payload served to the no-login receipt page at `/r/[token]`. */
  PublicReceiptPage: obj(
    {
      receipt: ref("PublicReceipt"),
      business: obj(
        {
          name: str(),
          logo_url: nullable(str("Signed, expiring URL.")),
          address: nullable(str()),
          phone: nullable(str()),
          email: nullable(str()),
          currency: str(),
          brand_primary: str(),
          brand_accent: str(),
        },
        ["name", "logo_url", "address", "phone", "email", "currency", "brand_primary", "brand_accent"],
      ),
      expires_at: str(TIMESTAMP),
    },
    ["receipt", "business", "expires_at"],
  ),

  /** Same as Receipt with tenancy metadata stripped — never leaks business_id. */
  PublicReceipt: obj(
    {
      id: str(),
      receipt_number: str(),
      issue_date: str(TIMESTAMP),
      subtotal: num(),
      discount: num(),
      tax: num(),
      tax_rate: num(),
      total: num(),
      paid_amount: num(),
      payment_method: { type: "string", enum: ["cash", "transfer", "card", "other"] },
      payment_status: { type: "string", enum: ["paid", "partial", "pending"] },
      status: { type: "string", enum: ["active", "void"] },
      notes: nullable(str()),
      voided_at: nullable(str(TIMESTAMP)),
      void_reason: nullable(str()),
      created_at: str(TIMESTAMP),
      customer: nullable(
        obj(
          {
            name: str(),
            phone: nullable(str()),
            email: nullable(str()),
          },
          ["name", "phone", "email"],
        ),
      ),
      items: array(ref("ReceiptItem")),
    },
    [
      "id",
      "receipt_number",
      "issue_date",
      "subtotal",
      "discount",
      "tax",
      "tax_rate",
      "total",
      "paid_amount",
      "payment_method",
      "payment_status",
      "status",
      "notes",
      "voided_at",
      "void_reason",
      "created_at",
      "customer",
      "items",
    ],
  ),
};
