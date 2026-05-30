import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

/** A5 无 /sync/a3-asr 或失败时：本机 process_a2_via_a3.py（内含 asr_worker 子进程） */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const audioId = url.searchParams.get("audio_id");
  if (!audioId || !/^\d+$/.test(audioId)) {
    return NextResponse.json({ ok: 0, error: "audio_id required" }, { status: 400 });
  }

  const qtRoot = path.resolve(process.cwd(), "..");
  const lianDiao = path.join(qtRoot, "联调");
  const venvPy = path.join(lianDiao, ".asr-venv", "Scripts", "python.exe");
  const py = fs.existsSync(venvPy) ? venvPy : "python";
  const script = path.join(lianDiao, "process_a2_via_a3.py");
  const args = [py, script, "--audio-id", audioId];

  return new Promise<NextResponse>((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: lianDiao,
      env: {
        ...process.env,
        ASR_BACKEND: process.env.ASR_BACKEND || "faster_whisper",
        WHISPER_MODEL: process.env.WHISPER_MODEL || "tiny",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("close", (code) => {
      try {
        const line = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
        const data = JSON.parse(line) as Record<string, unknown>;
        const ok = data.ok === 1 || data.ok === true;
        const ann = Number(data.annotations ?? 0);
        const failed =
          !ok &&
          (code !== 0 ||
            (Array.isArray(data.details) &&
              data.details.some(
                (d) =>
                  d &&
                  typeof d === "object" &&
                  (d as { status?: string }).status === "failed"
              )));
        const status = ok || ann > 0 ? 200 : failed ? 500 : 200;
        resolve(
          NextResponse.json(
            { ...data, via: "next-api", exit_code: code, stderr_tail: stderr.slice(-400) },
            { status }
          )
        );
      } catch {
        resolve(
          NextResponse.json(
            { ok: 0, error: "asr_parse_failed", stdout, stderr, exit_code: code },
            { status: 500 }
          )
        );
      }
    });
    child.on("error", (err) => {
      resolve(NextResponse.json({ ok: 0, error: String(err) }, { status: 500 }));
    });
  });
}
