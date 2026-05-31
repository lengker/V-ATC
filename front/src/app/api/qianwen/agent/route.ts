import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  transcriptText?: string;
  aircraftData?: ADSBData[];
};

function safeJsonParse<T = unknown>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ParseError" };
  }
}

function extractJsonObjectMaybe(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1);
}

function buildSystemPrompt() {
  return [
    "You are an assistant for an ATC voice annotation system.",
    "Use only the transcript and context provided by the user. Do not invent airport, route, airline, or aircraft facts.",
    "Return strict JSON only, without markdown fences.",
    "{",
    '  "reply": string,',
    '  "suggestedText"?: string,',
    '  "confidence"?: number,',
    '  "keywords"?: string[],',
    '  "notes"?: string',
    "}",
    "",
    "Priorities:",
    "1. Preserve the original meaning and segment boundary.",
    "2. If ASR text appears incomplete, suggest a conservative ATC-style correction.",
    "3. If there is not enough evidence, omit suggestedText or keep it empty.",
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
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function resolveFrontRootFromHere() {
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
    const fileCfg = readQianwenConfigFromEnvFile();
    const headerKeyRaw = req.headers.get("x-qianwen-api-key");
    const headerKey = headerKeyRaw?.trim();
    const apiKey = process.env.QIANWEN_API_KEY || fileCfg.apiKey || headerKey;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing QIANWEN_API_KEY. Set it in front/.env.local or restart the dev server.",
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
      body.userCommand ? body.userCommand : "Generate one conservative annotation editing suggestion.",
    ].join("\n");

    const payload = {
      model,
      input: { prompt: `${systemPrompt}\n\n${userContext}\n\nReturn strict JSON.` },
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
    const rawText: string =
      (typeof data?.output?.text === "string" && data.output.text) ||
      (Array.isArray(data?.output?.choices) &&
        typeof data.output.choices?.[0]?.text === "string" &&
        data.output.choices[0].text) ||
      (Array.isArray(data?.choices) &&
        typeof data.choices?.[0]?.message?.content === "string" &&
        data.choices[0].message.content) ||
      (typeof data?.output?.choices?.[0]?.message?.content === "string" &&
        data.output.choices[0].message.content) ||
      (typeof data?.text === "string" && data.text) ||
      "";

    if (!rawText) {
      return NextResponse.json(
        { ok: false, error: "Qianwen response missing text content." },
        { status: 502 }
      );
    }

    const maybeJson = extractJsonObjectMaybe(rawText);
    const parsed = maybeJson ? safeJsonParse<any>(maybeJson) : ({ ok: false, error: "NoJsonBlock" } as const);

    if (!parsed.ok) {
      return NextResponse.json({ ok: true, reply: rawText });
    }

    const value = parsed.value ?? {};
    const reply = typeof value.reply === "string" ? value.reply : rawText;
    const suggestedText =
      typeof value.suggestedText === "string" && value.suggestedText.trim()
        ? value.suggestedText
        : undefined;
    const confidence = typeof value.confidence === "number" ? value.confidence : undefined;
    const keywords = Array.isArray(value.keywords)
      ? value.keywords.filter((x: any) => typeof x === "string")
      : undefined;
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
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

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
    encodingHint: !cwdExists
      ? "process.cwd() does not exist on disk. Try starting npm run dev from an ASCII-only path or run chcp 65001 first."
      : null,
    envLocalExists: cwdMeta.envLocalExists,
    envFileHasKeyLine: cwdMeta.envFileHasKeyLine,
    envFileSize: cwdMeta.envFileSize,
    parentEnvLocalExists: parentMeta.envLocalExists,
    parentEnvFileHasKeyLine: parentMeta.envFileHasKeyLine,
    parentEnvFileSize: parentMeta.envFileSize,
  });
}
