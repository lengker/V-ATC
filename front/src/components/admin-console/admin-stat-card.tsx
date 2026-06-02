import { cn } from "@/lib/utils";
import { admin } from "@/components/admin-console/admin-theme";

export function AdminStatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className={cn(admin.panel, "px-4 py-3.5")}>
      <div className={cn("flex items-center gap-2 mb-1", admin.statLabel)}>
        <span className="text-sky-400">{icon}</span>
        {label}
      </div>
      <div className={admin.statValue}>{value.toLocaleString()}</div>
    </div>
  );
}
