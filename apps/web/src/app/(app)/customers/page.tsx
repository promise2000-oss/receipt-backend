"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CustomerDTO } from "@eleos/shared";
import { formatDate, formatMoney } from "@eleos/shared";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";

interface Draft {
  id?: string;
  name: string;
  phone: string;
  email: string;
}

const EMPTY_DRAFT: Draft = { name: "", phone: "", email: "" };

export default function CustomersPage() {
  useTitle("Customers");
  const { business } = useSession();
  const currency = business?.currency ?? "NGN";

  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: CustomerDTO[] }>(
        `/api/customers?search=${encodeURIComponent(search.trim())}`,
      );
      setCustomers(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      if (draft.id) {
        await api(`/api/customers/${draft.id}`, { method: "PATCH", body: draft });
      } else {
        await api("/api/customers", { method: "POST", body: draft });
      }
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details ?? {});
      } else {
        setError("Could not save the customer.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(customer: CustomerDTO) {
    const receipts = customer.receipt_count ?? 0;
    const prompt = receipts
      ? `${customer.name} has ${receipts} receipt(s). Their name stays on those receipts. Delete anyway?`
      : `Delete ${customer.name}?`;
    if (!window.confirm(prompt)) return;

    try {
      await api(`/api/customers/${customer.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the customer.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow">Relationships</p>
        <h1 className="page-title mt-1 text-4xl">Customers</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex flex-col gap-4">
          <div className="card">
            <label className="field-label" htmlFor="customer-search">
              Search
            </label>
            <input
              id="customer-search"
              className="field"
              placeholder="Name, phone or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted">
              {loading ? "Searching…" : `${customers.length} customer${customers.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {error ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          {loading && customers.length === 0 ? (
            <div className="card space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-cream-deep/60" />
              ))}
            </div>
          ) : customers.length === 0 ? (
            <div className="card-flat py-14 text-center">
              <p className="text-sm font-semibold">No customers yet</p>
              <p className="mt-1 text-xs text-muted">
                Add one here, or create them inline while writing a receipt.
              </p>
            </div>
          ) : (
            <div className="card p-0">
              <ul>
                {customers.map((customer) => (
                  <li
                    key={customer.id}
                    className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{customer.name}</p>
                      <p className="truncate text-xs text-muted">
                        {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
                          "No contact details"}
                      </p>
                    </div>

                    <div className="text-right text-xs text-muted">
                      <p>
                        {customer.receipt_count ?? 0} receipt
                        {(customer.receipt_count ?? 0) === 1 ? "" : "s"}
                      </p>
                      <p>Added {formatDate(customer.created_at)}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setDraft({
                            id: customer.id,
                            name: customer.name,
                            phone: customer.phone ?? "",
                            email: customer.email ?? "",
                          });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void remove(customer)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <form onSubmit={submit} className="card flex flex-col gap-4">
            <div>
              <p className="eyebrow">{draft.id ? "Edit" : "New"}</p>
              <h2 className="section-title text-xl">
                {draft.id ? "Update customer" : "Add customer"}
              </h2>
            </div>

            <div>
              <label className="field-label" htmlFor="customer-name">
                Name
              </label>
              <input
                id="customer-name"
                className="field"
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                aria-invalid={Boolean(fieldErrors["name"])}
              />
              {fieldErrors["name"] ? <p className="field-error">{fieldErrors["name"]}</p> : null}
            </div>

            <div>
              <label className="field-label" htmlFor="customer-phone">
                Phone
              </label>
              <input
                id="customer-phone"
                type="tel"
                className="field"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="customer-email">
                Email
              </label>
              <input
                id="customer-email"
                type="email"
                className="field"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                aria-invalid={Boolean(fieldErrors["email"])}
              />
              {fieldErrors["email"] ? (
                <p className="field-error">{fieldErrors["email"]}</p>
              ) : null}
            </div>

            <div className="flex gap-3">
              <button type="submit" className="btn btn-gold flex-1" disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save changes" : "Add customer"}
              </button>
              {draft.id ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDraft(EMPTY_DRAFT)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <p className="mt-4 px-1 text-xs text-muted">
            Deleting a customer never deletes their receipts — issued documents keep
            their record.
          </p>
        </aside>
      </div>
    </div>
  );
}
