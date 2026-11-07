import { File } from 'expo-file-system';
import type { LyricsAttribution, LyricLine, LyricSyllable, LyricVoice, LyricWord, PlaylistSummary, Track } from '../types';
import { deduplicateSyncedLyrics, parseLyrics } from './LyricsParser';
import { OfflineMusicService, type SpicyLyricsCacheEntry } from './OfflineMusicService';
import { PlaylistStorageService } from './PlaylistStorageService';

/** Local library boundary kept under the old service name for screen compatibility. */

let apiToken = '';
let spicyLyricsClientKey = '';
const SPICY_LYRICS_API_BASE = 'https://api.spicylyrics.org/v1';
const SPICY_API_MIN_REQUEST_INTERVAL_MS = 1_000;
let spicyLyricsEnabled = false;
let spicyLyricsCooldownUntil = 0;
let spicyLyricsPrefetchGeneration = 0;
let spicyLyricsPrefetchRunning = false;
let spicyLyricsResumeTimer: ReturnType<typeof setTimeout> | null = null;
const spicyLyricsPrefetchQueue: Track[] = [];
const spicyLyricsPrefetchQueuedIds = new Set<string>();
const spicyLyricsLookups = new Map<string, Promise<SpicyLyricsCacheEntry | null>>();
const embeddedLyricsLookups = new Map<string, Promise<{ text: string; synced: boolean } | null>>();
let spicyApiRequestQueue: Promise<void> = Promise.resolve();
let lastSpicyApiRequestAt = 0;

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
  artworkUri?: string;
  artworkMimeType?: string;
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
      artwork: changes.artworkUri ?? track.artwork,
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
    artwork: changes.artworkUri ?? track.artwork,
    syncedLyrics,
    plainLyrics,
    lyrics: parseLyrics(syncedLyrics, plainLyrics),
    lyricsAvailable: Boolean(lyrics),
    hasSyncedLyrics,
    hasPlainLyrics: Boolean(plainLyrics),
    lyricsSource: hasSyncedLyrics ? 'saved_lrc' : undefined,
    lyricsAttribution: undefined,
  };
};

const withoutSpicyApiLyrics = (track: Track): Track => track.lyricsSource === 'spicy_lyrics_api'
  ? {
      ...track,
      syncedLyrics: undefined,
      plainLyrics: undefined,
      lyrics: undefined,
      lyricsAvailable: false,
      hasSyncedLyrics: false,
      hasPlainLyrics: false,
      lyricsSource: undefined,
      lyricsAttribution: undefined,
    }
  : track;

const matchesQuery = (track: Track, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [track.title, track.artist, track.album].some((value) => value.toLocaleLowerCase().includes(normalized));
};

const makePlaylistId = () => `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const hasRenderableLyrics = (track: Track) => Boolean(
  track.lyrics?.some((line) => line.text.trim())
  || track.syncedLyrics?.trim()
  || track.plainLyrics?.trim(),
);

const hasTimedText = (text: string) => /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);

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
  const candidates: File[] = [];
  const addCandidate = (uri: string | undefined, expectedExtension?: string) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (expectedExtension && file.extension.toLowerCase() !== expectedExtension) return;
      if (!candidates.some((candidate) => candidate.uri === file.uri)) candidates.push(file);
    } catch {
      // Ignore malformed or stale sidecar references and keep checking.
    }
  };

  // A sibling LRC is the user's explicit lyric choice. Check it before any
  // cached or embedded lyrics already attached to the track.
  if (track.localUri) {
    try {
      const audioFile = new File(track.localUri);
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      addCandidate(new File(audioFile.parentDirectory, `${baseName}.lrc`).uri, '.lrc');
    } catch {
      // Continue with the indexed lyric URI and embedded metadata.
    }
  }
  addCandidate(track.lyricsFileUri, '.lrc');

  for (const lyricsFile of candidates) {
    try {
      if (!lyricsFile.exists) continue;
      const text = (await lyricsFile.text()).trim();
      if (!text) continue;
      const syncedLyrics = deduplicateSyncedLyrics(text);
      if (!syncedLyrics) continue;
      return {
        ...track,
        syncedLyrics,
        plainLyrics: undefined,
        lyrics: parseLyrics(syncedLyrics),
        lyricsAvailable: true,
        hasSyncedLyrics: true,
        hasPlainLyrics: false,
        lyricsSource: 'local_lrc',
      };
    } catch {
      // A sidecar can disappear between the exists check and read.
    }
  }

  // Then try the companion text file. Some files contain LRC timestamps even
  // when their extension is .txt, so preserve those timestamps when present.
  const plainCandidates: File[] = [];
  const addPlainCandidate = (uri: string | undefined) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.extension.toLowerCase() === '.txt' && !plainCandidates.some((item) => item.uri === file.uri)) {
        plainCandidates.push(file);
      }
    } catch {
      // Ignore malformed references.
    }
  };
  if (track.localUri) {
    try {
      const audioFile = new File(track.localUri);
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      addPlainCandidate(new File(audioFile.parentDirectory, `${baseName}.txt`).uri);
    } catch {
      // Keep trying indexed fallback data.
    }
  }
  addPlainCandidate(track.lyricsFileUri);
  for (const lyricsFile of plainCandidates) {
    try {
      if (!lyricsFile.exists) continue;
      const text = (await lyricsFile.text()).trim();
      if (!text) continue;
      if (hasTimedText(text)) {
        const syncedLyrics = deduplicateSyncedLyrics(text);
        return {
          ...track,
          syncedLyrics,
          plainLyrics: undefined,
          lyrics: parseLyrics(syncedLyrics),
          lyricsAvailable: true,
          hasSyncedLyrics: true,
          hasPlainLyrics: false,
          lyricsSource: 'local_lrc',
        };
      }
      return {
        ...track,
        plainLyrics: text,
        lyrics: parseLyrics(undefined, text),
        lyricsAvailable: true,
        hasPlainLyrics: true,
        lyricsSource: 'local_text',
      };
    } catch {
      // Keep the fallback non-fatal for offline playback.
    }
  }

  // This is reached after checking embedded metadata. Prefer the sidecar files,
  // then retain indexed lyric text as a compatibility fallback for older imports.
  const indexedSyncedLyrics = track.syncedLyrics?.trim();
  const indexedPlainLyrics = track.plainLyrics?.trim();
  if (indexedSyncedLyrics || indexedPlainLyrics) {
    const syncedLyrics = indexedSyncedLyrics
      ? deduplicateSyncedLyrics(indexedSyncedLyrics)
      : undefined;
    const plainLyrics = indexedPlainLyrics || (syncedLyrics && !hasTimedText(syncedLyrics) ? syncedLyrics : undefined);
    const timedLyrics = syncedLyrics && hasTimedText(syncedLyrics) ? syncedLyrics : undefined;
    return {
      ...track,
      syncedLyrics: timedLyrics,
      plainLyrics: timedLyrics ? undefined : plainLyrics,
      lyrics: parseLyrics(timedLyrics, plainLyrics),
      lyricsAvailable: Boolean(timedLyrics || plainLyrics),
      hasSyncedLyrics: Boolean(timedLyrics),
      hasPlainLyrics: Boolean(plainLyrics),
    };
  }
  if (track.lyrics?.some((line) => line.text.trim())) return track;

  return track;
};

const readEmbeddedLyrics = async (track: Track, localTrack: Track): Promise<Track> => {
  const isIndexedEmbeddedLyrics = localTrack.lyricsSource === 'embedded_lrc'
    || localTrack.lyricsSource === 'embedded_text';
  if (isIndexedEmbeddedLyrics && hasRenderableLyrics(localTrack)) return localTrack;
  if (!track.localUri) return localTrack;
  try {
    const audioFile = new File(track.localUri);
    const cacheKey = `${track.id}:${audioFile.uri}:${audioFile.size ?? 0}:${audioFile.modificationTime ?? 0}`;
    let lookup = embeddedLyricsLookups.get(cacheKey);
    if (!lookup) {
      lookup = OfflineMusicService.inspectLocalAudioMetadata(track.localUri)
        .then((metadata) => {
          const text = metadata.lyricsText?.trim();
          return text ? { text, synced: Boolean(metadata.hasSyncedLyrics || hasTimedText(text)) } : null;
        })
        .catch(() => null);
      embeddedLyricsLookups.set(cacheKey, lookup);
      if (embeddedLyricsLookups.size > 64) {
        const oldestKey = embeddedLyricsLookups.keys().next().value;
        if (oldestKey) embeddedLyricsLookups.delete(oldestKey);
      }
    }
    const embedded = await lookup;
    if (!embedded) return localTrack;
    const syncedLyrics = embedded.synced
      ? deduplicateSyncedLyrics(embedded.text)
      : undefined;
    const plainLyrics = syncedLyrics ? undefined : embedded.text;
    return {
      ...localTrack,
      syncedLyrics,
      plainLyrics,
      lyrics: parseLyrics(syncedLyrics, plainLyrics),
      lyricsAvailable: true,
      hasSyncedLyrics: Boolean(syncedLyrics),
      hasPlainLyrics: Boolean(plainLyrics),
      lyricsSource: syncedLyrics ? 'embedded_lrc' : 'embedded_text',
    };
  } catch {
    // Embedded metadata is a last local fallback; keep audio playback intact.
    return localTrack;
  }
};

const resolveLocalLyrics = async (track: Track) => {
  const embeddedTrack = await readEmbeddedLyrics(track, track);
  if (
    (embeddedTrack.lyricsSource === 'embedded_lrc' || embeddedTrack.lyricsSource === 'embedded_text')
    && hasRenderableLyrics(embeddedTrack)
  ) return embeddedTrack;
  return readLyricsFile(track);
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

type SpicySearchResult = {
  id?: string;
  tier?: string;
};

type SpicyApiResponse = {
  Body?: Record<string, unknown>;
  Status?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const trackLyricsSignature = (track: Track) => [
  track.title.trim().toLocaleLowerCase(),
  track.artist.trim().toLocaleLowerCase(),
  track.album.trim().toLocaleLowerCase(),
  track.durationSeconds ? Math.round(track.durationSeconds) : 0,
].join('|');

const spotifyIdFromTrack = (track: Track) => {
  const candidates = [track.providerId, track.shareUrl].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (/^[A-Za-z0-9]{22}$/.test(candidate)) return candidate;
    const match = candidate.match(/(?:spotify:track:|spotify\.com\/(?:intl-[^/]+\/)?track\/)([A-Za-z0-9]{22})(?:[/?#]|$)/i);
    if (match) return match[1];
  }
  return undefined;
};

const spicyTimeToMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value * 1000)) : null;

const wordsFromSpicySyllables = (syllables: unknown[]): LyricWord[] => {
  const words: LyricWord[] = [];
  let currentSyllables: LyricSyllable[] = [];

  const flushWord = () => {
    if (currentSyllables.length === 0) return;
    const text = currentSyllables.map((syllable) => syllable.text).join('').trim();
    if (text) {
      const starts = currentSyllables
        .map((syllable) => syllable.startTimeMs)
        .filter((time): time is number => time !== null);
      const ends = currentSyllables
        .map((syllable) => syllable.endTimeMs)
        .filter((time): time is number => time !== null);
      words.push({
        text,
        startTimeMs: starts.length ? Math.min(...starts) : null,
        endTimeMs: ends.length ? Math.max(...ends) : null,
        syllables: currentSyllables,
      });
    }
    currentSyllables = [];
  };

  syllables.forEach((value) => {
    const syllable = asRecord(value);
    const text = typeof syllable?.Text === 'string' ? syllable.Text.trim() : '';
    if (!syllable || !text) return;
    currentSyllables.push({
      text,
      startTimeMs: spicyTimeToMs(syllable.StartTime),
      endTimeMs: spicyTimeToMs(syllable.EndTime),
    });
    // Spicy marks syllables that continue the current word. A false or absent
    // flag ends the word, while retaining the source timing for karaoke fill.
    if (syllable.IsPartOfWord !== true) flushWord();
  });
  flushWord();
  return words;
};

const lyricsPartFromSpicy = (value: unknown): LyricVoice => {
  const part = asRecord(value);
  if (!part) return { text: '', timeMs: null };
  const syllables = Array.isArray(part.Syllables) ? part.Syllables : [];
  const words = wordsFromSpicySyllables(syllables);
  const text = words.length
    ? words.map((word) => word.text).join(' ').replace(/\s+([,.;!?…])/g, '$1').trim()
    : [part.Text, part.TransliteratedText, part.TranslatedText]
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim() ?? '';
  const firstWordTime = words.find((word) => word.startTimeMs !== null)?.startTimeMs ?? null;
  return {
    text,
    timeMs: spicyTimeToMs(part.StartTime) ?? firstWordTime,
    ...(words.length ? { words } : {}),
  };
};

const toLrcTimestamp = (seconds: number) => {
  const centiseconds = Math.max(0, Math.floor(seconds * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const remainingSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = String(centiseconds % 100).padStart(2, '0');
  return `[${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.${fraction}]`;
};

const withoutLyricTiming = (words?: LyricWord[]) => words?.map((word) => ({
  ...word,
  startTimeMs: null,
  endTimeMs: null,
  syllables: word.syllables?.map((syllable) => ({ ...syllable, startTimeMs: null, endTimeMs: null })),
}));

const contributorFrom = (value: unknown) => {
  const contributor = asRecord(value);
  if (!contributor || typeof contributor.username !== 'string' || typeof contributor.url !== 'string') return undefined;
  return { username: contributor.username, url: contributor.url };
};

const lyricsAttributionFrom = (body: Record<string, unknown>): LyricsAttribution => {
  const source = typeof body.source === 'string' ? body.source : '';
  const provider = source === 'spicy_lyrics'
    ? 'Spicy Lyrics'
    : source === 'apple_music'
      ? 'Apple Music'
      : source === 'spotify'
        ? 'Spotify'
        : source || 'Unknown source';
  const uploadAttribution = asRecord(body.UploadAttribution);
  return {
    provider,
    ...(uploadAttribution ? {
      uploader: contributorFrom(uploadAttribution.Uploader),
      maker: contributorFrom(uploadAttribution.Maker),
    } : {}),
  };
};

const cacheEntryFromResponse = (body: Record<string, unknown>, trackSignature: string, spotifyTrackId: string): SpicyLyricsCacheEntry | null => {
  const content = Array.isArray(body.Content) ? body.Content : [];
  const rows: LyricLine[] = [];
  for (const item of content) {
    const itemRecord = asRecord(item);
    if (!itemRecord || (typeof itemRecord.Type === 'string' && itemRecord.Type !== 'Vocal')) continue;
    const lead = lyricsPartFromSpicy(itemRecord.Lead);
    if (!lead.text) continue;
    const background: LyricVoice[] = Array.isArray(itemRecord.Background)
      ? itemRecord.Background
          .map(lyricsPartFromSpicy)
          .filter((part) => part.text.length > 0)
      : [];
    rows.push({
      timeMs: lead.timeMs ?? spicyTimeToMs(itemRecord.StartTime),
      text: lead.text,
      ...(lead.words ? { words: lead.words } : {}),
      ...(background.length ? { background } : {}),
    });
  }
  if (rows.length === 0) return null;

  const type = typeof body.Type === 'string' ? body.Type.toLowerCase() : 'static';
  const precision: NonNullable<SpicyLyricsCacheEntry['precision']> = type === 'syllable' || type === 'line'
    ? type
    : 'static';
  const timedRows = precision !== 'static' ? rows.filter((row) => row.timeMs !== null) : [];
  const lyrics = precision === 'static'
    ? rows.map((line) => ({
        ...line,
        timeMs: null,
        words: withoutLyricTiming(line.words),
        background: line.background?.map((voice) => ({
          ...voice,
          timeMs: null,
          words: withoutLyricTiming(voice.words),
        })),
      }))
    : rows;
  const syncedLyrics = timedRows.length
    ? deduplicateSyncedLyrics(timedRows.map((row) => `${toLrcTimestamp(row.timeMs! / 1000)}${row.text}`).join('\n'))
    : undefined;
  const plainLyrics = syncedLyrics ? undefined : rows.map((row) => row.text).join('\n');
  if (!syncedLyrics && !plainLyrics) return null;

  return {
    cachedAt: Date.now(),
    trackSignature,
    spotifyTrackId,
    precision,
    syncedLyrics,
    plainLyrics,
    lyrics,
    source: typeof body.source === 'string' ? body.source : undefined,
    sourceVia: typeof body.source_via === 'string' ? body.source_via : undefined,
    attribution: lyricsAttributionFrom(body),
  };
};

const fetchSpicyJson = (path: string): Promise<{ status: number; data?: SpicyApiResponse }> => {
  const operation = spicyApiRequestQueue.then(async () => {
    if (Date.now() < spicyLyricsCooldownUntil) return { status: 429 };
    const waitForSlot = SPICY_API_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastSpicyApiRequestAt);
    if (waitForSlot > 0) await sleep(waitForSlot);
    lastSpicyApiRequestAt = Date.now();
    const response = await fetch(`${SPICY_LYRICS_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${spicyLyricsClientKey}`, Accept: 'application/json' },
    });
    if (response.status === 429 || response.status === 503) {
      const retryAfter = Number(response.headers.get('retry-after'));
      spicyLyricsCooldownUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000);
    } else if (response.status === 401 || response.status === 403) {
      spicyLyricsCooldownUntil = Number.POSITIVE_INFINITY;
    } else if (response.status === 500 || response.status === 502) {
      spicyLyricsCooldownUntil = Date.now() + 60_000;
    }
    if (!response.ok) return { status: response.status };
    return { status: response.status, data: await response.json() as SpicyApiResponse };
  });
  spicyApiRequestQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

const requestSpicyLyrics = async (
  track: Track,
  forceOnline = false,
  bypassIgnore = false,
): Promise<SpicyLyricsCacheEntry | null> => {
  if (!spicyLyricsClientKey || !spicyLyricsEnabled || !track.title.trim() || !track.artist.trim()) return null;
  if (!bypassIgnore && await OfflineMusicService.isSpicyLyricsIgnored(track.id)) return null;
  const trackSignature = trackLyricsSignature(track);
  let legacyCachedEntry: SpicyLyricsCacheEntry | null = null;
  if (!forceOnline) {
    const cached = await OfflineMusicService.getSpicyLyricsCache(track.id, trackSignature);
    if (cached?.noLyrics || cached?.precision) return cached;
    // Earlier cache versions flattened the API response to LRC and lost its
    // word timings. Refresh those entries once so karaoke timing is restored.
    if (cached) legacyCachedEntry = cached;
  }
  if (Date.now() < spicyLyricsCooldownUntil) return legacyCachedEntry;

  try {
    let spotifyTrackId = spotifyIdFromTrack(track) ?? legacyCachedEntry?.spotifyTrackId;
    if (!spotifyTrackId) {
      const searchParams = new URLSearchParams({ title: track.title.trim(), artist: track.artist.trim() });
      if (track.album.trim()) searchParams.set('album', track.album.trim());
      if (track.durationSeconds && track.durationSeconds > 0) searchParams.set('duration', String(track.durationSeconds));
      const search = await fetchSpicyJson(`/tracks/search?${searchParams.toString()}`);
      if (search.status !== 200) return legacyCachedEntry;
      const body = asRecord(search.data?.Body);
      const results = Array.isArray(body?.results) ? body.results as SpicySearchResult[] : [];
      const exactMatch = results.find((result) => result.tier === 'exact' && typeof result.id === 'string');
      spotifyTrackId = exactMatch?.id;
      if (!spotifyTrackId) {
        if (legacyCachedEntry) return legacyCachedEntry;
        if (spicyLyricsEnabled) {
          await OfflineMusicService.setSpicyLyricsCache(track.id, {
            cachedAt: Date.now(), trackSignature, noLyrics: true,
          });
        }
        return { cachedAt: Date.now(), trackSignature, noLyrics: true };
      }
    }

    const lyricsResponse = await fetchSpicyJson(`/lyrics/${encodeURIComponent(spotifyTrackId)}`);
    if (lyricsResponse.status === 404) {
      if (legacyCachedEntry) return legacyCachedEntry;
      const miss = { cachedAt: Date.now(), trackSignature, spotifyTrackId, noLyrics: true };
      if (spicyLyricsEnabled) await OfflineMusicService.setSpicyLyricsCache(track.id, miss);
      return miss;
    }
    if (lyricsResponse.status !== 200) return legacyCachedEntry;
    const body = asRecord(lyricsResponse.data?.Body);
    if (!body) return legacyCachedEntry;
    const entry = cacheEntryFromResponse(body, trackSignature, spotifyTrackId);
    if (!entry) {
      if (legacyCachedEntry) return legacyCachedEntry;
      const miss = { cachedAt: Date.now(), trackSignature, spotifyTrackId, noLyrics: true };
      if (spicyLyricsEnabled) await OfflineMusicService.setSpicyLyricsCache(track.id, miss);
      return miss;
    }
    if (spicyLyricsEnabled) await OfflineMusicService.setSpicyLyricsCache(track.id, entry);
    return entry;
  } catch {
    spicyLyricsCooldownUntil = Date.now() + 60_000;
    return legacyCachedEntry;
  }
};

const getSpicyLyricsEntry = (track: Track, forceOnline: boolean) => {
  const inFlight = spicyLyricsLookups.get(track.id);
  if (inFlight && !forceOnline) return inFlight;
  const lookup = requestSpicyLyrics(track, forceOnline).finally(() => {
    if (spicyLyricsLookups.get(track.id) === lookup) spicyLyricsLookups.delete(track.id);
  });
  spicyLyricsLookups.set(track.id, lookup);
  return lookup;
};

const applySpicyLyricsEntry = (local: Track, entry: SpicyLyricsCacheEntry, syncedOnly: boolean) => {
  if (entry.noLyrics || (!entry.syncedLyrics && (!entry.plainLyrics || syncedOnly))) return local;
  return {
    ...local,
    syncedLyrics: entry.syncedLyrics,
    plainLyrics: entry.plainLyrics,
    lyrics: entry.lyrics?.length ? entry.lyrics : parseLyrics(entry.syncedLyrics, entry.plainLyrics),
    lyricsAvailable: Boolean(entry.syncedLyrics || entry.plainLyrics),
    hasSyncedLyrics: Boolean(entry.syncedLyrics),
    hasPlainLyrics: Boolean(entry.plainLyrics),
    lyricsSource: 'spicy_lyrics_api',
    lyricsAttribution: entry.attribution,
  };
};

const sleep = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const runSpicyLyricsPrefetch = async (generation: number) => {
  if (spicyLyricsPrefetchRunning) return;
  spicyLyricsPrefetchRunning = true;
  try {
    while (
      spicyLyricsEnabled
      && spicyLyricsClientKey
      && generation === spicyLyricsPrefetchGeneration
      && spicyLyricsPrefetchQueue.length > 0
    ) {
      const track = spicyLyricsPrefetchQueue.shift();
      if (!track) continue;
      spicyLyricsPrefetchQueuedIds.delete(track.id);
      await getSpicyLyricsEntry(track, false);
      if (Date.now() < spicyLyricsCooldownUntil) {
        if (!spicyLyricsPrefetchQueuedIds.has(track.id)) {
          spicyLyricsPrefetchQueuedIds.add(track.id);
          spicyLyricsPrefetchQueue.unshift(track);
        }
        break;
      }
    }
  } finally {
    spicyLyricsPrefetchRunning = false;
    if (
      spicyLyricsEnabled
      && spicyLyricsClientKey
      && spicyLyricsPrefetchQueue.length > 0
    ) {
      if (spicyLyricsResumeTimer) clearTimeout(spicyLyricsResumeTimer);
      if (Date.now() < spicyLyricsCooldownUntil && Number.isFinite(spicyLyricsCooldownUntil)) {
        const retryDelay = Math.min(spicyLyricsCooldownUntil - Date.now(), 2_147_000_000);
        spicyLyricsResumeTimer = setTimeout(() => {
          spicyLyricsResumeTimer = null;
          void runSpicyLyricsPrefetch(spicyLyricsPrefetchGeneration);
        }, retryDelay);
      } else if (spicyLyricsCooldownUntil !== Number.POSITIVE_INFINITY) {
        void runSpicyLyricsPrefetch(spicyLyricsPrefetchGeneration);
      }
    }
  }
};

export { parseLyrics };

export const MusicCatalogService = {
  setSpicyLyricsClientKey(key: string): boolean {
    const normalizedKey = key.trim();
    spicyLyricsClientKey = normalizedKey.startsWith('sl_pk_') ? normalizedKey : '';
    spicyLyricsCooldownUntil = 0;
    this.cancelSpicyLyricsPrefetch();
    return Boolean(spicyLyricsClientKey);
  },

  isSpicyLyricsConfigured(): boolean {
    return Boolean(spicyLyricsClientKey);
  },

  async getCachedSpicyLyricsEntries(tracks: Track[]): Promise<{ trackId: string; entry: SpicyLyricsCacheEntry }[]> {
    const cachedEntries = await Promise.all(tracks.map(async (track) => {
      const entry = await OfflineMusicService.getSpicyLyricsCache(track.id, trackLyricsSignature(track));
      return entry && !entry.noLyrics && (entry.syncedLyrics || entry.plainLyrics || entry.lyrics?.length)
        ? { trackId: track.id, entry }
        : null;
    }));
    return cachedEntries.filter((entry): entry is { trackId: string; entry: SpicyLyricsCacheEntry } => entry !== null);
  },

  async renewSpicyLyrics(track: Track): Promise<boolean> {
    const cached = await OfflineMusicService.getSpicyLyricsCache(track.id, trackLyricsSignature(track));
    if (cached && !cached.noLyrics && await OfflineMusicService.renewSpicyLyricsCache(track.id)) return true;

    const refreshed = await requestSpicyLyrics(track, true, true);
    return Boolean(refreshed && !refreshed.noLyrics && (refreshed.syncedLyrics || refreshed.plainLyrics || refreshed.lyrics?.length));
  },

  setSpicyLyricsEnabled(enabled: boolean): void {
    spicyLyricsEnabled = enabled;
    if (!enabled) this.cancelSpicyLyricsPrefetch();
  },

  cancelSpicyLyricsPrefetch(): void {
    spicyLyricsPrefetchGeneration += 1;
    spicyLyricsPrefetchQueue.length = 0;
    spicyLyricsPrefetchQueuedIds.clear();
    if (spicyLyricsResumeTimer) clearTimeout(spicyLyricsResumeTimer);
    spicyLyricsResumeTimer = null;
  },

  prefetchSpicyLyrics(tracks: Track[]): void {
    if (!spicyLyricsEnabled || !spicyLyricsClientKey) return;
    tracks.forEach((track) => {
      if (spicyLyricsPrefetchQueuedIds.has(track.id)) return;
      spicyLyricsPrefetchQueuedIds.add(track.id);
      spicyLyricsPrefetchQueue.push(track);
    });
    if (spicyLyricsPrefetchQueue.length > 0) void runSpicyLyricsPrefetch(spicyLyricsPrefetchGeneration);
  },

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
    return OfflineMusicService.updateTrack(
      updated,
      changes.artworkUri ? { uri: changes.artworkUri, mimeType: changes.artworkMimeType } : undefined,
    );
  },

  async deleteTrack(track: Track): Promise<void> {
    await OfflineMusicService.removeDownloadedTracks([track.id]);
  },

  async getLyrics(track: Track, syncedOnly = false, forceOnline = false, allowSpicyApi = true): Promise<Track> {
    const cleanTrack = withoutSpicyApiLyrics(track);
    if (allowSpicyApi && !spicyLyricsEnabled) return resolveLocalLyrics(cleanTrack);
    if (allowSpicyApi && spicyLyricsEnabled && spicyLyricsClientKey) {
      try {
        if (await OfflineMusicService.isSpicyLyricsIgnored(track.id)) return resolveLocalLyrics(cleanTrack);
        const entry = await getSpicyLyricsEntry(track, forceOnline);
        const stillIgnored = await OfflineMusicService.isSpicyLyricsIgnored(track.id);
        if (spicyLyricsEnabled && !stillIgnored && entry && !entry.noLyrics) {
          const apiTrack = applySpicyLyricsEntry(cleanTrack, entry, syncedOnly);
          if (apiTrack.lyricsSource === 'spicy_lyrics_api' && hasRenderableLyrics(apiTrack)) return apiTrack;
        }
      } catch {
        // A cache or API failure must not prevent local files and embedded tags from being checked.
      }
      return resolveLocalLyrics(cleanTrack);
    }
    const result = await resolveLocalLyrics(cleanTrack);
    if (forceOnline) return lookupLyricsOnline(track, result, syncedOnly);
    if (
      hasRenderableLyrics(result)
      && (!syncedOnly || Boolean(result.hasSyncedLyrics || result.syncedLyrics?.trim()))
    ) return result;
    return lookupLyricsOnline(track, result, syncedOnly);
  },

  async saveSyncedLyrics(track: Track, syncedLyrics: string): Promise<void> {
    await OfflineMusicService.saveSyncedLyrics(track, syncedLyrics);
  },

  async resolveMediaLink(url: string): Promise<MediaLinkMetadata> {
    const trimmed = url.trim();
    let source: URL;
    try {
      source = new URL(trimmed);
    } catch {
      throw new Error('Paste a valid Spotify or SoundCloud track link.');
    }
    if (source.protocol !== 'https:') throw new Error('Track links must use HTTPS.');

    const host = source.hostname.toLowerCase();
    const isSpotify = host === 'open.spotify.com' || host === 'spotify.link';
    const isSoundCloud = host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
    if (!isSpotify && !isSoundCloud) {
      throw new Error('Paste a Spotify or SoundCloud track link to identify the song.');
    }
    if (isSpotify && host !== 'spotify.link' && !/^\/track\//.test(source.pathname)) {
      throw new Error('Paste a Spotify track link, not a playlist or album link.');
    }

    const provider: MediaLinkMetadata['provider'] = isSoundCloud ? 'SoundCloud' : 'Spotify';
    const spotifyEmbedHost = host === 'spotify.link' ? 'https://spotify.link/oembed' : 'https://open.spotify.com/oembed';
    const endpoint = new URL(isSoundCloud ? 'https://soundcloud.com/oembed' : spotifyEmbedHost);
    endpoint.searchParams.set('url', source.toString());
    if (isSoundCloud) {
      endpoint.searchParams.set('format', 'json');
      endpoint.searchParams.set('show_artwork', 'true');
    }

    const response = await fetch(endpoint.toString());
    if (!response.ok) {
      throw new Error(`Could not read this ${provider} track link (HTTP ${response.status}).`);
    }
    const result = await response.json() as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    const title = result.title?.trim() ?? '';
    const artist = result.author_name?.trim() ?? '';
    if (!title) throw new Error(`No track title was returned by ${provider}.`);
    return {
      provider,
      title,
      artist,
      artwork: result.thumbnail_url?.startsWith('https://') ? result.thumbnail_url : '',
    };
  },

  async importAudioUrl(
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
    artworkUrl = '',
  ): Promise<Track> {
    return OfflineMusicService.importAudioUrl(url, title || titleFromUrl(url), artist, sourceUrl, onProgress, artworkUrl);
  },
};
