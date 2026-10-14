import { describe, expect, it } from "vitest";
import { receiptCreateSchema, invoiceCreateSchema, MAX_MONEY } from "@eleos/shared";

/**
 * Large amounts must fail as validation, not as a database error.
 *
 * Every monetary column is `@db.Decimal(14, 2)`, so Postgres rejects anything
 * at or above 10^12 with SQLSTATE 22003. Validating `unit_price` and
 * `quantity` individually is not enough — both can sit well inside their own
 * limits and still multiply out past the column. That reached the user as a
 * 500 "Something went wrong on our side" for typing a large number, which is
 * the least useful answer the API can give.
 */

const baseReceipt = {
  items: [{ description: "Consulting", quantity: 1, unit_price: 1000 }],
  discount: 0,
  tax_rate: 0,
  payment_method: "cash" as const,
  payment_status: "paid" as const,
};

const baseInvoice = { items: baseReceipt.items, discount: 0, tax_rate: 0 };

describe("money bounds", () => {
  it("accepts an ordinary receipt", () => {
    expect(receiptCreateSchema.safeParse(baseReceipt).success).toBe(true);
  });

  it("rejects a line whose product overflows the column", () => {
    // Both fields are individually legal; the product is not.
    const parsed = receiptCreateSchema.safeParse({
      ...baseReceipt,
      items: [{ description: "Bulk", quantity: 999_999, unit_price: 9_876_543.21 }],
    });

    expect(parsed.success).toBe(false);
    const message = JSON.stringify((parsed as { error: { issues: unknown[] } }).error.issues);
    expect(message).toMatch(/too large/i);
  });

  it("rejects the same overflow on an invoice", () => {
    const parsed = invoiceCreateSchema.safeParse({
      ...baseInvoice,
      items: [{ description: "Bulk", quantity: 999_999, unit_price: 9_876_543.21 }],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify((parsed as { error: { issues: unknown[] } }).error.issues)).toMatch(
      /too large/i,
    );
  });

  it("accepts a line right up to the largest field it allows", () => {
    // `amountField` caps an individual amount at 999,999,999,999 — a little
    // under the 999,999,999,999.99 the column could hold, because a typed
    // number with cents is not what a person enters into this field. Being
    // conservative there is safe; the product guard is what catches the case
    // neither bound covers.
    const parsed = receiptCreateSchema.safeParse({
      ...baseReceipt,
      items: [{ description: "At the limit", quantity: 1, unit_price: 999_999_999_999 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a summed total that overflows even though every line is legal", () => {
    // 200 lines is the documented maximum. Two of them at half the limit each
    // are individually fine and together exceed the column — which is why the
    // document total is bounded separately from the line totals.
    const line = { description: "Half", quantity: 1, unit_price: MAX_MONEY / 2 + 1 };
    const parsed = receiptCreateSchema.safeParse({
      ...baseReceipt,
      items: [line, { ...line, description: "Half again" }],
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify((parsed as { error: { issues: unknown[] } }).error.issues)).toMatch(
      /total is too large/i,
    );
  });

  it("states the limit as a readable number for the user", () => {
    // MAX_MONEY exists so the message and the column width cannot drift apart.
    expect(MAX_MONEY).toBe(999_999_999_999.99);
    // Below 10^12, because Decimal(14, 2) is twelve digits before the point.
    expect(MAX_MONEY).toBeLessThan(10 ** 12);
  });
});