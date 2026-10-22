import { File } from 'expo-file-system';
import type { PlaylistSummary, Track } from '../types';
import { parseLyrics } from './LyricsParser';
import { OfflineMusicService } from './OfflineMusicService';
import { PlaylistStorageService } from './PlaylistStorageService';

/** Local library boundary kept under the old service name for screen compatibility. */

let apiToken = '';

// Compatibility no-ops: local files never need a pairing code or auth header.
export const setMusicApiToken = (token: string) => { apiToken = token.trim(); };
export const getMusicApiHeaders = (): Record<string, string> => (apiToken ? {} : {});

export type MediaLinkMetadata = {
  provider: 'Spotify' | 'SoundCloud';
  title: string;
  artist: string;
  artwork: string;
};

export type ImportProgress = {
  progress: number | null;
  message: string;
  bytesDownloaded: number;
  totalBytes: number | null;
};

export type TrackEditChanges = {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  lyrics?: string;
};

const localTracks = () => OfflineMusicService.getDownloadedTracks();

const mergeTrackChanges = (track: Track, changes: TrackEditChanges): Track => {
  if (changes.lyrics === undefined) {
    return {
      ...track,
      title: changes.title.trim() || track.title,
      artist: changes.artist.trim() || track.artist,
      album: changes.album.trim(),
      artwork: changes.artworkUrl.trim() || track.artwork,
    };
  }
  const lyrics = changes.lyrics.trim();
  const parsed = parseLyrics(lyrics);
  const hasSyncedLyrics = parsed.some((line) => line.timeMs !== null && line.text.trim());
  const syncedLyrics = hasSyncedLyrics ? lyrics : undefined;
  const plainLyrics = lyrics && !hasSyncedLyrics ? lyrics : undefined;
  return {
    ...track,
    title: changes.title.trim() || track.title,
    artist: changes.artist.trim() || track.artist,
    album: changes.album.trim(),
    artwork: changes.artworkUrl.trim() || track.artwork,
    syncedLyrics,
    plainLyrics,
    lyrics: parseLyrics(syncedLyrics, plainLyrics),
    lyricsAvailable: Boolean(lyrics),
    hasSyncedLyrics,
    hasPlainLyrics: Boolean(plainLyrics),
    lyricsSource: hasSyncedLyrics ? 'saved_lrc' : undefined,
  };
};

const matchesQuery = (track: Track, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [track.title, track.artist, track.album].some((value) => value.toLocaleLowerCase().includes(normalized));
};

const makePlaylistId = () => `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const titleFromUrl = (url: string) => {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const value = pathname.split('/').filter(Boolean).at(-1) ?? 'Imported audio';
    return value.replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported audio';
  } catch {
    return 'Imported audio';
  }
};

const readLyricsFile = async (track: Track): Promise<Track> => {
  if (track.syncedLyrics?.trim() || track.plainLyrics?.trim() || !track.lyricsFileUri) return track;
  try {
    const lyricsFile = new File(track.lyricsFileUri);
    if (!lyricsFile.exists) return track;
    const text = await lyricsFile.text();
    const isSynced = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
    return {
      ...track,
      ...(isSynced ? { syncedLyrics: text, hasSyncedLyrics: true } : { plainLyrics: text, hasPlainLyrics: true }),
      lyrics: parseLyrics(isSynced ? text : undefined, isSynced ? undefined : text),
      lyricsAvailable: Boolean(text.trim()),
      lyricsSource: 'local_lrc',
    };
  } catch {
    return track;
  }
};

const lookupLyricsOnline = async (track: Track, local: Track, syncedOnly: boolean): Promise<Track> => {
  if (!track.title.trim() || !track.artist.trim()) return local;
  const params = new URLSearchParams({ track_name: track.title.trim(), artist_name: track.artist.trim() });
  if (track.album.trim()) params.set('album_name', track.album.trim());
  if (track.durationSeconds && track.durationSeconds > 0) params.set('duration', String(Math.round(track.durationSeconds)));
  try {
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
    if (!response.ok) return local;
    const result = await response.json() as { syncedLyrics?: string | null; plainLyrics?: string | null };
    const syncedLyrics = result.syncedLyrics?.trim() || undefined;
    const plainLyrics = result.plainLyrics?.trim() || undefined;
    if (!syncedLyrics && (!plainLyrics || syncedOnly)) return local;
    return {
      ...local,
      syncedLyrics,
      plainLyrics,
      lyrics: parseLyrics(syncedLyrics, plainLyrics),
      lyricsAvailable: Boolean(syncedLyrics || plainLyrics),
      hasSyncedLyrics: Boolean(syncedLyrics),
      hasPlainLyrics: Boolean(plainLyrics),
      lyricsSource: 'lrclib',
    };
  } catch {
    // Lyrics are optional; offline playback and local sidecars continue to work.
    return local;
  }
};

export { parseLyrics };

export const MusicCatalogService = {
  async searchTracks(query = '', _page = 1): Promise<Track[]> {
    return (await localTracks()).filter((track) => matchesQuery(track, query));
  },

  async searchAllTracks(): Promise<Track[]> { return localTracks(); },

  async getFavoriteTracks(): Promise<Track[]> {
    return (await localTracks()).filter((track) => track.isFavorite);
  },

  async setFavorite(track: Track, isFavorite: boolean): Promise<void> {
    await OfflineMusicService.updateTrack({ ...track, isFavorite });
  },

  async getPlaylists(): Promise<PlaylistSummary[]> { return PlaylistStorageService.getPlaylists(); },
  async getPlaylistTracks(playlistId: string): Promise<Track[]> { return PlaylistStorageService.getPlaylistTracks(playlistId); },

  async createPlaylist(name: string): Promise<PlaylistSummary> {
    return { id: makePlaylistId(), name: name.trim() || 'New playlist', trackCount: 0 };
  },

  async uploadPlaylistCover(_playlistId: string, uri: string, _mimeType: string): Promise<string> { return uri; },
  // App.tsx owns the local playlist mutation so it can update its React state;
  // these methods only preserve the old remote-success contract.
  async addTrackToPlaylist(playlistId: string, track: Track): Promise<boolean> {
    const tracks = await PlaylistStorageService.getPlaylistTracks(playlistId);
    return !tracks.some((item) => item.id === track.id);
  },
  async removeTrackFromPlaylist(playlistId: string, track: Track): Promise<boolean> {
    const tracks = await PlaylistStorageService.getPlaylistTracks(playlistId);
    return tracks.some((item) => item.id === track.id);
  },
  async deletePlaylist(playlistId: string): Promise<void> { await PlaylistStorageService.deletePlaylist(playlistId); },

  async updateTrack(track: Track, changes: TrackEditChanges): Promise<Track> {
    const updated = mergeTrackChanges(track, changes);
    await OfflineMusicService.updateTrack(updated);
    return updated;
  },

  async deleteTrack(track: Track): Promise<void> {
    await OfflineMusicService.removeDownloadedTracks([track.id]);
  },

  async getLyrics(track: Track, syncedOnly = false, forceOnline = false): Promise<Track> {
    if (forceOnline) return lookupLyricsOnline(track, track, syncedOnly);
    const result = await readLyricsFile(track);
    if (result.syncedLyrics?.trim() || (result.plainLyrics?.trim() && syncedOnly === false)) return result;
    return lookupLyricsOnline(track, result, syncedOnly);
  },

  async saveSyncedLyrics(track: Track, syncedLyrics: string): Promise<void> {
    await OfflineMusicService.saveSyncedLyrics(track, syncedLyrics);
  },

  async resolveMediaLink(url: string): Promise<MediaLinkMetadata> {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) throw new Error('Paste a valid HTTPS audio URL.');
    let host = '';
    try { host = new URL(trimmed).hostname.toLowerCase(); } catch { /* validated above */ }
    const provider: MediaLinkMetadata['provider'] = host.includes('soundcloud') ? 'SoundCloud' : 'Spotify';
    return { provider, title: titleFromUrl(trimmed), artist: 'Unknown artist', artwork: '' };
  },

  async importAudioUrl(
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
  ): Promise<Track> {
    return OfflineMusicService.importAudioUrl(url, title || titleFromUrl(url), artist, sourceUrl, onProgress);
  },
};
