"""Read-only catalog API for the MusicLocal client.

This module deliberately has no playlist, favorite, or server-side downloader
routes. The iPhone owns those writes and stores downloaded media locally.
"""

from typing import Any
import mimetypes

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from api_common import (
    API_TOKEN,
    READ_ONLY_MODE,
    http_client,
    require_api_token,
)
from lyrics_api import router as lyrics_router
from music_library import _all_records, _embedded_cover, _find_record, _public_track

if not READ_ONLY_MODE:
    raise RuntimeError("local_app requires MUSIQAPP_READ_ONLY=1")


app = FastAPI(title="Musiqapp Local Catalog API", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(lyrics_router)


@app.get("/healthz")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "catalog": "read_only_remote_files",
        "configured": bool(API_TOKEN),
        "readOnly": True,
    }


@app.get("/api/tracks")
async def list_tracks(
    q: str = Query(default="", max_length=160),
    page: int = Query(default=1, ge=1, le=10000),
    limit: int = Query(default=80, ge=1, le=200),
    _: None = Depends(require_api_token),
) -> dict[str, Any]:
    query = q.strip().casefold()
    records = sorted(_all_records(), key=lambda item: (item["title"].casefold(), item["artist"].casefold()))
    if query:
        records = [item for item in records if query in f"{item['title']} {item['artist']} {item['album']}".casefold()]
    offset = (page - 1) * limit
    page_items = records[offset : offset + limit]
    return {
        "items": [{**_public_track(item), "isFavorite": False} for item in page_items],
        "page": page,
        "limit": limit,
        "hasMore": offset + limit < len(records),
    }


@app.get("/api/audio/{track_id}")
async def stream_track(track_id: str, _: None = Depends(require_api_token)) -> FileResponse:
    record = _find_record(track_id)
    path = record["_path"]
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=None, content_disposition_type="inline")


@app.get("/api/download/{track_id}")
async def download_track(track_id: str, _: None = Depends(require_api_token)) -> FileResponse:
    record = _find_record(track_id)
    path = record["_path"]
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name, content_disposition_type="attachment")


@app.get("/api/artwork/{track_id}")
async def track_artwork(track_id: str, _: None = Depends(require_api_token)) -> Response:
    record = _find_record(track_id)
    artwork_path = record["_artwork_path"]
    if artwork_path:
        return FileResponse(artwork_path, media_type=mimetypes.guess_type(artwork_path.name)[0] or "image/jpeg")
    cover = _embedded_cover(record["_path"])
    if cover:
        return Response(content=cover[0], media_type=cover[1], headers={"Cache-Control": "private, max-age=3600"})
    raise HTTPException(status_code=404, detail="No embedded or adjacent cover art was found.")


@app.on_event("shutdown")
async def close_http_client() -> None:
    await http_client.aclose()
