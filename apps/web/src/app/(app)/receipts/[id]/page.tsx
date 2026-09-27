"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ReceiptDTO, ShareDTO } from "@eleos/shared";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@eleos/shared";
import { ApiError, api, downloadFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";
import { StatusBadge } from "@/components/StatusBadge";

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { business } = useSession();
  const currency = business?.currency ?? "NGN";

  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [share, setShare] = useState<ShareDTO | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  useTitle(receipt ? receipt.receipt_number : "Receipt");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setReceipt(await api<ReceiptDTO>(`/api/receipts/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Receipt not found.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: string, task: () => Promise<void>) {
    setBusyAction(action);
    setNotice(null);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  const createShare = () =>
    run("share", async () => {
      const result = await api<ShareDTO>(`/api/receipts/${id}/share`, {
        method: "POST",
        body: {},
      });
      setShare(result);
      await navigator.clipboard.writeText(result.url);
      setNotice("Share link copied to clipboard.");
    });

  const downloadPdf = () =>
    run("download", async () => {
      await downloadFile(
        `/api/receipts/${id}/pdf`,
        `${receipt?.receipt_number ?? "receipt"}.pdf`,
      );
      setNotice("PDF downloaded.");
    });

  const openWhatsApp = async () => {
    const result =
      share ??
      (await api<ShareDTO>(`/api/receipts/${id}/share`, { method: "POST", body: {} }));
    setShare(result);

    const message = [
      `Hello! Here is your receipt ${receipt?.receipt_number ?? ""} from ${business?.name ?? "us"}.`,
      `Total: ${formatMoney(receipt?.total ?? 0, currency)}`,
      `View it here: ${result.url}`,
    ].join("\n");

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  };

  const sendEmail = async (event: FormEvent) => {
    event.preventDefault();
    await run("email", async () => {
      await api(`/api/receipts/${id}/email`, {
        method: "POST",
        body: { to: emailTo, message: emailMessage },
      });
      setEmailOpen(false);
      setNotice(`Receipt emailed to ${emailTo}.`);
    });
  };

  const voidReceipt = async () => {
    if (!window.confirm("Void this receipt? This cannot be undone.")) return;
    await run("void", async () => {
      await api(`/api/receipts/${id}/void`, {
        method: "POST",
        body: { reason: "Voided from receipt detail" },
      });
      await load();
      setNotice("Receipt voided.");
    });
  };

  const reissue = async () => {
    if (!window.confirm("Void this receipt and issue a fresh replacement?")) return;
    await run("reissue", async () => {
      const created = await api<ReceiptDTO>(`/api/receipts/${id}/reissue`, {
        method: "POST",
        body: { reason: "Reissued from receipt detail" },
      });
      router.push(`/receipts/${created.id}`);
    });
  };

  if (error && !receipt) {
    return (
      <div className="card-flat py-16 text-center">
        <p className="text-sm font-semibold">{error}</p>
        <Link href="/receipts" className="btn btn-outline mt-4">
          Back to receipts
        </Link>
      </div>
    );
  }

  if (!receipt) {
    return <div className="card h-64 animate-pulse bg-cream-deep/40" />;
  }

  const isVoid = receipt.status === "void";

  return (
    <div className="flex flex-col gap-6">
      {/* ----------------------------- Header ------------------------------ */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/receipts" className="eyebrow hover:text-gold-light">
            ← Receipts
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1
              className={`page-title text-4xl ${isVoid ? "text-muted line-through" : ""}`}
            >
              {receipt.receipt_number}
            </h1>
            <StatusBadge receipt={receipt} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {receipt.customer?.name ?? "Walk-in customer"} ·{" "}
            {formatDateTime(receipt.issue_date)}
          </p>
        </div>

        <div className="text-right">
          <p className="eyebrow">Total</p>
          <p className="tabular text-3xl font-semibold">
            {formatMoney(receipt.total, currency)}
          </p>
        </div>
      </header>

      {isVoid ? (
        <div className="rounded-lg border border-gold/60 bg-gold/10 px-4 py-3 text-sm">
          <p className="font-semibold text-ink">This receipt has been voided.</p>
          <p className="text-muted">
            {receipt.voided_at ? `Voided ${formatDateTime(receipt.voided_at)}` : null}
            {receipt.void_reason ? ` — ${receipt.void_reason}` : ""}
          </p>
        </div>
      ) : null}

      {receipt.original_receipt_id ? (
        <div className="rounded-lg border border-rule px-4 py-3 text-sm text-muted">
          This receipt replaces{" "}
          <Link
            href={`/receipts/${receipt.original_receipt_id}`}
            className="font-semibold text-gold hover:text-gold-light"
          >
            the voided original
          </Link>
          .
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-ink">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* ----------------------------- Actions ----------------------------- */}
      <section className="card flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-gold"
          onClick={downloadPdf}
          disabled={busyAction === "download"}
        >
          {busyAction === "download" ? "Preparing…" : "Download PDF"}
        </button>

        <button
          type="button"
          className="btn btn-ink"
          onClick={createShare}
          disabled={busyAction === "share"}
        >
          {busyAction === "share" ? "Creating…" : "Copy share link"}
        </button>

        <button type="button" className="btn btn-outline" onClick={() => void openWhatsApp()}>
          WhatsApp
        </button>

        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setEmailOpen((open) => !open)}
        >
          Email receipt
        </button>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline"
            onClick={reissue}
            disabled={busyAction === "reissue"}
          >
            {busyAction === "reissue" ? "Reissuing…" : "Void & reissue"}
          </button>
          {!isVoid ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void voidReceipt()}
              disabled={busyAction === "void"}
            >
              {busyAction === "void" ? "Voiding…" : "Void"}
            </button>
          ) : null}
        </div>
      </section>

      {emailOpen ? (
        <form onSubmit={sendEmail} className="card flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="emailTo">
                Send to
              </label>
              <input
                id="emailTo"
                type="email"
                required
                className="field"
                placeholder="customer@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="emailMessage">
                Message (optional)
              </label>
              <input
                id="emailMessage"
                className="field"
                placeholder="Thank you for your purchase!"
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="btn btn-gold btn-sm"
              disabled={busyAction === "email"}
            >
              {busyAction === "email" ? "Sending…" : "Send"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEmailOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {share ? (
        <div className="flex flex-col gap-1 rounded-lg border border-rule px-4 py-3">
          <p className="eyebrow">Share link</p>
          <a
            href={share.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm text-gold hover:text-gold-light"
          >
            {share.url}
          </a>
          <p className="text-xs text-muted">
            Expires {formatDateTime(share.expires_at)} — no sign-in required to view.
          </p>
        </div>
      ) : null}

      {/* ----------------------------- Preview ----------------------------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <p className="eyebrow mb-3">Document</p>
          <div className="overflow-hidden rounded-xl border border-rule bg-cream">
            <iframe
              title={`${receipt.receipt_number} preview`}
              src={`/api/receipts/${receipt.id}/document`}
              className="h-[900px] w-full border-0"
            />
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <section className="card">
            <p className="eyebrow">Items</p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th className="pb-2 text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                    Description
                  </th>
                  <th className="pb-2 text-center text-[11px] uppercase tracking-[0.14em] text-muted">
                    Qty
                  </th>
                  <th className="pb-2 text-right text-[11px] uppercase tracking-[0.14em] text-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => (
                  <tr key={item.id} className="border-b border-rule last:border-0">
                    <td className="py-2.5 pr-3">{item.description}</td>
                    <td className="tabular py-2.5 text-center text-muted">{item.quantity}</td>
                    <td className="tabular py-2.5 text-right font-semibold">
                      {formatMoney(item.line_total, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span className="tabular text-ink">
                  {formatMoney(receipt.subtotal, currency)}
                </span>
              </div>
              {receipt.discount > 0 ? (
                <div className="flex justify-between text-muted">
                  <span>Discount</span>
                  <span className="tabular text-ink">
                    −{formatMoney(receipt.discount, currency)}
                  </span>
                </div>
              ) : null}
              {receipt.tax > 0 ? (
                <div className="flex justify-between text-muted">
                  <span>Tax ({receipt.tax_rate}%)</span>
                  <span className="tabular text-ink">
                    {formatMoney(receipt.tax, currency)}
                  </span>
                </div>
              ) : null}
              <hr className="gold-rule" />
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Total</span>
                <span className="tabular text-2xl font-semibold">
                  {formatMoney(receipt.total, currency)}
                </span>
              </div>
            </div>
          </section>

          <section className="card flex flex-col gap-3 text-sm">
            <p className="eyebrow">Details</p>
            <DetailRow label="Issued" value={formatDate(receipt.issue_date)} />
            <DetailRow
              label="Payment method"
              value={PAYMENT_METHOD_LABELS[receipt.payment_method]}
            />
            <DetailRow
              label="Payment status"
              value={PAYMENT_STATUS_LABELS[receipt.payment_status]}
            />
            <DetailRow
              label="Amount paid"
              value={formatMoney(receipt.paid_amount, currency)}
            />
            <DetailRow
              label="Balance"
              value={formatMoney(receipt.total - receipt.paid_amount, currency)}
            />
            {receipt.notes ? <DetailRow label="Notes" value={receipt.notes} /> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule pb-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
