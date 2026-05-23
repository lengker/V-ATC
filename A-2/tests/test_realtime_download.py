"""
A2 实时下载功能一键测试脚本。

用法:
    python tests/test_realtime_download.py

前提:
    1. A2 服务已在 http://127.0.0.1:8001 运行
    2. 安装了 requests 库（pip install requests）

脚本流程:
    1. 启动本地模拟流 HTTP 服务器
    2. 通过 ASX 文件创建实时任务
    3. 启动接收线程
    4. 等待至少 2 个语音片段落盘
    5. 停止接收
    6. 查询语音记录并验证
    7. 输出测试报告
"""

from __future__ import annotations

import io
import json
import math
import struct
import sys
import threading
import time
import wave
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

# ── 配置 ──────────────────────────────────────────────────
A2_BASE_URL = "http://127.0.0.1:8001"
STREAM_SERVER_HOST = "127.0.0.1"
STREAM_CHUNK_COUNT = 8          # 发送多少个数据块
STREAM_CHUNK_DELAY = 0.6        # 每个块之间的间隔秒数
SEGMENT_SECONDS = 1             # 每多少秒切一个片段
ICAO_CODE = "ZBAA"
BAND = "tower"
# ───────────────────────────────────────────────────────────


# ── 辅助函数 ──────────────────────────────────────────────

def build_wav_bytes(seconds: int, freq: float) -> bytes:
    """生成指定时长和频率的 WAV 二进制数据。"""
    sample_rate = 8000
    frames: list[bytes] = []
    for i in range(sample_rate * seconds):
        value = int(12000 * math.sin(2 * math.pi * freq * i / sample_rate))
        frames.append(struct.pack("<h", value))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"".join(frames))
    return buf.getvalue()


def api(path: str, method: str = "GET", **kwargs: Any) -> dict[str, Any]:
    """调用 A2 API 并返回解析后的 JSON。"""
    url = f"{A2_BASE_URL}{path}"
    resp = requests.request(method, url, **kwargs)
    resp.raise_for_status()
    return resp.json()


# ── 模拟流 HTTP 服务器 ───────────────────────────────────

class StreamHandler(BaseHTTPRequestHandler):
    """模拟实时音频流和 ASX 文件的 HTTP 处理器。"""

    def do_GET(self) -> None:
        if self.path == "/live.asx":
            body = self.server.asx_body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "video/x-ms-asf")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/stream.mp3":
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.end_headers()
            for _ in range(STREAM_CHUNK_COUNT):
                self.wfile.write(b"MP3DATA" * 512)
                self.wfile.flush()
                time.sleep(STREAM_CHUNK_DELAY)
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        return  # 安静模式


class StreamServer(ThreadingHTTPServer):
    asx_body: str = ""


def start_stream_server() -> tuple[StreamServer, int, threading.Thread]:
    """启动本地模拟流服务器，返回 (server, port, thread)。"""
    server = StreamServer((STREAM_SERVER_HOST, 0), StreamHandler)
    port = server.server_address[1]
    server.asx_body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<asx version="3.0"><entry>'
        f'<ref href="http://{STREAM_SERVER_HOST}:{port}/stream.mp3" />'
        "</entry></asx>"
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port, thread


# ── 测试主流程 ────────────────────────────────────────────

def check_health() -> bool:
    """检查 A2 服务是否已启动。"""
    try:
        resp = requests.get(f"{A2_BASE_URL}/health", timeout=3)
        if resp.status_code == 200 and resp.json().get("data", {}).get("status") == "ok":
            return True
    except requests.RequestException:
        pass
    return False


def run_test() -> bool:
    print("=" * 60)
    print("  A2 实时下载功能测试")
    print("=" * 60)

    # 1. 健康检查
    print("\n[1/5] 检查 A2 服务...", end=" ")
    if not check_health():
        print("FAIL")
        print(f"  请确保 A2 服务已在 {A2_BASE_URL} 启动")
        print(f"  启动命令: cd A2 && python -m uvicorn app.main:app --host 127.0.0.1 --port 8001")
        return False
    print("OK")

    # 2. 启动模拟流服务器
    print("[2/5] 启动模拟流服务器...", end=" ")
    server, port, server_thread = start_stream_server()
    print(f"OK (端口 {port})")

    try:
        # 3. 通过 ASX 创建实时任务 + 启动接收
        print("[3/5] 创建实时任务并启动接收...", end=" ")
        asx_content = server.asx_body

        create_resp = requests.post(
            f"{A2_BASE_URL}/api/a2/tasks/realtime/from-asx",
            data={
                "taskName": "test-realtime-download",
                "icaoCode": ICAO_CODE,
                "band": BAND,
                "segmentSeconds": SEGMENT_SECONDS,
                "preferredRef": 0,
            },
            files={"file": ("live.asx", asx_content.encode("utf-8"), "video/x-ms-asf")},
        )
        create_resp.raise_for_status()
        task_id = create_resp.json()["data"]["taskId"]
        print(f"OK (taskId={task_id})")

        start_resp = requests.post(
            f"{A2_BASE_URL}/api/a2/tasks/realtime/start-receive",
            json={"task_id": task_id},
        )
        start_resp.raise_for_status()

        # 4. 等待片段落盘
        print(f"[4/5] 等待语音片段落盘...")
        deadline = time.time() + (STREAM_CHUNK_COUNT * STREAM_CHUNK_DELAY) + 5
        state: dict[str, Any] = {}
        while time.time() < deadline:
            time.sleep(0.5)
            state_resp = requests.get(f"{A2_BASE_URL}/api/a2/tasks/realtime/{task_id}/state")
            state_resp.raise_for_status()
            state = state_resp.json()["data"]
            segs = state.get("segmentsSaved", 0)
            receiving = state.get("receiving", False)
            err = state.get("lastError")
            bar = "#" * min(segs, 20)
            print(f"  \r  已保存 {segs} 个片段 {bar}", end="")
            if err:
                print(f"\n  接收错误: {err}")
            if segs >= 2 and not receiving:
                break

        print()
        segments_saved = state.get("segmentsSaved", 0)
        if segments_saved < 2:
            print(f"  WARN: 只保存了 {segments_saved} 个片段（预期 >= 2）")
        else:
            print(f"  OK: 已保存 {segments_saved} 个片段")

        # 5. 停止接收 + 查询验证
        print("[5/5] 停止接收并查询语音记录...", end=" ")
        requests.post(f"{A2_BASE_URL}/api/a2/tasks/realtime/{task_id}/stop-receive")

        # 多给一秒让最后一个片段写完
        time.sleep(1.5)

        start_time = (datetime.now(UTC) - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
        end_time = (datetime.now(UTC) + timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S")

        query_resp = requests.get(
            f"{A2_BASE_URL}/api/a2/voice/query",
            params={
                "startTime": start_time,
                "endTime": end_time,
                "icaoCode": ICAO_CODE,
                "band": BAND,
                "pageNum": 1,
                "pageSize": 20,
            },
        )
        query_resp.raise_for_status()
        query_data = query_resp.json()
        total = query_data["count"]
        records = query_data["data"]

        print(f"OK (命中 {total} 条)")

        # ── 输出报告 ──────────────────────────────────────
        print("\n" + "=" * 60)
        print("  测试报告")
        print("=" * 60)
        print(f"  任务 ID        : {task_id}")
        print(f"  保存片段数     : {segments_saved}")
        print(f"  查询命中数     : {total}")
        print(f"  数据均为 S 类型: {all(r.get('data_type') == 'S' for r in records)}")

        print("\n  语音片段详情:")
        for i, r in enumerate(records[:5], 1):
            print(f"  [{i}] {r['unique_id']}")
            print(f"      时间: {r['start_at']} ~ {r['end_at']}")
            print(f"      文件: {r.get('file_name', 'N/A')}")
            stored = Path(r["file_path"]) if r.get("file_path") else None
            exists = stored.exists() if stored else False
            print(f"      存在: {'YES' if exists else 'NO  (文件可能已被同步清理)'}")

        if total >= 2:
            print(f"\n  结果: PASS")
            return True
        else:
            print(f"\n  结果: FAIL (片段不足)")
            return False

    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)


if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
