import json
import os
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api_common import MUSIC_DIR, PUBLIC_API_BASE, require_api_token
from music_library import (
    _all_records,
    _contains_timed_lyrics,
    _find_record,
    _public_track,
    _write_embedded_plain_lyrics,
    _write_embedded_synced_lyrics,
    invalidate_catalog_cache,
)

router = APIRouter()
STATE_DB = Path(os.environ.get("MUSIQAPP_LIBRARY_STATE_DB", str(Path(__file__).resolve().parent / "library_state.sqlite3")))
PLAYLIST_COVERS_DIR = Path(__file__).resolve().parent / "playlist-covers"
MAX_PLAYLIST_COVER_BYTES = 10 * 1024 * 1024


class FavoriteRequest(BaseModel):
    isFavorite: bool


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PlaylistTrackRequest(BaseModel):
    trackId: str = Field(min_length=1, max_length=64)


class TrackEditRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    artist: str | None = Field(default=None, max_length=200)
    album: str | None = Field(default=None, max_length=200)
    artworkUrl: str | None = Field(default=None, max_length=2048)
    lyrics: str | None = Field(default=None, max_length=500_000)


def _connect() -> sqlite3.Connection:
    STATE_DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(STATE_DB, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS favorites (
            track_id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            cover_path TEXT
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (playlist_id, track_id)
        );
        """
    )
    playlist_columns = {row[1] for row in connection.execute("PRAGMA table_info(playlists)")}
    if "cover_path" not in playlist_columns:
        connection.execute("ALTER TABLE playlists ADD COLUMN cover_path TEXT")
    return connection


def favorite_track_ids() -> set[str]:
    with _connect() as connection:
        return {row["track_id"] for row in connection.execute("SELECT track_id FROM favorites")}


def _get_playlist(playlist_id: str) -> sqlite3.Row:
    with _connect() as connection:
        row = connection.execute("SELECT id, name, created_at, cover_path FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Playlist was not found.")
    return row


def _playlist_cover_url(playlist_id: str, cover_path: str | None) -> str | None:
    if not cover_path:
        return None
    path = Path(cover_path)
    if not path.is_file():
        return None
    return f"{PUBLIC_API_BASE}/api/playlists/{playlist_id}/cover?v={path.stat().st_mtime_ns}"


def _track_id(value: str) -> str:
    return _find_record(value)["providerId"]


@router.get("/api/library/favorites")
def list_favorites(_: None = Depends(require_api_token)) -> dict[str, Any]:
    with _connect() as connection:
        ids = [row["track_id"] for row in connection.execute("SELECT track_id FROM favorites ORDER BY created_at DESC")]
    by_id = {record["providerId"]: record for record in _all_records()}
    items = [
        {**_public_track(by_id[track_id]), "isFavorite": True}
        for track_id in ids
        if track_id in by_id
    ]
    return {"items": items}


@router.put("/api/library/favorites/{track_id}")
def set_favorite(track_id: str, body: FavoriteRequest, _: None = Depends(require_api_token)) -> dict[str, Any]:
    track_id = _track_id(track_id)
    with _connect() as connection:
        if body.isFavorite:
            connection.execute("INSERT OR IGNORE INTO favorites(track_id, created_at) VALUES (?, ?)", (track_id, int(time.time())))
        else:
            connection.execute("DELETE FROM favorites WHERE track_id = ?", (track_id,))
    return {"trackId": track_id, "isFavorite": body.isFavorite}


@router.get("/api/playlists")
def list_playlists(_: None = Depends(require_api_token)) -> dict[str, Any]:
    with _connect() as connection:
        rows = connection.execute(
            """SELECT p.id, p.name, p.created_at, p.cover_path, COUNT(pt.track_id) AS trackCount
               FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
               GROUP BY p.id ORDER BY p.created_at DESC, p.name COLLATE NOCASE"""
        ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        cover_path = item.pop("cover_path", None)
        item["coverUrl"] = _playlist_cover_url(item["id"], cover_path)
        items.append(item)
    return {"items": items}


@router.post("/api/playlists")
def create_playlist(body: PlaylistCreateRequest, _: None = Depends(require_api_token)) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Enter a playlist name.")
    playlist_id = uuid.uuid4().hex
    with _connect() as connection:
        connection.execute("INSERT INTO playlists(id, name, created_at) VALUES (?, ?, ?)", (playlist_id, name, int(time.time())))
    return {"id": playlist_id, "name": name, "trackCount": 0, "coverUrl": None}


@router.put("/api/playlists/{playlist_id}/cover")
async def upload_playlist_cover(playlist_id: str, request: Request, _: None = Depends(require_api_token)) -> dict[str, Any]:
    playlist = _get_playlist(playlist_id)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    extension = extensions.get(content_type)
    if not extension:
        raise HTTPException(status_code=415, detail="Use a JPEG, PNG, or WebP playlist cover.")

    image = await request.body()
    if not image or len(image) > MAX_PLAYLIST_COVER_BYTES:
        raise HTTPException(status_code=413, detail="Playlist cover must be smaller than 10 MB.")
    valid_signature = (
        (content_type == "image/jpeg" and image.startswith(b"\xff\xd8\xff"))
        or (content_type == "image/png" and image.startswith(b"\x89PNG\r\n\x1a\n"))
        or (content_type == "image/webp" and image[:4] == b"RIFF" and image[8:12] == b"WEBP")
    )
    if not valid_signature:
        raise HTTPException(status_code=415, detail="The uploaded file does not match its image type.")

    PLAYLIST_COVERS_DIR.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=str(PLAYLIST_COVERS_DIR), prefix=".playlist-cover-")
    try:
        with os.fdopen(descriptor, "wb") as image_file:
            image_file.write(image)
        destination = PLAYLIST_COVERS_DIR / f"{playlist_id}{extension}"
        os.replace(temporary_name, destination)
        old_cover = Path(playlist["cover_path"]) if playlist["cover_path"] else None
        with _connect() as connection:
            connection.execute("UPDATE playlists SET cover_path = ? WHERE id = ?", (str(destination), playlist_id))
        if old_cover and old_cover != destination:
            try:
                old_cover.unlink(missing_ok=True)
            except OSError:
                pass
    finally:
        Path(temporary_name).unlink(missing_ok=True)

    return {"coverUrl": _playlist_cover_url(playlist_id, str(destination))}


@router.get("/api/playlists/{playlist_id}/cover")
def get_playlist_cover(playlist_id: str, _: None = Depends(require_api_token)) -> FileResponse:
    playlist = _get_playlist(playlist_id)
    cover_path = playlist["cover_path"]
    if not cover_path:
        raise HTTPException(status_code=404, detail="This playlist has no cover image.")
    path = Path(cover_path).resolve()
    try:
        path.relative_to(PLAYLIST_COVERS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Playlist cover was not found.") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Playlist cover was not found.")
    media_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/api/playlists/{playlist_id}")
def get_playlist(playlist_id: str, _: None = Depends(require_api_token)) -> dict[str, Any]:
    playlist = _get_playlist(playlist_id)
    with _connect() as connection:
        ids = [row["track_id"] for row in connection.execute(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, created_at",
            (playlist_id,),
        )]
    by_id = {record["providerId"]: record for record in _all_records()}
    items = [_public_track(by_id[track_id]) for track_id in ids if track_id in by_id]
    return {
        "id": playlist["id"],
        "name": playlist["name"],
        "coverUrl": _playlist_cover_url(playlist_id, playlist["cover_path"]),
        "trackCount": len(items),
        "items": items,
    }


@router.post("/api/playlists/{playlist_id}/tracks")
def add_playlist_track(playlist_id: str, body: PlaylistTrackRequest, _: None = Depends(require_api_token)) -> dict[str, Any]:
    _get_playlist(playlist_id)
    track_id = _track_id(body.trackId)
    with _connect() as connection:
        next_position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()[0]
        cursor = connection.execute(
            "INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position, created_at) VALUES (?, ?, ?, ?)",
            (playlist_id, track_id, next_position, int(time.time())),
        )
        added = cursor.rowcount > 0
    return {"playlistId": playlist_id, "trackId": track_id, "added": added}


@router.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def remove_playlist_track(playlist_id: str, track_id: str, _: None = Depends(require_api_token)) -> dict[str, Any]:
    _get_playlist(playlist_id)
    with _connect() as connection:
        connection.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
    return {"playlistId": playlist_id, "trackId": track_id, "removed": True}


@router.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str, _: None = Depends(require_api_token)) -> dict[str, Any]:
    playlist = _get_playlist(playlist_id)
    with _connect() as connection:
        connection.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    if playlist["cover_path"]:
        try:
            Path(playlist["cover_path"]).unlink(missing_ok=True)
        except OSError:
            pass
    return {"deleted": True, "playlistId": playlist_id}


@router.put("/api/tracks/{track_id}")
def edit_track(track_id: str, body: TrackEditRequest, _: None = Depends(require_api_token)) -> dict[str, Any]:
    record = _find_record(track_id)
    metadata_path: Path = record["_path"].with_suffix(record["_path"].suffix + ".musiqapp.json")
    metadata: dict[str, Any] = {}
    try:
        if metadata_path.is_file():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        metadata = {}

    for field in ("title", "artist", "album"):
        value = getattr(body, field)
        if value is not None:
            value = value.strip()
            if field in ("title", "artist") and not value:
                raise HTTPException(status_code=422, detail=f"{field.title()} cannot be empty.")
            metadata[field] = value

    if body.artworkUrl is not None:
        artwork_url = body.artworkUrl.strip()
        if artwork_url:
            parsed = urlparse(artwork_url)
            if parsed.scheme != "https" or not parsed.hostname:
                raise HTTPException(status_code=422, detail="Artwork must be an HTTPS image URL.")
            metadata["artworkUrl"] = artwork_url
        else:
            metadata.pop("artworkUrl", None)

    if body.lyrics is not None:
        lyrics = body.lyrics.strip()
        try:
            if lyrics and _contains_timed_lyrics(lyrics):
                _write_embedded_synced_lyrics(record["_path"], lyrics)
            else:
                _write_embedded_plain_lyrics(record["_path"], lyrics)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not update lyrics; the original audio was kept.") from exc
        for suffix in (".lrc", ".txt"):
            sidecar = record["_path"].with_suffix(suffix)
            try:
                sidecar.unlink(missing_ok=True)
            except OSError:
                pass

    descriptor, temporary_name = tempfile.mkstemp(dir=str(metadata_path.parent), prefix=".musiqapp-meta-")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as metadata_file:
            json.dump(metadata, metadata_file, ensure_ascii=False, indent=2)
        os.replace(temporary_name, metadata_path)
    finally:
        Path(temporary_name).unlink(missing_ok=True)

    invalidate_catalog_cache()
    updated = _find_record(record["providerId"])
    return {**_public_track(updated), "isFavorite": record["providerId"] in favorite_track_ids()}


@router.delete("/api/tracks/{track_id}")
def delete_track(track_id: str, _: None = Depends(require_api_token)) -> dict[str, Any]:
    record = _find_record(track_id)
    audio_path: Path = record["_path"]
    related = [
        audio_path,
        audio_path.with_suffix(audio_path.suffix + ".musiqapp.json"),
        audio_path.with_suffix(".lrc"),
        audio_path.with_suffix(".txt"),
    ]
    for path in related:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Could not remove the track from the VPS library.") from exc
    with _connect() as connection:
        connection.execute("DELETE FROM favorites WHERE track_id = ?", (record["providerId"],))
        connection.execute("DELETE FROM playlist_tracks WHERE track_id = ?", (record["providerId"],))
    invalidate_catalog_cache()
    return {"deleted": True, "trackId": record["providerId"]}
