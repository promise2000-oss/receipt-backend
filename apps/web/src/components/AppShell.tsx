"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useRequireAuth, useSession } from "@/lib/session";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/receipts", label: "Receipts" },
  { href: "/customers", label: "Customers" },
  { href: "/settings", label: "Settings" },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark leading-none ${className}`}>
      Eleos<span className="text-gold">styles</span>
    </span>
  );
}

function navClass(active: boolean): string {
  return [
    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-gold text-ink"
      : "text-cream/70 hover:text-cream hover:bg-cream/10",
  ].join(" ");
}

/**
 * Authenticated shell: black header band, gold hairline, cream body —
 * the same three-colour construction as the receipt itself.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { ready } = useRequireAuth();
  const { user, business, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Wordmark className="text-2xl" />
          <div className="h-px w-32 animate-pulse bg-gold/60" />
          <p className="text-xs uppercase tracking-[0.25em] text-muted">Loading…</p>
        </div>
      </div>
    );
  }

  const initials = (user?.full_name ?? "E")
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gold/70 bg-ink">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3.5">
          <Link href="/dashboard" className="shrink-0">
            <Wordmark className="text-xl text-cream" />
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={navClass(active)}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Link href="/receipts/new" className="btn btn-gold btn-sm hidden sm:inline-flex">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New Receipt
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/60 bg-cream/10 text-xs font-bold text-cream transition-colors hover:border-gold hover:bg-gold hover:text-ink"
                aria-label="Account menu"
                aria-expanded={menuOpen}
              >
                {initials}
              </button>

              {menuOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-rule bg-[#fffdf8] shadow-none">
                    <div className="border-b border-rule px-4 py-3">
                      <p className="truncate text-sm font-semibold">{user?.full_name}</p>
                      <p className="truncate text-xs text-muted">{user?.email}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-gold">
                        {business?.name}
                      </p>
                    </div>
                    <div className="p-2 md:hidden">
                      {NAV.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMenuOpen(false)}
                          className="block rounded-lg px-3 py-2 text-sm hover:bg-cream"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left text-sm text-danger hover:bg-cream"
                      onClick={async () => {
                        setMenuOpen(false);
                        await logout();
                        router.replace("/login");
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t border-cream/10 px-4 py-2 md:hidden">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={navClass(active)}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>

      <footer className="mx-auto max-w-7xl px-5 pb-10">
        <hr className="gold-rule" />
        <p className="pt-4 text-xs text-muted">
          Eleosstyles Receipt System — receipts are immutable once issued. Corrections
          are made by voiding and reissuing.
        </p>
      </footer>
    </div>
  );
}
