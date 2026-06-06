"""
A2 拉取新录音 + 同步 A5（供前端轮询 / A5 POST /sync/a2-to-a5 调用）。

用法:
  python 联调/refresh_recordings_pipeline.py
  python 联调/refresh_recordings_pipeline.py --full   # 含历史归档（较慢）
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_BASE, A2_ROOT, A5_BASE

from sync_a2_to_a5 import _media_url, run_sync
from process_a2_via_a3 import run_a3_asr_for_a5
from purge_recordings_without_transcript import run_purge, unblock_a2_files_with_local_media

_HISTORICAL_NAME_PATTERN = re.compile(
    r"([A-Za-z]{3})-(\d{1,2})-(\d{4})-(\d{4})Z", re.IGNORECASE
)
_HALF_HOUR_SEC = 30 * 60


def _post_empty(url: str, timeout: int) -> dict | list:
    req = Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _parse_historical_filename(file_name: str) -> tuple[datetime, datetime] | None:
    matched = _HISTORICAL_NAME_PATTERN.search(file_name)
    if not matched:
        return None
    month_text, day_text, year_text, hhmm_text = matched.groups()
    try:
        month = datetime.strptime(month_text[:3], "%b").month
        day = int(day_text)
        year = int(year_text)
        hour = int(hhmm_text[:2])
        minute = int(hhmm_text[2:])
        start = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        end = start + timedelta(seconds=_HALF_HOUR_SEC)
        return start, end
    except ValueError:
        return None


def _historical_day_key(file_name: str, slot: datetime | None = None) -> str:
    parsed = _parse_historical_filename(file_name)
    if parsed:
        return parsed[0].strftime("%Y%m%d")
    if slot is not None:
        return slot.strftime("%Y%m%d")
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _register_historical_file(
    file_name: str,
    rel_path: str,
    file_size: int,
    start: datetime,
    end: datetime,
) -> dict | None:
    media_url = _media_url(rel_path)
    body = json.dumps(
        {
            "file_name": file_name,
            "file_path": rel_path.replace("\\", "/"),
            "start_time_utc": start.isoformat(),
            "end_time_utc": end.isoformat(),
            "source_url": media_url,
            "file_size": file_size,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = Request(
        f"{A2_BASE}/api/v1/ingestion/historical/register",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError:
        return None


def _lookup_a5_audio_id(file_name: str) -> int | None:
    try:
        with urlopen(f"{A5_BASE}/tables/audio_records?limit=1000", timeout=30) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        if not isinstance(rows, list):
            return None
        best: int | None = None
        for row in rows:
            if str(row.get("file_name") or "") != file_name:
                continue
            aid = int(row["audio_id"])
            if best is None or aid > best:
                best = aid
        return best
    except Exception:  # noqa: BLE001
        return None


def _register_mp3_path(path: Path, *, slot: datetime | None = None) -> dict | None:
    if not path.is_file():
        return None
    try:
        rel = path.relative_to(A2_ROOT).as_posix()
    except ValueError:
        rel = path.as_posix()
    parsed = _parse_historical_filename(path.name)
    if parsed:
        start, end = parsed
    elif slot is not None:
        start = slot
        end = slot + timedelta(seconds=_HALF_HOUR_SEC)
    else:
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=_HALF_HOUR_SEC)
    return _register_historical_file(path.name, rel, path.stat().st_size, start, end)


def _import_orphan_mp3() -> dict[str, int]:
    """扫描 A2 data/audio 与 liveatc downloads，未入库的 mp3 登记到 A2。"""
    import sqlite3
    from module_paths import A2_DB

    known: set[str] = set()
    if A2_DB.exists():
        conn = sqlite3.connect(A2_DB)
        known = {r[0] for r in conn.execute("SELECT file_name FROM t_a2_voice_files").fetchall()}
        conn.close()

    registered = 0
    scanned = 0
    candidates: list[Path] = []
    audio_root = A2_ROOT / "data" / "audio"
    if audio_root.is_dir():
        candidates.extend(audio_root.rglob("*.mp3"))
    dl_dir = A2_ROOT / "liveatc-downloader" / "downloads"
    if dl_dir.is_dir():
        for mp3 in dl_dir.glob("*.mp3"):
            day = _historical_day_key(mp3.name)
            dest_dir = audio_root / "historical" / day
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / mp3.name
            if not dest.exists() or dest.stat().st_size != mp3.stat().st_size:
                shutil.copy2(mp3, dest)
            candidates.append(dest)

    for path in candidates:
        scanned += 1
        if path.name in known:
            continue
        out = _register_mp3_path(path)
        if out and out.get("voice_file_id"):
            known.add(path.name)
            registered += 1

    return {"scanned": scanned, "registered": registered}


def _liveatc_cookie_status() -> dict[str, object]:
    """检查 A2 是否配置了 LiveATC Cookie（历史归档几乎必需）。"""
    env_path = A2_ROOT / ".env"
    cookie_file_rel: str | None = None
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("A2_HTTP_COOKIE_FILE="):
                cookie_file_rel = line.split("=", 1)[1].strip()
                break
            if line.startswith("A2_HTTP_COOKIE=") and "=" in line:
                val = line.split("=", 1)[1].strip()
                if val:
                    return {"configured": True, "via": "env_inline"}
    if cookie_file_rel:
        path = (A2_ROOT / cookie_file_rel).resolve()
        if path.is_file() and path.stat().st_size > 20:
            return {"configured": True, "via": "file", "path": str(path)}
        return {"configured": False, "via": "file_missing", "path": str(path)}
    default_cookie = A2_ROOT / "liveatc-downloader" / ".local" / "liveatc_cookie.txt"
    if default_cookie.is_file() and default_cookie.stat().st_size > 20:
        return {"configured": True, "via": "default_file", "path": str(default_cookie)}
    return {"configured": False}


def _floor_slot_utc(utc_datetime: str) -> datetime:
    raw = utc_datetime.replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    minute = (dt.minute // 30) * 30
    return dt.replace(minute=minute, second=0, microsecond=0)


def _resolve_cookie_file_for_cli() -> str | None:
    st = _liveatc_cookie_status()
    if st.get("configured") and st.get("path"):
        return str(st["path"])
    return None


def _download_historical_cli_fallback(slot: datetime) -> dict[str, object]:
    """A2 HTTP 失败时，用 liveatc-downloader CLI 再试一次。"""
    dl_dir = A2_ROOT / "liveatc-downloader" / "downloads"
    dl_dir.mkdir(parents=True, exist_ok=True)
    for old in dl_dir.glob("*.mp3"):
        try:
            old.unlink()
        except OSError:
            pass

    date_str = slot.strftime("%b-%d-%Y")
    time_str = slot.strftime("%H%M") + "Z"
    station = "vhhh5"
    cmd = [
        sys.executable,
        "main.py",
        "download",
        station,
        "-d",
        date_str,
        "-t",
        time_str,
        "-o",
        str(dl_dir),
    ]
    cookie_file = _resolve_cookie_file_for_cli()
    if cookie_file:
        cmd.extend(["--cookie-file", cookie_file])

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(A2_ROOT / "liveatc-downloader"),
            capture_output=True,
            text=True,
            timeout=180,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "CLI 下载超时（180s）"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"CLI 启动失败: {exc}"}

    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-400:]
        return {"ok": False, "error": tail or f"CLI 退出码 {proc.returncode}"}

    mp3s = list(dl_dir.glob("*.mp3"))
    if not mp3s:
        return {"ok": False, "error": "CLI 未生成 mp3 文件（该时段可能无归档）"}

    imp = _import_orphan_mp3()
    name = mp3s[0].name
    return {
        "ok": True,
        "file_name": name,
        "slot_utc": slot.isoformat(),
        "via": "liveatc-downloader-cli",
        "import": imp,
    }


def _download_historical_selenium_fallback(slot: datetime) -> dict[str, object]:
    """A2 HTTP 失败时，在 A2 目录子进程跑 SeleniumBase（避免 backend/app 包名冲突）。"""
    script = A2_ROOT / "scripts" / "selenium_download_slot.py"
    dest = A2_ROOT / "data" / "audio" / "historical" / slot.strftime("%Y%m%d")
    dest.mkdir(parents=True, exist_ok=True)
    if not script.is_file():
        return {"ok": False, "error": f"缺少脚本: {script}"}

    try:
        proc = subprocess.run(
            [sys.executable, str(script), slot.isoformat(), str(dest)],
            cwd=str(A2_ROOT),
            capture_output=True,
            text=True,
            timeout=600,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Selenium 下载超时（600s）"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Selenium 启动失败: {exc}"}

    line = (proc.stdout or "").strip().splitlines()
    line = line[-1] if line else "{}"
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        tail = ((proc.stderr or "") + (proc.stdout or "")).strip()[-500:]
        return {"ok": False, "error": tail or f"Selenium 退出码 {proc.returncode}"}

    if not data.get("ok"):
        return {"ok": False, "error": str(data.get("error") or f"Selenium 退出码 {proc.returncode}")}

    file_name = str(data.get("file_name") or "")
    saved = dest / file_name if file_name else None
    reg: dict | None = None
    if saved and saved.is_file():
        reg = _register_mp3_path(saved, slot=slot)
    imp = _import_orphan_mp3()
    return {
        "ok": True,
        "file_name": file_name or None,
        "slot_utc": data.get("slot_utc") or slot.isoformat(),
        "via": "selenium_archive",
        "a2_register": reg,
        "import": imp,
    }


def download_historical_at(
    utc_datetime: str,
    *,
    sync_a5: bool = True,
    a3_asr: bool = False,
) -> dict[str, object]:
    """调用 A2 按 UTC 时刻下载历史档，可选同步 A5 并 ASR。"""
    slot = _floor_slot_utc(utc_datetime)
    cookie_st = _liveatc_cookie_status()

    body = json.dumps({"utc_datetime": utc_datetime}, ensure_ascii=False).encode("utf-8")
    req = Request(
        f"{A2_BASE}/api/v1/ingestion/historical/download-at",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=300) as resp:
            a2_result = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"ok": 0, "error": f"A2 历史下载失败: {exc}"}

    result: dict[str, object] = {"a2": a2_result}
    if not a2_result.get("ok"):
        selenium = _download_historical_selenium_fallback(slot)
        if selenium.get("ok"):
            result["ok"] = 1
            result["fallback"] = selenium
            result["file_name"] = selenium.get("file_name")
            result["slot_utc"] = selenium.get("slot_utc")
        else:
            cli = _download_historical_cli_fallback(slot)
            if cli.get("ok"):
                result["ok"] = 1
                result["fallback"] = cli
                result["file_name"] = cli.get("file_name")
                result["slot_utc"] = cli.get("slot_utc")
            else:
                parts = [
                    str(a2_result.get("error") or "A2 历史下载失败"),
                    str(selenium.get("error") or ""),
                    str(cli.get("error") or ""),
                ]
                result["ok"] = 0
                result["error"] = "；".join(p for p in parts if p)
                result["file_name"] = a2_result.get("file_name")
                result["slot_utc"] = a2_result.get("slot_utc")
                if not cookie_st.get("configured"):
                    result["cookie_required"] = True
                return result

    result["ok"] = 1
    result["file_name"] = a2_result.get("file_name")
    result["slot_utc"] = a2_result.get("slot_utc")
    result["already_exists"] = bool(a2_result.get("already_exists"))
    if not sync_a5:
        return result

    result["a2_import"] = _import_orphan_mp3()
    result["sync"] = run_sync(ignore_blocklist=True)
    sync = result.get("sync") if isinstance(result.get("sync"), dict) else {}
    result["a5_total"] = sync.get("a5_total", 0)
    synced = int(sync.get("synced") or 0)
    updated = int(sync.get("updated") or 0)
    result["a5_synced"] = synced + updated

    file_name = result.get("file_name") or a2_result.get("file_name")
    audio_id = _lookup_a5_audio_id(str(file_name)) if file_name else None
    result["audio_id"] = audio_id
    if file_name and audio_id is None:
        result["sync_warning"] = (
            "文件已下载但尚未出现在 A5 列表，请确认 A5(:8000) 已启动后重试同步"
        )

    if a3_asr and audio_id is not None:
        try:
            from process_a2_via_a3 import run_a3_asr_for_audio_id

            result["a3_asr"] = run_a3_asr_for_audio_id(audio_id=audio_id)
        except Exception as exc:  # noqa: BLE001
            result["a3_asr"] = {"ok": 0, "error": str(exc)}

    return result


def trigger_a2_downloads(*, full: bool) -> dict[str, object]:
    out: dict[str, object] = {}
    try:
        out["realtime"] = _post_empty(
            f"{A2_BASE}/api/v1/ingestion/scheduler/trigger/realtime",
            120,
        )
    except Exception as exc:  # noqa: BLE001
        out["realtime"] = {"error": str(exc)}
    if full:
        try:
            out["historical"] = _post_empty(
                f"{A2_BASE}/api/v1/ingestion/scheduler/trigger/historical",
                300,
            )
        except Exception as exc:  # noqa: BLE001
            out["historical"] = {"error": str(exc)}
    return out


def _pending_audio_ids() -> list[int]:
    """A5 中尚无 annotations 的 audio_id（供前端实时更新）。"""
    try:
        from purge_recordings_without_transcript import _list_all, _audio_ids_with_annotations

        aud = _list_all("audio_records")
        with_ann = _audio_ids_with_annotations(_list_all("annotations"))
    except Exception:  # noqa: BLE001
        return []
    out: list[int] = []
    for row in aud:
        try:
            aid = int(row["audio_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if aid not in with_ann:
            out.append(aid)
    return sorted(out)


def run_pipeline(
    *,
    full: bool = False,
    download: bool = True,
    a3_asr: bool = True,
    a3_limit: int = 5,
) -> dict[str, object]:
    """download=False 时仅扫描落盘 mp3 并同步 A5（供 30s 轮询，秒级返回）。"""
    result: dict[str, object] = {"ok": 1}
    if download:
        try:
            result["a2_trigger"] = trigger_a2_downloads(full=full)
        except Exception as exc:  # noqa: BLE001
            result["a2_trigger"] = {"error": str(exc)}
    else:
        result["a2_trigger"] = {"skipped": True}
    manual_refresh = download and a3_limit == 0
    if manual_refresh:
        result["unblock"] = unblock_a2_files_with_local_media()
    result["a2_import"] = _import_orphan_mp3()
    result["sync"] = run_sync(ignore_blocklist=manual_refresh)
    sync = result.get("sync") if isinstance(result.get("sync"), dict) else {}
    result["a5_total"] = sync.get("a5_total", 0)
    result["a2_total"] = sync.get("a2_total", 0)
    result["synced"] = sync.get("synced", 0)
    result["updated"] = sync.get("updated", 0)
    result["blocked"] = sync.get("blocked", 0)
    if a3_asr and download and a3_limit > 0:
        try:
            # 仅在含 A2 下载的同步轮跑批量 ASR；前端「立即更新」用 a3_limit=0，单条走 /sync/a3-asr
            result["a3_asr"] = run_a3_asr_for_a5(limit=a3_limit)
        except Exception as exc:  # noqa: BLE001
            result["a3_asr"] = {"ok": 0, "error": str(exc)}
    elif a3_asr:
        result["a3_asr"] = {"skipped": True, "reason": "poll_sync_only_use_frontend_asr"}
    # 前端「实时更新」用 a3_limit=0 逐条 ASR；此轮若 purge 会删掉刚同步、尚未转写的录音
    if a3_limit > 0 or not download:
        try:
            result["purge_without_transcript"] = run_purge(dry_run=False)
        except Exception as exc:  # noqa: BLE001
            result["purge_without_transcript"] = {"ok": 0, "error": str(exc)}
    else:
        result["purge_without_transcript"] = {"skipped": True, "reason": "frontend_asr_pending"}
    result["pending_audio_ids"] = _pending_audio_ids()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="同时触发历史归档下载（慢）")
    parser.add_argument("--sync-only", action="store_true", help="不触发 A2 下载，仅导入落盘并同步 A5")
    parser.add_argument("--no-a3", action="store_true", help="跳过 A3 语音转文本")
    parser.add_argument("--a3-limit", type=int, default=5, help="本轮 A3 ASR 最多处理条数")
    args = parser.parse_args()
    print(
        json.dumps(
            run_pipeline(
                full=args.full,
                download=not args.sync_only,
                a3_asr=not args.no_a3,
                a3_limit=max(1, args.a3_limit),
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
