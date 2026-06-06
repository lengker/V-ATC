from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.db.models import VoiceFile
from app.db.session import SessionLocal
from app.services.ingestion_service import LiveATCIngestionService
from app.services.liveatc_client import HistoricalAudioLink, LiveATCHTTPClient
from app.services.proxy_provider import proxy_provider
from app.services.storage_service import StorageManagerService


class HistoricalAudioDownloadError(ValueError):
    """Raised when a historical archive response is not an audio payload."""


class LiveATCScheduler:
    def __init__(self):
        self.client = LiveATCHTTPClient()
        self._running = False
        self._realtime_task: asyncio.Task | None = None
        self._historical_task: asyncio.Task | None = None
        self._last_error: str | None = None
        self._last_realtime_at: datetime | None = None
        self._last_historical_at: datetime | None = None
        self._last_historical_found: int = 0
        self._last_historical_skipped: int = 0
        self._last_historical_downloaded: int = 0
        self._last_historical_failed: int = 0
        self._last_historical_first_failed_status: int | None = None
        self._last_cookie_warmup_ok: bool | None = None
        self._last_cookie_count: int = 0
        self._lock = asyncio.Lock()

    @staticmethod
    def _format_exc(prefix: str, exc: Exception) -> str:
        msg = str(exc).strip()
        if msg:
            return f"{prefix}: {exc.__class__.__name__}: {msg}"
        return f"{prefix}: {exc.__class__.__name__}"

    def _default_headers(self) -> dict[str, str]:
        headers = {
            "User-Agent": settings.a2_http_user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": settings.a2_http_accept_language,
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": settings.a2_liveatc_base_url,
        }
        cookie = self._resolve_cookie()
        if cookie:
            headers["Cookie"] = cookie
        return headers

    @staticmethod
    def _resolve_cookie() -> str | None:
        cookie = settings.a2_http_cookie.strip()
        if cookie:
            return cookie
        cookie_file = settings.a2_http_cookie_file.strip()
        if not cookie_file:
            return None
        try:
            value = Path(cookie_file).expanduser().read_text(encoding="utf-8").strip()
            return value or None
        except OSError:
            return None

    def _http_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)

    def _historical_download_headers(self) -> dict[str, str]:
        referer_mount = self.client.mount_ids[0] if self.client.mount_ids else settings.a2_icao_code.lower()
        return {
            "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
            "Referer": f"{settings.a2_liveatc_base_url.rstrip('/')}/archive.php?m={referer_mount}",
        }

    @staticmethod
    def _same_file_name(left: str, right: str) -> bool:
        return Path(left).name == Path(right).name

    async def _refresh_historical_link(
        self, client: httpx.AsyncClient, fallback: HistoricalAudioLink, icao_code: str
    ) -> HistoricalAudioLink:
        try:
            links = await self.client.list_historical_links(client, icao_code)
        except Exception:
            return fallback
        for link in links:
            if self._same_file_name(link.file_name, fallback.file_name):
                return HistoricalAudioLink(
                    url=link.url,
                    file_name=link.file_name,
                    referer_url=link.referer_url or fallback.referer_url,
                    browser_body=link.browser_body or fallback.browser_body,
                )
        return fallback

    @staticmethod
    def _looks_like_html(chunk: bytes) -> bool:
        sample = chunk.lstrip()[:128].lower()
        return sample.startswith((b"<!doctype html", b"<html", b"<head", b"<body")) or b"<title>" in sample

    @staticmethod
    def _looks_like_mp3(chunk: bytes) -> bool:
        sample = chunk.lstrip()[:16]
        if sample.startswith(b"ID3"):
            return True
        return len(sample) >= 2 and sample[0] == 0xFF and (sample[1] & 0xE0) == 0xE0

    @staticmethod
    def _raise_for_invalid_audio_headers(resp: httpx.Response) -> None:
        content_type = resp.headers.get("content-type", "").lower()
        if "text/html" in content_type or "application/xhtml" in content_type:
            raise HistoricalAudioDownloadError(f"unexpected archive content-type: {content_type}")

    async def _validated_audio_byte_iter(self, resp: httpx.Response) -> AsyncIterator[bytes]:
        self._raise_for_invalid_audio_headers(resp)
        first_chunk = True
        async for chunk in resp.aiter_bytes(chunk_size=settings.a2_chunk_size):
            if not chunk:
                continue
            if first_chunk:
                first_chunk = False
                if self._looks_like_html(chunk):
                    raise HistoricalAudioDownloadError("archive response looks like an HTML challenge page")
                if settings.a2_historical_strict_mp3_validation and not self._looks_like_mp3(chunk):
                    raise HistoricalAudioDownloadError("archive response does not look like an MP3 payload")
            yield chunk

    async def _validated_memory_byte_iter(self, body: bytes) -> AsyncIterator[bytes]:
        if self._looks_like_html(body):
            raise HistoricalAudioDownloadError("archive response looks like an HTML challenge page")
        if settings.a2_historical_strict_mp3_validation and not self._looks_like_mp3(body):
            raise HistoricalAudioDownloadError("archive response does not look like an MP3 payload")
        yield body

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._realtime_task = asyncio.create_task(self._realtime_loop(), name="liveatc-realtime-loop")
            self._historical_task = asyncio.create_task(self._historical_loop(), name="liveatc-historical-loop")

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            tasks = [t for t in (self._realtime_task, self._historical_task) if t]
            for task in tasks:
                task.cancel()
            for task in tasks:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            self._realtime_task = None
            self._historical_task = None

    async def _download_historical_link_item(
        self,
        client: httpx.AsyncClient,
        svc: LiveATCIngestionService,
        item: HistoricalAudioLink,
        headers: dict[str, str],
        icao_code: str,
    ) -> VoiceFile | None:
        fresh_item = await self._refresh_historical_link(client, item, icao_code)
        if getattr(fresh_item, "browser_body", None):
            row = await svc.register_historical_download(
                file_name=fresh_item.file_name,
                source_url=fresh_item.url,
                byte_iter=self._validated_memory_byte_iter(fresh_item.browser_body or b""),
            )
            if row is not None:
                return row

        download_urls = [fresh_item.url]
        for alt_url in self.client.build_archive_urls(fresh_item.file_name):
            if alt_url not in download_urls:
                download_urls.append(alt_url)

        for download_url in download_urls:
            download_headers = {**headers, **self._historical_download_headers()}
            if getattr(fresh_item, "referer_url", None):
                download_headers["Referer"] = fresh_item.referer_url
            try:
                async with client.stream(
                    "GET", download_url, follow_redirects=True, headers=download_headers
                ) as resp:
                    if resp.status_code >= 400:
                        request_status, request_body, _ = self.client._browser_request_get(
                            download_url,
                            referer=download_headers.get("Referer"),
                        )
                        if request_status < 400 and request_body:
                            row = await svc.register_historical_download(
                                file_name=fresh_item.file_name,
                                source_url=fresh_item.url,
                                byte_iter=self._validated_memory_byte_iter(request_body),
                            )
                            if row is not None:
                                return row
                        browser_status, browser_body = self.client._browser_fetch_bytes(
                            download_url, referer=download_headers.get("Referer")
                        )
                        if browser_status < 400 and browser_body:
                            row = await svc.register_historical_download(
                                file_name=fresh_item.file_name,
                                source_url=fresh_item.url,
                                byte_iter=self._validated_memory_byte_iter(browser_body),
                            )
                            if row is not None:
                                return row
                        continue
                    row = await svc.register_historical_download(
                        file_name=fresh_item.file_name,
                        source_url=fresh_item.url,
                        byte_iter=self._validated_audio_byte_iter(resp),
                    )
                    if row is not None:
                        return row
            except HistoricalAudioDownloadError:
                continue
            except httpx.HTTPError:
                request_status, request_body, _ = self.client._browser_request_get(
                    download_url,
                    referer=download_headers.get("Referer"),
                )
                if request_status < 400 and request_body:
                    row = await svc.register_historical_download(
                        file_name=fresh_item.file_name,
                        source_url=fresh_item.url,
                        byte_iter=self._validated_memory_byte_iter(request_body),
                    )
                    if row is not None:
                        return row
                browser_status, browser_body = self.client._browser_fetch_bytes(
                    download_url, referer=download_headers.get("Referer")
                )
                if browser_status < 400 and browser_body:
                    row = await svc.register_historical_download(
                        file_name=fresh_item.file_name,
                        source_url=fresh_item.url,
                        byte_iter=self._validated_memory_byte_iter(browser_body),
                    )
                    if row is not None:
                        return row
        return None

    async def _download_historical_via_selenium(
        self, slot: datetime, link: HistoricalAudioLink
    ) -> dict[str, object] | None:
        from app.services.liveatc_selenium_archive import (
            LiveATCSeleniumDownloadError,
            archive_time_label,
            download_archive_slot,
        )

        dest_dir = Path(settings.a2_audio_storage) / "historical" / slot.strftime("%Y%m%d")
        try:
            file_path: Path = await asyncio.to_thread(download_archive_slot, slot, output_dir=dest_dir)
        except LiveATCSeleniumDownloadError as exc:
            self._last_error = str(exc)
            return None
        except Exception as exc:  # noqa: BLE001
            self._last_error = self._format_exc("selenium archive", exc)
            return None

        if not file_path.is_file() or file_path.stat().st_size < 1024:
            self._last_error = "Selenium archive download produced an empty file"
            return None

        async with SessionLocal() as db:
            svc = LiveATCIngestionService(db)
            extracted = svc.extract_utc_range_from_filename(file_path.name)
            start_time = extracted[0] if extracted else slot
            end_time = extracted[1] if extracted else slot
            try:
                rel_path = file_path.resolve().relative_to(Path.cwd().resolve())
                stored_path = rel_path.as_posix()
            except ValueError:
                stored_path = str(file_path)

            row = await svc.register_historical_capture(
                file_name=file_path.name,
                source_url=link.url,
                start_time_utc=start_time,
                end_time_utc=end_time,
                file_path=stored_path,
                file_size=file_path.stat().st_size,
            )

        self._last_error = None
        return {
            "ok": True,
            "already_exists": False,
            "file_name": file_path.name,
            "source_url": link.url,
            "slot_utc": slot.isoformat(),
            "voice_file_id": row.id,
            "via": "selenium_archive",
            "time_slot": archive_time_label(slot),
        }

    async def download_historical_at(self, target_utc: datetime) -> dict[str, object]:
        """下载指定 UTC 时刻对应 30 分钟档的历史录音（单条）。"""
        slot = self.client.floor_to_archive_slot(target_utc)
        link = self.client.build_historical_link_for_slot(slot)
        if link is None:
            return {"ok": False, "error": "无法构造 LiveATC 归档链接，请检查 A2 配置"}

        async with SessionLocal() as db:
            storage = StorageManagerService(db)
            if not await storage.ensure_capacity_for_new_download():
                return {"ok": False, "error": "A2 存储空间不足，无法下载"}
            svc = LiveATCIngestionService(db)
            if await svc.has_source_url(link.url):
                existing = (
                    await db.execute(select(VoiceFile).where(VoiceFile.source_url == link.url).limit(1))
                ).scalar_one_or_none()
                return {
                    "ok": True,
                    "already_exists": True,
                    "file_name": link.file_name,
                    "source_url": link.url,
                    "slot_utc": slot.isoformat(),
                    "voice_file_id": existing.id if existing else None,
                }

        if settings.a2_liveatc_selenium_archive_enabled:
            selenium_result = await self._download_historical_via_selenium(slot, link)
            if selenium_result is not None:
                return selenium_result
            return {
                "ok": False,
                "error": self._last_error or "Selenium 归档下载失败（请安装 seleniumbase 并重启 A2）",
                "file_name": link.file_name,
                "slot_utc": slot.isoformat(),
                "via": "selenium_archive",
            }

        headers = self._default_headers()
        max_retries = max(settings.a2_http_max_retries, 1)
        last_error: str | None = None

        for attempt in range(max_retries):
            picked_proxy = await proxy_provider.get_proxy()
            try:
                client_kwargs = {"timeout": self._http_timeout(), "headers": headers}
                if picked_proxy:
                    client_kwargs["proxy"] = picked_proxy
                async with httpx.AsyncClient(**client_kwargs) as client:
                    self._last_cookie_warmup_ok = await self.client.ensure_public_session_cookie(
                        client, settings.a2_icao_code
                    )
                    self._last_cookie_count = self.client.cookie_count(client)
                    async with SessionLocal() as db:
                        svc = LiveATCIngestionService(db)
                        row = await self._download_historical_link_item(
                            client, svc, link, headers, settings.a2_icao_code
                        )
                    if row is not None:
                        proxy_provider.report_result(picked_proxy, True)
                        self._last_error = None
                        return {
                            "ok": True,
                            "already_exists": False,
                            "file_name": row.file_name,
                            "source_url": row.source_url or link.url,
                            "slot_utc": slot.isoformat(),
                            "voice_file_id": row.id,
                        }
                    last_error = "LiveATC 归档不存在或下载被拒绝（请换时段或检查 Cookie）"
            except Exception as exc:  # noqa: BLE001
                last_error = self._format_exc("historical download", exc)
                proxy_provider.report_result(picked_proxy, False)
                if attempt < max_retries - 1:
                    await asyncio.sleep(self._backoff_delay(attempt))

        return {
            "ok": False,
            "error": last_error or "下载失败",
            "file_name": link.file_name,
            "slot_utc": slot.isoformat(),
        }

    async def trigger_historical_once(self) -> int:
        try:
            return await self._run_historical_once()
        except Exception as exc:  # noqa: BLE001
            self._last_error = self._format_exc("historical", exc)
            return 0

    async def trigger_realtime_once(self) -> bool:
        try:
            return await self._run_realtime_once()
        except Exception as exc:  # noqa: BLE001
            self._last_error = self._format_exc("realtime", exc)
            return False

    def status(self) -> dict[str, str | bool | int | None]:
        return {
            "running": self._running,
            "icao_code": settings.a2_icao_code,
            "last_error": self._last_error,
            "last_realtime_at": self._fmt_time(self._last_realtime_at),
            "last_historical_at": self._fmt_time(self._last_historical_at),
            "last_historical_found": self._last_historical_found,
            "last_historical_skipped": self._last_historical_skipped,
            "last_historical_downloaded": self._last_historical_downloaded,
            "last_historical_failed": self._last_historical_failed,
            "last_historical_first_failed_status": self._last_historical_first_failed_status,
            "last_cookie_warmup_ok": self._last_cookie_warmup_ok,
            "last_cookie_count": self._last_cookie_count,
        }

    @staticmethod
    def _fmt_time(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    async def _realtime_loop(self) -> None:
        while self._running:
            try:
                await self._sleep_human_delay()
                await self._run_realtime_once()
            except Exception as exc:  # noqa: BLE001
                self._last_error = self._format_exc("realtime", exc)
            await asyncio.sleep(self._interval_delay(settings.a2_realtime_interval_seconds))

    async def _historical_loop(self) -> None:
        while self._running:
            try:
                await self._sleep_human_delay()
                await self._run_historical_once()
            except Exception as exc:  # noqa: BLE001
                self._last_error = self._format_exc("historical", exc)
            await asyncio.sleep(self._interval_delay(settings.a2_historical_interval_seconds))

    async def _run_realtime_once(self) -> bool:
        async with SessionLocal() as db:
            storage = StorageManagerService(db)
            can_download = await storage.ensure_capacity_for_new_download()
            if not can_download:
                self._last_error = "storage low: skipped realtime capture"
                return False

        headers = self._default_headers()
        stream_url = None
        max_retries = max(settings.a2_http_max_retries, 1)
        for attempt in range(max_retries):
            picked_proxy = await proxy_provider.get_proxy()
            if picked_proxy:
                self._last_error = f"using proxy: {proxy_provider.redact(picked_proxy)}"
            try:
                client_kwargs = {"timeout": self._http_timeout(), "headers": headers}
                if picked_proxy:
                    client_kwargs["proxy"] = picked_proxy
                async with httpx.AsyncClient(**client_kwargs) as client:
                    self._last_cookie_warmup_ok = await self.client.ensure_public_session_cookie(client, settings.a2_icao_code)
                    self._last_cookie_count = self.client.cookie_count(client)
                    stream_url = await self.client.resolve_realtime_stream_url(client, settings.a2_icao_code)
                    headers = await self.client.enrich_headers_with_session_cookie(client, headers)
                if stream_url:
                    break
            except Exception as exc:  # noqa: BLE001
                self._last_error = self._format_exc("realtime resolve failed", exc)
                proxy_provider.report_result(picked_proxy, False)
                if attempt < max_retries - 1:
                    await asyncio.sleep(self._backoff_delay(attempt))
        if not stream_url:
            self._last_error = "unable to resolve realtime stream url"
            return False
        try:
            async with SessionLocal() as db:
                svc = LiveATCIngestionService(db)
                row = await svc.capture_realtime_stream(
                    stream_url=stream_url,
                    request_headers=headers,
                    proxy=picked_proxy,
                )
        except Exception:
            proxy_provider.report_result(picked_proxy, False)
            raise
        if row is None:
            proxy_provider.report_result(picked_proxy, False)
            return False
        proxy_provider.report_result(picked_proxy, True)
        self._last_realtime_at = datetime.now(timezone.utc)
        self._last_error = None
        return True

    async def _run_historical_once(self) -> int:
        async with SessionLocal() as db:
            storage = StorageManagerService(db)
            can_download = await storage.ensure_capacity_for_new_download()
            if not can_download:
                self._last_error = "storage low: skipped historical download"
                self._last_historical_found = 0
                self._last_historical_skipped = 0
                self._last_historical_downloaded = 0
                self._last_historical_failed = 0
                self._last_historical_first_failed_status = None
                return 0

        headers = self._default_headers()
        # Limit concurrent historical download attempts to avoid server-side throttling.
        max_conc = max(1, settings.a2_max_concurrent_downloads or 1)
        self._download_semaphore = getattr(self, '_download_semaphore', None) or __import__('asyncio').Semaphore(max_conc)
        last_exc: Exception | None = None
        max_retries = max(settings.a2_http_max_retries, 1)
        for attempt in range(max_retries):
            picked_proxy = await proxy_provider.get_proxy()
            if picked_proxy:
                self._last_error = f"using proxy: {proxy_provider.redact(picked_proxy)}"
            try:
                client_kwargs = {"timeout": self._http_timeout(), "headers": headers}
                if picked_proxy:
                    client_kwargs["proxy"] = picked_proxy
                async with httpx.AsyncClient(**client_kwargs) as client:
                    self._last_cookie_warmup_ok = await self.client.ensure_public_session_cookie(client, settings.a2_icao_code)
                    self._last_cookie_count = self.client.cookie_count(client)
                    links = await self.client.list_historical_links(client, settings.a2_icao_code)
                    self._last_historical_found = len(links)
                    self._last_historical_skipped = 0
                    self._last_historical_downloaded = 0
                    self._last_historical_failed = 0
                    self._last_historical_first_failed_status = None
                    if not links:
                        return 0
                    saved = 0
                    skipped = 0
                    failed = 0
                    first_failed_status: int | None = None
                    async with SessionLocal() as db:
                        svc = LiveATCIngestionService(db)
                        for item in links[: settings.a2_historical_max_files_per_run]:
                            if await svc.has_source_url(item.url):
                                skipped += 1
                                continue
                            fresh_item = await self._refresh_historical_link(client, item, settings.a2_icao_code)
                            if saved > 0 or skipped > 0:
                                await self._sleep_download_gap()
                            if getattr(fresh_item, 'browser_body', None):
                                row = await svc.register_historical_download(
                                    file_name=fresh_item.file_name,
                                    source_url=fresh_item.url,
                                    byte_iter=self._validated_memory_byte_iter(fresh_item.browser_body or b""),
                                )
                                if row is None:
                                    failed += 1
                                    if first_failed_status is None:
                                        first_failed_status = 0
                                else:
                                    saved += 1
                                    downloaded = True
                                    continue
                            download_urls = [fresh_item.url]
                            for alt_url in self.client.build_archive_urls(fresh_item.file_name):
                                if alt_url not in download_urls:
                                    download_urls.append(alt_url)
                            item_failed_status: int | None = None
                            downloaded = False
                            for download_url in download_urls:
                                download_headers = {**headers, **self._historical_download_headers()}
                                if getattr(fresh_item, "referer_url", None):
                                    download_headers["Referer"] = fresh_item.referer_url
                                try:
                                    async with client.stream("GET", download_url, follow_redirects=True, headers=download_headers) as resp:
                                        if resp.status_code >= 400:
                                            if item_failed_status is None:
                                                item_failed_status = resp.status_code
                                            request_status, request_body, request_text = self.client._browser_request_get(
                                                download_url,
                                                referer=download_headers.get("Referer"),
                                            )
                                            if request_status < 400 and request_body:
                                                row = await svc.register_historical_download(
                                                    file_name=fresh_item.file_name,
                                                    source_url=fresh_item.url,
                                                    byte_iter=self._validated_memory_byte_iter(request_body),
                                                )
                                                if row is not None:
                                                    saved += 1
                                                    downloaded = True
                                                    break
                                            browser_status, browser_body = self.client._browser_fetch_bytes(download_url, referer=download_headers.get("Referer"))
                                            if browser_status < 400 and browser_body:
                                                row = await svc.register_historical_download(
                                                    file_name=fresh_item.file_name,
                                                    source_url=fresh_item.url,
                                                    byte_iter=self._validated_memory_byte_iter(browser_body),
                                                )
                                                if row is not None:
                                                    saved += 1
                                                    downloaded = True
                                                    break
                                            continue
                                        self._raise_for_invalid_audio_headers(resp)
                                        row = await svc.register_historical_download(
                                            file_name=fresh_item.file_name,
                                            source_url=fresh_item.url,
                                            byte_iter=self._validated_audio_byte_iter(resp),
                                        )
                                        if row is not None:
                                            saved += 1
                                            downloaded = True
                                            break
                                except HistoricalAudioDownloadError:
                                    if item_failed_status is None:
                                        item_failed_status = 200
                                    continue
                                except httpx.HTTPError:
                                    request_status, request_body, request_text = self.client._browser_request_get(
                                        download_url,
                                        referer=download_headers.get("Referer"),
                                    )
                                    if request_status < 400 and request_body:
                                        row = await svc.register_historical_download(
                                            file_name=fresh_item.file_name,
                                            source_url=fresh_item.url,
                                            byte_iter=self._validated_memory_byte_iter(request_body),
                                        )
                                        if row is not None:
                                            saved += 1
                                            downloaded = True
                                            break
                                    browser_status, browser_body = self.client._browser_fetch_bytes(download_url, referer=download_headers.get("Referer"))
                                    if browser_status < 400 and browser_body:
                                        row = await svc.register_historical_download(
                                            file_name=fresh_item.file_name,
                                            source_url=fresh_item.url,
                                            byte_iter=self._validated_memory_byte_iter(browser_body),
                                        )
                                        if row is not None:
                                            saved += 1
                                            downloaded = True
                                            break
                                    continue
                            if not downloaded:
                                failed += 1
                                if first_failed_status is None and item_failed_status is not None:
                                    first_failed_status = item_failed_status
                    self._last_historical_skipped = skipped
                    self._last_historical_downloaded = saved
                    self._last_historical_failed = failed
                    self._last_historical_first_failed_status = first_failed_status
                    self._last_historical_at = datetime.now(timezone.utc)
                    self._last_error = (
                        None
                        if saved > 0 or failed == 0
                        else f"historical download failed for {failed} candidate(s); first status={first_failed_status}"
                    )
                    proxy_provider.report_result(picked_proxy, saved > 0 or failed == 0)
                    return saved
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                proxy_provider.report_result(picked_proxy, False)
                if attempt < max_retries - 1:
                    await asyncio.sleep(self._backoff_delay(attempt))
        if last_exc is not None:
            raise last_exc
        return 0

    async def _sleep_human_delay(self) -> None:
        delay = self._bounded_random_delay(
            settings.a2_liveatc_human_delay_min_seconds,
            settings.a2_liveatc_human_delay_max_seconds,
        )
        if delay > 0:
            await asyncio.sleep(delay)

    async def _sleep_download_gap(self) -> None:
        delay = self._bounded_random_delay(
            settings.a2_liveatc_download_gap_min_seconds,
            settings.a2_liveatc_download_gap_max_seconds,
        )
        if delay > 0:
            await asyncio.sleep(delay)

    def _interval_delay(self, base_seconds: int | float) -> float:
        base = max(float(base_seconds), 0.0)
        jitter = max(float(settings.a2_scheduler_interval_jitter_seconds), 0.0)
        if jitter == 0:
            return base
        return max(base + random.uniform(-jitter, jitter), 0.0)

    @staticmethod
    def _bounded_random_delay(min_seconds: int | float, max_seconds: int | float) -> float:
        lower = max(float(min_seconds), 0.0)
        upper = max(float(max_seconds), lower)
        if upper == 0:
            return 0.0
        return random.uniform(lower, upper)

    def _backoff_delay(self, attempt: int) -> float:
        base = max(settings.a2_http_backoff_base_seconds, 0.1)
        max_wait = max(settings.a2_http_backoff_max_seconds, base)
        exp_wait = min(base * (2**attempt), max_wait)
        jitter = random.uniform(0, base)
        return min(exp_wait + jitter, max_wait)


liveatc_scheduler = LiveATCScheduler()
