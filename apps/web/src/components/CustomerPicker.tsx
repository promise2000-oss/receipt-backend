"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerDTO } from "@eleos/shared";
import { api } from "@/lib/api";

interface Props {
  value: string | null;
  /** Human label for the currently selected customer (empty = walk-in). */
  label: string;
  onChange: (id: string | null, label: string) => void;
}

/**
 * Search-as-you-type customer picker with inline creation, so a receipt can be
 * written without leaving the builder.
 */
export function CustomerPicker({ value, label, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking away.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ items: CustomerDTO[] }>(
          `/api/customers?search=${encodeURIComponent(term)}`,
        );
        setResults(data.items);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  async function createCustomer(name: string) {
    setBusy(true);
    try {
      const created = await api<CustomerDTO>("/api/customers", {
        method: "POST",
        body: { name },
      });
      onChange(created.id, created.name);
      setQuery("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const trimmed = query.trim();
  const exactExists = results.some(
    (customer) => customer.name.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div ref={containerRef} className="relative">
      <label className="field-label" htmlFor="customer-picker">
        Customer
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="customer-picker"
            className="field"
            placeholder="Search by name, phone or email…"
            value={open ? query : label}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setQuery("");
              setOpen(true);
            }}
            autoComplete="off"
          />
          {open ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-xl border border-rule bg-[#fffdf8] py-1">
              {value ? (
                <button
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-cream"
                  onClick={() => {
                    onChange(null, "");
                    setOpen(false);
                  }}
                >
                  <span className="text-muted">Walk-in customer</span>{" "}
                  <span className="text-xs text-gold">(no customer)</span>
                </button>
              ) : null}

              {results.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-cream"
                  onClick={() => {
                    onChange(customer.id, customer.name);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{customer.name}</span>
                  {customer.phone ? (
                    <span className="ml-2 text-xs text-muted">{customer.phone}</span>
                  ) : null}
                </button>
              ))}

              {trimmed.length > 0 && !exactExists ? (
                <button
                  type="button"
                  disabled={busy}
                  className="block w-full border-t border-rule px-4 py-2 text-left text-sm font-semibold text-gold hover:bg-cream disabled:opacity-50"
                  onClick={() => void createCustomer(trimmed)}
                >
                  + Create “{trimmed}”
                </button>
              ) : null}

              {trimmed.length === 0 && results.length === 0 ? (
                <p className="px-4 py-2 text-xs text-muted">
                  Start typing to search, or create a customer inline.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {value ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => onChange(null, "")}
            title="Remove customer"
          >
            Clear
          </button>
        ) : null}
      </div>

      {value ? (
        <p className="mt-1.5 text-xs text-muted">
          Selected: <span className="font-semibold text-ink">{label}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted">No customer — will show as walk-in.</p>
      )}
    </div>
  );
}
