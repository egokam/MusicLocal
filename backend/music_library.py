import base64
import hashlib
import json
import mimetypes
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from mutagen import File as MutagenFile
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, SYLT, TXXX, USLT
from mutagen.mp3 import MP3
from mutagen.mp4 import AtomDataType, MP4, MP4Cover, MP4FreeForm
from mutagen.oggflac import OggFLAC
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis

from api_common import AUDIO_EXTENSIONS, LRC_TIMESTAMP_RE, MUSIC_DIR, PUBLIC_API_BASE, READ_ONLY_MODE

track_cache: dict[str, dict[str, Any]] = {}
cache_expires_at = 0.0


def invalidate_catalog_cache() -> None:
    global cache_expires_at
    cache_expires_at = 0.0

def _tag_value(tags: Any, *keys: str, default: str = "") -> str:
    if not tags:
        return default
    for key in keys:
        value = tags.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            value = value[0] if value else ""
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        value = str(value).strip()
        if value:
            return value
    return default

def _embedded_lyrics(easy_tags: Any, raw_tags: Any) -> str:
    candidates: list[str] = []
    try:
        text = _tag_value(easy_tags, "lyrics", "unsyncedlyrics", "unsynced lyrics", "©lyr")
        if text:
            candidates.append(text)
        if raw_tags and hasattr(raw_tags, "getall"):
            for entry in raw_tags.getall("USLT"):
                text = str(getattr(entry, "text", "")).strip()
                if text:
                    candidates.append(text)
            for entry in raw_tags.getall("SYLT"):
                if getattr(entry, "format", 0) != 2:
                    continue
                lines: list[str] = []
                for lyric_text, timestamp_ms in getattr(entry, "text", []):
                    if not str(lyric_text).strip():
                        continue
                    timestamp_ms = max(0, int(timestamp_ms))
                    minutes = timestamp_ms // 60_000
                    seconds = (timestamp_ms // 1_000) % 60
                    milliseconds = timestamp_ms % 1_000
                    lines.append(f"[{minutes:02d}:{seconds:02d}.{milliseconds:03d}]{lyric_text}")
                if lines:
                    candidates.append("\n".join(lines))
        if raw_tags:
            for key in ("©lyr", "LYRICS", "lyrics"):
                value = raw_tags.get(key)
                if isinstance(value, (list, tuple)):
                    value = value[0] if value else ""
                if isinstance(value, bytes):
                    value = value.decode("utf-8", "replace")
                if isinstance(value, str) and value.strip():
                    candidates.append(value.strip())
    except Exception:
        pass

    for candidate in candidates:
        if _contains_timed_lyrics(candidate):
            return candidate
    return candidates[0] if candidates else ""

def _contains_timed_lyrics(contents: str) -> bool:
    for line in contents.splitlines():
        if LRC_TIMESTAMP_RE.search(line) and LRC_TIMESTAMP_RE.sub("", line).strip():
            return True
    return False

def _lrc_entries(contents: str, duration_seconds: float = 0) -> list[tuple[str, int]]:
    entries: list[tuple[str, int]] = []
    previous_timestamp = -1
    for line in contents.splitlines():
        timestamps = list(LRC_TIMESTAMP_RE.finditer(line))
        lyric_text = LRC_TIMESTAMP_RE.sub("", line).strip()
        if not timestamps or not lyric_text:
            continue
        for match in timestamps:
            minutes, seconds, fraction = match.groups()
            if int(seconds) > 59:
                raise ValueError("LRC seconds must be between 00 and 59.")
            milliseconds = int((fraction or "0").ljust(3, "0")[:3])
            timestamp_ms = (int(minutes) * 60 + int(seconds)) * 1000 + milliseconds
            if timestamp_ms < previous_timestamp:
                raise ValueError("LRC lines must be in time order.")
            if duration_seconds and timestamp_ms > (duration_seconds + 15) * 1000:
                raise ValueError("LRC timestamps exceed this track's duration.")
            entries.append((lyric_text, timestamp_ms))
            previous_timestamp = timestamp_ms
    if not entries:
        raise ValueError("No timestamped lyric lines were found.")
    return entries

def _write_embedded_synced_lyrics(audio_path: Path, contents: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=str(audio_path.parent),
        prefix=".musiqapp-embed-",
        suffix=audio_path.suffix,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(audio_path, temporary_path)
        audio = MutagenFile(str(temporary_path), easy=False)
        if audio is None:
            raise ValueError("The VPS could not read this audio file's metadata.")
        duration_seconds = float(getattr(getattr(audio, "info", None), "length", 0) or 0)
        entries = _lrc_entries(contents, duration_seconds)

        if isinstance(audio, MP3):
            if audio.tags is None:
                audio.add_tags()
            tags = audio.tags
            plain_lyrics = [
                str(frame.text).strip()
                for frame in tags.getall("USLT")
                if str(getattr(frame, "text", "")).strip()
                and not _contains_timed_lyrics(str(frame.text))
            ]
            if plain_lyrics:
                tags.delall("TXXX:MUSIQAPP_PLAIN_LYRICS")
                tags.add(TXXX(
                    encoding=3,
                    desc="MUSIQAPP_PLAIN_LYRICS",
                    text="\n".join(plain_lyrics),
                ))
            tags.delall("USLT")
            tags.delall("SYLT")
            tags.add(USLT(encoding=3, lang="eng", desc="Musiqapp LRC", text=contents))
            tags.add(SYLT(
                encoding=3,
                lang="eng",
                format=2,
                type=1,
                desc="Musiqapp",
                text=entries,
            ))
            audio.save(v2_version=4)
        elif isinstance(audio, MP4):
            if audio.tags is None:
                audio.add_tags()
            tags = audio.tags
            old_lyrics = tags.get("©lyr", [])
            old_text = "\n".join(str(value) for value in old_lyrics).strip()
            if old_text and not _contains_timed_lyrics(old_text):
                tags["----:com.apple.iTunes:MUSIQAPP_PLAIN_LYRICS"] = [
                    MP4FreeForm(old_text.encode("utf-8"), dataformat=AtomDataType.UTF8)
                ]
            tags["©lyr"] = [contents]
            audio.save()
        elif isinstance(audio, (FLAC, OggVorbis, OggOpus, OggFLAC)):
            if audio.tags is None:
                audio.add_tags()
            tags = audio.tags
            old_lyrics = tags.get("lyrics") or tags.get("LYRICS") or []
            old_text = "\n".join(str(value) for value in old_lyrics).strip()
            if old_text and not _contains_timed_lyrics(old_text):
                tags["MUSIQAPP_PLAIN_LYRICS"] = [old_text]
            tags["LYRICS"] = [contents]
            audio.save()
        else:
            raise ValueError("This VPS audio format does not support embedded lyrics.")

        verified_audio = MutagenFile(str(temporary_path), easy=True)
        verified_raw = MutagenFile(str(temporary_path), easy=False)
        verified_lyrics = _embedded_lyrics(
            getattr(verified_audio, "tags", None),
            getattr(verified_raw, "tags", None),
        )
        if not _contains_timed_lyrics(verified_lyrics):
            raise ValueError("The embedded lyrics could not be verified; the original audio was kept.")
        os.replace(temporary_path, audio_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

def _write_embedded_plain_lyrics(audio_path: Path, contents: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=str(audio_path.parent), prefix=".musiqapp-plain-lyrics-", suffix=audio_path.suffix,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(audio_path, temporary_path)
        audio = MutagenFile(str(temporary_path), easy=False)
        if audio is None:
            raise ValueError("The VPS could not read this audio file's metadata.")
        contents = contents.strip()
        if isinstance(audio, MP3):
            if audio.tags is None:
                audio.add_tags()
            audio.tags.delall("USLT")
            audio.tags.delall("SYLT")
            if contents:
                audio.tags.add(USLT(encoding=3, lang="eng", desc="Musiqapp", text=contents))
            audio.save(v2_version=4)
        elif isinstance(audio, MP4):
            if audio.tags is None:
                audio.add_tags()
            if contents:
                audio.tags["©lyr"] = [contents]
            else:
                audio.tags.pop("©lyr", None)
            audio.save()
        elif isinstance(audio, (FLAC, OggVorbis, OggOpus, OggFLAC)):
            if audio.tags is None:
                audio.add_tags()
            audio.tags.pop("lyrics", None)
            audio.tags.pop("LYRICS", None)
            if contents:
                audio.tags["lyrics"] = [contents]
            audio.save()
        else:
            raise ValueError("This VPS audio format does not support embedded lyrics.")

        if contents:
            verified = MutagenFile(str(temporary_path), easy=True)
            raw_verified = MutagenFile(str(temporary_path), easy=False)
            saved_lyrics = _embedded_lyrics(
                getattr(verified, "tags", None), getattr(raw_verified, "tags", None),
            )
            if saved_lyrics.strip() != contents:
                raise ValueError("Embedded lyrics could not be verified; the original audio was kept.")
        os.replace(temporary_path, audio_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _format_duration(seconds: float) -> str:
    total = max(0, int(seconds))
    return f"{total // 60}:{total % 60:02d}"

def _artwork_file(audio_path: Path) -> Path | None:
    candidates = [
        audio_path.with_suffix(".jpg"), audio_path.with_suffix(".jpeg"), audio_path.with_suffix(".png"),
        audio_path.parent / "cover.jpg", audio_path.parent / "cover.jpeg", audio_path.parent / "cover.png",
        audio_path.parent / "folder.jpg", audio_path.parent / "folder.png",
    ]
    return next((candidate for candidate in candidates if candidate.is_file()), None)

def _embedded_cover(audio_path: Path) -> tuple[bytes, str] | None:
    try:
        audio = MutagenFile(str(audio_path))
        if not audio:
            return None
        tags = audio.tags
        if not tags:
            return None
        if hasattr(tags, "getall"):
            pictures = tags.getall("APIC")
            if pictures:
                picture = pictures[0]
                return picture.data, picture.mime or "image/jpeg"
        pictures = getattr(audio, "pictures", None)
        if pictures:
            picture = pictures[0]
            return picture.data, picture.mime or "image/jpeg"
        for key in ("covr", "metadata_block_picture", "coverart"):
            values = tags.get(key)
            if not values:
                continue
            value = values[0] if isinstance(values, (list, tuple)) else values
            if key == "covr":
                data = bytes(value)
                mime = "image/png" if getattr(value, "imageformat", 0) == 2 else "image/jpeg"
                return data, mime
            decoded = base64.b64decode(value)
            if key == "coverart":
                return decoded, "image/jpeg"
            picture = Picture(decoded)
            return picture.data, picture.mime or "image/jpeg"
    except Exception:
        return None
    return None

def _build_record(path: Path) -> dict[str, Any] | None:
    relative_path = path.relative_to(MUSIC_DIR).as_posix()
    track_id = hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:24]
    metadata_path = path.with_suffix(path.suffix + ".musiqapp.json")
    metadata: dict[str, Any] = {}
    try:
        if metadata_path.is_file():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        metadata = {}

    tags = None
    raw_tags = None
    try:
        audio = MutagenFile(str(path), easy=True)
        raw_audio = MutagenFile(str(path))
        info = audio.info if audio else (raw_audio.info if raw_audio else None)
        duration_seconds = int(getattr(info, "length", 0) or 0)
        tags = audio.tags if audio else None
        raw_tags = raw_audio.tags if raw_audio else None
        title = str(metadata.get("title") or _tag_value(tags, "title", default=path.stem.replace("_", " ")))
        artist = str(metadata.get("artist") or _tag_value(tags, "artist", "albumartist", default="Unknown Artist"))
        album = str(metadata.get("album") or _tag_value(tags, "album", default=""))
    except Exception:
        duration_seconds = 0
        title = str(metadata.get("title") or path.stem.replace("_", " "))
        artist = str(metadata.get("artist") or "Unknown Artist")
        album = str(metadata.get("album") or "")

    lyrics_lrc = path.with_suffix(".lrc")
    lyrics_text = path.with_suffix(".txt")
    embedded_lyrics = _embedded_lyrics(tags, raw_tags)
    embedded_is_synced = _contains_timed_lyrics(embedded_lyrics)
    embedded_plain = embedded_lyrics if not embedded_is_synced else ""
    sidecar_lrc_text: str | None = None
    if lyrics_lrc.is_file():
        try:
            candidate_lrc = lyrics_lrc.read_text(encoding="utf-8", errors="replace")
            if _contains_timed_lyrics(candidate_lrc):
                sidecar_lrc_text = candidate_lrc
        except OSError:
            pass
    has_synced_lyrics = bool(sidecar_lrc_text or embedded_is_synced)
    try:
        has_plain_lyrics = bool(embedded_plain) or (lyrics_text.is_file() and lyrics_text.stat().st_size > 0)
    except OSError:
        has_plain_lyrics = bool(embedded_plain)
    artwork_path = _artwork_file(path)
    relative_url = f"/api/artwork/{track_id}"
    try:
        file_stat = path.stat()
        fallback_date_added = int(getattr(file_stat, "st_birthtime", file_stat.st_ctime) * 1000)
        date_added = int(float(metadata.get("dateAdded", fallback_date_added)))
    except (OSError, TypeError, ValueError):
        date_added = None
    return {
        "id": f"local:{track_id}",
        "provider": "local",
        "providerId": track_id,
        "title": title,
        "artist": artist,
        "album": album,
        "duration": _format_duration(duration_seconds),
        "durationSeconds": duration_seconds,
        "dateAdded": date_added,
        "fileExtension": path.suffix.lower(),
        "artwork": str(metadata.get("artworkUrl") or (f"{PUBLIC_API_BASE}{relative_url}" if (artwork_path or _embedded_cover(path)) else "")),
        "streamUrl": f"{PUBLIC_API_BASE}/api/audio/{track_id}",
        "downloadUrl": f"{PUBLIC_API_BASE}/api/download/{track_id}",
        "downloadAllowed": True,
        "lyricsAvailable": has_synced_lyrics or has_plain_lyrics,
        "hasSyncedLyrics": has_synced_lyrics,
        "hasPlainLyrics": has_plain_lyrics,
        "_path": path,
        "_artwork_path": artwork_path,
        "_lyrics_lrc": lyrics_lrc if sidecar_lrc_text else None,
        "_lyrics_text": lyrics_text if lyrics_text.is_file() else None,
        "_embedded_synced_lyrics": embedded_lyrics if embedded_is_synced else None,
        "_embedded_plain_lyrics": embedded_plain,
    }

def _all_records() -> list[dict[str, Any]]:
    global cache_expires_at, track_cache
    now = time.monotonic()
    if now < cache_expires_at:
        return list(track_cache.values())
    if not MUSIC_DIR.is_dir():
        if READ_ONLY_MODE:
            return []
        MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    records: dict[str, dict[str, Any]] = {}
    for path in MUSIC_DIR.rglob("*"):
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS and not path.name.startswith("."):
            record = _build_record(path)
            if record:
                records[record["providerId"]] = record
    track_cache = records
    cache_expires_at = now + 8.0
    return list(records.values())

def _find_record(track_id: str) -> dict[str, Any]:
    record = next((item for item in _all_records() if item["providerId"] == track_id or item["id"] == track_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Track was not found in the private library.")
    return record

def _public_track(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if not key.startswith("_")}
