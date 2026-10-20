import asyncio
import http.client
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from mutagen import File as MutagenFile
from mutagen.id3 import APIC, USLT
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover

from api_common import (
    AUDIO_EXTENSIONS, AUDIO_MIME_EXTENSIONS, LRCLIB_GET_URL, LRC_TIMESTAMP_RE,
    MAX_IMPORT_BYTES, MUSIC_DIR, AudioImportRequest, MediaLinkRequest, http_client,
    require_api_token, search_synced_lyrics,
)
from music_library import (
    _build_record, _contains_timed_lyrics, _public_track, _tag_value,
    _write_embedded_synced_lyrics, invalidate_catalog_cache,
)

router = APIRouter()
import_jobs: dict[str, dict[str, Any]] = {}

def _public_import_targets(value: str) -> tuple[Any, list[str]]:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Enter a valid HTTPS audio file link.") from exc
    hostname = parsed.hostname
    if parsed.scheme.lower() != "https" or not hostname or parsed.username or parsed.password or port not in (None, 443):
        raise HTTPException(status_code=422, detail="Only public HTTPS audio links on the standard port can be imported.")
    if hostname.endswith((".local", ".localhost", ".internal")) or "%" in hostname:
        raise HTTPException(status_code=422, detail="Private or local network links cannot be imported.")
    try:
        try:
            literal_ip = ipaddress.ip_address(hostname)
            addresses = [str(literal_ip)]
        except ValueError:
            results = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
            addresses = list(dict.fromkeys(item[4][0] for item in results))
        ip_addresses = {ipaddress.ip_address(address) for address in addresses}
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="The audio link host could not be resolved.") from exc
    if not ip_addresses or any(not address.is_global for address in ip_addresses):
        raise HTTPException(status_code=422, detail="The link must resolve only to public internet addresses.")
    return parsed, addresses

class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, address: str):
        super().__init__(host=hostname, port=443, timeout=45, context=ssl.create_default_context())
        self.pinned_address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection((self.pinned_address, self.port), timeout=self.timeout)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)

def _download_direct_audio(value: str, on_progress: Any = None) -> Path:
    current_url = value
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    for redirect_count in range(5):
        parsed, addresses = _public_import_targets(current_url)
        redirect_url: str | None = None
        request_error: Exception | None = None
        downloaded_path: Path | None = None

        for address in addresses:
            connection: _PinnedHTTPSConnection | None = None
            attempt_path: Path | None = None
            try:
                connection = _PinnedHTTPSConnection(parsed.hostname or "", address)
                target = parsed.path or "/"
                if parsed.query:
                    target += "?" + parsed.query
                connection.request("GET", target, headers={"User-Agent": "Musiqapp/1.0", "Accept": "audio/*, application/octet-stream, */*;q=0.5", "Connection": "close"})
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader("Location")
                    if not location or redirect_count == 4:
                        raise HTTPException(status_code=502, detail="The audio host returned too many redirects.")
                    redirect_url = urljoin(current_url, location)
                    break
                if response.status != 200:
                    raise HTTPException(status_code=502, detail=f"The audio host returned HTTP {response.status}.")
                content_length = response.getheader("Content-Length")
                total_bytes: int | None = None
                if content_length:
                    try:
                        total_bytes = int(content_length)
                        if total_bytes > MAX_IMPORT_BYTES:
                            raise HTTPException(status_code=413, detail="Audio files must be smaller than 512 MB.")
                    except ValueError:
                        total_bytes = None
                media_type = (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
                extension = Path(unquote(parsed.path)).suffix.lower()
                if extension not in AUDIO_EXTENSIONS:
                    extension = AUDIO_MIME_EXTENSIONS.get(media_type, "")
                if extension not in (".mp3", ".m4a"):
                    raise HTTPException(status_code=415, detail="Provide a direct MP3 or M4A file link; page links and other formats are not converted.")
                if media_type in ("text/html", "application/xhtml+xml", "text/plain"):
                    raise HTTPException(status_code=415, detail="The link returned a web page or text, not an audio file.")

                with tempfile.NamedTemporaryFile(mode="wb", dir=str(MUSIC_DIR), prefix=".musiqapp-import-", suffix=extension, delete=False) as output:
                    attempt_path = Path(output.name)
                    size = 0
                    while True:
                        chunk = response.read(128 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_IMPORT_BYTES:
                            raise HTTPException(status_code=413, detail="Audio files must be smaller than 512 MB.")
                        output.write(chunk)
                        if on_progress:
                            on_progress(size, total_bytes)
                if size == 0:
                    raise HTTPException(status_code=422, detail="The audio link returned an empty file.")
                downloaded_path = attempt_path
                break
            except HTTPException:
                if attempt_path and attempt_path.exists():
                    attempt_path.unlink()
                raise
            except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
                request_error = exc
                if attempt_path and attempt_path.exists():
                    attempt_path.unlink()
            finally:
                if connection:
                    connection.close()

        if redirect_url:
            current_url = redirect_url
            continue
        if downloaded_path:
            return downloaded_path
        raise HTTPException(status_code=502, detail="Could not download the audio from that link.") from request_error

    raise HTTPException(status_code=502, detail="The audio host returned too many redirects.")


def _media_source_site(value: str) -> str | None:
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return None
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password:
        return None
    if hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}:
        return "YouTube"
    if hostname in {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}:
        return "TikTok"
    if hostname in {"soundcloud.com", "on.soundcloud.com"} or hostname.endswith(".soundcloud.com"):
        return "SoundCloud"
    return None


def _download_platform_audio(value: str, output_format: str, on_progress: Any = None) -> Path:
    try:
        import yt_dlp
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="The VPS media downloader is not installed.") from exc

    _public_import_targets(value)
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    prefix = MUSIC_DIR / f".musiqapp-import-{uuid.uuid4().hex}"
    exceeded_limit = False

    def report_progress(status: dict[str, Any]) -> None:
        nonlocal exceeded_limit
        downloaded = int(status.get("downloaded_bytes") or 0)
        total = status.get("total_bytes") or status.get("total_bytes_estimate")
        if downloaded > MAX_IMPORT_BYTES or (total and int(total) > MAX_IMPORT_BYTES):
            exceeded_limit = True
            raise yt_dlp.utils.DownloadError("Audio files must be smaller than 512 MB.")
        if on_progress and status.get("status") in ("downloading", "finished"):
            on_progress(downloaded, int(total) if total else None)

    options = {
        "format": "bestaudio/best",
        "outtmpl": f"{prefix}.%(ext)s",
        "noplaylist": True,
        "max_filesize": MAX_IMPORT_BYTES,
        "quiet": True,
        "no_warnings": True,
        "cachedir": False,
        "socket_timeout": 30,
        "retries": 2,
        "fragment_retries": 2,
        "extractor_retries": 2,
        "js_runtimes": {"node": {}},
        "progress_hooks": [report_progress],
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": output_format, "preferredquality": "192"},
            {"key": "FFmpegMetadata"},
        ],
    }
    cookie_file = os.environ.get("MUSIQAPP_YTDLP_COOKIES_FILE", "").strip()
    if cookie_file:
        cookie_path = Path(cookie_file).expanduser()
        try:
            cookie_mode = cookie_path.stat().st_mode
        except OSError as exc:
            raise HTTPException(
                status_code=503,
                detail="The VPS YouTube cookies file is configured but cannot be read.",
            ) from exc
        if not cookie_path.is_file() or cookie_mode & 0o077:
            raise HTTPException(
                status_code=503,
                detail="The VPS YouTube cookies file must exist and be readable only by the app service user.",
            )
        options["cookiefile"] = str(cookie_path)

    user_agent = os.environ.get("MUSIQAPP_YTDLP_USER_AGENT", "").strip()
    if user_agent:
        if "\r" in user_agent or "\n" in user_agent:
            raise HTTPException(status_code=503, detail="The configured downloader User-Agent is invalid.")
        options["http_headers"] = {"User-Agent": user_agent}

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            result = ydl.download([value])
        output_path = prefix.with_suffix(f".{output_format}")
        if result or not output_path.is_file():
            raise yt_dlp.utils.DownloadError("The source did not produce an audio file.")
        if output_path.stat().st_size > MAX_IMPORT_BYTES:
            exceeded_limit = True
            raise yt_dlp.utils.DownloadError("Audio files must be smaller than 512 MB.")
        return output_path
    except Exception as exc:
        for partial in MUSIC_DIR.glob(f"{prefix.name}.*"):
            partial.unlink(missing_ok=True)
        if exceeded_limit:
            raise HTTPException(status_code=413, detail="Audio files must be smaller than 512 MB.") from exc
        error_text = str(exc).casefold()
        source_site = _media_source_site(value)
        if source_site == "YouTube" and any(
            marker in error_text
            for marker in ("sign in to confirm", "not a bot", "cookies-from-browser", "cookies for the authentication")
        ):
            detail = (
                "YouTube blocked this VPS request with a bot-verification check. "
                "The link was accepted, but YouTube refused audio extraction for this video. "
                "Try a supported SoundCloud link or a direct MP3/M4A URL."
            )
        else:
            detail = "Could not extract audio from this link. Check that the media is public and supported."
        raise HTTPException(
            status_code=502,
            detail=detail,
        ) from exc


def _download_import_audio(value: str, on_progress: Any = None) -> Path:
    if _media_source_site(value):
        return _download_platform_audio(value, "mp3", on_progress)
    return _download_direct_audio(value, on_progress)

def _platform_for_link(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Enter a valid Spotify or SoundCloud track link.") from exc
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Track reference links must use HTTPS.")
    if host in ("open.spotify.com", "spotify.link"):
        if not re.search(r"/track/[A-Za-z0-9]+", parsed.path):
            raise HTTPException(status_code=422, detail="Paste a Spotify track link, not a playlist or artist page.")
        return "Spotify"
    if host in ("soundcloud.com", "on.soundcloud.com") or host.endswith(".soundcloud.com"):
        return "SoundCloud"
    raise HTTPException(status_code=422, detail="Only Spotify and SoundCloud track links can be used for track details.")

async def _resolve_platform_metadata(value: str) -> dict[str, str]:
    provider = _platform_for_link(value)
    endpoint = "https://open.spotify.com/oembed" if provider == "Spotify" else "https://soundcloud.com/oembed"
    params: dict[str, str] = {"url": value.strip()}
    if provider == "SoundCloud":
        params.update({"format": "json", "show_artwork": "true"})
    try:
        response = await http_client.get(endpoint, params=params)
        if response.is_error:
            raise HTTPException(status_code=422, detail=f"{provider} could not provide details for this link.")
        data = response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider} to read track details.") from exc

    title = str(data.get("title") or "").strip()
    artist = str(data.get("author_name") or "").strip() if provider == "SoundCloud" else ""
    if provider == "Spotify" and " - " in title:
        title, artist = title.rsplit(" - ", 1)
        title, artist = title.strip(), artist.strip()
    artwork = str(data.get("thumbnail_url") or "").strip()
    if not artwork.startswith("https://"):
        artwork = ""
    if not title:
        raise HTTPException(status_code=422, detail=f"{provider} did not return a track title.")
    return {"provider": provider, "title": title, "artist": artist, "artwork": artwork}

@router.post("/api/link-preview")
async def preview_media_link(body: MediaLinkRequest, _: None = Depends(require_api_token)) -> dict[str, str]:
    return await _resolve_platform_metadata(body.url)

async def _download_import_artwork(value: str) -> tuple[bytes, str] | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    trusted_host = (
        host == "scdn.co" or host.endswith(".scdn.co")
        or host == "sndcdn.com" or host.endswith(".sndcdn.com")
        or host == "spotifycdn.com" or host.endswith(".spotifycdn.com")
    )
    if parsed.scheme.lower() != "https" or not trusted_host or parsed.username or parsed.password:
        return None
    try:
        response = await http_client.get(value)
        if response.is_error or len(response.content) > 15 * 1024 * 1024:
            return None
        media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if media_type not in ("image/jpeg", "image/png"):
            return None
        return response.content, media_type
    except httpx.HTTPError:
        return None

def _embed_import_artwork(audio_path: Path, image_data: bytes, media_type: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=str(audio_path.parent),
        prefix=".musiqapp-cover-",
        suffix=audio_path.suffix,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(audio_path, temporary_path)
        audio = MutagenFile(str(temporary_path), easy=False)
        if isinstance(audio, MP3):
            if audio.tags is None:
                audio.add_tags()
            audio.tags.delall("APIC")
            audio.tags.add(APIC(encoding=3, mime=media_type, type=3, desc="Cover", data=image_data))
            audio.save(v2_version=4)
        elif isinstance(audio, MP4):
            if audio.tags is None:
                audio.add_tags()
            image_format = MP4Cover.FORMAT_PNG if media_type == "image/png" else MP4Cover.FORMAT_JPEG
            audio.tags["covr"] = [MP4Cover(image_data, imageformat=image_format)]
            audio.save()
        else:
            suffix = ".png" if media_type == "image/png" else ".jpg"
            audio_path.with_suffix(suffix).write_bytes(image_data)
            return
        os.replace(temporary_path, audio_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

def _embed_import_plain_lyrics(audio_path: Path, contents: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=str(audio_path.parent),
        prefix=".musiqapp-lyrics-",
        suffix=audio_path.suffix,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(audio_path, temporary_path)
        audio = MutagenFile(str(temporary_path), easy=False)
        if isinstance(audio, MP3):
            if audio.tags is None:
                audio.add_tags()
            audio.tags.delall("USLT")
            audio.tags.add(USLT(encoding=3, lang="eng", desc="Musiqapp", text=contents.strip()))
            audio.save(v2_version=4)
        elif isinstance(audio, MP4):
            if audio.tags is None:
                audio.add_tags()
            audio.tags["©lyr"] = [contents.strip()]
            audio.save()
        else:
            raise ValueError("This audio format does not support embedded lyrics.")

        verified_audio = MutagenFile(str(temporary_path), easy=False)
        if isinstance(verified_audio, MP3):
            found_lyrics = any(str(getattr(frame, "text", "")).strip() for frame in verified_audio.tags.getall("USLT"))
        elif isinstance(verified_audio, MP4):
            found_lyrics = bool(verified_audio.tags.get("©lyr"))
        else:
            found_lyrics = False
        if not found_lyrics:
            raise ValueError("Embedded lyrics could not be verified; the original audio was kept.")
        os.replace(temporary_path, audio_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

def _lyrics_fit_duration(contents: str, duration: int) -> bool:
    if not _contains_timed_lyrics(contents):
        return False
    latest_ms = 0
    for minutes, seconds, fraction in LRC_TIMESTAMP_RE.findall(contents):
        if int(seconds) > 59:
            return False
        millis = int((fraction or "0").ljust(3, "0")[:3])
        latest_ms = max(latest_ms, (int(minutes) * 60 + int(seconds)) * 1000 + millis)
    return not duration or latest_ms <= (duration + 15) * 1000

async def _find_import_lyrics(title: str, artist: str, album: str, duration: int) -> tuple[str, str, bool] | None:
    if not title.strip() or not artist.strip():
        return None
    params: dict[str, Any] = {"track_name": title, "artist_name": artist}
    if album:
        params["album_name"] = album
    if duration:
        params["duration"] = duration
    try:
        response = await http_client.get(LRCLIB_GET_URL, params=params)
        if response.status_code == 200:
            data = response.json()
            candidate = str(data.get("syncedLyrics") or "")
            if _lyrics_fit_duration(candidate, duration):
                return candidate, "lrclib", True
            plain = str(data.get("plainLyrics") or "").strip()
            if plain:
                return plain, "lrclib", False
    except (httpx.HTTPError, ValueError):
        pass

    if search_synced_lyrics is None:
        return None
    query = " ".join(part for part in (title, artist, album) if part)
    try:
        candidate = await asyncio.to_thread(
            search_synced_lyrics,
            query,
            synced_only=True,
            providers=["Musixmatch", "NetEase", "Megalobiz"],
        )
    except Exception:
        return None
    if candidate and _lyrics_fit_duration(candidate, duration):
        return candidate, "multi_provider", True
    return None

async def _import_audio(body: AudioImportRequest, report: Any = None) -> dict[str, Any]:
    temporary_audio: Path | None = None
    temporary_metadata: Path | None = None
    final_path: Path | None = None
    try:
        if report:
            report(0.03, "Checking track details", 0, None)
        source_metadata = await _resolve_platform_metadata(body.sourceUrl) if body.sourceUrl.strip() else {}
        if report:
            report(0.06, "Downloading audio file", 0, None)
        loop = asyncio.get_running_loop()
        last_transfer: dict[str, Any] = {"bytes": 0, "total": None}

        def on_download(downloaded: int, total: int | None) -> None:
            last_transfer["bytes"] = downloaded
            last_transfer["total"] = total
            progress = 0.06 + 0.70 * downloaded / total if total else None
            message = "Downloading audio file" if total else "Receiving audio file"
            if report:
                loop.call_soon_threadsafe(report, progress, message, downloaded, total)

        temporary_audio = await asyncio.to_thread(_download_import_audio, body.url.strip(), on_download)
        if report:
            report(0.79, "Reading audio metadata", last_transfer["bytes"], last_transfer["total"])
        raw_audio = MutagenFile(str(temporary_audio))
        easy_audio = MutagenFile(str(temporary_audio), easy=True)
        if raw_audio is None or not getattr(raw_audio, "info", None):
            raise HTTPException(status_code=415, detail="The downloaded file is not a supported audio track.")
        tags = easy_audio.tags if easy_audio else None
        source_name = Path(unquote(urlsplit(body.url.strip()).path)).stem
        title = body.title.strip() or source_metadata.get("title") or _tag_value(tags, "title", default=source_name.replace("_", " ")) or "Untitled track"
        artist = body.artist.strip() or source_metadata.get("artist") or _tag_value(tags, "artist", "albumartist", default="Unknown Artist")
        album = _tag_value(tags, "album", default="")
        duration = int(getattr(raw_audio.info, "length", 0) or 0)
        safe_stem = re.sub(r"[^\w.-]+", "_", f"{artist} - {title}", flags=re.UNICODE).strip("._-")[:120]
        safe_stem = safe_stem or "Imported_track"
        file_name = f"{safe_stem}-{uuid.uuid4().hex[:8]}{temporary_audio.suffix.lower()}"
        final_path = MUSIC_DIR / file_name
        metadata_path = final_path.with_suffix(final_path.suffix + ".musiqapp.json")
        metadata = {"title": title, "artist": artist, "album": album, "source": source_metadata.get("provider", ""), "dateAdded": int(time.time() * 1000)}
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(MUSIC_DIR), prefix=".musiqapp-meta-", suffix=".tmp", delete=False) as metadata_file:
            json.dump(metadata, metadata_file, ensure_ascii=False)
            temporary_metadata = Path(metadata_file.name)

        os.replace(temporary_audio, final_path)
        temporary_audio = None
        os.replace(temporary_metadata, metadata_path)
        temporary_metadata = None

        if report:
            report(None, "Fetching cover art", last_transfer["bytes"], last_transfer["total"])
        artwork = await _download_import_artwork(source_metadata.get("artwork", ""))
        if report:
            report(0.85, "Cover art ready", last_transfer["bytes"], last_transfer["total"])
        if artwork:
            try:
                _embed_import_artwork(final_path, artwork[0], artwork[1])
            except Exception:
                extension = ".png" if artwork[1] == "image/png" else ".jpg"
                final_path.with_suffix(extension).write_bytes(artwork[0])

        if report:
            report(None, "Searching for synced lyrics", last_transfer["bytes"], last_transfer["total"])
        lyrics_artist = source_metadata.get("artist") or _tag_value(tags, "artist", "albumartist", default=artist)
        lyrics_result = await _find_import_lyrics(title, lyrics_artist, album, duration)
        if lyrics_result:
            lyrics, _lyrics_source, is_synced = lyrics_result
            if report:
                report(0.93, "Embedding synced lyrics" if is_synced else "Embedding lyrics", last_transfer["bytes"], last_transfer["total"])
            if is_synced:
                try:
                    _write_embedded_synced_lyrics(final_path, lyrics)
                except (OSError, ValueError):
                    final_path.with_suffix(".lrc").write_text(lyrics, encoding="utf-8")
            else:
                try:
                    _embed_import_plain_lyrics(final_path, lyrics)
                except (OSError, ValueError):
                    final_path.with_suffix(".txt").write_text(lyrics, encoding="utf-8")

        if report:
            report(0.97, "Updating your VPS library", last_transfer["bytes"], last_transfer["total"])
        invalidate_catalog_cache()
        record = _build_record(final_path)
        if not record:
            raise HTTPException(status_code=500, detail="The imported audio could not be added to the catalog.")
        return _public_track(record)
    except HTTPException:
        if temporary_audio and temporary_audio.exists():
            temporary_audio.unlink()
        if temporary_metadata and temporary_metadata.exists():
            temporary_metadata.unlink()
        if final_path and final_path.exists():
            final_path.unlink()
            final_path.with_suffix(final_path.suffix + ".musiqapp.json").unlink(missing_ok=True)
            final_path.with_suffix(".lrc").unlink(missing_ok=True)
            final_path.with_suffix(".jpg").unlink(missing_ok=True)
            final_path.with_suffix(".png").unlink(missing_ok=True)
        raise
    except (OSError, ValueError) as exc:
        if temporary_audio and temporary_audio.exists():
            temporary_audio.unlink()
        if temporary_metadata and temporary_metadata.exists():
            temporary_metadata.unlink()
        if final_path and final_path.exists():
            final_path.unlink()
            final_path.with_suffix(final_path.suffix + ".musiqapp.json").unlink(missing_ok=True)
            final_path.with_suffix(".lrc").unlink(missing_ok=True)
            final_path.with_suffix(".jpg").unlink(missing_ok=True)
            final_path.with_suffix(".png").unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not add this audio file to the VPS library.") from exc

@router.post("/api/import-url")
async def import_audio_url(body: AudioImportRequest, _: None = Depends(require_api_token)) -> dict[str, Any]:
    return await _import_audio(body)

def _report_import_job(job_id: str, progress: float | None, message: str, downloaded: int = 0, total: int | None = None) -> None:
    job = import_jobs.get(job_id)
    if not job:
        return
    job.update({
        "status": "running",
        "progress": round(max(0.0, min(1.0, progress)), 3) if progress is not None else None,
        "message": message,
        "bytesDownloaded": downloaded,
        "totalBytes": total,
    })

async def _run_import_job(job_id: str, body: AudioImportRequest) -> None:
    try:
        track = await _import_audio(body, lambda progress, message, downloaded, total: _report_import_job(job_id, progress, message, downloaded, total))
        job = import_jobs.get(job_id)
        if job:
            job.update({"status": "complete", "progress": 1.0, "message": "Import complete", "track": track})
    except HTTPException as exc:
        job = import_jobs.get(job_id)
        if job:
            job.update({"status": "failed", "progress": None, "message": "Import failed", "error": str(exc.detail)})
    except Exception:
        job = import_jobs.get(job_id)
        if job:
            job.update({"status": "failed", "progress": None, "message": "Import failed", "error": "The VPS could not complete this import. Please try again."})

@router.post("/api/import-jobs")
async def create_import_job(body: AudioImportRequest, _: None = Depends(require_api_token)) -> dict[str, str]:
    job_id = uuid.uuid4().hex
    import_jobs[job_id] = {
        "status": "queued",
        "progress": 0.0,
        "message": "Preparing import",
        "bytesDownloaded": 0,
        "totalBytes": None,
    }
    asyncio.create_task(_run_import_job(job_id, body))
    return {"jobId": job_id}

@router.get("/api/import-jobs/{job_id}")
async def get_import_job(job_id: str, _: None = Depends(require_api_token)) -> dict[str, Any]:
    job = import_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="This import job expired or was not found.")
    return job
