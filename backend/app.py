from typing import Any
import mimetypes

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from api_common import API_TOKEN, http_client, require_api_token
from lyrics_api import router as lyrics_router
from library_actions import favorite_track_ids, router as library_actions_router
from music_library import _all_records, _embedded_cover, _find_record, _public_track

app = FastAPI(title="Musiqapp Private Music API", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "PUT", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"])
app.include_router(lyrics_router)
app.include_router(library_actions_router)


@app.get("/healthz")
async def health() -> dict[str, Any]:
    return {"status": "ok", "catalog": "vps_files", "configured": bool(API_TOKEN)}


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
    favorites = favorite_track_ids()
    return {"items": [{**_public_track(item), "isFavorite": item["providerId"] in favorites} for item in page_items], "page": page, "limit": limit, "hasMore": offset + limit < len(records)}

@app.get("/api/audio/{track_id}")
async def stream_track(track_id: str, _: None = Depends(require_api_token)) -> FileResponse:
    record = _find_record(track_id)
    path: Path = record["_path"]
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=None, content_disposition_type="inline")

@app.get("/api/download/{track_id}")
async def download_track(track_id: str, _: None = Depends(require_api_token)) -> FileResponse:
    record = _find_record(track_id)
    path: Path = record["_path"]
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name, content_disposition_type="attachment")

@app.get("/api/artwork/{track_id}")
async def track_artwork(track_id: str, _: None = Depends(require_api_token)) -> Response:
    record = _find_record(track_id)
    artwork_path: Path | None = record["_artwork_path"]
    if artwork_path:
        return FileResponse(artwork_path, media_type=mimetypes.guess_type(artwork_path.name)[0] or "image/jpeg")
    cover = _embedded_cover(record["_path"])
    if cover:
        return Response(content=cover[0], media_type=cover[1], headers={"Cache-Control": "private, max-age=3600"})
    raise HTTPException(status_code=404, detail="No embedded or adjacent cover art was found.")


@app.on_event("shutdown")
async def close_http_client() -> None:
    await http_client.aclose()
