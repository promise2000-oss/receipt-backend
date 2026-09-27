"use client";

import { useEffect, type ReactNode } from "react";

/** Set the tab title from a client component (they can't export metadata). */
export function useTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Eleosstyles Receipt System`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Tiny helper so empty states and headings stay consistent. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-flat flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 3h9l3 3v15l-3-2-3 2-3-2-3 2V3z" strokeLinejoin="round" />
          <path d="M9 8h6M9 12h6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
