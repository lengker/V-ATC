from __future__ import annotations

import random
import shutil
import time as tm
import threading
from datetime import datetime, UTC
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlparse

import requests
from pydub import AudioSegment
from app.core.config import settings
from app.services.download_utils import retry, wait
from app.services.exception import (
    ATCAbortError,
    ATCDownloadError,
    ATCStopStreamError,
    ATCTimeoutError,
)


@wait("fails to bypass cloudflare")
def _check_bypass_cloudflare(sb: BaseCase) -> bool:
    wait_time = random.uniform(1, 7)
    tm.sleep(wait_time)
    sb.solve_captcha()
    return "ATC" in sb.get_title()


@wait("fails to load '#archiveDate'")
def _check_archive_date_present(sb: BaseCase) -> bool:
    return sb.is_element_present("#archiveDate")


@wait("fails to load 'select[name=\"time\"]'")
def _check_time_selectable(sb: BaseCase) -> bool:
    return sb.is_element_present('select[name="time"]')


@wait("fails to load '#archiveSubmit'")
def _check_archive_submit_present(sb: BaseCase) -> bool:
    return sb.is_element_present("#archiveSubmit")


@wait("fails to load '#archiveResults'")
def _check_archive_results_present(sb: BaseCase) -> bool:
    return sb.is_element_present("#archiveResults")


@wait("fails to load archive results content")
def _check_archive_results_loaded(sb: BaseCase) -> bool:
    if not sb.is_element_present("#archiveResults"):
        return False
    html = sb.get_attribute("#archiveResults", "innerHTML") or ""
    return bool(html.strip())


@wait("fails to load 'source'")
def _check_source_present(sb: BaseCase) -> bool:
    return sb.is_element_present("source")


@wait("fails to load '#container'")
def _check_container_present(sb: BaseCase) -> bool:
    return sb.is_element_present("#container")


def _click_archive_audio_link(sb: BaseCase) -> None:
    selector = '#archiveResults a[href], #archiveResults font[color="blue"]'
    if sb.is_element_present(selector):
        sb.click(selector)
        return
    result_text = sb.get_text("#archiveResults") if sb.is_element_present("#archiveResults") else ""
    raise ATCDownloadError(result_text or "LiveATC archive audio link was not found")


def _extract_archive_audio_url(sb: BaseCase) -> str:
    audio_url = sb.execute_script(
        """
        (() => Array.from(document.querySelectorAll('audio, source, a[href]'))
          .map((el) => el.src || el.href || '')
          .find((url) => url && url.includes('.mp3')))()
        """
    )
    if not audio_url:
        result_text = sb.get_text("#archiveResults") if sb.is_element_present("#archiveResults") else ""
        raise ATCDownloadError(result_text or "LiveATC archive audio URL was not found")
    return urljoin(sb.get_current_url(), str(audio_url))


def normalize_audio(file_path: str) -> None:
    ext = file_path.rsplit(".", 1)[-1].lower()
    if ext == "wav":
        _normalize_wav(file_path)
    else:
        _normalize_via_pydub(file_path)


def _normalize_via_pydub(file_path: str) -> None:
    audio = AudioSegment.from_file(file_path)
    audio = audio.apply_gain(settings.audio_loudness - audio.dBFS)
    audio = audio.set_frame_rate(settings.audio_sample_rate)
    audio = audio.set_sample_width(settings.audio_bit_depth // 8)
    audio.export(file_path, format=file_path.rsplit(".", 1)[-1])


def _normalize_wav(file_path: str) -> None:
    import math
    import struct
    import wave

    with wave.open(file_path, "rb") as wf:
        params = wf.getparams()
        nchannels, sampwidth, framerate, nframes = params[:4]
        raw = wf.readframes(nframes)

    fmt = {1: "b", 2: "<h", 4: "<i"}[sampwidth]
    max_val = float(2 ** (sampwidth * 8 - 1))

    samples = [
        struct.unpack_from(fmt, raw, i * sampwidth)[0]
        for i in range(nframes * nchannels)
    ]

    if not samples:
        return

    squared = [(s / max_val) ** 2 for s in samples]
    rms = (sum(squared) / len(squared)) ** 0.5
    current_dbfs = 20.0 * math.log10(max(rms, 1e-10))
    gain_db = settings.audio_loudness - current_dbfs
    gain_linear = 10.0 ** (gain_db / 20.0)

    if sampwidth != settings.audio_bit_depth // 8:
        sampwidth = settings.audio_bit_depth // 8
        fmt = {1: "b", 2: "<h", 4: "<i"}[sampwidth]
        max_val = float(2 ** (sampwidth * 8 - 1))

    adjusted = [int(max(-max_val, min(max_val - 1, s * gain_linear))) for s in samples]
    new_raw = b"".join(struct.pack(fmt, s) for s in adjusted)

    with wave.open(file_path, "wb") as wf:
        wf.setnchannels(nchannels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(framerate)
        wf.writeframes(new_raw)


class _BrowserLock:
    """模块级浏览器锁，防止多次并发打开 SeleniumBase 浏览器。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._held = False

    @property
    def in_use(self) -> bool:
        return self._held

    def __enter__(self) -> None:
        self._lock.acquire()
        self._held = True

    def __exit__(self, *args: object) -> None:
        self._held = False
        self._lock.release()


_browser_lock = _BrowserLock()
CHROMIUM_STABILITY_ARGS = ",".join(
    [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
    ]
)


def cleanup_temp_files() -> None:
    import shutil
    import time as _time

    min_mtime = _time.time() - 300

    dirs_to_scan = [
        settings.temp_root / "downloads",
        settings.temp_root / "webdriver",
    ]
    for d in dirs_to_scan:
        if not d.exists():
            continue
        for entry in d.iterdir():
            try:
                if entry.stat().st_mtime > min_mtime:
                    continue
                if entry.is_file():
                    entry.unlink(missing_ok=True)
                elif entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
            except OSError:
                pass

    if settings.temp_root.exists():
        for entry in settings.temp_root.iterdir():
            if not entry.is_file():
                continue
            suffix = entry.suffix.lower()
            if suffix in (".wav", ".mp3", ".aac", ".bin", ".part"):
                try:
                    if entry.stat().st_mtime > min_mtime:
                        continue
                    entry.unlink(missing_ok=True)
                except OSError:
                    pass


def shutdown_browser() -> None:
    """服务关闭时不再需要显式释放浏览器 — `with SB()` 会自动清理。"""


def _ensure_browser_driver_ready(download_dir: Path) -> None:
    download_dir.mkdir(parents=True, exist_ok=True)
    local_uc_driver = download_dir / "uc_driver.exe"
    lock_path = download_dir / "driver_fixing.lock"
    if lock_path.exists():
        age_seconds = tm.time() - lock_path.stat().st_mtime
        if local_uc_driver.exists() and age_seconds > 10:
            lock_path.unlink(missing_ok=True)
        elif age_seconds > 120:
            lock_path.unlink(missing_ok=True)
        else:
            raise ATCDownloadError("Chrome driver is being prepared, please retry in a moment")

    try:
        import seleniumbase

        seleniumbase_driver = Path(seleniumbase.__file__).parent / "drivers" / "uc_driver.exe"
    except Exception:
        seleniumbase_driver = Path()
    if not local_uc_driver.exists() and seleniumbase_driver.exists():
        shutil.copy2(seleniumbase_driver, local_uc_driver)

    if not local_uc_driver.exists():
        raise ATCDownloadError(
            "uc_driver is not available. Install a SeleniumBase uc_driver matching local Chrome "
            "before using LiveATC browser download."
        )

    try:
        from seleniumbase.core import browser_launcher

        browser_launcher.override_driver_dir(str(download_dir.resolve()))
    except Exception as exc:
        raise ATCDownloadError(f"failed to configure SeleniumBase driver directory: {exc}") from exc


class ArchiveDownloader:
    def __init__(
        self,
        url: str,
        date: str,
        time_slot: str,
        file_dir: str | Path,
        download_timeout: int | None = None,
    ) -> None:
        self.url = url
        self.date = date
        self.time_slot = time_slot
        self.file_dir = Path(file_dir)
        self.audio_file_name: str = ""
        self.download_timeout = download_timeout or settings.download_timeout
        self.stop_event = threading.Event()
        self._dl_dir = settings.temp_root / "webdriver"

    @retry("fails to download archive audio file", max_retry=0)
    def run(self) -> Path:
        cached_path = self._find_cached_archive_file()
        if cached_path:
            return cached_path

        _ensure_browser_driver_ready(self._dl_dir)
        from seleniumbase import SB

        with _browser_lock:
            with SB(uc=True, chromium_arg=CHROMIUM_STABILITY_ARGS) as sb:
                sb.activate_cdp_mode(self.url)
                _check_bypass_cloudflare(sb)
                _check_archive_date_present(sb)
                sb.execute_script(
                    'document.querySelector("#archiveDate").value="{}";'.format(self.date)
                )
                _check_time_selectable(sb)
                sb.select_option_by_text('[name="time"]', self.time_slot)
                _check_archive_submit_present(sb)
                sb.click("#archiveSubmit")
                _check_archive_results_present(sb)
                _check_archive_results_loaded(sb)
                if not sb.is_element_present("source") and not sb.is_element_present('#archiveResults a[href*=".mp3"]'):
                    _click_archive_audio_link(sb)
                audio_url = _extract_archive_audio_url(sb)
                cookies_dict = sb.get_cookies()
                cookies = {c["name"]: c["value"] for c in cookies_dict}
                headers = {
                    "User-Agent": sb.get_user_agent(),
                    "Referer": sb.get_current_url(),
                    "Accept": "*/*",
                }

                self.audio_file_name = Path(urlparse(audio_url).path).name or f"{self.date}.mp3"

                self._dl_dir.mkdir(parents=True, exist_ok=True)
                mp3_download_path = self._dl_dir / self.audio_file_name
                mp3_file_path = self.file_dir / self.audio_file_name
                self.file_dir.mkdir(parents=True, exist_ok=True)

                if mp3_file_path.exists():
                    return mp3_file_path

                self._download_audio_url(audio_url, headers, cookies, mp3_download_path)
                try:
                    normalize_audio(str(mp3_download_path))
                except Exception:
                    pass
                mp3_download_path.replace(mp3_file_path)
                return mp3_file_path

    def stop(self) -> None:
        self.stop_event.set()

    def _find_cached_archive_file(self) -> Path | None:
        try:
            date_dt = datetime.strptime(self.date.replace("-", ""), "%Y%m%d")
        except ValueError:
            return None
        slot_start = self.time_slot.rstrip("Z").split("-", 1)[0]
        pattern = f"*-{date_dt.strftime('%b')}-{date_dt.day}-{date_dt.year}-{slot_start}Z.mp3"
        for directory in (self.file_dir, settings.temp_root / "downloads"):
            if not directory.exists():
                continue
            matches = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
            if matches:
                return matches[0]
        return None

    def _verify_download_progress(self) -> Literal["BEGIN", "PROGRESS", "HALT", "FINISH"]:
        cr_path = self._dl_dir / f"{self.audio_file_name}.crdownload"
        mp3_path = self._dl_dir / self.audio_file_name
        if not cr_path.exists() and not mp3_path.exists():
            return "BEGIN"
        elif mp3_path.exists():
            return "FINISH"
        elif cr_path.exists():
            start_size = cr_path.stat().st_size
            tm.sleep(settings.fresh_time)
            if mp3_path.exists():
                return "FINISH"
            end_size = cr_path.stat().st_size
            if end_size > start_size:
                return "PROGRESS"
            else:
                return "HALT"
        return "PROGRESS"

    def _download_audio_url(
        self,
        audio_url: str,
        headers: dict[str, str],
        cookies: dict[str, str],
        target_path: Path,
    ) -> None:
        partial_path = target_path.with_suffix(target_path.suffix + ".part")
        if partial_path.exists():
            partial_path.unlink()
        start_time = tm.time()
        with requests.get(audio_url, headers=headers, cookies=cookies, stream=True, timeout=30) as response:
            response.raise_for_status()
            with partial_path.open("wb") as file_obj:
                for chunk in response.iter_content(chunk_size=settings.download_chunk_size):
                    if self.stop_event.is_set():
                        partial_path.unlink(missing_ok=True)
                        raise ATCAbortError("aborts archive downloading")
                    if tm.time() - start_time > self.download_timeout:
                        partial_path.unlink(missing_ok=True)
                        raise ATCTimeoutError("fails to download archive audio due to taking too long")
                    if chunk:
                        file_obj.write(chunk)
        partial_path.replace(target_path)


class StreamDownloader:
    def __init__(
        self,
        url: str,
        file_dir: str | Path,
        chunk_size: int | None = None,
    ) -> None:
        self.url = url
        self.file_dir = Path(file_dir)
        self.chunk_size = chunk_size or settings.download_chunk_size
        self.stop_event = threading.Event()

    def resolve_stream_url(self) -> tuple[str, dict[str, str], dict[str, str]]:
        """使用 SeleniumBase 绕过 Cloudflare 并获取真实流地址、请求头和 Cookies。"""
        _ensure_browser_driver_ready(settings.temp_root / "webdriver")
        from seleniumbase import SB

        with _browser_lock:
            with SB(uc=True, chromium_arg=CHROMIUM_STABILITY_ARGS) as sb:
                sb.activate_cdp_mode(self.url)
                _check_bypass_cloudflare(sb)
                _check_container_present(sb)
                stream_url = sb.get_attribute("#player2_html5", "src")
                stream_url = urljoin(sb.get_current_url(), stream_url)
                cookies_dict = sb.get_cookies()
                cookies = {c["name"]: c["value"] for c in cookies_dict}
                user_agent = sb.get_user_agent()
                referer = sb.get_current_url()
        headers = {
            "User-Agent": user_agent,
            "Referer": referer,
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        return stream_url, headers, cookies

    def stream_chunks(
        self, stream_url: str, headers: dict[str, str], cookies: dict[str, str]
    ):
        """从音频流中逐块读取原始字节。

        被 run()（一次性下载到文件）和 RealtimeConnectionManager（实时分段落盘）
        共用，确保两种场景使用同一套 HTTP 流式读取逻辑。
        """
        response = requests.get(
            stream_url,
            headers=headers,
            cookies=cookies,
            stream=True,
            timeout=settings.stream_timeout,
        )
        response.raise_for_status()
        for chunk in response.iter_content(chunk_size=self.chunk_size):
            if self.stop_event.is_set():
                break
            if chunk:
                yield chunk

    @retry("fails to download stream audio due to excessive max retry")
    def run(self) -> Path:
        """一次性下载完整音频流并归一化后落盘。"""
        stream_url, headers, cookies = self.resolve_stream_url()
        self.file_dir.mkdir(parents=True, exist_ok=True)
        temp_file_name = f"temp-{str(tm.time())}.mp3"
        temp_file_path = self.file_dir / temp_file_name
        start_timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
        with open(temp_file_path, "ab") as f:
            for chunk in self.stream_chunks(stream_url, headers, cookies):
                f.write(chunk)
                f.flush()
        end_timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
        file_name = f"{start_timestamp}-{end_timestamp}Z.mp3"
        file_path = self.file_dir / file_name
        normalize_audio(str(temp_file_path))
        temp_file_path.rename(file_path)
        return file_path

    def stop(self) -> None:
        self.stop_event.set()
