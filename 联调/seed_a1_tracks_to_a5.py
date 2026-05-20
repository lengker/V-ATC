"""
将示例 ADSB 航迹点写入 A5 的 LNG_TRACKS（模拟 A1 采集结果），供前端地图展示。

用法（A5 需在 8000 运行）:
  python 联调/seed_a1_tracks_to_a5.py
"""
from __future__ import annotations

import json
import sys
from urllib.request import Request, urlopen

A5_BASE = "http://127.0.0.1:8000"

# 香港附近示意航迹（与前端 saneAdsb 合法经纬度一致）
SAMPLE_POINTS = [
    {"t": 0, "lat": 22.308, "lon": 113.918, "alt": 3500, "spd": 240, "hdg": 85},
    {"t": 60, "lat": 22.315, "lon": 113.928, "alt": 4200, "spd": 250, "hdg": 88},
    {"t": 120, "lat": 22.322, "lon": 113.935, "alt": 4800, "spd": 255, "hdg": 90},
]


def _post(path: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = Request(
        f"{A5_BASE}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    try:
        _post(
            "/tables/tracks/ext/create",
            {
                "timestamp": "2026-04-07T12:00:00Z",
                "flight_id": "A1-DEMO-001",
                "tracks_latitude": SAMPLE_POINTS[0]["lat"],
                "tracks_longitude": SAMPLE_POINTS[0]["lon"],
                "altitude": SAMPLE_POINTS[0]["alt"],
                "speed": SAMPLE_POINTS[0]["spd"],
                "heading": SAMPLE_POINTS[0]["hdg"],
                "airport_code": ["VHHH", "VHHH"],
            },
        )
    except Exception as exc:  # noqa: BLE001
        print(f"首段创建失败（可能已存在）: {exc}")

    for pt in SAMPLE_POINTS[1:]:
        try:
            r = _post(
                "/tables/tracks/ext/create",
                {
                    "timestamp": f"2026-04-07T12:{pt['t']//60:02d}:{pt['t']%60:02d}Z",
                    "flight_id": "A1-DEMO-001",
                    "tracks_latitude": pt["lat"],
                    "tracks_longitude": pt["lon"],
                    "altitude": pt["alt"],
                    "speed": pt["spd"],
                    "heading": pt["hdg"],
                    "airport_code": ["VHHH", "VHHH"],
                },
            )
            print("  track segment:", r)
        except Exception as exc:  # noqa: BLE001
            print(f"  跳过 t={pt['t']}: {exc}")

    print("完成。请刷新前端查看地图航迹。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
