"""Archive source adapter interfaces and implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator, Optional


@dataclass
class ArchiveLink:
    """Unified archive link format."""

    url: str
    file_name: str
    source: str
    size_bytes: Optional[int] = None
    start_time_utc: Optional[datetime] = None
    end_time_utc: Optional[datetime] = None
    metadata: Optional[dict] = None


class ArchiveAdapter(ABC):
    """Abstract base class for archive sources."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable adapter name."""
        pass

    @abstractmethod
    async def authenticate(self, credentials: dict) -> bool:
        """Authenticate with the source.

        Args:
            credentials: auth params (api_key, username, password, etc.)

        Returns:
            True if authenticated, False otherwise.
        """
        pass

    @abstractmethod
    async def probe_availability(self) -> bool:
        """Check if the source is currently available.

        Returns:
            True if reachable and healthy.
        """
        pass

    @abstractmethod
    async def list_archives(
        self, icao: str, start_date: datetime, end_date: datetime
    ) -> list[ArchiveLink]:
        """List available archives in date range.

        Args:
            icao: airport code (e.g., 'VHHH', 'KORD')
            start_date: inclusive start (UTC)
            end_date: inclusive end (UTC)

        Returns:
            List of ArchiveLink objects or empty list if none found.
        """
        pass

    @abstractmethod
    async def download(
        self, link: ArchiveLink, output_path: str
    ) -> tuple[bool, Optional[str]]:
        """Download a single archive.

        Args:
            link: ArchiveLink to download
            output_path: where to save file

        Returns:
            (success: bool, error_message: Optional[str])
        """
        pass

    async def download_stream(
        self, link: ArchiveLink, chunk_size: int = 65536
    ) -> AsyncIterator[bytes]:
        """Stream download for memory efficiency.

        Default implementation delegates to download() if not overridden.
        Yields bytes chunks from remote source.

        Args:
            link: ArchiveLink to stream
            chunk_size: bytes per chunk

        Yields:
            Raw bytes from the remote resource.
        """
        raise NotImplementedError(
            f"{self.name} does not support streaming; use download() instead"
        )


class LiveATCAdapter(ArchiveAdapter):
    """Adapter for LiveATC.net archives.

    Requires manual cookie injection or environment variable.
    Compliant usage recommended: follow their ToS and contact
    for API access if possible.
    """

    @property
    def name(self) -> str:
        return "LiveATC"

    async def authenticate(self, credentials: dict) -> bool:
        """Store cookie from credentials dict or env.

        Expected keys in credentials:
          - cookie: LiveATC session cookie string
          - icao: (optional) airport code to verify
        """
        # TODO: Implement using app/services/liveatc_client.py
        raise NotImplementedError("See liveatc_client.py for current implementation")

    async def probe_availability(self) -> bool:
        """Check if LiveATC main page is reachable."""
        # TODO: Use httpx + cloudscraper fallback
        raise NotImplementedError()

    async def list_archives(
        self, icao: str, start_date: datetime, end_date: datetime
    ) -> list[ArchiveLink]:
        """List archives from LiveATC for given airport and date range."""
        # TODO: Delegate to app/services/liveatc_client.py::list_historical_links
        raise NotImplementedError()

    async def download(
        self, link: ArchiveLink, output_path: str
    ) -> tuple[bool, Optional[str]]:
        """Download from link.url using stored cookie."""
        # TODO: Use httpx with cookie header + cloudscraper fallback
        raise NotImplementedError()


class BroadcastifyAdapter(ArchiveAdapter):
    """Adapter for Broadcastify official API.

    Requires subscription + API key.
    Reference: https://www.radioreference.com/forums/
    """

    @property
    def name(self) -> str:
        return "Broadcastify"

    async def authenticate(self, credentials: dict) -> bool:
        """Authenticate using API key.

        Expected keys:
          - api_key: Broadcastify API key (from developer portal)
          - api_secret: (optional) if OAuth flow required
        """
        self.api_key = credentials.get("api_key", "")
        self.api_secret = credentials.get("api_secret", "")
        if not self.api_key:
            return False
        # TODO: Verify key via probe request
        return True

    async def probe_availability(self) -> bool:
        """Check Broadcastify API health endpoint."""
        # TODO: GET https://api.broadcastify.com/health (or equivalent)
        raise NotImplementedError()

    async def list_archives(
        self, icao: str, start_date: datetime, end_date: datetime
    ) -> list[ArchiveLink]:
        """Query Broadcastify archive API.

        Note: Requires premium subscription.
        """
        # TODO: POST to Broadcastify API with date range, return archives
        raise NotImplementedError()

    async def download(
        self, link: ArchiveLink, output_path: str
    ) -> tuple[bool, Optional[str]]:
        """Download from Broadcastify presigned URL."""
        # TODO: Use httpx to GET link.url + save to output_path
        raise NotImplementedError()


class LocalMirrorAdapter(ArchiveAdapter):
    """Adapter for local/self-hosted mirror.

    Points to a configurable base URL (e.g., LIVEATC_ARCHIVE_BASE_URLS).
    Assumes mirror has same directory structure as LiveATC.
    """

    def __init__(self, base_url: str):
        """
        Args:
            base_url: base URL of mirror (e.g., https://your-mirror.example.com)
        """
        self.base_url = base_url.rstrip("/")

    @property
    def name(self) -> str:
        return f"LocalMirror ({self.base_url})"

    async def authenticate(self, credentials: dict) -> bool:
        """No auth needed for local mirror."""
        return True

    async def probe_availability(self) -> bool:
        """Check if mirror base URL is reachable."""
        # TODO: HEAD or GET base_url
        raise NotImplementedError()

    async def list_archives(
        self, icao: str, start_date: datetime, end_date: datetime
    ) -> list[ArchiveLink]:
        """List files in mirror that match date range.

        Assumes mirror has files in format:
          /archive_dir/STATIONCODE-Mon-DD-YYYY-HHMM.mp3
        """
        # TODO: DIR listing or manifest file
        raise NotImplementedError()

    async def download(
        self, link: ArchiveLink, output_path: str
    ) -> tuple[bool, Optional[str]]:
        """Download from mirror URL."""
        # TODO: GET (base_url + relative_path) and save
        raise NotImplementedError()


class ArchiveAdapterFactory:
    """Factory for selecting and instantiating adapters."""

    def __init__(self):
        self._adapters: dict[str, type[ArchiveAdapter]] = {
            "liveatc": LiveATCAdapter,
            "broadcastify": BroadcastifyAdapter,
            "local_mirror": LocalMirrorAdapter,
        }

    def create(self, adapter_type: str, **kwargs) -> ArchiveAdapter:
        """Create an adapter instance.

        Args:
            adapter_type: key from registry (liveatc, broadcastify, local_mirror)
            **kwargs: passed to adapter __init__

        Returns:
            ArchiveAdapter instance

        Raises:
            ValueError: if adapter_type not found
        """
        if adapter_type not in self._adapters:
            raise ValueError(
                f"Unknown adapter: {adapter_type}. Available: {list(self._adapters.keys())}"
            )
        cls = self._adapters[adapter_type]
        if adapter_type == "local_mirror":
            return cls(base_url=kwargs.get("base_url", "http://localhost"))
        return cls()

    def list_available(self) -> list[str]:
        """List all registered adapter types."""
        return list(self._adapters.keys())
