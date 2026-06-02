/** 后台管理：文案、角色映射与校验（贴近业务语言） */

export type AdminRole = "admin" | "annotator" | "viewer";

export const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "管理员",
  annotator: "标注员",
  viewer: "只读",
};

export const TAB_ITEMS = [
  { key: "recordings" as const, label: "录音管理", hint: "播放、编辑转写与标注段" },
  { key: "users" as const, label: "用户", hint: "角色与关联录音" },
  { key: "annotations" as const, label: "全部标注", hint: "跨录音检索与删除" },
];

export function formatRelativeTime(from: Date, now = new Date()): string {
  const sec = Math.floor((now.getTime() - from.getTime()) / 1000);
  if (sec < 10) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return from.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function validateSegmentTimes(
  start: number,
  end: number,
  durationSec: number
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "请填写有效的起止时间（秒）";
  if (start < 0) return "开始时间不能小于 0";
  if (end <= start) return "结束时间必须大于开始时间";
  if (end > durationSec + 0.01) {
    return `结束时间不能超过录音时长（${durationSec.toFixed(1)} 秒）`;
  }
  return null;
}

export function listFilterSummary(total: number, shown: number, query: string): string {
  const q = query.trim();
  if (!q) return `共 ${total} 条`;
  if (shown === 0) return `未找到与「${q}」匹配的结果（共 ${total} 条）`;
  return `找到 ${shown} / ${total} 条`;
}
