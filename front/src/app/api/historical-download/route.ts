import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

/** A5 /sync/a2-historical-download 不可用时的兜底 */
export async function POST(req: Request) {
  let body: { utc?: string; a3_asr?: boolean };
  try {
    body = (await req.json()) as { utc?: string; a3_asr?: boolean };
  } catch {
    return NextResponse.json({ ok: 0, error: "invalid_json" }, { status: 400 });
  }
  const utc = body.utc?.trim();
  if (!utc) {
    return NextResponse.json({ ok: 0, error: "missing utc" }, { status: 400 });
  }

  const qtRoot = path.resolve(process.cwd(), "..");
  const script = path.join(qtRoot, "联调", "download_historical_cli.py");
  const args = ["python", script, utc, body.a3_asr ? "1" : "0"];

  return new Promise<NextResponse>((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: path.join(qtRoot, "联调"),
      env: process.env,
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
        resolve(NextResponse.json({ ...data, via: "next-api", exit_code: code }));
      } catch {
        resolve(
          NextResponse.json(
            { ok: 0, error: "pipeline_parse_failed", stdout, stderr, exit_code: code },
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
