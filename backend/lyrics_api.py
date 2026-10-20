import asyncio
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from api_common import (
    LRCLIB_GET_URL, LRC_TIMESTAMP_RE, LyricsSaveRequest, http_client,
    require_api_token, require_write_access, search_synced_lyrics,
)
from music_library import (
    _contains_timed_lyrics, _find_record, _write_embedded_synced_lyrics,
    invalidate_catalog_cache,
)

router = APIRouter()

@router.get("/api/lyrics")
async def get_lyrics(
    track_id: str | None = Query(default=None, max_length=64),
    track_name: str = Query(default="", max_length=200),
    artist_name: str = Query(default="", max_length=200),
    album_name: str = Query(default="", max_length=200),
    duration: int | None = Query(default=None, ge=1, le=3600),
    synced_only: bool = Query(default=False),
    _: None = Depends(require_api_token),
) -> dict[str, Any]:
    local_plain: str | None = None
    local_plain_source: str | None = None
    if track_id:
        record = _find_record(track_id)
        track_name = record["title"]
        artist_name = record["artist"]
        album_name = record["album"]
        duration = record["durationSeconds"] or duration
        lrc_path: Path | None = record["_lyrics_lrc"]
        text_path: Path | None = record["_lyrics_text"]
        if lrc_path:
            return {"available": True, "source": "local_lrc", "syncedLyrics": lrc_path.read_text(encoding="utf-8", errors="replace"), "plainLyrics": None}
        embedded_lrc = record.get("_embedded_synced_lyrics")
        if embedded_lrc:
            return {"available": True, "source": "embedded_lrc", "syncedLyrics": embedded_lrc, "plainLyrics": None}
        if text_path:
            local_plain = text_path.read_text(encoding="utf-8", errors="replace") or None
            local_plain_source = "local_text" if local_plain else None
        if not local_plain:
            local_plain = record.get("_embedded_plain_lyrics") or None
            local_plain_source = "embedded_text" if local_plain else local_plain_source
        if local_plain and not synced_only:
            return {"available": True, "source": local_plain_source, "syncedLyrics": None, "plainLyrics": local_plain}

    if not track_name.strip() or not artist_name.strip():
        return {"available": bool(local_plain), "source": local_plain_source, "syncedLyrics": None, "plainLyrics": local_plain}

    params: dict[str, Any] = {"track_name": track_name.strip(), "artist_name": artist_name.strip()}
    if album_name.strip():
        params["album_name"] = album_name.strip()
    if duration:
        params["duration"] = duration

    lrclib_result: dict[str, Any] = {}
    lrclib_error: str | None = None
    try:
        response = await http_client.get(LRCLIB_GET_URL, params=params)
        if response.status_code == 429:
            lrclib_error = "LRCLIB is rate limited right now."
        elif response.status_code != 404:
            if response.is_error:
                lrclib_error = "LRCLIB is temporarily unavailable."
            else:
                lrclib_result = response.json()
    except httpx.HTTPError:
        lrclib_error = "Could not reach LRCLIB right now."

    synced = lrclib_result.get("syncedLyrics")
    plain = lrclib_result.get("plainLyrics") or local_plain
    if synced and _contains_timed_lyrics(synced):
        return {"available": True, "source": "lrclib", "syncedLyrics": synced, "plainLyrics": plain}
    if plain and not synced_only:
        source = "lrclib" if lrclib_result.get("plainLyrics") else local_plain_source
        return {"available": True, "source": source, "syncedLyrics": None, "plainLyrics": plain}

    if synced_only and search_synced_lyrics is not None:
        query = " ".join(part for part in (track_name.strip(), artist_name.strip(), album_name.strip()) if part)
        try:
            alternate_lrc = await asyncio.to_thread(
                search_synced_lyrics,
                query,
                synced_only=True,
                providers=["Musixmatch", "NetEase", "Megalobiz"],
            )
        except Exception:
            alternate_lrc = None
        if alternate_lrc and _contains_timed_lyrics(alternate_lrc):
            if duration:
                latest_ms = 0
                invalid_timestamp = False
                for minutes, seconds, fraction in LRC_TIMESTAMP_RE.findall(alternate_lrc):
                    if int(seconds) > 59:
                        invalid_timestamp = True
                        break
                    millis = int((fraction or "0").ljust(3, "0")[:3])
                    latest_ms = max(latest_ms, (int(minutes) * 60 + int(seconds)) * 1000 + millis)
                if invalid_timestamp or latest_ms > (duration + 15) * 1000:
                    alternate_lrc = None
            if alternate_lrc:
                return {"available": True, "source": "multi_provider", "syncedLyrics": alternate_lrc, "plainLyrics": plain}

    if synced_only and lrclib_error:
        raise HTTPException(status_code=503, detail=f"Lyrics lookup failed: {lrclib_error} Try again shortly.")
    return {
        "available": bool(plain),
        "source": local_plain_source or ("lrclib" if lrclib_result else None),
        "syncedLyrics": None,
        "plainLyrics": plain,
    }

@router.put("/api/lyrics/{track_id}")
async def save_synced_lyrics(
    track_id: str,
    body: LyricsSaveRequest,
    _: None = Depends(require_api_token),
    __: None = Depends(require_write_access),
) -> dict[str, Any]:
    record = _find_record(track_id)
    contents = body.syncedLyrics.strip()
    timed_lines = 0
    duration_seconds = int(record["durationSeconds"] or 0)

    for line in contents.splitlines():
        if not line.strip() or line.strip().lower().startswith(("[ar:", "[al:", "[ti:", "[au:", "[by:", "[re:", "[ve:", "[offset:", "[length:", "[la:", "[kana:", "[id:")):
            continue
        timestamps = list(LRC_TIMESTAMP_RE.finditer(line))
        lyric_text = LRC_TIMESTAMP_RE.sub("", line).strip()
        if not lyric_text:
            continue
        if not timestamps:
            raise HTTPException(status_code=422, detail="Every lyric line must have an LRC timestamp.")
        timed_lines += 1
        for match in timestamps:
            minutes, seconds, fraction = match.groups()
            if int(seconds) > 59:
                raise HTTPException(status_code=422, detail="LRC seconds must be between 00 and 59.")
            fraction_ms = int((fraction or "0").ljust(3, "0")[:3])
            time_ms = (int(minutes) * 60 + int(seconds)) * 1000 + fraction_ms
            if duration_seconds and time_ms > (duration_seconds + 15) * 1000:
                raise HTTPException(status_code=422, detail="The LRC timestamps exceed this track's duration.")

    if timed_lines == 0:
        raise HTTPException(status_code=422, detail="No timestamped lyric lines were found.")

    audio_path: Path = record["_path"]
    try:
        _write_embedded_synced_lyrics(audio_path, contents)
        sidecar_path = audio_path.with_suffix(".lrc")
        if sidecar_path.is_file():
            try:
                sidecar_path.unlink()
            except OSError:
                pass
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not embed LRC lyrics in this audio file; the original file was kept.",
        ) from exc

    invalidate_catalog_cache()
    return {"saved": True, "trackId": track_id, "lyricsAvailable": True, "embedded": True, "audioFile": audio_path.name}
