import type { AudioData } from "@/types";

/** 列表为空时占位，用于保持完整工作台布局 */
export const EMPTY_PLACEHOLDER_AUDIO: AudioData = {
  id: "",
  url: "",
  duration: 1,
  timestamps: [],
  metadata: { title: "暂无录音 · 请点「立即更新」" },
};

export function isEmptyPlaceholderAudio(audio: AudioData | null | undefined): boolean {
  return !audio?.id;
}
