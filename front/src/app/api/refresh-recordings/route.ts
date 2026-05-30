import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

/** A5 /sync 未重启时的兜底：本机执行 联调/refresh_recordings_pipeline.py */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const syncOnly = url.searchParams.get("sync_only") === "1";
  const noA3 = url.searchParams.get("no_a3") === "1";
  const qtRoot = path.resolve(process.cwd(), "..");
  const script = path.join(qtRoot, "联调", "refresh_recordings_pipeline.py");
  const args = ["python", script];
  if (full) args.push("--full");
  if (syncOnly) args.push("--sync-only");
  if (noA3) args.push("--no-a3");

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
