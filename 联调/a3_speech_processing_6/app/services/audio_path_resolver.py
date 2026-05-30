"""解析 A5/A2 录音的本地路径（支持 http media URL 下载缓存）。"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen

logger = logging.getLogger(__name__)


def resolve_local_audio_path(
    *,
    source_url: str | None,
    file_path: str | None = None,
    file_name: str | None = None,
    cache_dir: str | Path | None = None,
) -> tuple[str, bool]:
    """
    返回 (本地绝对路径, 是否为临时文件需在处理后删除)。
    """
    candidates: list[Path] = []
    if file_path:
        p = Path(file_path)
        candidates.append(p)
        if not p.is_absolute():
            candidates.append(Path.cwd() / p)

    url = (source_url or "").strip()
    if url.startswith("file://"):
        candidates.append(Path(url[7:]))

    for cand in candidates:
        try:
            resolved = cand.resolve()
            if resolved.is_file() and resolved.stat().st_size > 0:
                return str(resolved), False
        except OSError:
            continue

    if url.startswith("http://") or url.startswith("https://"):
        name = file_name or Path(url.split("?", 1)[0]).name or "audio.mp3"
        base = Path(cache_dir) if cache_dir else Path(tempfile.gettempdir()) / "a3_audio_cache"
        base.mkdir(parents=True, exist_ok=True)
        dest = base / name
        if dest.is_file() and dest.stat().st_size > 0:
            return str(dest.resolve()), False
        logger.info("[A3] 从 URL 下载音频: %s", url)
        with urlopen(url, timeout=180) as resp:
            dest.write_bytes(resp.read())
        if dest.stat().st_size == 0:
            raise FileNotFoundError(f"下载音频为空: {url}")
        return str(dest.resolve()), False

    raise FileNotFoundError(
        f"无法解析音频路径 source_url={source_url!r} file_path={file_path!r}"
    )
