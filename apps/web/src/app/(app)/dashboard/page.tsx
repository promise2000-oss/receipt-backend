"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DashboardSummaryDTO, TotalsCard } from "@eleos/shared";
import { formatMoney, formatDate } from "@eleos/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";
import { StatusBadge } from "@/components/StatusBadge";

function SummaryCard({
  label,
  hint,
  data,
  currency,
  emphasis = false,
}: {
  label: string;
  hint: string;
  data: TotalsCard;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`card relative overflow-hidden ${emphasis ? "border-gold/60" : ""}`}
    >
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-[3px] ${emphasis ? "bg-gold" : "bg-rule"}`}
      />
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-3 text-3xl font-semibold">
        {formatMoney(data.total, currency)}
      </p>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-xs text-muted">{hint}</span>
        <span className="text-xs font-semibold text-gold">
          {data.count} receipt{data.count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  useTitle("Dashboard");
  const { business } = useSession();
  const [summary, setSummary] = useState<DashboardSummaryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DashboardSummaryDTO>("/api/dashboard/summary")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Could not load the dashboard.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = summary?.currency ?? business?.currency ?? "NGN";

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="page-title mt-1 text-4xl">Dashboard</h1>
        </div>
        <Link href="/receipts/new" className="btn btn-ink">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New receipt
        </Link>
      </header>

      {error ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {!summary && !error ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="card h-32 animate-pulse bg-cream-deep/50" />
          ))}
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <SummaryCard
              label="Today"
              hint="Issued today"
              data={summary.today}
              currency={currency}
              emphasis
            />
            <SummaryCard
              label="This Week"
              hint="Monday onwards"
              data={summary.week}
              currency={currency}
            />
            <SummaryCard
              label="This Month"
              hint="Calendar month"
              data={summary.month}
              currency={currency}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule px-5 py-4">
            <div>
              <p className="eyebrow">Outstanding</p>
              <p className="mt-1 text-sm text-muted">
                Receipts still pending or partially paid
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-xl font-semibold">
                {formatMoney(summary.outstanding.total, currency)}
              </p>
              <p className="text-xs text-muted">
                {summary.outstanding.count} receipt
                {summary.outstanding.count === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <section>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="eyebrow">Latest</p>
                <h2 className="section-title text-2xl">Recent receipts</h2>
              </div>
              <Link href="/receipts" className="btn btn-outline btn-sm">
                View all
              </Link>
            </div>

            {summary.recent.length === 0 ? (
              <div className="card-flat py-12 text-center">
                <p className="text-sm font-semibold">No receipts yet</p>
                <p className="mt-1 text-xs text-muted">
                  Create your first receipt to see it here.
                </p>
                <Link href="/receipts/new" className="btn btn-gold mt-4">
                  Create receipt
                </Link>
              </div>
            ) : (
              <div className="card overflow-x-auto p-0">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gold/50">
                      {["Receipt", "Customer", "Date", "Amount", "Status"].map((heading) => (
                        <th
                          key={heading}
                          className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((receipt) => (
                      <tr
                        key={receipt.id}
                        className="border-b border-rule last:border-0 transition-colors hover:bg-cream/70"
                      >
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/receipts/${receipt.id}`}
                            className="font-semibold text-ink underline-offset-4 hover:text-gold hover:underline"
                          >
                            {receipt.receipt_number}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 text-muted">
                          {receipt.customer?.name ?? "Walk-in customer"}
                        </td>
                        <td className="px-5 py-3.5 text-muted">
                          {formatDate(receipt.issue_date)}
                        </td>
                        <td className="tabular px-5 py-3.5 font-semibold">
                          {formatMoney(receipt.total, currency)}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge receipt={receipt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
