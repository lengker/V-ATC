from __future__ import annotations

import os
import random
from pathlib import Path
from urllib.parse import urlparse


def normalize_proxy(proxy: str | None) -> str | None:
    if not proxy:
        return None
    proxy = proxy.strip()
    if not proxy:
        return None
    if '://' not in proxy:
        proxy = f"http://{proxy}"
    return proxy


def redact_proxy(proxy: str) -> str:
    try:
        parsed = urlparse(proxy)
        if parsed.hostname:
            scheme = parsed.scheme or 'http'
            port = f":{parsed.port}" if parsed.port else ''
            return f"{scheme}://{parsed.hostname}{port}"
    except Exception:
        pass
    if '@' in proxy:
        return proxy.split('@', 1)[1]
    return proxy


def load_proxy_pool(cli_proxy: str | None, cli_proxy_file: str | None) -> list[str]:
    proxies: list[str] = []

    pool_str = (cli_proxy or os.environ.get('LIVEATC_PROXY_POOL', '')).strip()
    pool_file = (cli_proxy_file or os.environ.get('LIVEATC_PROXY_FILE', '')).strip()

    if pool_str:
        if '\n' in pool_str:
            parts = [p.strip() for p in pool_str.splitlines()]
        else:
            parts = [p.strip() for p in pool_str.split(',')]
        for p in parts:
            norm = normalize_proxy(p)
            if norm:
                proxies.append(norm)

    if pool_file:
        path = Path(pool_file)
        if path.exists():
            lines = [l.strip() for l in path.read_text(encoding='utf-8').splitlines()]
            for l in lines:
                norm = normalize_proxy(l)
                if norm:
                    proxies.append(norm)

    unique: list[str] = []
    seen = set()
    for p in proxies:
        if p not in seen:
            unique.append(p)
            seen.add(p)
    return unique


class ProxyPool:
    def __init__(self, proxies: list[str], mode: str = 'round_robin'):
        self.proxies = proxies
        self.mode = mode
        self._index = 0

    def pick(self) -> str | None:
        if not self.proxies:
            return None
        if self.mode == 'random':
            return random.choice(self.proxies)
        proxy = self.proxies[self._index % len(self.proxies)]
        self._index += 1
        return proxy

    def to_requests_proxies(self, proxy: str | None) -> dict | None:
        if not proxy:
            return None
        return {"http": proxy, "https": proxy}
