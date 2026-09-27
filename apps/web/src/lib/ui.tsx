"use client";

import { useEffect } from "react";

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
