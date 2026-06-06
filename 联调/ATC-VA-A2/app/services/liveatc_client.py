from __future__ import annotations

import os
import re
import random
import asyncio
import html
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.parse import urljoin

import httpx

from app.core.config import settings
from app.services.proxy_provider import ProxyProvider

_DEFAULT_CLOAKBROWSER_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cloakbrowser-cache"
os.environ["CLOAKBROWSER_CACHE_DIR"] = str(_DEFAULT_CLOAKBROWSER_CACHE_DIR)

try:
    import cloudscraper
except Exception:  # pragma: no cover - optional dependency
    cloudscraper = None

try:
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover - optional dependency
    sync_playwright = None

try:
    from cloakbrowser import launch as cloakbrowser_launch
except Exception:  # pragma: no cover - optional dependency
    cloakbrowser_launch = None

try:
    from cloakbrowser import launch_persistent_context as cloakbrowser_launch_persistent_context
except Exception:  # pragma: no cover - optional dependency
    cloakbrowser_launch_persistent_context = None

@dataclass
class HistoricalAudioLink:
    url: str
    file_name: str
    referer_url: str | None = None
    browser_body: bytes | None = None


class LiveATCHTTPClient:
    """LiveATC page parser and downloader."""

    HREF_PATTERN = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
    MP3_PATTERN = re.compile(r"\.mp3($|\?)", re.IGNORECASE)
    MP3_FILE_PATTERN = re.compile(r"([A-Za-z0-9._-]+\.mp3)\b", re.IGNORECASE)
    SELECTED_OPTION_PATTERN = re.compile(
        r"<option\b[^>]*\bselected\b[^>]*\bvalue=[\"']?([^\"'>\s]+)",
        re.IGNORECASE,
    )

    def __init__(self):
        self.base_url = settings.a2_liveatc_base_url.rstrip("/")
        self.archive_base_url = settings.a2_liveatc_archive_base_url.rstrip("/")
        self.archive_base_urls = self._build_archive_base_urls()
        self.search_tpl = settings.a2_liveatc_search_url
        self.mount_ids = [item.strip() for item in settings.a2_liveatc_mount_ids.split(",") if item.strip()]
        self.archive_file_prefixes = [
            item.strip() for item in settings.a2_liveatc_archive_file_prefixes.split(",") if item.strip()
        ]
        self.realtime_stream_override = settings.a2_liveatc_realtime_stream_url.strip()

    @staticmethod
    def _browser_context_kwargs() -> dict[str, object]:
        kwargs: dict[str, object] = {
            "user_agent": settings.a2_http_user_agent,
            "locale": "zh-CN",
            "extra_http_headers": {
                "Accept-Language": settings.a2_http_accept_language,
            },
            "ignore_https_errors": True,
        }
        proxy = LiveATCHTTPClient._pick_static_proxy()
        if proxy:
            kwargs["proxy"] = {"server": proxy}
        return kwargs

    @staticmethod
    def _pick_static_proxy() -> str | None:
        if not settings.a2_proxy_enabled:
            return None
        path = Path(settings.a2_proxy_file)
        if not path.exists():
            return None
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        candidates: list[str] = []
        for raw in lines:
            normalized = ProxyProvider._normalize_proxy(raw)
            if normalized:
                candidates.append(normalized)
        if not candidates:
            return None
        if settings.a2_proxy_mode.strip().lower() == "random":
            return random.choice(candidates)
        return candidates[0]

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

    @staticmethod
    def _ensure_cloakbrowser_binary_path() -> str | None:
        configured = os.environ.get("CLOAKBROWSER_BINARY_PATH", "").strip()
        return configured or None

    @classmethod
    def _launch_browser(cls, playwright):
        proxy = cls._pick_static_proxy()
        if cloakbrowser_launch is not None:
            try:
                cls._ensure_cloakbrowser_binary_path()
                launch_kwargs: dict[str, object] = {"headless": False, "humanize": True}
                if proxy:
                    launch_kwargs["proxy"] = proxy
                return cloakbrowser_launch(**launch_kwargs)
            except Exception:
                pass
        return playwright.chromium.launch(
            headless=settings.a2_browser_headless,
            channel=settings.a2_browser_channel or None,
            proxy={"server": proxy} if proxy else None,
        )

    @staticmethod
    def _browser_profile_dir() -> Path:
        configured = settings.a2_playwright_user_data_dir.strip()
        if configured:
            return Path(configured).expanduser()
        return Path(".cloakbrowser-profile")

    @staticmethod
    def _split_user_data_profile(path_value: str) -> tuple[str, str | None]:
        path = Path(path_value).expanduser()
        if path.name.lower().startswith("profile") or path.name.lower() == "default":
            return str(path.parent), path.name
        return str(path), None

    @staticmethod
    def _browser_navigation_headers(referer: str | None = None) -> dict[str, str]:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": settings.a2_http_accept_language,
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-site" if referer else "none",
            "Sec-Fetch-User": "?1",
            "Priority": "u=0, i",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    @staticmethod
    def _browser_request_headers(referer: str | None = None) -> dict[str, str]:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": settings.a2_http_accept_language,
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": "1",
            "Priority": "u=0, i",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    @classmethod
    def _new_browser_context(cls, playwright):
        kwargs = cls._browser_context_kwargs()
        profile_dir = cls._browser_profile_dir()
        storage_state_file = settings.a2_playwright_storage_state_file.strip()
        if storage_state_file:
            browser = cls._launch_browser(playwright)
            storage_state_path = Path(storage_state_file).expanduser()
            if storage_state_path.exists():
                kwargs["storage_state"] = str(storage_state_path)
            context = browser.new_context(**kwargs)
            cookie_header = cls._resolve_cookie()
            if cookie_header:
                cookies = cls._browser_cookies_from_header(cookie_header, domain=".liveatc.net")
                if cookies:
                    context.add_cookies(cookies)
            return browser, context
        if cloakbrowser_launch_persistent_context is not None:
            clean_profile_dir = profile_dir.with_name(f"{profile_dir.name}-clean")
            profile_candidates = [clean_profile_dir, profile_dir]
            for candidate_profile_dir in profile_candidates:
                try:
                    cls._ensure_cloakbrowser_binary_path()
                    launch_kwargs: dict[str, object] = {
                        # CloakBrowser docs recommend headed mode for aggressive sites.
                        "headless": False,
                        "humanize": True,
                        "args": ["--disable-http2"],
                    }
                    proxy = kwargs.get("proxy")
                    if proxy:
                        launch_kwargs["proxy"] = proxy
                    context = cloakbrowser_launch_persistent_context(str(candidate_profile_dir), **launch_kwargs)
                    cookie_header = cls._resolve_cookie()
                    if cookie_header:
                        cookies = cls._browser_cookies_from_header(cookie_header, domain=".liveatc.net")
                        if cookies:
                            context.add_cookies(cookies)
                    return context
                except Exception:
                    continue
        if settings.a2_playwright_user_data_dir:
            user_data_dir, profile_directory = cls._split_user_data_profile(settings.a2_playwright_user_data_dir)
            launch_args = []
            if profile_directory:
                launch_args = [f"--profile-directory={profile_directory}"]
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=settings.a2_browser_headless,
                channel=settings.a2_browser_channel or None,
                user_agent=kwargs["user_agent"],
                locale=kwargs["locale"],
                extra_http_headers=kwargs["extra_http_headers"],
                ignore_https_errors=kwargs["ignore_https_errors"],
                args=launch_args,
                proxy=kwargs.get("proxy"),
            )
            cookie_header = cls._resolve_cookie()
            if cookie_header:
                cookies = cls._browser_cookies_from_header(cookie_header, domain=".liveatc.net")
                if cookies:
                    context.add_cookies(cookies)
            return context
        browser = cls._launch_browser(playwright)
        context = browser.new_context(**kwargs)
        cookie_header = cls._resolve_cookie()
        if cookie_header:
            cookies = cls._browser_cookies_from_header(cookie_header, domain=".liveatc.net")
            if cookies:
                context.add_cookies(cookies)
        return browser, context

    def _build_archive_base_urls(self) -> list[str]:
        primary = settings.a2_liveatc_archive_base_url.rstrip("/")
        urls = [primary] if primary else []
        extras = [item.strip() for item in settings.a2_liveatc_archive_base_urls.split(",") if item.strip()]
        for item in extras:
            normalized = item.rstrip("/")
            if normalized and normalized not in urls:
                urls.append(normalized)
        return urls or [self.archive_base_url]

    def build_search_url(self, icao: str) -> str:
        return self.search_tpl.format(icao=icao.upper())

    def build_archive_urls(self, file_name: str) -> list[str]:
        lowered = file_name.lower()
        for mount in self.mount_ids:
            if lowered.startswith(mount.lower()):
                archive_dir = self._infer_archive_dir(station=mount, archive_identifier=file_name)
                encoded = quote(file_name, safe="-_.()")
                return [f"{base}/{archive_dir}/{encoded}" for base in self.archive_base_urls]
        for prefix in self.archive_file_prefixes:
            if lowered.startswith(prefix.lower()):
                archive_dir = self._infer_archive_dir(station=prefix, archive_identifier=file_name)
                encoded = quote(file_name, safe="-_.()")
                return [f"{base}/{archive_dir}/{encoded}" for base in self.archive_base_urls]
        return []

    @classmethod
    def _extract_hrefs(cls, html_text: str) -> list[str]:
        return [html.unescape(m.group(1).strip()) for m in cls.HREF_PATTERN.finditer(html_text)]

    def _to_abs(self, href: str, source_url: str) -> str:
        if href.startswith("http://") or href.startswith("https://"):
            return href
        if href.startswith("/"):
            return urljoin(source_url, href)
        return urljoin(source_url, href)

    @staticmethod
    def _cookie_header_from_client(client: httpx.AsyncClient) -> str:
        pairs = []
        for cookie in client.cookies.jar:
            if cookie.name and cookie.value:
                pairs.append(f"{cookie.name}={cookie.value}")
        return "; ".join(pairs)

    @staticmethod
    def _cookie_header_from_items(cookies: list[dict]) -> str:
        pairs = []
        for cookie in cookies:
            name = cookie.get("name")
            value = cookie.get("value")
            if name and value:
                pairs.append(f"{name}={value}")
        return "; ".join(pairs)

    @staticmethod
    def _browser_cookies_from_header(cookie_header: str, *, domain: str) -> list[dict[str, object]]:
        jar = SimpleCookie()
        jar.load(cookie_header)
        cookies: list[dict[str, object]] = []
        for name, morsel in jar.items():
            value = morsel.value
            if not name or not value:
                continue
            cookies.append(
                {
                    "name": name,
                    "value": value,
                    "domain": domain,
                    "path": morsel["path"] or "/",
                    "secure": True,
                }
            )
        return cookies

    @staticmethod
    def _seed_client_cookies(client: httpx.AsyncClient, cookies: list[dict], *, allowed_domain: str | None = None) -> None:
        for cookie in cookies:
            name = cookie.get("name")
            value = cookie.get("value")
            if not name or value is None:
                continue
            domain = cookie.get("domain")
            if allowed_domain and domain and allowed_domain not in domain:
                continue
            client.cookies.set(
                name,
                value,
                domain=domain,
                path=cookie.get("path") or "/",
            )

    @staticmethod
    def _browser_fetch(url: str, *, wait_ms: int = 1500) -> tuple[int, str, list[dict]]:
        if sync_playwright is None:
            return 0, "", []
        browser = None
        try:
            with sync_playwright() as playwright:
                context_result = LiveATCHTTPClient._new_browser_context(playwright)
                if isinstance(context_result, tuple):
                    browser, context = context_result
                else:
                    context = context_result
                    browser = context_result
                page = context.new_page()
                bootstrap_url = url
                page.goto(
                    bootstrap_url,
                    wait_until="domcontentloaded",
                    timeout=45_000,
                    referer=bootstrap_url,
                )
                page.wait_for_timeout(int(max(settings.a2_browser_bootstrap_wait_seconds, 1.0) * 1000))
                response = page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=45_000,
                    referer=bootstrap_url,
                )
                text = page.content()
                cookies = context.cookies()
                return (response.status if response is not None else 0), text, cookies
        except Exception:
            return 0, "", []
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass

    @staticmethod
    def _browser_fetch_bytes(url: str, *, referer: str | None = None) -> tuple[int, bytes]:
        if sync_playwright is None:
            return 0, b""
        def looks_like_html(chunk: bytes) -> bool:
            sample = chunk.lstrip()[:128].lower()
            return sample.startswith((b"<!doctype html", b"<html", b"<head", b"<body")) or b"<title>" in sample

        status, body, _ = LiveATCHTTPClient._browser_request_get(url, referer=referer)
        if status and body and not looks_like_html(body):
            return status, body
        browser = None
        try:
            with sync_playwright() as playwright:
                context_result = LiveATCHTTPClient._new_browser_context(playwright)
                if isinstance(context_result, tuple):
                    browser, context = context_result
                else:
                    context = context_result
                    browser = context_result
                page = context.new_page()
                bootstrap_url = referer or url
                page.goto(
                    bootstrap_url,
                    wait_until="domcontentloaded",
                    timeout=45_000,
                    referer=bootstrap_url,
                )
                page.wait_for_timeout(int(max(settings.a2_browser_bootstrap_wait_seconds, 1.0) * 1000))
                response = page.goto(
                    url,
                    wait_until="commit",
                    timeout=45_000,
                    referer=bootstrap_url,
                )
                if response is not None:
                    try:
                        body = response.body()
                        if body and not looks_like_html(body):
                            return response.status, body
                    except Exception:
                        pass
                encoded = page.evaluate(
                    """
                    async ({ url }) => {
                      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
                      if (!response.ok) {
                        throw new Error(`fetch failed: ${response.status}`);
                      }
                      const buffer = await response.arrayBuffer();
                      const bytes = new Uint8Array(buffer);
                      let binary = '';
                      const chunkSize = 0x8000;
                      for (let index = 0; index < bytes.length; index += chunkSize) {
                        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
                      }
                      return btoa(binary);
                    }
                    """,
                    {"url": url},
                )
                if encoded:
                    return 200, base64.b64decode(encoded)
        except Exception:
            return 0, b""
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass

    @staticmethod
    def _browser_request_get(url: str, *, referer: str | None = None) -> tuple[int, bytes, str]:
        if sync_playwright is None:
            return 0, b"", ""
        browser = None
        try:
            with sync_playwright() as playwright:
                context_result = LiveATCHTTPClient._new_browser_context(playwright)
                if isinstance(context_result, tuple):
                    browser, context = context_result
                else:
                    context = context_result
                    browser = context_result
                bootstrap_url = referer or settings.a2_liveatc_base_url
                try:
                    page = context.new_page()
                    page.goto(
                        bootstrap_url,
                        wait_until="domcontentloaded",
                        timeout=45_000,
                        referer=bootstrap_url,
                    )
                    page.wait_for_timeout(int(max(settings.a2_browser_bootstrap_wait_seconds, 1.0) * 1000))
                except Exception:
                    pass
                response = context.request.get(url, headers=LiveATCHTTPClient._browser_request_headers(referer=bootstrap_url))
                body = response.body() if response is not None else b""
                text = response.text() if response is not None else ""
                return (response.status if response is not None else 0), body, text
        except Exception:
            return 0, b"", ""
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass

    @staticmethod
    def cookie_count(client: httpx.AsyncClient) -> int:
        return sum(1 for cookie in client.cookies.jar if cookie.name and cookie.value)

    @staticmethod
    def _infer_archive_dir(station: str, archive_identifier: str) -> str:
        prefix = archive_identifier.split("-", 1)[0].strip().lower()
        if len(prefix) == 4 and prefix.isalnum():
            return prefix
        station_token = re.split(r"[_-]", station.strip().lower())[0]
        letters = "".join(ch for ch in station_token if ch.isalpha())
        if len(letters) >= 4:
            return letters[:4]
        return station_token or "unknown"

    @classmethod
    def _selected_archive_identifier(cls, html: str) -> str | None:
        matched = cls.SELECTED_OPTION_PATTERN.search(html)
        return matched.group(1).strip() if matched else None

    @staticmethod
    def _last_finished_half_hour(now: datetime | None = None) -> datetime:
        value = now or datetime.now(timezone.utc)
        value = value - timedelta(minutes=30)
        floored_minute = (value.minute // 30) * 30
        return value.replace(minute=floored_minute, second=0, microsecond=0)

    @staticmethod
    def _archive_time_label(slot: datetime) -> str:
        end = slot + timedelta(minutes=30)
        return f"{slot.strftime('%H%M')}-{end.strftime('%H%M')}Z"

    @staticmethod
    def floor_to_archive_slot(value: datetime) -> datetime:
        """LiveATC 历史档按 30 分钟一档（UTC）。"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        floored_minute = (value.minute // 30) * 30
        return value.replace(minute=floored_minute, second=0, microsecond=0)

    def build_historical_link_for_slot(
        self,
        slot_utc: datetime,
        *,
        station: str | None = None,
        archive_identifier: str | None = None,
    ) -> HistoricalAudioLink | None:
        """根据任意 UTC 时刻构造对应 30 分钟档的 LiveATC 归档 URL。"""
        slot = self.floor_to_archive_slot(slot_utc)
        station_key = (station or (self.mount_ids[0] if self.mount_ids else settings.a2_icao_code.lower())).strip()
        identifier = (
            archive_identifier
            or (self.archive_file_prefixes[0] if self.archive_file_prefixes else None)
            or station_key
        )
        if not identifier:
            return None
        archive_dir = self._infer_archive_dir(station=station_key, archive_identifier=identifier)
        file_name = f"{identifier}-{slot.strftime('%b-%d-%Y-%H%MZ')}.mp3"
        encoded_name = quote(file_name, safe="-_.()")
        return HistoricalAudioLink(
            url=f"{self.archive_base_urls[0]}/{archive_dir}/{encoded_name}",
            file_name=file_name,
            referer_url=f"{self.base_url}/archive.php?m={station_key}",
        )

    def _recent_archive_candidates(
        self, *, station: str, archive_identifier: str, now: datetime | None = None
    ) -> list[HistoricalAudioLink]:
        archive_dir = self._infer_archive_dir(station=station, archive_identifier=archive_identifier)
        slots = max(settings.a2_historical_candidate_slots, 1)
        start_slot = self._last_finished_half_hour(now)
        candidates: list[HistoricalAudioLink] = []
        for index in range(slots):
            slot = start_slot - timedelta(minutes=30 * index)
            file_name = f"{archive_identifier}-{slot.strftime('%b-%d-%Y-%H%MZ')}.mp3"
            encoded_name = quote(file_name, safe="-_.()")
            candidates.append(
                HistoricalAudioLink(
                    url=f"{self.archive_base_urls[0]}/{archive_dir}/{encoded_name}",
                    file_name=file_name,
                    referer_url=f"{self.base_url}/archive.php?m={station}",
                )
            )
        return candidates

    def _browser_archive_flow_link(self, icao: str, *, now: datetime | None = None) -> HistoricalAudioLink | None:
        if not settings.a2_liveatc_browser_archive_flow_enabled:
            return None
        slot = self._last_finished_half_hour(now)
        target_date = slot.strftime("%Y%m%d")
        target_time = self._archive_time_label(slot)
        timeout_ms = int(max(settings.a2_liveatc_browser_flow_timeout_seconds, 15.0) * 1000)
        context = None
        try:
            from cloakbrowser import launch_persistent_context as _launch_persistent_context

            context = _launch_persistent_context(
                r".\cloakbrowser-profile-clean",
                headless=False,
                humanize=True,
                args=["--disable-http2"],
            )
            page = context.new_page()
            mount = self.mount_ids[0] if self.mount_ids else icao.lower()
            page.goto(f"{self.base_url}/archive.php?m={mount}", wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(int(max(settings.a2_browser_bootstrap_wait_seconds, 20.0) * 1000))

            page.evaluate(
                """
                ({ value }) => {
                  const visible = document.querySelector('#archiveDateDisplay');
                  if (visible && visible._flatpickr) {
                    visible._flatpickr.setDate(value, true, 'Ymd');
                    return;
                  }
                  const hidden = document.querySelector('#archiveDate');
                  if (hidden) {
                    hidden.value = value;
                    hidden.dispatchEvent(new Event('input', { bubbles: true }));
                    hidden.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  if (visible) {
                    visible.value = value;
                    visible.dispatchEvent(new Event('input', { bubbles: true }));
                    visible.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
                """,
                {"value": target_date},
            )

            time_select = page.locator("select[name='time']")
            if time_select.count() == 0:
                return None
            try:
                time_select.first.select_option(label=target_time)
            except Exception:
                return None

            submit = page.locator("input[type='submit'], button[type='submit'], button", has_text="Submit").first
            if submit.count():
                submit.click()
            else:
                page.keyboard.press("Enter")

            deadline = max(timeout_ms, 30_000)
            waited_ms = 0
            while waited_ms <= deadline:
                html = page.content()
                link = self._historical_audio_link_from_html(html, page.url)
                if link is not None:
                    try:
                        page.goto(link.url, wait_until="commit", timeout=45_000, referer=link.referer_url)
                        encoded = page.evaluate(
                            """
                            async ({ url }) => {
                              const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
                              if (!response.ok) {
                                throw new Error(`fetch failed: ${response.status}`);
                              }
                              const buffer = await response.arrayBuffer();
                              const bytes = new Uint8Array(buffer);
                              let binary = '';
                              const chunkSize = 0x8000;
                              for (let index = 0; index < bytes.length; index += chunkSize) {
                                binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
                              }
                              return btoa(binary);
                            }
                            """,
                            {"url": link.url},
                        )
                        if encoded:
                            return HistoricalAudioLink(
                                url=link.url,
                                file_name=link.file_name,
                                referer_url=link.referer_url,
                                browser_body=base64.b64decode(encoded),
                            )
                    except Exception:
                        return link
                page.wait_for_timeout(1000)
                waited_ms += 1000
        except Exception:
            return None
        finally:
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass
        return None

    def _historical_audio_link_from_html(self, html: str, page_url: str) -> HistoricalAudioLink | None:
        for href in self._extract_hrefs(html):
            absolute = self._to_abs(href, page_url)
            if self.MP3_PATTERN.search(absolute):
                file_name = absolute.split("/")[-1].split("?")[0] or "liveatc.mp3"
                return HistoricalAudioLink(url=absolute, file_name=file_name, referer_url=page_url)
        for file_name in {m.group(1) for m in self.MP3_FILE_PATTERN.finditer(html)}:
            for mount in self.mount_ids:
                if file_name.lower().startswith(mount.lower()):
                    archive_dir = self._infer_archive_dir(station=mount, archive_identifier=file_name)
                    absolute = f"{self.archive_base_urls[0]}/{archive_dir}/{quote(file_name, safe='-_.()')}"
                    return HistoricalAudioLink(url=absolute, file_name=file_name, referer_url=page_url)
        return None

    @staticmethod
    def _mount_from_archive_page_url(page_url: str) -> str:
        parsed = urlparse(page_url)
        mount = parse_qs(parsed.query).get("m", [""])[0].strip()
        return mount or page_url

    async def ensure_public_session_cookie(self, client: httpx.AsyncClient, icao: str) -> bool:
        seed_urls = [
            f"{self.base_url}/archive.php?m={self.mount_ids[0]}" if self.mount_ids else self.base_url,
            self.build_search_url(icao),
            self.base_url,
        ]
        for url in seed_urls:
            try:
                resp = await client.get(url, follow_redirects=True)
                if resp.status_code < 400:
                    continue
                if cloudscraper is not None:
                    try:
                        sc = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "mobile": False})
                        sc.get(url, timeout=10)
                    except Exception:
                        pass
                browser_status, browser_html, browser_cookies = self._browser_fetch(url)
                if browser_status and browser_html:
                    self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(url).hostname)
                    if self._cookie_header_from_client(client):
                        continue
            except httpx.HTTPError:
                # 尝试 cloudscraper 回退以获取会话 cookie
                if cloudscraper is not None:
                    try:
                        sc = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "mobile": False})
                        sc.get(url, timeout=10)
                    except Exception:
                        pass
                browser_status, browser_html, browser_cookies = self._browser_fetch(url)
                if browser_status and browser_html:
                    self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(url).hostname)
                    if self._cookie_header_from_client(client):
                        continue
                continue
        return bool(self._cookie_header_from_client(client))

    def _cloudscraper_get_text(self, url: str, headers: dict | None = None) -> tuple[int, str, str | None]:
        """同步 cloudscraper 请求，返回 (status_code, text, cookie_header)"""
        if cloudscraper is None:
            return 0, "", None
        try:
            sc = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "mobile": False})
            if headers:
                sc.headers.update(headers)
            r = sc.get(url, timeout=20)
            cookie = None
            if hasattr(sc, 'cookies'):
                # 构建 Cookie header
                try:
                    cookie = "; ".join(f"{c.name}={c.value}" for c in sc.cookies.jar if c.name and c.value)
                except Exception:
                    cookie = None
            return getattr(r, 'status_code', 0) or 0, getattr(r, 'text', '') or '', cookie
        except Exception:
            return 0, "", None

    async def enrich_headers_with_session_cookie(
        self, client: httpx.AsyncClient, base_headers: dict[str, str]
    ) -> dict[str, str]:
        merged = dict(base_headers)
        cookie_header = self._cookie_header_from_client(client)
        if cookie_header:
            merged["Cookie"] = cookie_header
        return merged

    async def get_search_page(self, client: httpx.AsyncClient, icao: str) -> tuple[str, str]:
        search_url = self.build_search_url(icao)
        headers = self._browser_navigation_headers(referer=self.base_url)
        try:
            resp = await client.get(search_url, headers=headers)
            resp.raise_for_status()
            return search_url, resp.text
        except httpx.HTTPStatusError as exc:
            # 如果被 403 拦截，尝试 cloudscraper 回退（同步）
            if cloudscraper is not None and getattr(exc.response, 'status_code', None) == 403:
                status, text, cookie = self._cloudscraper_get_text(search_url, headers={
                    'User-Agent': settings.a2_http_user_agent,
                    'Accept': headers['Accept'],
                    'Accept-Language': headers['Accept-Language'],
                    'Cache-Control': headers['Cache-Control'],
                    'Referer': self.base_url,
                    'Upgrade-Insecure-Requests': headers['Upgrade-Insecure-Requests'],
                })
                if status and status < 400:
                    return search_url, text
            browser_status, browser_text, browser_cookies = self._browser_fetch(search_url)
            if browser_status and browser_text:
                self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(search_url).hostname)
                return search_url, browser_text
            request_status, request_body, request_text = self._browser_request_get(search_url, referer=self.base_url)
            if request_status and request_text:
                return search_url, request_text
            raise

    async def resolve_realtime_stream_url(self, client: httpx.AsyncClient, icao: str) -> str | None:
        if self.realtime_stream_override:
            return self.realtime_stream_override

        for mount in self.mount_ids:
            for playlist_url in (f"{self.base_url}/play/{mount}.pls", f"{self.base_url}/play/{mount}.m3u"):
                try:
                    resp = await client.get(playlist_url, follow_redirects=True, headers=self._browser_navigation_headers(referer=self.base_url))
                except httpx.HTTPError:
                    # 回退到 cloudscraper 同步请求
                    if cloudscraper is not None:
                        status, text, cookie = self._cloudscraper_get_text(playlist_url, headers={'User-Agent': settings.a2_http_user_agent})
                        if status and status < 400:
                            resp = type('R', (), {'status_code': status, 'text': text})()
                        else:
                            browser_status, browser_text, browser_cookies = self._browser_fetch(playlist_url)
                            if browser_status and browser_text:
                                self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(playlist_url).hostname)
                                resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                            else:
                                continue
                    else:
                        browser_status, browser_text, browser_cookies = self._browser_fetch(playlist_url)
                        if browser_status and browser_text:
                            self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(playlist_url).hostname)
                            resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                        else:
                            continue
                if resp.status_code >= 400:
                    browser_status, browser_text, browser_cookies = self._browser_fetch(playlist_url)
                    if browser_status and browser_text:
                        self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(playlist_url).hostname)
                        resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                    else:
                        continue
                playlist_urls = re.findall(r"https?://[^\s'\"<>]+", resp.text)
                for url in playlist_urls:
                    lowered = url.lower()
                    if any(k in lowered for k in ("liveatc", "stream", "mount", ".mp3", ".aac")):
                        return url

        candidate_listen_pages = [
            f"{self.base_url}/hlisten.php?mount={mount}&icao={icao.lower()}" for mount in self.mount_ids
        ]
        try:
            search_url, html = await self.get_search_page(client, icao)
            for href in self._extract_hrefs(html):
                if "listen.php?" in href.lower():
                    candidate_listen_pages.append(self._to_abs(href, search_url))
        except httpx.HTTPStatusError:
            # 如果 cloudscraper 可用，尝试直接用 cloudscraper 拉取 search page
            if cloudscraper is not None:
                status, text, cookie = self._cloudscraper_get_text(self.build_search_url(icao), headers={'User-Agent': settings.a2_http_user_agent})
                if status and status < 400:
                    for href in self._extract_hrefs(text):
                        if "listen.php?" in href.lower():
                            candidate_listen_pages.append(self._to_abs(href, self.build_search_url(icao)))
            browser_status, browser_text, browser_cookies = self._browser_fetch(self.build_search_url(icao))
            if browser_status and browser_text:
                self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(self.build_search_url(icao)).hostname)
                for href in self._extract_hrefs(browser_text):
                    if "listen.php?" in href.lower():
                        candidate_listen_pages.append(self._to_abs(href, self.build_search_url(icao)))

        for listen_url in candidate_listen_pages:
            listen_resp = await client.get(listen_url, follow_redirects=True)
            if listen_resp.status_code >= 400:
                continue
            text = listen_resp.text
            for candidate in self._extract_hrefs(text):
                absolute = self._to_abs(candidate, listen_url)
                lowered = absolute.lower()
                if any(k in lowered for k in ("audio", "stream", "mount", ".pls", ".m3u", ".mp3", "d.liveatc.net")):
                    return absolute
            http_urls = re.findall(r"https?://[^\s'\"<>]+", text)
            for item in http_urls:
                lowered = item.lower()
                if any(k in lowered for k in ("audio", "stream", "mount", ".pls", ".m3u", ".mp3", "d.liveatc.net")):
                    return item

        for mount in self.mount_ids:
            # 最后兜底：常见直连模式（部分节点可用）。
            for direct_url in (f"https://d.liveatc.net/{mount}", f"https://d.liveatc.net/{mount}.mp3"):
                if await self._probe_stream_url(client, direct_url):
                    return direct_url
        return None

    @staticmethod
    async def _probe_stream_url(client: httpx.AsyncClient, url: str) -> bool:
        try:
            async with client.stream("GET", url, follow_redirects=True) as resp:
                if resp.status_code >= 400:
                    return False
                async for chunk in resp.aiter_bytes(chunk_size=1):
                    return bool(chunk)
                return True
        except httpx.HTTPError:
            return False

    async def list_historical_links(self, client: httpx.AsyncClient, icao: str) -> list[HistoricalAudioLink]:
        candidate_pages = [f"{self.base_url}/archive.php?m={mount}" for mount in self.mount_ids]
        for mount in self.mount_ids:
            for base_url in self.archive_base_urls:
                candidate_pages.append(f"{base_url}/{mount}/")
        browser_flow_link = None
        if settings.a2_liveatc_browser_archive_flow_enabled and sync_playwright is not None:
            try:
                browser_flow_link = await asyncio.to_thread(self._browser_archive_flow_link, icao)
            except Exception:
                browser_flow_link = None
        try:
            search_url, html = await self.get_search_page(client, icao)
            candidate_pages.append(search_url)
            for href in self._extract_hrefs(html):
                lowered = href.lower()
                if "archive" in lowered or "recordings" in lowered:
                    candidate_pages.append(self._to_abs(href, search_url))
        except httpx.HTTPStatusError:
            pass
        links: dict[str, HistoricalAudioLink] = {}
        if browser_flow_link is not None:
            links[browser_flow_link.url] = browser_flow_link
        for page_url in candidate_pages:
            try:
                resp = await client.get(page_url, follow_redirects=True, headers=self._browser_navigation_headers(referer=self.base_url))
            except httpx.HTTPError:
                # cloudscraper 回退
                if cloudscraper is not None:
                    status, text, cookie = self._cloudscraper_get_text(page_url, headers={'User-Agent': settings.a2_http_user_agent})
                    if status and status < 400:
                        resp = type('R', (), {'status_code': status, 'text': text})()
                    else:
                        browser_status, browser_text, browser_cookies = self._browser_fetch(page_url)
                        if browser_status and browser_text:
                            self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(page_url).hostname)
                            resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                        else:
                            request_status, request_body, request_text = self._browser_request_get(page_url, referer=self.base_url)
                            if request_status and request_text:
                                resp = type('R', (), {'status_code': request_status, 'text': request_text})()
                            else:
                                continue
                else:
                    browser_status, browser_text, browser_cookies = self._browser_fetch(page_url)
                    if browser_status and browser_text:
                        self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(page_url).hostname)
                        resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                    else:
                        request_status, request_body, request_text = self._browser_request_get(page_url, referer=self.base_url)
                        if request_status and request_text:
                            resp = type('R', (), {'status_code': request_status, 'text': request_text})()
                        else:
                            continue
            if resp.status_code >= 400:
                browser_status, browser_text, browser_cookies = self._browser_fetch(page_url)
                if browser_status and browser_text:
                    self._seed_client_cookies(client, browser_cookies, allowed_domain=urlparse(page_url).hostname)
                    resp = type('R', (), {'status_code': browser_status, 'text': browser_text})()
                else:
                    request_status, request_body, request_text = self._browser_request_get(page_url, referer=self.base_url)
                    if request_status and request_text:
                        resp = type('R', (), {'status_code': request_status, 'text': request_text})()
                    else:
                        continue
            for href in self._extract_hrefs(resp.text):
                absolute = self._to_abs(href, page_url)
                if not self.MP3_PATTERN.search(absolute):
                    continue
                file_name = absolute.split("/")[-1].split("?")[0] or "liveatc.mp3"
                links[absolute] = HistoricalAudioLink(url=absolute, file_name=file_name)

            # 有些页面只显示文件名文本，不在 href 里；此处补充提取并拼接归档域名。
            for file_name in {m.group(1) for m in self.MP3_FILE_PATTERN.finditer(resp.text)}:
                for mount in self.mount_ids:
                    if file_name.lower().startswith(mount.lower()):
                        archive_dir = self._infer_archive_dir(station=mount, archive_identifier=file_name)
                        absolute = f"{self.archive_base_urls[0]}/{archive_dir}/{quote(file_name, safe='-_.()')}"
                        links[absolute] = HistoricalAudioLink(url=absolute, file_name=file_name)
            if "archive.php" in page_url.lower():
                archive_identifier = self._selected_archive_identifier(resp.text)
                if archive_identifier:
                    station = self._mount_from_archive_page_url(page_url)
                    for item in self._recent_archive_candidates(station=station, archive_identifier=archive_identifier):
                        links.setdefault(item.url, item)
        for mount, archive_identifier in zip(self.mount_ids, self.archive_file_prefixes):
            for item in self._recent_archive_candidates(station=mount, archive_identifier=archive_identifier):
                links.setdefault(item.url, item)
        return list(links.values())
