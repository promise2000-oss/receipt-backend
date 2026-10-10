/** Formatting helpers shared by the UI and the PDF template. */

/** `2026-09-26` → `26 Sep 2026` */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** `2026-09-26T10:15:00Z` → `26 Sep 2026, 10:15` */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Input value for `<input type="date">` bound to an ISO timestamp. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `ES` + `214` → `ES-000214` */
export function formatReceiptNumber(prefix: string, sequence: number): string {
  const safePrefix = (prefix || "ES").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${safePrefix}-${String(sequence).padStart(6, "0")}`;
}

/**
 * `214` → `INV-000214`
 *
 * Invoices get a fixed prefix rather than the organization's receipt prefix:
 * a business may have configured `ES` because that is what their sales slips
 * have always said, and an invoice carrying that same prefix would be
 * indistinguishable from a receipt once the two are in the same pile.
 */
export function formatInvoiceNumber(sequence: number): string {
  return formatReceiptNumber("INV", sequence);
}
