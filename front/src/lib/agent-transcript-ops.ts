import type { VoiceTimestamp } from "@/types";

export type AgentSegmentPatch = {
  id: string;
  text?: string;
  speaker?: string;
};

export type AgentMergeGroup = {
  /** 至少 2 个，须为当前转写中存在的段 id */
  segmentIds: string[];
  /** 合并后整段的说话人（如 ATC / Pilot） */
  speaker?: string;
  /** 若提供则作为合并后全文，否则按各段 text 用换行拼接 */
  text?: string;
};

export type AgentTranscriptOps = {
  segmentPatches?: AgentSegmentPatch[];
  mergeGroups?: AgentMergeGroup[];
};

function newSegmentId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ts_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function sortTranscriptSegments(items: VoiceTimestamp[]): VoiceTimestamp[] {
  return [...items].sort((a, b) => a.startTime - b.startTime);
}

function applySingleMerge(
  sorted: VoiceTimestamp[],
  group: AgentMergeGroup
): VoiceTimestamp[] | null {
  const ids = [...new Set(group.segmentIds.map(String))];
  if (ids.length < 2) return null;

  const list = sortTranscriptSegments(sorted.filter((t) => ids.includes(t.id)));
  if (list.length < 2) return null;

  const merged: VoiceTimestamp = {
    id: newSegmentId(),
    startTime: Math.min(...list.map((t) => t.startTime)),
    endTime: Math.max(...list.map((t) => t.endTime)),
    text:
      group.text?.trim() ||
      list
        .map((t) => t.text.trim())
        .filter(Boolean)
        .join("\n"),
    speaker: group.speaker?.trim() || list.map((t) => t.speaker).find(Boolean),
    confidence: undefined,
  };

  const removeSet = new Set(list.map((t) => t.id));
  const next = sorted.filter((t) => !removeSet.has(t.id));
  const insertAt = Math.max(0, sorted.findIndex((t) => t.id === list[0].id));
  next.splice(insertAt, 0, merged);
  return sortTranscriptSegments(next);
}

/** 将智能体返回的合并 / 改说话人 / 改文本应用到转写列表 */
export function applyAgentTranscriptOps(
  timestamps: VoiceTimestamp[],
  ops: AgentTranscriptOps
): { applied: boolean; message: string; next: VoiceTimestamp[] } {
  let next = sortTranscriptSegments(timestamps);
  const parts: string[] = [];

  const merges = ops.mergeGroups ?? [];
  if (merges.length) {
    const ordered = [...merges].sort((a, b) => {
      const idx = (ids: string[]) =>
        Math.max(...ids.map((id) => next.findIndex((t) => t.id === id)));
      return idx(b.segmentIds) - idx(a.segmentIds);
    });
    let mergeCount = 0;
    for (const g of ordered) {
      const result = applySingleMerge(next, g);
      if (result) {
        next = result;
        mergeCount += 1;
      }
    }
    if (mergeCount) parts.push(`合并 ${mergeCount} 组`);
  }

  const patches = ops.segmentPatches ?? [];
  let patchCount = 0;
  if (patches.length) {
    next = next.map((ts) => {
      const p = patches.find((x) => x.id === ts.id);
      if (!p) return ts;
      let updated = ts;
      if (p.text !== undefined && p.text.trim() !== ts.text) {
        updated = { ...updated, text: p.text.trim() };
      }
      if (p.speaker !== undefined) {
        const sp = p.speaker.trim() || undefined;
        if (sp !== ts.speaker) updated = { ...updated, speaker: sp };
      }
      if (updated !== ts) {
        patchCount += 1;
        return updated;
      }
      return ts;
    });
    if (patchCount) parts.push(`更新 ${patchCount} 段`);
  }

  next = sortTranscriptSegments(next);
  const applied =
    JSON.stringify(sortTranscriptSegments(timestamps)) !== JSON.stringify(next);

  return {
    applied,
    message: applied ? parts.join("，") || "已应用" : "没有可匹配的段 id 或内容与现有一致",
    next,
  };
}

export function summarizeAgentOps(ops: AgentTranscriptOps): string {
  const m = ops.mergeGroups?.length ?? 0;
  const p = ops.segmentPatches?.length ?? 0;
  const bits: string[] = [];
  if (m) bits.push(`${m} 组合并`);
  if (p) bits.push(`${p} 段属性/文本`);
  return bits.length ? bits.join(" · ") : "无结构化编辑";
}
