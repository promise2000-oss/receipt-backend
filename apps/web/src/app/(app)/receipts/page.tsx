"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Paginated, PaymentStatus, ReceiptDTO, ReceiptStatus } from "@eleos/shared";
import { formatMoney, formatDate } from "@eleos/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";
import { StatusBadge } from "@/components/StatusBadge";

interface Filters {
  search: string;
  status: ReceiptStatus | "all";
  payment_status: PaymentStatus | "all";
  from: string;
  to: string;
  min: string;
  max: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "all",
  payment_status: "all",
  from: "",
  to: "",
  min: "",
  max: "",
};

const PAGE_SIZE = 20;

export default function ReceiptHistoryPage() {
  useTitle("Receipts");
  const { business } = useSession();
  const router = useRouter();
  const currency = business?.currency ?? "NGN";

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ReceiptDTO> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (filters.search) params.set("search", filters.search);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.payment_status !== "all") params.set("payment_status", filters.payment_status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.min) params.set("min", filters.min);
    if (filters.max) params.set("max", filters.max);

    try {
      setData(await api<Paginated<ReceiptDTO>>(`/api/receipts?${params.toString()}`));
    } catch (err) {
      setError((err as Error).message ?? "Could not load receipts.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  // Debounced so typing a search doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">History</p>
          <h1 className="page-title mt-1 text-4xl">Receipts</h1>
        </div>
        <Link href="/receipts/new" className="btn btn-ink">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New receipt
        </Link>
      </header>

      {/* --- Filters ------------------------------------------------------ */}
      <section className="card flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="field-label" htmlFor="search">
              Search
            </label>
            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                id="search"
                className="field pl-9"
                placeholder="Receipt no., customer, item…"
                value={filters.search}
                onChange={(e) => setFilter("search", e.target.value)}
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="field-label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              className="field"
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value as Filters["status"])}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="void">Void</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="field-label" htmlFor="payment">
              Payment
            </label>
            <select
              id="payment"
              className="field"
              value={filters.payment_status}
              onChange={(e) =>
                setFilter("payment_status", e.target.value as Filters["payment_status"])
              }
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="field-label" htmlFor="from">
              From
            </label>
            <input
              id="from"
              type="date"
              className="field"
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="field-label" htmlFor="to">
              To
            </label>
            <input
              id="to"
              type="date"
              className="field"
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-4">
          <div className="flex items-center gap-2">
            <label className="field-label mb-0" htmlFor="min">
              Amount
            </label>
            <input
              id="min"
              inputMode="decimal"
              className="field w-28"
              placeholder="min"
              value={filters.min}
              onChange={(e) => setFilter("min", e.target.value)}
            />
            <span className="text-muted">–</span>
            <input
              inputMode="decimal"
              aria-label="Maximum amount"
              className="field w-28"
              placeholder="max"
              value={filters.max}
              onChange={(e) => setFilter("max", e.target.value)}
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted">
              {loading ? "Searching…" : `${total} result${total === 1 ? "" : "s"}`}
            </span>
            {hasFilters ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* --- Results ------------------------------------------------------- */}
      {loading && !data ? (
        <div className="card space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-cream-deep/60" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="card-flat py-14 text-center">
          <p className="text-sm font-semibold">No receipts match your filters</p>
          <p className="mt-1 text-xs text-muted">
            Try widening the date range or clearing the search.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gold/50">
                {["Receipt", "Customer", "Date", "Items", "Amount", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((receipt) => (
                <tr
                  key={receipt.id}
                  onClick={() => router.push(`/receipts/${receipt.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/receipts/${receipt.id}`);
                  }}
                  role="link"
                  tabIndex={0}
                  className={`cursor-pointer border-b border-rule last:border-0 transition-colors hover:bg-cream/70 ${
                    receipt.status === "void" ? "opacity-70" : ""
                  }`}
                >
                  <td className="px-5 py-3.5">
                    <span
                      className={`font-semibold ${
                        receipt.status === "void" ? "text-muted line-through" : "text-ink"
                      }`}
                    >
                      {receipt.receipt_number}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted">
                    {receipt.customer?.name ?? "Walk-in customer"}
                  </td>
                  <td className="px-5 py-3.5 text-muted">
                    {formatDate(receipt.issue_date)}
                  </td>
                  <td className="px-5 py-3.5 text-muted">{receipt.items.length}</td>
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

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-muted">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
