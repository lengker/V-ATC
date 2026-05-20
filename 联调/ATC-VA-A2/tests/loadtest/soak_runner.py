from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psutil


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="A-2 long-run soak runner")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="A-2 service base URL")
    parser.add_argument("--duration-minutes", type=int, default=120, help="soak test duration in minutes")
    parser.add_argument("--interval-seconds", type=int, default=30, help="sampling interval in seconds")
    parser.add_argument("--output", default="tests/loadtest/reports/soak_metrics.jsonl", help="output JSONL file")
    parser.add_argument("--include-historical", action="store_true", help="run historical trigger in loop")
    parser.add_argument("--historical-every", type=int, default=6, help="trigger historical every N iterations")
    parser.add_argument("--pid", type=int, default=0, help="target service pid for process metrics")
    return parser.parse_args()


def sample_metrics(target_pid: int) -> dict[str, int | float]:
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(".")
    sample: dict[str, int | float] = {
        "system_memory_used": int(memory.used),
        "system_memory_available": int(memory.available),
        "system_memory_percent": float(memory.percent),
        "system_disk_used": int(disk.used),
        "system_disk_free": int(disk.free),
        "system_disk_percent": float(disk.percent),
    }

    if target_pid > 0:
        process = psutil.Process(target_pid)
        with process.oneshot():
            sample["process_rss"] = int(process.memory_info().rss)
            sample["process_vms"] = int(process.memory_info().vms)
            sample["process_threads"] = int(process.num_threads())
            if hasattr(process, "num_fds"):
                sample["process_num_fds"] = int(process.num_fds())
            if hasattr(process, "num_handles"):
                sample["process_num_handles"] = int(process.num_handles())

    return sample


def parse_json(resp: httpx.Response) -> dict[str, object]:
    try:
        data = resp.json()
        if isinstance(data, dict):
            return data
    except ValueError:
        pass
    return {}


def main() -> None:
    args = parse_args()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
    deadline = time.time() + args.duration_minutes * 60
    iteration = 0

    with httpx.Client(base_url=args.base_url, timeout=timeout) as client, output_path.open("w", encoding="utf-8") as fp:
        while time.time() < deadline:
            iteration += 1

            realtime_resp = client.post("/api/v1/ingestion/scheduler/trigger/realtime")
            status_resp = client.get("/api/v1/ingestion/scheduler/status")

            historical_resp = None
            if args.include_historical and iteration % max(args.historical_every, 1) == 0:
                historical_resp = client.post("/api/v1/ingestion/scheduler/trigger/historical")

            status_payload = parse_json(status_resp)
            record: dict[str, object] = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "iteration": iteration,
                "realtime_status_code": realtime_resp.status_code,
                "status_status_code": status_resp.status_code,
                "scheduler_running": status_payload.get("running"),
                "scheduler_last_error": status_payload.get("last_error"),
            }
            if historical_resp is not None:
                historical_payload = parse_json(historical_resp)
                record["historical_status_code"] = historical_resp.status_code
                record["historical_downloaded"] = historical_payload.get("downloaded")
                record["historical_error"] = historical_payload.get("error")

            record.update(sample_metrics(args.pid))
            fp.write(json.dumps(record, ensure_ascii=False) + "\n")
            fp.flush()
            time.sleep(max(args.interval_seconds, 1))


if __name__ == "__main__":
    main()
