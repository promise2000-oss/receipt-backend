"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUSES,
  computeTotals,
  formatMoney,
  lineTotal,
  parseAmount,
  toDateInputValue,
} from "@eleos/shared";
import type { PaymentMethod, PaymentStatus } from "@eleos/shared";
import { ApiError, api, apiText } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";
import { CustomerPicker } from "@/components/CustomerPicker";

interface Line {
  key: string;
  description: string;
  quantity: string;
  unit_price: string;
}

let lineCounter = 0;
const newLine = (description = ""): Line => ({
  key: `line-${(lineCounter += 1)}`,
  description,
  quantity: "1",
  unit_price: "",
});

export default function NewReceiptPage() {
  useTitle("New receipt");
  const router = useRouter();
  const { business } = useSession();
  const currency = business?.currency ?? "NGN";

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState("");
  const [issueDate, setIssueDate] = useState(toDateInputValue(new Date()));
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [discount, setDiscount] = useState("");
  const [taxRate, setTaxRate] = useState("7.5");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequests = useRef(0);

  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((line) => ({
          description: line.description,
          quantity: parseAmount(line.quantity),
          unit_price: parseAmount(line.unit_price),
        })),
        parseAmount(discount),
        parseAmount(taxRate),
      ),
    [lines, discount, taxRate],
  );

  const filledLines = lines.filter(
    (line) => line.description.trim().length > 0 && lineTotal(parseAmount(line.quantity), parseAmount(line.unit_price)) > 0,
  );

  const payload = useMemo(
    () => ({
      customer_id: customerId ?? null,
      issue_date: issueDate || undefined,
      items: filledLines.map((line) => ({
        description: line.description.trim(),
        quantity: parseAmount(line.quantity),
        unit_price: parseAmount(line.unit_price),
      })),
      discount: parseAmount(discount),
      tax_rate: parseAmount(taxRate),
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      notes: notes.trim() || null,
    }),
    [customerId, issueDate, filledLines, discount, taxRate, paymentMethod, paymentStatus, notes],
  );

  // Live preview: the same endpoint that produces the PDF's HTML.
  useEffect(() => {
    if (payload.items.length === 0) {
      setPreview("");
      setPreviewError(null);
      return;
    }

    const requestId = (previewRequests.current += 1);
    const timer = setTimeout(async () => {
      try {
        const html = await apiText("/api/receipts/preview", { body: payload });
        if (requestId !== previewRequests.current) return; // stale response
        setPreview(html);
        setPreviewError(null);
      } catch (err) {
        if (requestId !== previewRequests.current) return;
        // Silently keep the last good preview while a field is mid-edit.
        setPreviewError(err instanceof ApiError ? err.message : null);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [payload]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    if (payload.items.length === 0) {
      setError("Add at least one line item with a description and a price.");
      setBusy(false);
      return;
    }

    try {
      const created = await api<{ id: string }>("/api/receipts", {
        method: "POST",
        body: payload,
      });
      router.push(`/receipts/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details ?? {});
      } else {
        setError("Could not save the receipt. Please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Create</p>
          <h1 className="page-title mt-1 text-4xl">New receipt</h1>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => router.back()}>
          Cancel
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ------------------------------ Form ------------------------------ */}
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {error}
            </div>
          ) : null}

          <section className="card flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <CustomerPicker
                value={customerId}
                label={customerLabel}
                onChange={(id, label) => {
                  setCustomerId(id);
                  setCustomerLabel(label);
                }}
              />

              <div>
                <label className="field-label" htmlFor="issue_date">
                  Issue date
                </label>
                <input
                  id="issue_date"
                  type="date"
                  className="field"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* --------------------------- Line items -------------------------- */}
          <section className="card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="eyebrow">Items</p>
                <h2 className="section-title text-xl">Line items</h2>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setLines((prev) => [...prev, newLine()])}
              >
                + Add line
              </button>
            </div>

            <div className="hidden grid-cols-[minmax(0,1fr)_84px_128px_128px_36px] gap-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted md:grid">
              <span>Description</span>
              <span className="text-center">Qty</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            <div className="flex flex-col gap-3">
              {lines.map((line) => {
                const amount = lineTotal(
                  parseAmount(line.quantity),
                  parseAmount(line.unit_price),
                );
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-2 gap-3 rounded-lg border border-rule bg-cream/50 p-3 md:grid-cols-[minmax(0,1fr)_84px_128px_128px_36px] md:border-0 md:bg-transparent md:p-0"
                  >
                    <input
                      className="field col-span-2 md:col-span-1"
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      aria-label="Line description"
                    />
                    <input
                      className="field text-center"
                      inputMode="decimal"
                      placeholder="1"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      aria-label="Quantity"
                    />
                    <input
                      className="field text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.unit_price}
                      onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                      aria-label="Unit price"
                    />
                    <div className="tabular flex items-center justify-end text-sm font-semibold md:pr-1">
                      {formatMoney(amount, currency)}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm col-span-2 justify-self-end px-2 md:col-span-1"
                      aria-label="Remove line"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((prev) => prev.filter((item) => item.key !== line.key))
                      }
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>

            {fieldErrors["items"] ? (
              <p className="field-error">{fieldErrors["items"]}</p>
            ) : null}
          </section>

          {/* --------------------------- Totals ------------------------------ */}
          <section className="card grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div>
                <label className="field-label" htmlFor="discount">
                  Discount
                </label>
                <input
                  id="discount"
                  className="field text-right"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted">Fixed amount off the subtotal.</p>
              </div>

              <div>
                <label className="field-label" htmlFor="tax_rate">
                  Tax rate (%)
                </label>
                <input
                  id="tax_rate"
                  className="field text-right"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted">Applied after the discount.</p>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2 rounded-lg bg-cream-deep/60 p-4">
              <div className="flex justify-between text-sm text-muted">
                <span>Subtotal</span>
                <span className="tabular text-ink">{formatMoney(totals.subtotal, currency)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted">
                <span>Discount</span>
                <span className="tabular text-ink">
                  −{formatMoney(totals.discount, currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm text-muted">
                <span>Tax ({parseAmount(taxRate)}%)</span>
                <span className="tabular text-ink">{formatMoney(totals.tax, currency)}</span>
              </div>
              <hr className="gold-rule" />
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Total</span>
                <span className="tabular text-2xl font-semibold">
                  {formatMoney(totals.total, currency)}
                </span>
              </div>
            </div>
          </section>

          {/* --------------------------- Payment ----------------------------- */}
          <section className="card grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="payment_method">
                Payment method
              </label>
              <select
                id="payment_method"
                className="field"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="payment_status">
                Payment status
              </label>
              <select
                id="payment_status"
                className="field"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              >
                {PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PAYMENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="notes">
                Notes (optional)
              </label>
              <textarea
                id="notes"
                className="field min-h-20 resize-y"
                placeholder="Payment terms, thank-you note, return policy…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-gold" disabled={busy}>
              {busy ? "Issuing…" : "Issue receipt"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => router.push("/receipts")}
            >
              Back to history
            </button>
            <p className="text-xs text-muted">
              Once issued, a receipt cannot be edited — corrections are made by voiding
              and reissuing.
            </p>
          </div>
        </form>

        {/* ---------------------------- Preview ----------------------------- */}
        <aside className="xl:sticky xl:top-24 xl:self-start">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="eyebrow">Live preview</p>
              <p className="text-xs text-muted">
                {previewError ?? "Exactly what the PDF will look like."}
              </p>
            </div>
            <span className="rounded-full border border-gold/50 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-gold">
              {business?.number_prefix ?? "ES"}-••••••
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-rule bg-cream">
            {preview ? (
              <iframe
                title="Receipt preview"
                srcDoc={preview}
                className="h-[720px] w-full border-0"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex h-[720px] flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="h-px w-24 bg-gold/60" />
                <p className="section-title text-xl">Your receipt will appear here</p>
                <p className="max-w-xs text-xs text-muted">
                  Add a description and a price on the left to start the preview.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
