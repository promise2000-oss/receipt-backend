import { z } from "zod";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "./enums";
import { lineTotal, outstandingBalance } from "./money";
import { MAX_WATERMARK_OPACITY } from "./brand";

/** Deliberately regex-based rather than `z.email()` so behaviour is stable
 *  across zod minor upgrades. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const emailField = (label = "Email") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(EMAIL_RE, `Enter a valid ${label.toLowerCase()}`)
    .max(254, `${label} is too long`)
    .transform((v) => v.toLowerCase());

export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password is too long");

// `.nullish()` rather than `.optional()`: clients legitimately express "no
// phone" as JSON `null` (the signup form sends `phone: "" || null`), and
// `.optional()` only admits `undefined` — a null would be rejected with
// "expected string, received null" *before* the transform could normalise it,
// which locked every new signup out of the product.
export const phoneField = z
  .string()
  .trim()
  .max(40, "Phone number is too long")
  .nullish()
  .transform((v) => (v ? v : null));

/** Positive money amount with at most 2 decimals. */
export const amountField = z
  .number({ error: "Enter a number" })
  .finite("Enter a number")
  .min(0, "Amount cannot be negative")
  .max(999_999_999_999, "Amount is too large");

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  business: z.object({
    name: z.string().trim().min(2, "Business name is required").max(120),
    email: emailField("Business email").optional(),
    phone: phoneField,
    address: z
      .string()
      .trim()
      .max(240)
      .optional()
      .transform((v) => (v ? v : null)),
    currency: z.string().trim().min(3).max(3).default("NGN"),
    number_prefix: z
      .string()
      .trim()
      .max(6)
      .optional()
      .transform((v) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "ES")),
  }),
  user: z.object({
    full_name: z.string().trim().min(2, "Your name is required").max(120),
    email: emailField(),
    password: passwordField,
    phone: phoneField,
  }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailField(),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

export const businessUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z
    .union([emailField("Business email"), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  phone: phoneField.optional(),
  address: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((v) => (v === "" ? null : v)),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? null : v)),
  currency: z.string().trim().min(3).max(3).optional(),
  brand_primary: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #111111")
    .optional(),
  brand_accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #B8912F")
    .optional(),
  number_prefix: z
    .string()
    .trim()
    .max(6)
    .optional()
    .transform((v) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : undefined)),

  /* ---- Document watermarking ---- */
  // Owner-only in the API (see `requireOwner` on PATCH /business). The opacity
  // ceiling stops a tenant from setting a watermark opaque enough to make its
  // own totals unreadable.
  watermark_enabled: z.boolean().optional(),
  watermark_text: z
    .string()
    .trim()
    .max(40, "Watermark text is too long")
    .optional(),
  watermark_opacity: z
    .number({ error: "Enter a number" })
    .finite()
    .min(0, "Opacity cannot be negative")
    .max(MAX_WATERMARK_OPACITY, `Keep the watermark at or below ${MAX_WATERMARK_OPACITY}%`)
    .optional(),
});
export type BusinessUpdateInput = z.infer<typeof businessUpdateSchema>;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  phone: phoneField,
  // The form sends "" for a cleared field, so an empty string means "none".
  email: z
    .union([emailField("Customer email"), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined || v === null ? null : v)),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export const receiptItemSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Each line needs a description")
      .max(240),
    quantity: amountField.refine((v) => v > 0, "Quantity must be at least 1"),
    unit_price: amountField,
  })
  .superRefine((item, ctx) => {
    if (lineTotal(item.quantity, item.unit_price) <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Line total must be greater than zero",
        path: ["unit_price"],
      });
    }
  });

export const receiptCreateSchema = z.object({
  customer_id: z.string().trim().min(1).nullish(),
  issue_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),
  items: z
    .array(receiptItemSchema)
    .min(1, "Add at least one line item")
    .max(200, "A receipt can hold at most 200 lines"),
  discount: amountField.default(0),
  tax_rate: z
    .number({ error: "Enter a tax rate" })
    .finite()
    .min(0, "Tax rate cannot be negative")
    .max(100, "Tax rate cannot exceed 100%")
    .default(0),
  payment_method: z.enum(PAYMENT_METHODS as [string, ...string[]]).default("cash"),
  payment_status: z.enum(PAYMENT_STATUSES as [string, ...string[]]).default("paid"),
  paid_amount: amountField.optional(),
  // See phoneField: the receipt form posts `notes: notes.trim() || null`, and
  // `.optional()` rejects that null before the transform can normalise it.
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type ReceiptCreateInput = z.infer<typeof receiptCreateSchema>;

export const voidReceiptSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const reissueReceiptSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const emailReceiptSchema = z.object({
  to: emailField("Recipient"),
  message: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : "")),
});

export const shareReceiptSchema = z.object({
  /** Lifetime in seconds. Defaults to SHARE_TTL_SECONDS (7 days). */
  ttl_seconds: z
    .number()
    .int()
    .min(3600, "Minimum share lifetime is 1 hour")
    .max(31_536_000, "Maximum share lifetime is 1 year")
    .optional(),
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, or null when the field was cleared. */
const isoDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * A line on an invoice. Same shape and same rules as a receipt line — the two
 * documents are the same arithmetic, and a shared schema means a value that is
 * rejected on one is rejected on the other too.
 */
export const invoiceItemSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Each line needs a description")
      .max(240),
    quantity: amountField.refine((v) => v > 0, "Quantity must be at least 1"),
    unit_price: amountField,
  })
  .superRefine((item, ctx) => {
    if (lineTotal(item.quantity, item.unit_price) <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Line total must be greater than zero",
        path: ["unit_price"],
      });
    }
  });

export const invoiceCreateSchema = z
  .object({
    customer_id: z.string().trim().min(1).nullish(),
    issue_date: isoDateField.optional(),
    due_date: isoDateField.nullish().transform((v) => v || null),
    items: z
      .array(invoiceItemSchema)
      .min(1, "Add at least one line item")
      .max(200, "An invoice can hold at most 200 lines"),
    discount: amountField.default(0),
    tax_rate: z
      .number({ error: "Enter a tax rate" })
      .finite()
      .min(0, "Tax rate cannot be negative")
      .max(100, "Tax rate cannot exceed 100%")
      .default(0),
    notes: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) => (v ? v : null)),
    terms: z
      .string()
      .trim()
      .max(240)
      .nullish()
      .transform((v) => (v ? v : null)),
    po_reference: z
      .string()
      .trim()
      .max(80)
      .nullish()
      .transform((v) => (v ? v : null)),
    /** Send `true` to issue immediately instead of saving a draft. */
    issue: z.boolean().default(false),
  })
  .superRefine((invoice, ctx) => {
    // A due date before the issue date is not a payment schedule, it is a
    // typo — and it would silently mark a brand-new invoice overdue.
    if (!invoice.due_date || !invoice.issue_date) return;
    if (invoice.due_date < invoice.issue_date) {
      ctx.addIssue({
        code: "custom",
        message: "Due date cannot be before the issue date",
        path: ["due_date"],
      });
    }
  });
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

/** Draft-only edits. The API rejects this on any other status. */
export const invoiceUpdateSchema = z.object({
  due_date: isoDateField.nullish().transform((v) => v || null),
  items: z
    .array(invoiceItemSchema)
    .min(1, "Add at least one line item")
    .max(200, "An invoice can hold at most 200 lines")
    .optional(),
  discount: amountField.optional(),
  tax_rate: z
    .number({ error: "Enter a tax rate" })
    .finite()
    .min(0, "Tax rate cannot be negative")
    .max(100, "Tax rate cannot exceed 100%")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
  terms: z
    .string()
    .trim()
    .max(240)
    .nullish()
    .transform((v) => (v ? v : null)),
  po_reference: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;

export const invoiceCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Give a short reason for cancelling")
    .max(240),
});
export type InvoiceCancelInput = z.infer<typeof invoiceCancelSchema>;

/**
 * Recording a payment.
 *
 * `amount` is validated against the outstanding balance by the *server*, not
 * here — this schema only knows the shape. The balance check needs the stored
 * invoice, so it belongs in the route where the transaction lives.
 */
export const invoicePaymentSchema = z.object({
  amount: amountField.refine((v) => v > 0, "Payment must be greater than zero"),
  paid_at: isoDateField.optional(),
  method: z.enum(PAYMENT_METHODS as [string, ...string[]]).default("cash"),
  reference: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
  /**
   * Generate the matching receipt in the same transaction as the payment.
   * Defaults to true — a recorded payment with no document is the state the
   * product exists to avoid.
   */
  generate_receipt: z.boolean().default(true),
});
export type InvoicePaymentInput = z.infer<typeof invoicePaymentSchema>;

export const invoiceShareSchema = z.object({
  ttl_seconds: z
    .number()
    .int()
    .min(3600, "Minimum share lifetime is 1 hour")
    .max(31_536_000, "Maximum share lifetime is 1 year")
    .optional(),
});

/**
 * Guard used by the payment route. Exported so the tests assert against the
 * same rule the API enforces rather than restating it.
 */
export function assertPaymentWithinBalance(
  amount: number,
  total: number,
  amountPaid: number,
): { ok: true } | { ok: false; outstanding: number } {
  const outstanding = outstandingBalance(total, amountPaid);
  if (amount > outstanding + 0.0001) return { ok: false, outstanding };
  return { ok: true };
}
