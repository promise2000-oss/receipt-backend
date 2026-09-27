"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-xs uppercase tracking-[0.3em] text-muted">Eleosstyles</p>
    </div>
  );
}
