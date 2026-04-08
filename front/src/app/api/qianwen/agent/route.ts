import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vspAip } from "@/mock/vsp-aip";
import type { ADSBData, AudioData, VoiceTimestamp } from "@/types";

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
  aircraftData?: ADSBData[]; // 可选：如果你后续把更多上下文接进来
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
    "你的任务是：根据用户提供的当前时间戳文本/上下文，生成可直接用于界面标注编辑的建议。",
    "",
    "输出要求：只输出严格 JSON（不要包裹在代码块里）。JSON 结构如下：",
    "{",
    '  "reply": string,',
    '  "suggestedText"?: string,',
    '  "confidence"?: number,',
    '  "keywords"?: string[],',
    '  "notes"?: string',
    "}",
    "",
    "你可以参考下面的 VSP/AIP（用于提示可能的程序/地标/航司简字映射；不要编造不在列表中的数据）：",
    `- 常用地标：${landmarks}`,
    `- SID/STAR：${procedures}`,
    `- 航司简字 ↔ 呼号：${airlines}`,
    "",
    "建议优先：",
    "1) 保持原意和语义边界，不要擅自加入新的事实；",
    "2) 若原文疑似口误/ASR 漏字，给出更像真实 ATC 逐字稿的改写；",
    "3) 如果无法给出可靠建议，就不要给 suggestedText（或给一个空/简单提示）。",
  ].join("\n");
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

    const mode: AgentMode = body.mode ?? "custom";
    const selectedTimestamp = body.selectedTimestamp ?? null;

    const systemPrompt = buildSystemPrompt();

    const userContext = [
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
      "",
      "userCommand:",
      body.userCommand ? body.userCommand : "生成一条用于标注编辑的建议。",
    ].join("\n");

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
    const confidence = typeof value.confidence === "number" ? value.confidence : undefined;
    const keywords = Array.isArray(value.keywords) ? value.keywords.filter((x: any) => typeof x === "string") : undefined;
    const notes = typeof value.notes === "string" ? value.notes : undefined;

    return NextResponse.json({
      ok: true,
      reply,
      suggestedText,
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
