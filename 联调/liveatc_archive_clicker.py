#!/usr/bin/env python3
"""
LiveATC archive.php 鼠标点击自动化（配合本机 Edge 已登录/已过 Cloudflare）。

使用前：
  1. Edge 打开 https://www.liveatc.net/archive.php?m=vhhh5 ，窗口位置固定、最大化
  2. pip install pyautogui
  3. 校准坐标：python liveatc_archive_clicker.py --calibrate
  4. 下载：python liveatc_archive_clicker.py --start 2026-06-03T00:00:00Z --end 2026-06-03T01:00:00Z

鼠标移到屏幕左上角可紧急中止（pyautogui FAILSAFE）。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import pyautogui
except ImportError:
    print("请先安装: pip install pyautogui", file=sys.stderr)
    raise SystemExit(1)

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.12

CONFIG_PATH = Path(__file__).resolve().parent / "liveatc_archive_clicker_config.json"
EXAMPLE_CONFIG = Path(__file__).resolve().parent / "liveatc_archive_clicker_config.example.json"
ARCHIVE_URL = "https://www.liveatc.net/archive.php?m=vhhh5"


def floor_slot(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    minute = (value.minute // 30) * 30
    return value.replace(minute=minute, second=0, microsecond=0)


def iter_slots(start: datetime, end: datetime):
    slot = floor_slot(start)
    end_slot = floor_slot(end)
    while slot <= end_slot:
        yield slot
        slot += timedelta(minutes=30)


def time_option_index(slot: datetime) -> int:
    return slot.hour * 2 + (1 if slot.minute >= 30 else 0)


def archive_time_label(slot: datetime) -> str:
    end = slot + timedelta(minutes=30)
    return f"{slot.strftime('%H%M')}-{end.strftime('%H%M')}Z"


def load_config(path: Path) -> dict:
    if not path.is_file():
        if EXAMPLE_CONFIG.is_file():
            path.write_text(EXAMPLE_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"已生成默认配置，请先运行 --calibrate 校准坐标: {path}")
        else:
            raise FileNotFoundError(f"配置文件不存在: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def save_config(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def calibrate(path: Path) -> None:
    print("校准模式：把 Edge 窗口打开并置于 archive.php 页面。")
    print("按提示把鼠标移到对应控件上，回到本窗口按 Enter 记录坐标。\n")
    cfg = load_config(path) if path.is_file() else json.loads(EXAMPLE_CONFIG.read_text(encoding="utf-8"))
    for key in ("date_input", "time_dropdown", "submit_button"):
        input(f"  [{key}] 鼠标对准后按 Enter...")
        pos = pyautogui.position()
        cfg[key] = [int(pos.x), int(pos.y)]
        print(f"    -> {cfg[key]}")
    save_config(path, cfg)
    print(f"\n已保存: {path}")


def click_point(xy: list[int], delay: float) -> None:
    pyautogui.click(xy[0], xy[1])
    time.sleep(delay)


def set_date(date_xy: list[int], slot: datetime, delay: float) -> None:
    date_str = slot.strftime("%Y-%m-%d")
    click_point(date_xy, delay)
    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.05)
    pyautogui.write(date_str, interval=0.03)
    time.sleep(delay)


def set_time(time_xy: list[int], slot: datetime, delay: float, opens_down: bool) -> None:
    index = time_option_index(slot)
    click_point(time_xy, delay)
    time.sleep(0.2)
    pyautogui.press("home")
    time.sleep(0.1)
    if index > 0:
        pyautogui.press("down", presses=index, interval=0.05)
    time.sleep(0.1)
    pyautogui.press("enter")
    time.sleep(delay)


def run_downloads(
    start: datetime,
    end: datetime,
    cfg: dict,
    *,
    dry_run: bool = False,
) -> list[datetime]:
    delay = float(cfg.get("delay_seconds", 0.35))
    download_wait = float(cfg.get("download_wait_seconds", 20))
    countdown = int(cfg.get("countdown_seconds", 8))
    opens_down = bool(cfg.get("time_dropdown_opens_down", True))

    date_xy = cfg["date_input"]
    time_xy = cfg["time_dropdown"]
    submit_xy = cfg["submit_button"]

    slots = list(iter_slots(start, end))
    if not slots:
        print("时间范围无效（结束应晚于开始）", file=sys.stderr)
        return []

    print(f"将下载 {len(slots)} 个 30 分钟档（UTC）")
    for s in slots:
        print(f"  - {s.date()} {archive_time_label(s)}")

    if dry_run:
        return slots

    print(f"\n请在 {countdown} 秒内点击 Edge 窗口（archive 页面）...")
    for i in range(countdown, 0, -1):
        print(f"  {i}...")
        time.sleep(1)

    done: list[datetime] = []
    for i, slot in enumerate(slots, 1):
        label = archive_time_label(slot)
        print(f"\n[{i}/{len(slots)}] {slot.date()} {label}")
        set_date(date_xy, slot, delay)
        set_time(time_xy, slot, delay, opens_down)
        click_point(submit_xy, delay)
        print(f"  已点击 Submit，等待下载 {download_wait:.0f}s ...")
        time.sleep(download_wait)
        done.append(slot)

    print("\n全部档位已触发。请确认 Edge 下载目录中有 mp3。")
    return done


def parse_utc(value: str) -> datetime:
    raw = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser(description="LiveATC archive 鼠标点击批量下载")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH, help="坐标配置文件")
    parser.add_argument("--calibrate", action="store_true", help="校准三个点击坐标")
    parser.add_argument("--start", help="UTC 开始，如 2026-06-03T00:00:00Z")
    parser.add_argument("--end", help="UTC 结束（含该档），如 2026-06-03T02:00:00Z")
    parser.add_argument("--dry-run", action="store_true", help="只列出档位，不点击")
    parser.add_argument(
        "--import-after",
        action="store_true",
        help="点击完成后运行 import_liveatc_downloads_to_a2.py + sync_a2_to_a5.py",
    )
    parser.add_argument("--open-url", action="store_true", help="启动时用 Edge 打开 archive 页面")
    args = parser.parse_args()

    if args.calibrate:
        calibrate(args.config)
        return 0

    if not args.start or not args.end:
        parser.error("需要 --start 与 --end（或先用 --calibrate）")

    if args.open_url:
        edge_paths = [
            Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        ]
        for p in edge_paths:
            if p.is_file():
                import subprocess

                subprocess.Popen([str(p), ARCHIVE_URL])  # noqa: S603
                break

    start = parse_utc(args.start)
    end = parse_utc(args.end)
    cfg = load_config(args.config)
    run_downloads(start, end, cfg, dry_run=args.dry_run)

    if args.import_after and not args.dry_run:
        root = Path(__file__).resolve().parent
        import subprocess

        for script in ("import_liveatc_downloads_to_a2.py", "sync_a2_to_a5.py"):
            path = root / script
            if path.is_file():
                print(f"\n>>> python {script}")
                subprocess.run([sys.executable, str(path)], cwd=str(root), check=False)  # noqa: S603

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
