"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTitle } from "@/lib/ui";

function LoginForm() {
  useTitle("Sign in");
  const { login, user } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const next = params.get("next") ?? "/dashboard";

  // Redirecting must happen in an effect: calling router.replace while
  // rendering is a state update during render.
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await login(email, password);
      router.replace(next);
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

      <div className="mx-auto flex max-w-md flex-col px-6 py-16">
        <p className="eyebrow">Welcome back</p>
        <h1 className="page-title mt-2 text-4xl">Sign in</h1>
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
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors["email"])}
              required
            />
            {fieldErrors["email"] ? (
              <p className="field-error">{fieldErrors["email"]}</p>
            ) : null}
          </div>

          <div>
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-gold w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-semibold text-gold hover:text-gold-light">
            Create your business account
          </Link>
        </p>

        <div className="mt-10 rounded-xl border border-rule bg-cream-deep/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            Demo account
          </p>
          <p className="mt-1 font-mono text-xs text-ink">demo@eleosstyles.com</p>
          <p className="font-mono text-xs text-ink">password123</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-cream" />}>
      <LoginForm />
    </Suspense>
  );
}
