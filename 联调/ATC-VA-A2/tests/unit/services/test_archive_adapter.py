"""Archive adapter stub tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.archive_adapter import ArchiveAdapterFactory, ArchiveLink, BroadcastifyAdapter, LiveATCAdapter, LocalMirrorAdapter

pytestmark = pytest.mark.unit


def _utc_now() -> datetime:
    return datetime(2024, 1, 1, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_liveatc_adapter_raises_not_implemented():
    adapter = LiveATCAdapter()
    link = ArchiveLink(url="http://example.com/a.mp3", file_name="a.mp3", source="liveatc")

    with pytest.raises(NotImplementedError):
        await adapter.authenticate({"cookie": "abc"})

    with pytest.raises(NotImplementedError):
        await adapter.probe_availability()

    with pytest.raises(NotImplementedError):
        await adapter.list_archives("VHHH", _utc_now(), _utc_now())

    with pytest.raises(NotImplementedError):
        await adapter.download(link, "/tmp/a.mp3")

    with pytest.raises(NotImplementedError):
        await adapter.download_stream(link)


@pytest.mark.asyncio
async def test_broadcastify_adapter_auth_and_stubbed_methods():
    adapter = BroadcastifyAdapter()
    link = ArchiveLink(url="http://example.com/b.mp3", file_name="b.mp3", source="broadcastify")

    assert await adapter.authenticate({"api_key": "key"}) is True
    assert await adapter.authenticate({"api_key": ""}) is False

    with pytest.raises(NotImplementedError):
        await adapter.probe_availability()

    with pytest.raises(NotImplementedError):
        await adapter.list_archives("VHHH", _utc_now(), _utc_now())

    with pytest.raises(NotImplementedError):
        await adapter.download(link, "/tmp/b.mp3")


@pytest.mark.asyncio
async def test_local_mirror_adapter_raises_not_implemented():
    adapter = LocalMirrorAdapter("https://mirror.example.com")
    link = ArchiveLink(url="http://example.com/c.mp3", file_name="c.mp3", source="mirror")

    assert await adapter.authenticate({}) is True

    with pytest.raises(NotImplementedError):
        await adapter.probe_availability()

    with pytest.raises(NotImplementedError):
        await adapter.list_archives("VHHH", _utc_now(), _utc_now())

    with pytest.raises(NotImplementedError):
        await adapter.download(link, "/tmp/c.mp3")


def test_archive_adapter_factory_creates_instances():
    factory = ArchiveAdapterFactory()

    assert factory.create("liveatc").name == "LiveATC"
    assert factory.create("broadcastify").name == "Broadcastify"
    mirror = factory.create("local_mirror", base_url="https://mirror.example.com")
    assert "LocalMirror" in mirror.name
