"""LiveATC 历史归档下载（SeleniumBase + 表单提交，绕过 Cloudflare）。"""
from __future__ import annotations

import random
import shutil
import threading
import time as tm
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import urljoin, urlparse

import requests

from app.core.config import settings

if TYPE_CHECKING:
    from seleniumbase import BaseCase as BaseCaseType
else:
    BaseCaseType = Any

CF_CHALLENGE_IFRAME_SELECTOR = (
    'iframe[src*="challenges.cloudflare.com"], '
    'iframe[title*="Cloudflare"], '
    'iframe[title*="cloudflare"]'
)

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


class LiveATCSeleniumDownloadError(RuntimeError):
    pass


def _wait(message: str, *, attempts: int = 40, delay: float = 2.0) -> Callable:
    def decorator(check_fn: Callable) -> Callable:
        def wrapper(sb: BaseCaseType, *args: object, **kwargs: object) -> bool:
            for _ in range(attempts):
                if check_fn(sb, *args, **kwargs):
                    return True
                tm.sleep(delay)
            raise LiveATCSeleniumDownloadError(message)

        return wrapper

    return decorator


@_wait("fails to bypass cloudflare")
def _check_bypass_cloudflare(sb: BaseCaseType) -> bool:
    tm.sleep(random.uniform(1, 4))
    sb.solve_captcha()
    if _is_cloudflare_challenge_present(sb):
        _click_cloudflare_turnstile_if_present(sb)
        return not _is_cloudflare_challenge_present(sb)
    if "ATC" in sb.get_title():
        return True
    return sb.is_element_present("#player2_html5") or sb.is_element_present("#container")


def _is_cloudflare_challenge_present(sb: BaseCaseType) -> bool:
    try:
        return bool(
            sb.execute_script(
                f"""
                (() => Array.from(document.querySelectorAll({CF_CHALLENGE_IFRAME_SELECTOR!r}))
                  .some((frame) => {{
                    const rect = frame.getBoundingClientRect();
                    const style = window.getComputedStyle(frame);
                    return rect.width > 0 && rect.height > 0 &&
                      style.display !== 'none' &&
                      style.visibility !== 'hidden';
                  }}))()
                """
            )
        )
    except Exception:
        return False


def _click_cloudflare_turnstile_if_present(sb: BaseCaseType) -> bool:
    if not _is_cloudflare_challenge_present(sb):
        return False
    clicked = _click_cloudflare_turnstile_checkbox(sb)
    if clicked:
        tm.sleep(random.uniform(6.0, 10.0))
    return clicked


def _click_cloudflare_turnstile_checkbox(sb: BaseCaseType) -> bool:
    try:
        from selenium.common.exceptions import NoSuchElementException, WebDriverException
        from selenium.webdriver.common.by import By
    except Exception:
        return False

    try:
        frames = sb.driver.find_elements(By.CSS_SELECTOR, CF_CHALLENGE_IFRAME_SELECTOR)
    except WebDriverException:
        return False

    for frame in frames:
        try:
            if not frame.is_displayed():
                continue
            sb.driver.switch_to.frame(frame)
            try:
                checkbox = sb.driver.find_element(By.CSS_SELECTOR, 'input[type="checkbox"]')
                if checkbox.is_displayed() and checkbox.is_enabled():
                    try:
                        sb.click('input[type="checkbox"]', timeout=3)
                    except Exception:
                        checkbox.click()
                    return True
            except NoSuchElementException:
                label = sb.driver.find_element(By.CSS_SELECTOR, "label")
                if label.is_displayed():
                    try:
                        sb.click("label", timeout=3)
                    except Exception:
                        label.click()
                    return True
        except WebDriverException:
            continue
        finally:
            try:
                sb.driver.switch_to.default_content()
            except WebDriverException:
                pass
    return False


@_wait("fails to load '#archiveDate'")
def _check_archive_date_present(sb: BaseCaseType) -> bool:
    return sb.is_element_present("#archiveDate")


@_wait("fails to load 'select[name=\"time\"]'")
def _check_time_selectable(sb: BaseCaseType) -> bool:
    return sb.is_element_present('select[name="time"]')


@_wait("fails to load '#archiveSubmit'")
def _check_archive_submit_present(sb: BaseCaseType) -> bool:
    return sb.is_element_present("#archiveSubmit")


@_wait("fails to load '#archiveResults'")
def _check_archive_results_present(sb: BaseCaseType) -> bool:
    return sb.is_element_present("#archiveResults")


@_wait("fails to receive archive audio result")
def _check_archive_result_ready(sb: BaseCaseType) -> bool:
    if not sb.is_element_present("#archiveResults"):
        return False
    result_text = (sb.get_text("#archiveResults") or "").strip()
    if "Error retrieving archive" in result_text or "HTTP 403" in result_text:
        return True
    return (
        sb.is_element_present("source")
        or sb.is_element_present('#archiveResults a[href*=".mp3"]')
        or sb.is_element_present('#archiveResults a[href]')
        or sb.is_element_present('#archiveResults font[color="blue"]')
    )


def _raise_for_archive_result_error(sb: BaseCaseType) -> None:
    if not sb.is_element_present("#archiveResults"):
        return
    result_text = (sb.get_text("#archiveResults") or "").strip()
    if "Error retrieving archive" in result_text or "HTTP 403" in result_text:
        raise LiveATCSeleniumDownloadError(result_text)


def _click_archive_audio_link(sb: BaseCaseType) -> None:
    selector = '#archiveResults a[href], #archiveResults font[color="blue"]'
    if sb.is_element_present(selector):
        sb.click(selector)
        return
    result_text = sb.get_text("#archiveResults") if sb.is_element_present("#archiveResults") else ""
    raise LiveATCSeleniumDownloadError(result_text or "LiveATC archive audio link was not found")


def _extract_archive_audio_url(sb: BaseCaseType) -> str:
    audio_url = sb.execute_script(
        """
        (() => Array.from(document.querySelectorAll('audio, source, a[href]'))
          .map((el) => el.currentSrc || el.src || el.href || '')
          .find((url) => /^https?:/i.test(url) && url.includes('.mp3')))()
        """
    )
    if not audio_url:
        result_text = sb.get_text("#archiveResults") if sb.is_element_present("#archiveResults") else ""
        raise LiveATCSeleniumDownloadError(result_text or "LiveATC archive audio URL was not found")
    return urljoin(sb.get_current_url(), str(audio_url))


class _BrowserLock:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._held = False

    def __enter__(self) -> None:
        if not self._lock.acquire(timeout=120):
            raise LiveATCSeleniumDownloadError("Another LiveATC browser download is still running")
        self._held = True

    def __exit__(self, *args: object) -> None:
        self._held = False
        self._lock.release()


_browser_lock = _BrowserLock()


def _temp_root() -> Path:
    return Path(settings.a2_audio_storage).resolve() / ".selenium-temp"


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
            raise LiveATCSeleniumDownloadError("Chrome driver is being prepared, please retry in a moment")

    try:
        import seleniumbase

        seleniumbase_driver = Path(seleniumbase.__file__).parent / "drivers" / "uc_driver.exe"
    except Exception as exc:
        raise LiveATCSeleniumDownloadError("seleniumbase is not installed") from exc

    if not local_uc_driver.exists() and seleniumbase_driver.exists():
        shutil.copy2(seleniumbase_driver, local_uc_driver)

    if not local_uc_driver.exists():
        raise LiveATCSeleniumDownloadError(
            "uc_driver missing. Run: python -m seleniumbase install uc_driver"
        )

    try:
        from seleniumbase.core import browser_launcher

        browser_launcher.override_driver_dir(str(download_dir.resolve()))
    except Exception as exc:
        raise LiveATCSeleniumDownloadError(f"failed to configure SeleniumBase driver: {exc}") from exc


def archive_time_label(slot: datetime) -> str:
    end = slot + timedelta(minutes=30)
    return f"{slot.strftime('%H%M')}-{end.strftime('%H%M')}Z"


def floor_slot(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    minute = (value.minute // 30) * 30
    return value.replace(minute=minute, second=0, microsecond=0)


def default_archive_url() -> str:
    custom = getattr(settings, "a2_liveatc_selenium_archive_url", "").strip()
    if custom:
        return custom
    mount = settings.a2_liveatc_mount_ids.split(",")[0].strip() or "vhhh5"
    base = settings.a2_liveatc_base_url.rstrip("/")
    return f"{base}/archive.php?m={mount}"


class ArchiveDownloader:
    def __init__(
        self,
        *,
        url: str,
        date_yyyymmdd: str,
        time_slot: str,
        file_dir: Path,
        download_timeout: int | None = None,
    ) -> None:
        self.url = url
        self.date = date_yyyymmdd
        self.time_slot = time_slot
        self.file_dir = Path(file_dir)
        self.audio_file_name = ""
        self.download_timeout = download_timeout or int(
            getattr(settings, "a2_liveatc_selenium_download_timeout", 300)
        )
        self._dl_dir = _temp_root() / "webdriver"

    def run(self) -> Path:
        cached = self._find_cached_archive_file()
        if cached:
            return cached

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
                if _click_cloudflare_turnstile_if_present(sb):
                    tm.sleep(random.uniform(12.0, 18.0))
                else:
                    tm.sleep(random.uniform(2.0, 4.0))
                sb.click("#archiveSubmit", timeout=999)
                _check_archive_results_present(sb)
                _check_archive_result_ready(sb)
                _raise_for_archive_result_error(sb)
                if not sb.is_element_present("source") and not sb.is_element_present(
                    '#archiveResults a[href*=".mp3"]'
                ):
                    _click_archive_audio_link(sb)
                _raise_for_archive_result_error(sb)
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

                if mp3_file_path.exists() and mp3_file_path.stat().st_size > 0:
                    return mp3_file_path

                self._download_audio_url(audio_url, headers, cookies, mp3_download_path)
                mp3_download_path.replace(mp3_file_path)
                return mp3_file_path

    def _find_cached_archive_file(self) -> Path | None:
        try:
            date_dt = datetime.strptime(self.date, "%Y%m%d")
        except ValueError:
            return None
        slot_start = self.time_slot.rstrip("Z").split("-", 1)[0]
        pattern = f"*-{date_dt.strftime('%b')}-{date_dt.day}-{date_dt.year}-{slot_start}Z.mp3"
        for directory in (self.file_dir, _temp_root() / "downloads"):
            if not directory.exists():
                continue
            matches = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
            if matches:
                return matches[0]
        return None

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
        with requests.get(audio_url, headers=headers, cookies=cookies, stream=True, timeout=60) as response:
            response.raise_for_status()
            with partial_path.open("wb") as file_obj:
                for chunk in response.iter_content(chunk_size=settings.a2_chunk_size):
                    if tm.time() - start_time > self.download_timeout:
                        partial_path.unlink(missing_ok=True)
                        raise LiveATCSeleniumDownloadError("archive download timeout")
                    if chunk:
                        file_obj.write(chunk)
        partial_path.replace(target_path)


def download_archive_slot(slot_utc: datetime, *, output_dir: Path | None = None) -> Path:
    """下载单个 30 分钟 UTC 档，返回本地 mp3 路径。"""
    slot = floor_slot(slot_utc)
    dest = output_dir or (Path(settings.a2_audio_storage) / "historical" / slot.strftime("%Y%m%d"))
    downloader = ArchiveDownloader(
        url=default_archive_url(),
        date_yyyymmdd=slot.strftime("%Y%m%d"),
        time_slot=archive_time_label(slot),
        file_dir=dest,
    )
    return downloader.run()


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m app.services.liveatc_selenium_archive 2026-06-03T00:00:00Z")
        raise SystemExit(1)
    raw = sys.argv[1].replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    path = download_archive_slot(dt)
    print(path)
