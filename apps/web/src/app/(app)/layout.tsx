import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** Everything under (app) requires a valid session — AppShell enforces it. */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
