"""Audio slicing and merging service for the A-2 voice module."""

from __future__ import annotations

import contextlib
import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.config import settings
from app.core.time_utils import parse_datetime


@dataclass
class AudioClipSpec:
    """A source audio segment and the part needed in the final export."""

    path: Path
    clip_start_seconds: float
    clip_duration_seconds: float


class AudioService:
    def compose_time_range_audio(
        self,
        *,
        segments: list[dict],
        query_start: str,
        query_end: str,
        output_format: str,
    ) -> Path:
        """Slice overlapping segments and merge them into a target audio file."""

        if not segments:
            raise ValueError("No overlapping voice segments found for the requested range")
        specs = self._build_clip_specs(segments, query_start, query_end)
        if output_format == "wav" and all(spec.path.suffix.lower() == ".wav" for spec in specs):
            return self._compose_wav(specs)
        return self._compose_with_ffmpeg(specs, output_format)

    def _build_clip_specs(
        self, segments: list[dict], query_start: str, query_end: str
    ) -> list[AudioClipSpec]:
        start_dt = parse_datetime(query_start)
        end_dt = parse_datetime(query_end)
        specs: list[AudioClipSpec] = []
        for segment in segments:
            seg_start = parse_datetime(segment["start_at"])
            seg_end = parse_datetime(segment["end_at"])
            clip_start = max(start_dt, seg_start)
            clip_end = min(end_dt, seg_end)
            duration = (clip_end - clip_start).total_seconds()
            if duration <= 0:
                continue
            offset = (clip_start - seg_start).total_seconds()
            specs.append(AudioClipSpec(Path(segment["file_path"]), offset, duration))
        return specs

    def _compose_wav(self, specs: list[AudioClipSpec]) -> Path:
        output = settings.temp_root / f"slice_{specs[0].path.stem}_{len(specs)}.wav"
        output.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.ExitStack() as stack:
            wave_files = [stack.enter_context(wave.open(str(spec.path), "rb")) for spec in specs]
            params = wave_files[0].getparams()
            with wave.open(str(output), "wb") as writer:
                writer.setparams(params)
                for spec, wav_file in zip(specs, wave_files, strict=True):
                    frame_rate = wav_file.getframerate()
                    start_frame = int(spec.clip_start_seconds * frame_rate)
                    frame_count = int(spec.clip_duration_seconds * frame_rate)
                    wav_file.setpos(min(start_frame, wav_file.getnframes()))
                    writer.writeframes(wav_file.readframes(frame_count))
        return output

    def _compose_with_ffmpeg(self, specs: list[AudioClipSpec], output_format: str) -> Path:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError(
                "ffmpeg is required for mp3 slicing/merging or mixed audio formats, but it was not found"
            )

        final_path = settings.temp_root / f"slice_{specs[0].path.stem}_{len(specs)}.{output_format}"
        final_path.parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=settings.temp_root) as temp_dir:
            temp_dir_path = Path(temp_dir)
            part_files: list[Path] = []
            concat_file = temp_dir_path / "concat.txt"
            for index, spec in enumerate(specs, start=1):
                part_path = temp_dir_path / f"part_{index}.{output_format}"
                if output_format == "wav":
                    codec_args = ["-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000"]
                else:
                    codec_args = ["-acodec", "libmp3lame", "-q:a", "3"]

                # Decode sources before writing parts so MP3 downloads can become
                # real WAV files for browser waveform/playback and editing.
                try:
                    subprocess.run(
                        [
                            ffmpeg,
                            "-y",
                            "-ss",
                            str(spec.clip_start_seconds),
                            "-t",
                            str(spec.clip_duration_seconds),
                            "-i",
                            str(spec.path),
                            "-vn",
                            *codec_args,
                            str(part_path),
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                    )
                except (OSError, subprocess.CalledProcessError) as exc:
                    raise RuntimeError(f"failed to slice audio segment with ffmpeg: {exc}") from exc
                part_files.append(part_path)

            concat_file.write_text(
                "\n".join(f"file '{part.as_posix()}'" for part in part_files),
                encoding="utf-8",
            )
            try:
                subprocess.run(
                    [
                        ffmpeg,
                        "-y",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(concat_file),
                        "-c",
                        "copy",
                        str(final_path),
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
            except (OSError, subprocess.CalledProcessError) as exc:
                raise RuntimeError(f"failed to merge audio segments with ffmpeg: {exc}") from exc
        return final_path
