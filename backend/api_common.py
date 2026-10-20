import hmac
import os
import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field

MUSIC_DIR = Path(os.environ.get("MUSIQAPP_MUSIC_DIR", "/home/ubuntu/musiqapp-api/music")).resolve()
API_TOKEN = os.environ.get("MUSIQAPP_API_TOKEN", "").strip()
PUBLIC_API_BASE = os.environ.get("MUSIQAPP_PUBLIC_API_BASE", "https://msc-api.egokam.site").rstrip("/")
LRCLIB_GET_URL = "https://lrclib.net/api/get"
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wav", ".aiff", ".alac"}
HTTP_TIMEOUT = httpx.Timeout(18.0, connect=6.0)
http_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": "Musiqapp/1.0 (https://msc-api.egokam.site)"})
MAX_IMPORT_BYTES = 512 * 1024 * 1024
LRC_TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
AUDIO_MIME_EXTENSIONS = {
    "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
    "audio/aac": ".aac", "audio/flac": ".flac", "audio/x-flac": ".flac", "audio/ogg": ".ogg",
    "application/ogg": ".ogg", "audio/opus": ".opus", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/aiff": ".aiff", "audio/alac": ".alac", "application/mp4": ".m4a",
}

try:
    from syncedlyrics import search as search_synced_lyrics
except ImportError:
    search_synced_lyrics = None


class LyricsSaveRequest(BaseModel):
    syncedLyrics: str = Field(min_length=1, max_length=500_000)


class AudioImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str = Field(default="", max_length=200)
    artist: str = Field(default="", max_length=200)
    sourceUrl: str = Field(default="", max_length=2048)


class MediaLinkRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


def require_api_token(authorization: str | None = Header(default=None)) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="Musiqapp API token is not configured on the VPS.")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not hmac.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="A valid Musiqapp API token is required.")
