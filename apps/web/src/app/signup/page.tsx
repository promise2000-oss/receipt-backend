"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { CURRENCIES } from "@eleos/shared";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";

export default function SignupPage() {
  useTitle("Create account");
  const { signup, user } = useSession();
  const router = useRouter();

  const [form, setForm] = useState({
    businessName: "",
    fullName: "",
    email: "",
    password: "",
    phone: "",
    currency: "NGN",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await signup({
        business: {
          name: form.businessName,
          currency: form.currency,
        },
        user: {
          full_name: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone || null,
        },
      });
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details ?? {});
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="border-b border-gold/70 bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <span className="wordmark text-2xl text-cream">
            Eleos<span className="text-gold">styles</span>
          </span>
          <span className="eyebrow">Receipt System</span>
        </div>
      </div>

      <div className="mx-auto flex max-w-md flex-col px-6 py-14">
        <p className="eyebrow">Get started</p>
        <h1 className="page-title mt-2 text-4xl">Create your account</h1>
        <p className="mt-3 text-sm text-muted">
          One account gives you a branded business profile, customers, and sequential
          receipt numbering.
        </p>
        <hr className="gold-rule mt-5" />

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {error}
            </div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              className="field"
              placeholder="Eleosstyles Boutique"
              value={form.businessName}
              onChange={(e) => set("businessName")(e.target.value)}
              aria-invalid={Boolean(fieldErrors["business.name"])}
              required
            />
            {fieldErrors["business.name"] ? (
              <p className="field-error">{fieldErrors["business.name"]}</p>
            ) : null}
          </div>

          <div>
            <label className="field-label" htmlFor="fullName">
              Your name
            </label>
            <input
              id="fullName"
              className="field"
              autoComplete="name"
              value={form.fullName}
              onChange={(e) => set("fullName")(e.target.value)}
              aria-invalid={Boolean(fieldErrors["user.full_name"])}
              required
            />
            {fieldErrors["user.full_name"] ? (
              <p className="field-error">{fieldErrors["user.full_name"]}</p>
            ) : null}
          </div>

          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="field"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
              aria-invalid={Boolean(fieldErrors["user.email"])}
              required
            />
            {fieldErrors["user.email"] ? (
              <p className="field-error">{fieldErrors["user.email"]}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="field"
                value={form.password}
                onChange={(e) => set("password")(e.target.value)}
                aria-invalid={Boolean(fieldErrors["user.password"])}
                required
                minLength={8}
              />
              {fieldErrors["user.password"] ? (
                <p className="field-error">{fieldErrors["user.password"]}</p>
              ) : (
                <p className="mt-1 text-[11px] text-muted">At least 8 characters.</p>
              )}
            </div>

            <div>
              <label className="field-label" htmlFor="currency">
                Currency
              </label>
              <select
                id="currency"
                className="field"
                value={form.currency}
                onChange={(e) => set("currency")(e.target.value)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="phone">
              Phone (optional)
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              className="field"
              value={form.phone}
              onChange={(e) => set("phone")(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-gold w-full" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-gold hover:text-gold-light">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
