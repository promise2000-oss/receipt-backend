"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { BRAND, CURRENCIES, type BusinessDTO } from "@eleos/shared";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";

const PRESETS = [
  { label: "Eleosstyles (default)", primary: BRAND.ink, accent: BRAND.gold },
  { label: "Ivory & Antique", primary: "#1C1810", accent: "#A9762A" },
  { label: "Noir & Champagne", primary: "#0B0B0B", accent: "#C9A227" },
  { label: "Forest & Brass", primary: "#12241C", accent: "#A8823B" },
];

interface SettingsForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  number_prefix: string;
  brand_primary: string;
  brand_accent: string;
}

export default function SettingsPage() {
  useTitle("Settings");
  const { business, updateBusiness } = useSession();

  const [form, setForm] = useState<SettingsForm>({
    name: "",
    email: "",
    phone: "",
    address: "",
    currency: "NGN",
    number_prefix: "ES",
    brand_primary: BRAND.ink,
    brand_accent: BRAND.gold,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!business) return;
    setForm({
      name: business.name,
      email: business.email ?? "",
      phone: business.phone ?? "",
      address: business.address ?? "",
      currency: business.currency,
      number_prefix: business.number_prefix,
      brand_primary: business.brand_primary,
      brand_accent: business.brand_accent,
    });
  }, [business]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const updated = await api<BusinessDTO>("/api/business", {
        method: "PATCH",
        body: form,
      });
      updateBusiness(updated);
      setNotice("Business profile saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details ?? {});
      } else {
        setError("Could not save your settings.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("logo", file);
      const updated = await api<BusinessDTO>("/api/business/logo", {
        method: "POST",
        formData,
      });
      updateBusiness(updated);
      setNotice("Logo updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Logo upload failed.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function removeLogo() {
    setUploading(true);
    try {
      const updated = await api<BusinessDTO>("/api/business/logo", { method: "DELETE" });
      updateBusiness(updated);
      setNotice("Logo removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow">Branding</p>
        <h1 className="page-title mt-1 text-4xl">Business settings</h1>
      </header>

      {notice ? (
        <div className="rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* ---------------------- Live header preview ---------------------- */}
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: form.brand_accent }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-4 px-6 py-5"
          style={{ backgroundColor: form.brand_primary }}
        >
          <div className="flex items-center gap-4">
            {business?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logo_url}
                alt="Business logo"
                className="h-12 w-12 rounded-lg bg-[#FBF7EE] p-1 object-contain"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold"
                style={{
                  border: `1px solid ${form.brand_accent}`,
                  color: form.brand_accent,
                  fontFamily: "var(--font-display)",
                }}
              >
                {(form.name || "E").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p
                className="text-xl"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "#FBF7EE",
                }}
              >
                {form.name || "Your business"}
              </p>
              <p
                className="text-[10px] uppercase tracking-[0.24em]"
                style={{ color: form.brand_accent }}
              >
                Sales receipt
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.2em] text-cream/60">
              Receipt no.
            </p>
            <p
              className="text-lg"
              style={{ fontFamily: "var(--font-display)", color: form.brand_accent }}
            >
              {form.number_prefix || "ES"}-000214
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={save} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* --------------------------- Profile --------------------------- */}
        <section className="card flex flex-col gap-5">
          <div>
            <p className="eyebrow">Profile</p>
            <h2 className="section-title text-xl">Business details</h2>
          </div>

          <div>
            <label className="field-label" htmlFor="name">
              Business name
            </label>
            <input
              id="name"
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-invalid={Boolean(fieldErrors["name"])}
            />
            {fieldErrors["name"] ? <p className="field-error">{fieldErrors["name"]}</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={Boolean(fieldErrors["email"])}
              />
              {fieldErrors["email"] ? (
                <p className="field-error">{fieldErrors["email"]}</p>
              ) : null}
            </div>

            <div>
              <label className="field-label" htmlFor="phone">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                className="field"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="address">
              Address
            </label>
            <textarea
              id="address"
              className="field min-h-20 resize-y"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="currency">
                Currency
              </label>
              <select
                id="currency"
                className="field"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="prefix">
                Receipt prefix
              </label>
              <input
                id="prefix"
                className="field uppercase"
                maxLength={6}
                value={form.number_prefix}
                onChange={(e) =>
                  setForm({
                    ...form,
                    number_prefix: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
              />
              <p className="mt-1 text-[11px] text-muted">Produces {form.number_prefix || "ES"}-000214.</p>
            </div>
          </div>
        </section>

        {/* --------------------------- Branding -------------------------- */}
        <section className="card flex flex-col gap-5">
          <div>
            <p className="eyebrow">Appearance</p>
            <h2 className="section-title text-xl">Logo & colours</h2>
          </div>

          <div>
            <span className="field-label">Logo</span>
            <div className="flex flex-wrap items-center gap-4">
              {business?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={business.logo_url}
                  alt="Current logo"
                  className="h-16 w-16 rounded-lg border border-rule bg-white object-contain p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-rule text-xs text-muted">
                  None
                </div>
              )}

              <label className="btn btn-outline btn-sm cursor-pointer">
                {uploading ? "Uploading…" : "Upload logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  className="hidden"
                  onChange={(e) => void uploadLogo(e)}
                  disabled={uploading}
                />
              </label>

              {business?.logo_url ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void removeLogo()}
                  disabled={uploading}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-muted">PNG, JPEG, WebP or SVG · max 3 MB.</p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="primary">
                Header band
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="primary"
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded border border-rule bg-transparent p-1"
                  value={form.brand_primary}
                  onChange={(e) => setForm({ ...form, brand_primary: e.target.value })}
                />
                <input
                  className="field font-mono uppercase"
                  value={form.brand_primary}
                  onChange={(e) => setForm({ ...form, brand_primary: e.target.value })}
                  aria-label="Header band hex colour"
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="accent">
                Gold accent
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="accent"
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded border border-rule bg-transparent p-1"
                  value={form.brand_accent}
                  onChange={(e) => setForm({ ...form, brand_accent: e.target.value })}
                />
                <input
                  className="field font-mono uppercase"
                  value={form.brand_accent}
                  onChange={(e) => setForm({ ...form, brand_accent: e.target.value })}
                  aria-label="Gold accent hex colour"
                />
              </div>
            </div>
          </div>

          <div>
            <span className="field-label">Presets</span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-rule px-3 py-2 text-xs transition-colors hover:border-gold"
                  onClick={() =>
                    setForm({
                      ...form,
                      brand_primary: preset.primary,
                      brand_accent: preset.accent,
                    })
                  }
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: preset.accent }}
                  />
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: preset.primary }}
                  />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-rule pt-4">
            <button type="submit" className="btn btn-gold" disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (!business) return;
                setForm({
                  name: business.name,
                  email: business.email ?? "",
                  phone: business.phone ?? "",
                  address: business.address ?? "",
                  currency: business.currency,
                  number_prefix: business.number_prefix,
                  brand_primary: business.brand_primary,
                  brand_accent: business.brand_accent,
                });
                setError(null);
                setNotice(null);
              }}
            >
              Reset
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
