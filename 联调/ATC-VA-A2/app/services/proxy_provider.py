from __future__ import annotations

import asyncio
import random
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.core.config import settings


class ProxyProvider:
    def __init__(self) -> None:
        self._pool: list[str] = []
        self._cursor = 0
        self._last_refresh_at = 0.0
        self._cooldown_until: dict[str, float] = {}

    @staticmethod
    def _normalize_proxy(raw: str) -> str | None:
        value = (raw or "").strip()
        if not value:
            return None
        if "://" not in value:
            value = f"http://{value}"
        parsed = urlparse(value)
        if not parsed.hostname or not parsed.port:
            return None
        # 当前链路默认支持 HTTP(S) 代理；SOCKS 可后续扩展 requests[socks]
        if parsed.scheme not in {"http", "https"}:
            return None
        return value

    @staticmethod
    def redact(proxy: str) -> str:
        parsed = urlparse(proxy)
        if parsed.hostname:
            port = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{parsed.hostname}{port}"
        return proxy

    def _dedupe(self, proxies: list[str]) -> list[str]:
        out: list[str] = []
        seen = set()
        for p in proxies:
            if p not in seen:
                out.append(p)
                seen.add(p)
        return out

    def _load_static_pool(self) -> list[str]:
        path = Path(settings.a2_proxy_file)
        if not path.exists():
            return []
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
        proxies: list[str] = []
        for line in lines:
            p = self._normalize_proxy(line)
            if p:
                proxies.append(p)
        limit = max(settings.a2_proxy_static_limit, 1)
        return proxies[:limit]

    async def _fetch_api_pool(self) -> list[str]:
        if not settings.a2_proxy_api_enabled:
            return []
        params = {
            "protocol": settings.a2_proxy_api_protocol,
            "count": max(1, min(settings.a2_proxy_api_count, 20)),
        }
        cc = (settings.a2_proxy_api_country_code or "all").strip()
        if cc:
            params["country_code"] = cc

        timeout = httpx.Timeout(connect=8.0, read=8.0, write=8.0, pool=8.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(settings.a2_proxy_api_url, params=params)
            resp.raise_for_status()
            payload = resp.json()

        raw_items = (
            payload.get("data", {}).get("proxies", [])
            if isinstance(payload, dict)
            else []
        )
        proxies: list[str] = []
        for item in raw_items:
            p = self._normalize_proxy(str(item))
            if p:
                proxies.append(p)
        return proxies

    async def refresh(self, force: bool = False) -> None:
        if not settings.a2_proxy_enabled:
            self._pool = []
            return

        now = time.time()
        if not force:
            refresh_secs = max(settings.a2_proxy_api_refresh_seconds, 30)
            if now - self._last_refresh_at < refresh_secs:
                return

        source = (settings.a2_proxy_source or "static").strip().lower()
        static_pool: list[str] = []
        api_pool: list[str] = []

        if source in {"static", "mixed"}:
            static_pool = self._load_static_pool()
        if source in {"api", "mixed"}:
            try:
                api_pool = await self._fetch_api_pool()
            except Exception:
                api_pool = []

        self._pool = self._dedupe(static_pool + api_pool)
        self._last_refresh_at = now

    async def get_proxy(self) -> str | None:
        if not settings.a2_proxy_enabled:
            return None

        await self.refresh(force=False)
        if not self._pool:
            return None

        now = time.time()
        available = [p for p in self._pool if self._cooldown_until.get(p, 0.0) <= now]
        if not available:
            return None

        mode = (settings.a2_proxy_mode or "round_robin").strip().lower()
        candidates = list(available)
        if mode == "random":
            random.shuffle(candidates)
        else:
            start = self._cursor % len(candidates)
            candidates = candidates[start:] + candidates[:start]
            self._cursor += 1

        probe_limit = max(1, min(settings.a2_proxy_health_probe_attempts, len(candidates)))
        probe_candidates = candidates[:probe_limit]

        # Probe only a few candidates concurrently so selection stays fast.
        task_map = {asyncio.create_task(self._is_proxy_healthy(proxy)): proxy for proxy in probe_candidates}
        pending = set(task_map)
        try:
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for completed in done:
                    proxy = task_map[completed]
                    try:
                        if completed.result():
                            for remaining in pending:
                                remaining.cancel()
                            return proxy
                        self.report_result(proxy, False)
                    except Exception:
                        self.report_result(proxy, False)
        finally:
            for task in task_map:
                if not task.done():
                    task.cancel()
        return None

    async def _is_proxy_healthy(self, proxy: str) -> bool:
        timeout_secs = max(settings.a2_proxy_health_timeout_seconds, 1.0)
        timeout = httpx.Timeout(connect=timeout_secs, read=timeout_secs, write=timeout_secs, pool=timeout_secs)
        check_url = settings.a2_proxy_health_check_url
        try:
            async with httpx.AsyncClient(timeout=timeout, proxy=proxy) as client:
                resp = await client.get(check_url, follow_redirects=True)
                return resp.status_code < 400
        except Exception:
            return False

    def report_result(self, proxy: str | None, ok: bool) -> None:
        if not proxy:
            return
        if ok:
            self._cooldown_until.pop(proxy, None)
            return
        cooldown = max(settings.a2_proxy_fail_cooldown_seconds, 5)
        self._cooldown_until[proxy] = time.time() + cooldown


proxy_provider = ProxyProvider()
