from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.core.config import settings
from app.services.liveatc_client import LiveATCHTTPClient

pytestmark = pytest.mark.unit


class _Resp:
    def __init__(self, text: str, status_code: int = 200, url: str = "https://www.liveatc.net"):
        self.text = text
        self.status_code = status_code
        self.url = url

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("GET", self.url)
            response = httpx.Response(self.status_code, request=request, text=self.text)
            raise httpx.HTTPStatusError("http error", request=request, response=response)


@pytest.mark.asyncio
async def test_build_search_url_uppercase_icao():
    client = LiveATCHTTPClient()
    assert client.build_search_url("vhhh") == "https://www.liveatc.net/search/?icao=VHHH"


@pytest.mark.asyncio
async def test_get_search_page_returns_url_and_html():
    client = LiveATCHTTPClient()
    http_client = AsyncMock()
    http_client.get = AsyncMock(return_value=_Resp("<html>ok</html>", 200))

    search_url, html = await client.get_search_page(http_client, "VHHH")

    assert search_url.endswith("icao=VHHH")
    assert html == "<html>ok</html>"


@pytest.mark.asyncio
async def test_resolve_realtime_stream_url():
    client = LiveATCHTTPClient()
    http_client = AsyncMock()
    http_client.get = AsyncMock(
        side_effect=[
            _Resp('<a href="/listen.php?icao=vhhh">listen</a>'),
            _Resp('<a href="https://audio.example/vhhh_stream.mp3">stream</a>'),
        ]
    )
    url = await client.resolve_realtime_stream_url(http_client, "VHHH")
    assert url == "https://audio.example/vhhh_stream.mp3"


@pytest.mark.asyncio
async def test_resolve_realtime_stream_url_direct_fallback():
    client = LiveATCHTTPClient()
    client.mount_ids = ["vhhh5"]
    http_client = AsyncMock()

    async def _fake_get(url: str, **kwargs):
        if url.endswith(".pls") or url.endswith(".m3u"):
            return _Resp("not found", status_code=404, url=url)
        if "search/?icao=" in url:
            return _Resp("not found", status_code=404, url=url)
        if "hlisten.php" in url:
            return _Resp("not found", status_code=404, url=url)
        if url == "https://d.liveatc.net/vhhh5":
            return _Resp("ok", status_code=200, url=url)
        return _Resp("not found", status_code=404, url=url)

    http_client.get = AsyncMock(side_effect=_fake_get)
    with patch.object(client, "_probe_stream_url", new=AsyncMock(return_value=True)) as mocked_probe:
        url = await client.resolve_realtime_stream_url(http_client, "VHHH")

    assert url == "https://d.liveatc.net/vhhh5"
    mocked_probe.assert_awaited_once_with(http_client, "https://d.liveatc.net/vhhh5")


@pytest.mark.asyncio
async def test_list_historical_links(override_settings):
    override_settings(a2_liveatc_archive_file_prefixes="")
    client = LiveATCHTTPClient()
    http_client = AsyncMock()
    http_client.get = AsyncMock(
        side_effect=[
            _Resp("blocked", status_code=403, url="https://www.liveatc.net/search/?icao=VHHH"),
            _Resp('<a href="/recordings/abc.mp3">abc</a><a href="/recordings/def.mp3">def</a>'),
            _Resp("index"),
        ]
    )
    links = await client.list_historical_links(http_client, "VHHH")
    urls = sorted(item.url for item in links)
    assert urls == [
        "https://www.liveatc.net/recordings/abc.mp3",
        "https://www.liveatc.net/recordings/def.mp3",
    ]


@pytest.mark.asyncio
async def test_list_historical_links_from_plain_filename_text(override_settings):
    override_settings(a2_liveatc_archive_file_prefixes="")
    client = LiveATCHTTPClient()
    http_client = AsyncMock()
    http_client.get = AsyncMock(
        side_effect=[
            _Resp("blocked", status_code=403, url="https://www.liveatc.net/search/?icao=VHHH"),
            _Resp("VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0000Z.mp3 (31:56)"),
            _Resp("index"),
        ]
    )
    links = await client.list_historical_links(http_client, "VHHH")
    urls = sorted(item.url for item in links)
    assert (
        "https://archive.liveatc.net/vhhh/VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0000Z.mp3" in urls
    )


@pytest.mark.asyncio
async def test_list_historical_links_generates_recent_archive_candidates(override_settings):
    override_settings(
        a2_liveatc_archive_file_prefixes="VHHH5-App-Dep-Dir-Zone",
        a2_historical_candidate_slots=2,
    )
    client = LiveATCHTTPClient()
    http_client = AsyncMock()
    http_client.get = AsyncMock(
        side_effect=[
            _Resp("blocked", status_code=403, url="https://www.liveatc.net/search/?icao=VHHH"),
            _Resp("blocked", status_code=403, url="https://www.liveatc.net/archive.php?m=vhhh5"),
            _Resp("index"),
        ]
    )

    links = await client.list_historical_links(http_client, "VHHH")

    assert len(links) == 2
    assert all(item.url.startswith("https://archive.liveatc.net/vhhh/") for item in links)
    assert all(item.file_name.startswith("VHHH5-App-Dep-Dir-Zone-") for item in links)


@pytest.mark.network
@pytest.mark.asyncio
async def test_resolve_realtime_stream_url_real_network(network_guard):
    client = LiveATCHTTPClient()
    headers = {
        "User-Agent": settings.a2_http_user_agent,
        "Accept-Language": settings.a2_http_accept_language,
    }
    timeout = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0)

    async with httpx.AsyncClient(timeout=timeout, headers=headers, trust_env=False) as http_client:
        url = await network_guard(client.resolve_realtime_stream_url(http_client, settings.a2_icao_code))

    assert url is None or url.startswith("http")


@pytest.mark.network
@pytest.mark.asyncio
async def test_list_historical_links_real_network(network_guard):
    client = LiveATCHTTPClient()
    headers = {
        "User-Agent": settings.a2_http_user_agent,
        "Accept-Language": settings.a2_http_accept_language,
    }
    timeout = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0)

    async with httpx.AsyncClient(timeout=timeout, headers=headers, trust_env=False) as http_client:
        links = await network_guard(client.list_historical_links(http_client, settings.a2_icao_code))

    assert isinstance(links, list)
    if links:
        assert links[0].url.startswith("http")
        assert links[0].file_name.lower().endswith(".mp3")
