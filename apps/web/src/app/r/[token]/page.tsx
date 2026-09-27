"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatMoney, type PublicReceiptDTO } from "@eleos/shared";
import { useTitle } from "@/lib/ui";

/**
 * Public receipt page. Reached through an HMAC-signed, expiring link —
 * no session, no tenant metadata, no sequential ids in the URL.
 */
export default function PublicReceiptPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [data, setData] = useState<PublicReceiptDTO | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useTitle(data ? data.receipt.receipt_number : "Receipt");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    api<PublicReceiptDTO>(`/api/public/r/${token}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError({ message: err.message, code: err.code });
        } else {
          setError({ message: "This link could not be loaded." });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <Shell>
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="eyebrow">{error.code === "LINK_EXPIRED" ? "Expired" : "Invalid link"}</p>
          <h1 className="page-title mt-2 text-3xl">Receipt unavailable</h1>
          <hr className="gold-rule my-5" />
          <p className="text-sm text-muted">{error.message}</p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24">
          <div className="h-px w-24 animate-pulse bg-gold/60" />
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Loading receipt…</p>
        </div>
      </Shell>
    );
  }

  const { receipt, business } = data;
  const isVoid = receipt.status === "void";

  return (
    <Shell business={business}>
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Receipt</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className={`page-title text-3xl ${isVoid ? "line-through" : ""}`}>
                {receipt.receipt_number}
              </h1>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                  isVoid
                    ? "border border-muted/50 text-muted"
                    : receipt.payment_status === "paid"
                      ? "bg-gold text-cream"
                      : receipt.payment_status === "partial"
                        ? "border border-gold text-gold"
                        : "border border-muted/45 text-muted"
                }`}
              >
                {isVoid
                  ? "Void"
                  : receipt.payment_status === "paid"
                    ? "Paid"
                    : receipt.payment_status === "partial"
                      ? "Partial"
                      : "Pending"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {receipt.customer?.name ?? "Walk-in customer"} ·{" "}
              {formatMoney(receipt.total, business.currency)}
            </p>
          </div>

          <a
            href={`/api/public/r/${token}/download`}
            className="btn btn-gold"
            onClick={() => setPdfBusy(true)}
          >
            {pdfBusy ? "Preparing…" : "Download PDF"}
          </a>
        </div>

        {isVoid ? (
          <div className="mb-5 rounded-lg border border-gold/60 bg-gold/10 px-4 py-3 text-sm">
            <p className="font-semibold">This receipt has been voided.</p>
            {receipt.void_reason ? <p className="text-muted">{receipt.void_reason}</p> : null}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-rule bg-cream">
          <iframe
            title={`${receipt.receipt_number} document`}
            src={`/api/public/r/${token}/document`}
            className="h-[1000px] w-full border-0"
          />
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          This link expires on {formatDateTime(data.expires_at)}.
        </p>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  business,
}: {
  children: React.ReactNode;
  business?: PublicReceiptDTO["business"];
}) {
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-gold/70 bg-ink">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <span className="wordmark text-xl text-cream">
            {business ? (
              <>
                {business.name.split(" ")[0]}
                <span className="text-gold">
                  {business.name.split(" ").slice(1).join(" ") || ""}
                </span>
              </>
            ) : (
              <>
                Eleos<span className="text-gold">styles</span>
              </>
            )}
          </span>
          <span className="eyebrow">Receipt</span>
        </div>
      </header>
      {children}
      <footer className="mx-auto max-w-5xl px-5 pb-10">
        <hr className="gold-rule" />
        <p className="pt-4 text-xs text-muted">
          Shared securely — this link expires and cannot be guessed.
        </p>
      </footer>
    </div>
  );
}
