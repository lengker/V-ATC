/** 后台管理设计令牌：清晰 · 克制 · 高对比 */
export const admin = {
  page: "relative min-h-screen text-[#f1f5f9] bg-[#0f1419]",
  hero:
    "rounded-xl border border-slate-600/80 bg-slate-900/95 px-5 py-4 shadow-sm",
  panel:
    "rounded-xl border border-slate-600/70 bg-slate-900/95 shadow-sm relative",
  panelInner:
    "rounded-lg border border-slate-600/60 bg-slate-950/90",
  title: "text-[#f8fafc] font-semibold",
  heroTitle: "text-xl sm:text-2xl font-bold tracking-tight text-[#f8fafc]",
  body: "text-[#e2e8f0]",
  muted: "text-[#94a3b8]",
  label: "text-[#cbd5e1] text-xs font-medium mb-1 block",
  hint: "text-[#64748b] text-xs mt-1",
  input:
    "bg-slate-950 border border-slate-500 text-[#f8fafc] placeholder:text-slate-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40",
  inputError: "border-red-500 focus:border-red-500 focus:ring-red-500/30",
  btnPrimary:
    "bg-sky-600 hover:bg-sky-500 text-white font-medium border-0",
  btnOutline:
    "bg-slate-800 hover:bg-slate-700 text-[#f8fafc] border border-slate-500 font-medium",
  btnGhost: "text-[#f8fafc] hover:bg-slate-800",
  tabActive: "bg-sky-600 text-white font-medium border-0 shadow-none",
  tabIdle:
    "bg-slate-800 text-[#e2e8f0] border border-slate-600 hover:bg-slate-700 font-medium",
  listActive: "border border-sky-500 bg-sky-950/50 text-[#f8fafc] ring-1 ring-sky-500/40",
  listIdle:
    "border border-transparent bg-slate-800/40 hover:bg-slate-800 text-[#e2e8f0]",
  tableHead: "bg-slate-800 text-[#f1f5f9] font-medium text-xs uppercase tracking-wide",
  tableCell: "text-[#e2e8f0]",
  statLabel: "text-[#94a3b8] text-sm",
  statValue: "text-2xl sm:text-3xl font-bold text-[#f8fafc] tabular-nums",
  badge: "inline-flex items-center rounded-md bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200 tabular-nums",
  unsaved: "text-amber-400 text-xs font-medium",
} as const;
