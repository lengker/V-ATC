"use client";

import { AdminGuard } from "@/components/admin-guard";
import { AdminConsolePage } from "@/components/admin-console/admin-console-page";

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminConsolePage />
    </AdminGuard>
  );
}
