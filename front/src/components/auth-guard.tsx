"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const PUBLIC_ROUTES = new Set<string>(["/login"]);

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (PUBLIC_ROUTES.has(pathname)) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (PUBLIC_ROUTES.has(pathname)) return <>{children}</>;
  if (loading) return null;
  if (!user) return null;
  return <>{children}</>;
}

