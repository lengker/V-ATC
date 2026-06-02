import type { ReactNode } from "react";

/** 后台页独立配色，避免继承全局 muted 导致文字过浅 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-console-scope min-h-screen bg-[#0f1419] text-[#f8fafc] [&_button]:text-inherit">
      {children}
    </div>
  );
}
