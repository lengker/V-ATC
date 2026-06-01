import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vspAip } from "@/mock/vsp-aip";
import type { AgentWorkspaceSnapshot } from "@/lib/agent-workspace-context";
import type { AudioData, VoiceTimestamp } from "@/types";

type AgentMode =
  | "rewrite_annotation"
  | "summarize_segment"
  | "summarize_transcript"
  | "suggest_next"
  | "custom";

type AgentRequest = {
  mode?: AgentMode;
  userCommand?: string;
  audio?: Pick<AudioData, "id">;
  currentTime?: number;
  selectedAircraft?: string;
  selectedTimestamp?: VoiceTimestamp | null;
  // 把当前可见上下文（可选）传给模型，提升建议质量
  transcriptText?: string;
  /** 前端工作区只读快照：录音列表、当前转写全文、地图目标等 */
  workspace?: AgentWorkspaceSnapshot;
};

function safeJsonParse<T = unknown>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ParseError" };
  }
}

function extractJsonObjectMaybe(text: string): string | null {
  // 允许模型把 JSON 包在文本里，尽可能从中抽出第一个 {...} 块
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1);
}

function buildSystemPrompt() {
  const landmarks = vspAip.commonLandmarks.map((x) => x.name).join(", ");
  const procedures = vspAip.procedures
    .map((p) => `${p.type} ${p.name}${p.runway ? ` (RWY ${p.runway})` : ""}${p.waypointHint ? ` · Hint: ${p.waypointHint}` : ""}`)
    .join("; ");
  const airlines = vspAip.airlines
    .map((a) => `${a.callsign} (${a.icao}${a.iata ? `/${a.iata}` : ""})`)
    .join(", ");

  return [
    "你是专为“ATC 地空通话语音标注系统（A-4 模块）”服务的智能体。",
    "你会收到一份「前端工作区快照 workspace」（JSON），其中包含：录音列表、当前选中录音的完整转写、播放头位置、地图目标与选中飞机等。",
    "你必须基于 workspace 中的真实数据回答用户的总结、查询、对比类问题；不得编造快照中不存在的录音、航段或飞机。",
    "若用户问「有哪些录音」「总结当前通话」「当前选中段是什么」等，请直接引用 workspace 中的字段。",
    "你的任务是：根据用户命令与 workspace，生成可直接用于界面标注编辑的建议，或清晰的中文总结。",
    "",
    "输出要求：只输出严格 JSON（不要包裹在代码块里）。JSON 结构如下：",
    "{",
    '  "reply": string,',
    '  "suggestedText"?: string,',
    '  "segmentPatches"?: Array<{ "id": string, "text"?: string, "speaker"?: string }>,',
    '  "mergeGroups"?: Array<{ "segmentIds": string[], "speaker"?: string, "text"?: string }>,',
    '  "confidence"?: number,',
    '  "keywords"?: string[],',
    '  "notes"?: string',
    "}",
    "",
    "编辑权限（用户要求合并片段、改说话人、改文本时均可使用）：",
    "- mergeGroups：合并转写段。每组 segmentIds 至少 2 个，且必须是 workspace.activeRecording.transcript 里已有的 id；",
    "  合并后时间范围为各段 start/end 的并集；未提供 text 时用各段原文换行拼接；可用 speaker 指定合并后说话人（如 ATC、Pilot）；",
    "  默认只合并相邻或用户明确指定的段，不要擅自合并整条录音。",
    "- segmentPatches：按 id 修改单段，可只改 text、只改 speaker、或两者都改；只列出有改动的段，不必覆盖全部段；",
    "- 改单段文本也可用 suggestedText（仅 selectedTimestamp 一段时）。",
    "",
    "改写/润色规则（用户要求修改转写时必须遵守）：",
    "- 禁止只输出分析报告、原因说明或「建议用户去听录音」而不给可写入字段；",
    "- reply 仅 1～3 句说明已改什么，不要重复贴全文。",
    "",
    "你可以参考下面的 VSP/AIP（用于提示可能的程序/地标/航司简字映射；不要编造不在列表中的数据）：",
    `- 常用地标：${landmarks}`,
    `- SID/STAR：${procedures}`,
    `- 航司简字 ↔ 呼号：${airlines}`,
    "",
    "建议优先（默认保守校对，见用户上下文中的 rewriteStyle）：",
    "1) 标注文本应尽量与录音听感一致，不是「理想化」ATC 稿；",
    "2) 默认只改正显拼写、标点、空格；不要用航司/程序表去猜测替换听感词；",
    "3) 仅当用户明确要求 ATC/ASR 语义校正时，才可做呼号、高度等听感纠错，并在 reply 说明依据；",
    "4) 无把握则保持原文，把存疑项写在 reply，不要写入 segmentPatches/suggestedText。",
  ].join("\n");
}

/** 用户明确要求 ATC/ASR 语义级改写（否则走保守拼写校对） */
function userWantsAtcSemanticRewrite(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  if (/不要|别|仅|只/.test(c) && /猜|替换|语义|atc|asr/i.test(c)) return false;
  return /asr|atc\s*语义|语义校正|口误|逐字稿|规范化|润色|呼号|航司|听感纠错|像真实\s*atc/i.test(c);
}

function buildRewriteStyleHint(userCommand: string): string {
  if (userWantsAtcSemanticRewrite(userCommand)) {
    return [
      "rewriteStyle=ATC/ASR 语义校正（用户已明确要求）：",
      "- 在确信的 ASR 误听时可参照 VSP/AIP 纠错；",
      "- reply 中简要列出关键「听感→改后」；",
      "- 仍不要编造快照中不存在的航班/程序。",
    ].join("\n");
  }
  return [
    "rewriteStyle=保守拼写校对（默认，除非用户明确要求 ATC/ASR 校正）：",
    "- 只改明确拼写错误、标点、空格、大小写；",
    "- 禁止用航司表、高度、SID/STAR 去「猜」并替换原文词（如 baby、february 等听感词）；",
    "- 疑似 ASR 误听但不确定时：保持原文，仅在 reply 列出「存疑」建议，不要写入 segmentPatches；",
    "- 目标是与录音听感一致，不是生成标准逐字稿。",
  ].join("\n");
}

function userWantsTranscriptRewrite(command: string, mode: AgentMode): boolean {
  if (mode === "rewrite_annotation") return true;
  const c = command.toLowerCase();
  return /修改|改写|纠正|润色|语法|错别字|转写|文本|没有错误|帮我改/.test(c);
}

function parseDotEnvLike(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function resolveFrontRootFromHere() {
  // This file is: front/src/app/api/qianwen/agent/route.ts
  // So front root is: ../../../../../ from this file's directory
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(hereDir, "../../../../../");
}

function buildModeHint(mode: AgentMode, userCommand: string): string {
  const rewrite = userWantsTranscriptRewrite(userCommand, mode);
  if (rewrite) {
    return [
      "用户模式=改写转写（必须产出可写入字段，禁止只分析）：",
      buildRewriteStyleHint(userCommand),
      "- 改文本：segmentPatches 或 suggestedText；改说话人/合并段：segmentPatches.speaker 或 mergeGroups；",
      "- 不要拒绝改写，不要要求用户去听录音。",
    ].join("\n");
  }
  switch (mode) {
    case "summarize_segment":
      return "用户模式=总结当前段：重点总结 selectedTimestamp 与播放头附近内容，可引用 activeRecording.transcript。";
    case "summarize_transcript":
      return "用户模式=总结整段录音：概括 activeRecording 全部转写要点，列出关键通话主题与说话人。";
    case "suggest_next":
      return "用户模式=建议下一段：根据 workspace 判断下一值得标注的时间范围或内容。";
    case "rewrite_annotation":
      return "用户模式=改写标注：优化 selectedTimestamp 文本，输出 suggestedText。";
    default:
      return [
        "用户模式=自定义：按 userCommand 处理，需要时结合 workspace 全文。",
        "若用户要求合并片段、修改说话人（ATC/Pilot 等）或结构调整，使用 mergeGroups / segmentPatches。",
      ].join("\n");
  }
}

function buildUserContext(body: AgentRequest): string {
  const mode: AgentMode = body.mode ?? "custom";
  const selectedTimestamp = body.selectedTimestamp ?? null;
  const userCommand = body.userCommand ?? "";

  const parts = [
    buildModeHint(mode, userCommand),
    `mode=${mode}`,
    `audioId=${body.audio?.id ?? "N/A"}`,
    `currentTime=${typeof body.currentTime === "number" ? body.currentTime : "N/A"}s`,
    `selectedAircraft=${body.selectedAircraft ?? "N/A"}`,
    "",
    "selectedTimestamp:",
    selectedTimestamp
      ? `- id: ${selectedTimestamp.id}\n- startTime: ${selectedTimestamp.startTime}s\n- endTime: ${selectedTimestamp.endTime}s\n- speaker: ${selectedTimestamp.speaker ?? "N/A"}\n- text: ${selectedTimestamp.text}`
      : "- null",
    "",
    `transcriptText=${body.transcriptText ?? selectedTimestamp?.text ?? ""}`,
  ];

  if (body.workspace) {
    parts.push(
      "",
      "## workspace（前端只读快照，请据此读取与总结）",
      JSON.stringify(body.workspace, null, 2)
    );
  } else {
    parts.push("", "## workspace", "（未提供 — 仅能使用上方 selectedTimestamp / transcriptText）");
  }

  parts.push("", "userCommand:", body.userCommand ? body.userCommand : "生成一条用于标注编辑的建议。");
  return parts.join("\n");
}

function readQianwenConfigFromEnvFile(): {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  envPath: string;
  envExists: boolean;
} {
  const frontRoot = resolveFrontRootFromHere();
  const envPath = path.join(frontRoot, ".env.local");
  try {
    const envExists = fs.existsSync(envPath);
    if (!envExists) return { envPath, envExists: false };
    const raw = fs.readFileSync(envPath, "utf8");
    const parsed = parseDotEnvLike(raw);
    return {
      envPath,
      envExists: true,
      apiKey: parsed.QIANWEN_API_KEY,
      model: parsed.QIANWEN_MODEL,
      baseUrl: parsed.QIANWEN_API_BASE_URL,
    };
  } catch {
    return { envPath, envExists: false };
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    // Prefer process.env (recommended). Fallback to reading front/.env.local by file path
    // to survive Windows mojibake/encoding issues with cwd/env loading.
    const fileCfg = readQianwenConfigFromEnvFile();
    const headerKeyRaw = req.headers.get("x-qianwen-api-key");
    const headerKey = headerKeyRaw?.trim();
    const apiKey = process.env.QIANWEN_API_KEY || fileCfg.apiKey || headerKey;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing QIANWEN_API_KEY. Please set it in front/.env.local (or restart dev server so env is loaded).",
          debug: {
            cwd: process.cwd(),
            envFilePath: fileCfg.envPath,
            envFileExists: fileCfg.envExists,
            headerPresent: Boolean(headerKeyRaw),
            headerLength: headerKey ? headerKey.length : 0,
          },
        },
        { status: 500 }
      );
    }

    const model = process.env.QIANWEN_MODEL || fileCfg.model || "qwen-plus";
    const baseUrl =
      process.env.QIANWEN_API_BASE_URL ||
      fileCfg.baseUrl ||
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

    const systemPrompt = buildSystemPrompt();
    const userContext = buildUserContext(body);

    // DashScope /generation 常见参数：model + input.prompt
    const payload = {
      model,
      input: { prompt: `${systemPrompt}\n\n${userContext}\n\n请严格输出符合要求的 JSON。` },
    };

    const resp = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `Qianwen request failed: ${resp.status} ${resp.statusText}${text ? ` - ${text.slice(0, 500)}` : ""}`,
        },
        { status: 502 }
      );
    }

    const data: any = await resp.json();

    // 兼容不同返回结构：output.text / output.choices[0].text / choices[0].message.content 等
    const rawText: string =
      (typeof data?.output?.text === "string" && data.output.text) ||
      (Array.isArray(data?.output?.choices) && typeof data.output.choices?.[0]?.text === "string" && data.output.choices[0].text) ||
      (Array.isArray(data?.choices) && typeof data.choices?.[0]?.message?.content === "string" && data.choices[0].message.content) ||
      (typeof data?.output?.choices?.[0]?.message?.content === "string" && data.output.choices[0].message.content) ||
      (typeof data?.text === "string" && data.text) ||
      "";

    if (!rawText) {
      return NextResponse.json(
        {
          ok: false,
          error: "Qianwen response missing text content.",
        },
        { status: 502 }
      );
    }

    const maybeJson = extractJsonObjectMaybe(rawText);
    const parsed = maybeJson ? safeJsonParse<any>(maybeJson) : ({ ok: false, error: "NoJsonBlock" } as const);

    // 如果没解析成 JSON，就把整段当 reply
    if (!parsed.ok) {
      return NextResponse.json({
        ok: true,
        reply: rawText,
      });
    }

    const value = (parsed.ok ? parsed.value : {}) ?? {};
    const reply = typeof value.reply === "string" ? value.reply : rawText;
    const suggestedText = typeof value.suggestedText === "string" && value.suggestedText.trim() ? value.suggestedText : undefined;
    const segmentPatches = Array.isArray(value.segmentPatches)
      ? value.segmentPatches
          .map((p: unknown) => {
            if (!p || typeof p !== "object") return null;
            const id = (p as { id?: unknown }).id;
            if (typeof id !== "string" || !id.trim()) return null;
            const textRaw = (p as { text?: unknown }).text;
            const speakerRaw = (p as { speaker?: unknown }).speaker;
            const text =
              typeof textRaw === "string" && textRaw.trim() ? textRaw.trim() : undefined;
            const speaker =
              typeof speakerRaw === "string" && speakerRaw.trim()
                ? speakerRaw.trim()
                : speakerRaw === ""
                  ? ""
                  : undefined;
            if (text === undefined && speaker === undefined) return null;
            return { id: id.trim(), text, speaker };
          })
          .filter(Boolean)
      : undefined;

    const mergeGroups = Array.isArray(value.mergeGroups)
      ? value.mergeGroups
          .map((g: unknown) => {
            if (!g || typeof g !== "object") return null;
            const ids = (g as { segmentIds?: unknown }).segmentIds;
            if (!Array.isArray(ids) || ids.length < 2) return null;
            const segmentIds = ids
              .filter((x): x is string => typeof x === "string" && Boolean(String(x).trim()))
              .map((x) => x.trim());
            if (segmentIds.length < 2) return null;
            const textRaw = (g as { text?: unknown }).text;
            const speakerRaw = (g as { speaker?: unknown }).speaker;
            return {
              segmentIds,
              text:
                typeof textRaw === "string" && textRaw.trim() ? textRaw.trim() : undefined,
              speaker:
                typeof speakerRaw === "string" && speakerRaw.trim()
                  ? speakerRaw.trim()
                  : undefined,
            };
          })
          .filter(Boolean)
      : undefined;
    const confidence = typeof value.confidence === "number" ? value.confidence : undefined;
    const keywords = Array.isArray(value.keywords) ? value.keywords.filter((x: any) => typeof x === "string") : undefined;
    const notes = typeof value.notes === "string" ? value.notes : undefined;

    return NextResponse.json({
      ok: true,
      reply,
      suggestedText,
      segmentPatches: segmentPatches?.length ? segmentPatches : undefined,
      mergeGroups: mergeGroups?.length ? mergeGroups : undefined,
      confidence,
      keywords,
      notes,
      raw: rawText,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// 小工具：确认服务端是否已经读到 QIANWEN_API_KEY（不输出密钥本身）
export async function GET() {
  const hasKey = Boolean(process.env.QIANWEN_API_KEY);
  const cwd = process.cwd();
  const cwdExists = fs.existsSync(cwd);
  const cwdEnvPath = path.join(cwd, ".env.local");
  const parentEnvPath = path.join(cwd, "..", ".env.local");
  const fileCfg = readQianwenConfigFromEnvFile();

  const readEnvMeta = (p: string) => {
    const envLocalExists = fs.existsSync(p);
    let envFileHasKeyLine = false;
    let envFileSize = 0;
    if (envLocalExists) {
      try {
        const stat = fs.statSync(p);
        envFileSize = stat.size;
        const raw = fs.readFileSync(p, "utf8");
        envFileHasKeyLine = raw.includes("QIANWEN_API_KEY=");
      } catch {
        // ignore
      }
    }
    return { envLocalExists, envFileHasKeyLine, envFileSize };
  };

  const cwdMeta = readEnvMeta(cwdEnvPath);
  const parentMeta = readEnvMeta(parentEnvPath);

  return NextResponse.json({
    ok: true,
    hasKey,
    cwd,
    cwdExists,
    envFilePath: fileCfg.envPath,
    envFileExists: fileCfg.envExists,
    hasKeyFromEnvFile: Boolean(fileCfg.apiKey),
    encodingHint:
      !cwdExists
        ? "process.cwd() does not exist on disk. On Windows this often means the dev server was started under a non-UTF8 code page and the working directory string got mojibake. Try starting `npm run dev` from an ASCII-only path (e.g. E:\\qt\\front) or run `chcp 65001` before starting."
        : null,
    envLocalExists: cwdMeta.envLocalExists,
    envFileHasKeyLine: cwdMeta.envFileHasKeyLine,
    envFileSize: cwdMeta.envFileSize,
    parentEnvLocalExists: parentMeta.envLocalExists,
    parentEnvFileHasKeyLine: parentMeta.envFileHasKeyLine,
    parentEnvFileSize: parentMeta.envFileSize,
  });
}
