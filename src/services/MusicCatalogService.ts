import { File } from 'expo-file-system';
import { parse as parseYaml } from 'yaml';
import type { LyricsAttribution, LyricsFormat, LyricLine, LyricSyllable, LyricVoice, LyricWord, PlaylistSummary, Track } from '../types';
import { deduplicateSyncedLyrics, parseLyrics } from './LyricsParser';
import { OfflineMusicService, type SpicyLyricsCacheEntry } from './OfflineMusicService';
import { PlaylistStorageService } from './PlaylistStorageService';

/** Local library boundary kept under the old service name for screen compatibility. */

let apiToken = '';
let spicyLyricsClientKey = '';
const SPICY_LYRICS_API_BASE = 'https://api.spicylyrics.org/v1';
const SPICY_API_MIN_REQUEST_INTERVAL_MS = 1_000;
let spicyLyricsEnabled = false;
let spicyLyricsAutoDownloadAllowed = false;
let spicyLyricsCooldownUntil = 0;
let spicyLyricsPrefetchGeneration = 0;
let spicyLyricsPrefetchRunning = false;
let spicyLyricsResumeTimer: ReturnType<typeof setTimeout> | null = null;
const spicyLyricsPrefetchQueue: Track[] = [];
const spicyLyricsPrefetchQueuedIds = new Set<string>();
const spicyLyricsLookups = new Map<string, Promise<SpicyLyricsCacheEntry | null>>();
type EmbeddedLyricsLookup = {
  text: string;
  format: 'ttml' | 'line' | 'plain';
  source: string;
  attribution?: LyricsAttribution;
} | null;
const embeddedLyricsLookups = new Map<string, Promise<EmbeddedLyricsLookup>>();
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
    lyricsFormat: hasSyncedLyrics ? 'line' : 'plain',
    lyricsTtml: undefined,
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
      lyricsFormat: undefined,
      lyricsTtml: undefined,
      lyricsLookupProviders: undefined,
      lyricsLookupIssues: undefined,
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

const durationSecondsForTrack = (track: Track) => {
  if (track.durationSeconds && Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) {
    return track.durationSeconds;
  }
  const parts = track.duration.trim().split(':');
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  return numbers.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
};

const normalizeTrackText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const trackTextMatches = (actual: string, expected: string) => {
  const left = normalizeTrackText(actual);
  const right = normalizeTrackText(expected);
  return Boolean(left && right && (left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)));
};

const xmlDecode = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
  const normalized = name.toLowerCase();
  if (normalized === 'amp') return '&';
  if (normalized === 'lt') return '<';
  if (normalized === 'gt') return '>';
  if (normalized === 'quot') return '"';
  if (normalized === 'apos') return "'";
  const codePoint = normalized.startsWith('#x')
    ? Number.parseInt(normalized.slice(2), 16)
    : Number.parseInt(normalized.slice(1), 10);
  return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
});

const xmlText = (value: string) => xmlDecode(value
  .replace(/<br\b[^>]*\/?\s*>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/\s+/g, ' ')
  .trim());

const xmlAttributes = (value: string) => {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].split(':').at(-1) ?? match[1]] = xmlDecode(match[2] ?? match[3] ?? '');
  }
  return attributes;
};

const ttmlTimeMs = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  const secondsUnit = trimmed.match(/^([\d.]+)s$/i);
  if (secondsUnit) return Math.round(Number(secondsUnit[1]) * 1000);
  const millisecondsUnit = trimmed.match(/^([\d.]+)ms$/i);
  if (millisecondsUnit) return Math.round(Number(millisecondsUnit[1]));
  const parts = trimmed.split(':');
  if (parts.length === 3 && parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) {
    return Math.round((Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * 1000);
  }
  if (parts.length === 2 && parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) {
    return Math.round((Number(parts[0]) * 60 + Number(parts[1])) * 1000);
  }
  return null;
};

const lrcTimestampFromMs = (timeMs: number) => {
  const centiseconds = Math.max(0, Math.floor(timeMs / 10));
  const minutes = Math.floor(centiseconds / 6000);
  const remainingSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = String(centiseconds % 100).padStart(2, '0');
  return `[${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.${fraction}]`;
};

const lrcFromLyricLines = (lyrics: LyricLine[]) => lyrics
  .filter((line) => line.timeMs !== null && line.text.trim())
  .map((line) => `${lrcTimestampFromMs(line.timeMs!)}${line.text.trim()}`)
  .join('\n');

const parseTtmlLyrics = (ttml: string): LyricLine[] => {
  const paragraphs = [...ttml.matchAll(/<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p\s*>/gi)];
  const lines: LyricLine[] = [];
  for (const paragraph of paragraphs) {
    const paragraphAttributes = xmlAttributes(paragraph[1]);
    const rawContent = paragraph[2];
    const text = xmlText(rawContent);
    if (!text) continue;

    const words: LyricWord[] = [];
    let currentWordText = '';
    let currentSyllables: LyricSyllable[] = [];
    const flushWord = () => {
      const trimmed = currentWordText.trim();
      if (trimmed) {
        const starts = currentSyllables.map((syllable) => syllable.startTimeMs).filter((time): time is number => time !== null);
        const ends = currentSyllables.map((syllable) => syllable.endTimeMs).filter((time): time is number => time !== null);
        words.push({
          text: trimmed,
          startTimeMs: starts.length ? Math.min(...starts) : null,
          endTimeMs: ends.length ? Math.max(...ends) : null,
          ...(currentSyllables.length ? { syllables: currentSyllables } : {}),
        });
      }
      currentWordText = '';
      currentSyllables = [];
    };

    // TTML commonly nests timed spans (for example, syllables inside a word).
    // Tokenize the XML stream so nested span boundaries do not truncate timing.
    const activeTimings: { startTimeMs: number | null; endTimeMs: number | null }[] = [];
    const tokens = /<(\/)?(?:[\w.-]+:)?span\b([^>]*)>|<(?:[\w.-]+:)?br\b[^>]*\/?>|([^<]+)|<[^>]*>/gi;
    for (const token of rawContent.matchAll(tokens)) {
      const fullToken = token[0];
      if (/^<\//.test(fullToken) && /span\b/i.test(fullToken)) {
        activeTimings.pop();
        continue;
      }
      if (/^<(?:(?:[\w.-]+:)?span)\b/i.test(fullToken)) {
        const attributes = xmlAttributes(token[2] ?? '');
        const parent = activeTimings.at(-1);
        const timing = {
          startTimeMs: ttmlTimeMs(attributes.begin) ?? ttmlTimeMs(attributes.start) ?? parent?.startTimeMs ?? ttmlTimeMs(paragraphAttributes.begin),
          endTimeMs: ttmlTimeMs(attributes.end) ?? ttmlTimeMs(attributes.stop) ?? parent?.endTimeMs ?? ttmlTimeMs(paragraphAttributes.end),
        };
        if (!/\/\s*>$/.test(fullToken)) activeTimings.push(timing);
        continue;
      }
      if (/^<(?:(?:[\w.-]+:)?br)\b/i.test(fullToken)) {
        flushWord();
        continue;
      }
      if (token[3] === undefined) continue;
      const decoded = xmlDecode(token[3]).replace(/\u00a0/g, ' ');
      const activeTiming = activeTimings.at(-1);
      for (const part of decoded.matchAll(/\s+|\S+/gu)) {
        if (/^\s+$/u.test(part[0])) {
          flushWord();
          continue;
        }
        currentWordText += part[0];
        if (activeTiming) currentSyllables.push({ text: part[0], ...activeTiming });
      }
    }
    flushWord();

    const lineStart = ttmlTimeMs(paragraphAttributes.begin) ?? words.find((word) => word.startTimeMs !== null)?.startTimeMs ?? null;
    const lineEnd = ttmlTimeMs(paragraphAttributes.end) ?? [...words].reverse().find((word) => word.endTimeMs !== null)?.endTimeMs ?? null;
    lines.push({
      timeMs: lineStart,
      endTimeMs: lineEnd,
      text,
      ...(words.some((word) => word.startTimeMs !== null || word.endTimeMs !== null) ? { words } : {}),
    });
  }
  return lines;
};

const escapeXmlText = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const ttmlTimeFromMs = (timeMs: number) => {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  const hours = Math.floor(safeTimeMs / 3_600_000);
  const minutes = Math.floor((safeTimeMs % 3_600_000) / 60_000);
  const seconds = ((safeTimeMs % 60_000) / 1_000).toFixed(3).padStart(6, '0');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds}`;
};

const serializeLyricsAsTtml = (lines: LyricLine[]) => {
  const body = lines.map((line) => {
    const begin = line.timeMs !== null ? ` begin="${ttmlTimeFromMs(line.timeMs)}"` : '';
    const end = typeof line.endTimeMs === 'number' ? ` end="${ttmlTimeFromMs(line.endTimeMs)}"` : '';
    const content = line.words?.length
      ? line.words.map((word) => {
          const wordBegin = word.startTimeMs !== null ? ` begin="${ttmlTimeFromMs(word.startTimeMs)}"` : '';
          const wordEnd = word.endTimeMs !== null ? ` end="${ttmlTimeFromMs(word.endTimeMs)}"` : '';
          return `<span${wordBegin}${wordEnd}>${escapeXmlText(word.text)}</span>`;
        }).join('')
      : escapeXmlText(line.text);
    return `<p${begin}${end}>${content}</p>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div>${body}</div></body></tt>`;
};

const parseQrcLyrics = (qrc: string, track?: Pick<Track, 'title' | 'artist'>): LyricLine[] => {
  const lyricElement = qrc.match(/<(?:[\w.-]+:)?Lyric_1\b([^>]*)\/?\s*>/i);
  const qrcBody = lyricElement ? xmlAttributes(lyricElement[1]).LyricContent ?? qrc : qrc;
  const parsed: LyricLine[] = [];
  for (const rawLine of qrcBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^\[(\d+),(\d+)\]/);
    if (!header) continue;
    const startMs = Number(header[1]);
    const durationMs = Number(header[2]);
    const rest = line.slice(header[0].length);
    const words: LyricWord[] = [];
    let textStart = 0;
    for (const token of rest.matchAll(/\((\d+),(\d+)\)/g)) {
      const tokenIndex = token.index ?? 0;
      const text = rest.slice(textStart, tokenIndex);
      const wordStart = Number(token[1]);
      const wordDuration = Number(token[2]);
      if (text.trim()) words.push({
        text,
        startTimeMs: wordStart,
        endTimeMs: wordDuration > 0 ? wordStart + wordDuration : null,
      });
      textStart = tokenIndex + token[0].length;
    }
    if (!words.length) continue;
    const text = words.map((word) => word.text).join('').trim();
    if (!text || /^(?:lyrics\s+by|composed\s+by|arranged\s+by|producer\s*[:：]|作词\s*[:：]|作曲\s*[:：]|编曲\s*[:：]|制作人\s*[:：])/i.test(text)) continue;
    if (parsed.length < 3 && track && (
      trackTextMatches(text.replace(/\s*[-–—]\s*.*$/, ''), track.title)
      || trackTextMatches(text, track.artist)
      || (normalizeTrackText(text).startsWith(normalizeTrackText(track.title))
        && normalizeTrackText(text).includes(normalizeTrackText(track.artist)))
    )) continue;
    parsed.push({
      timeMs: startMs,
      endTimeMs: durationMs > 0 ? startMs + durationMs : null,
      text,
      words,
    });
  }
  return parsed;
};

type ParsedLyricsPayload = {
  format: LyricsFormat;
  lyrics: LyricLine[];
  syncedLyrics?: string;
  plainLyrics?: string;
  ttml?: string;
};

const parseLyricsfile = (value?: string | null): ParsedLyricsPayload | null => {
  if (!value?.trim()) return null;
  try {
    const document = parseYaml(value) as {
      lines?: {
        text?: string;
        start_ms?: number;
        end_ms?: number;
        words?: { text?: string; start_ms?: number; end_ms?: number }[];
      }[];
      plain?: string;
    } | null;
    const lyricLines = Array.isArray(document?.lines)
      ? document.lines
          .map((line): LyricLine | null => {
            const words = Array.isArray(line.words) ? line.words.filter((word) => typeof word.text === 'string').map((word) => ({
                text: word.text!,
                startTimeMs: typeof word.start_ms === 'number' ? word.start_ms : null,
                endTimeMs: typeof word.end_ms === 'number' ? word.end_ms : null,
              })) : [];
            const text = typeof line.text === 'string' && line.text.trim()
              ? line.text.trim()
              : words.map((word) => word.text).join('').trim();
            if (!text) return null;
            const wordStarts = words.map((word) => word.startTimeMs).filter((time): time is number => time !== null);
            const wordEnds = words.map((word) => word.endTimeMs).filter((time): time is number => time !== null);
            return {
              timeMs: typeof line.start_ms === 'number' ? line.start_ms : wordStarts.length ? Math.min(...wordStarts) : null,
              endTimeMs: typeof line.end_ms === 'number' ? line.end_ms : wordEnds.length ? Math.max(...wordEnds) : null,
              text,
              ...(words.length ? { words } : {}),
            };
          })
          .filter((line): line is LyricLine => Boolean(line))
      : [];
    if (lyricLines.length) {
      const hasWordTiming = lyricLines.some((line) => line.words?.some((word) => word.startTimeMs !== null || word.endTimeMs !== null));
      const hasLineTiming = lyricLines.some((line) => line.timeMs !== null);
      const format: LyricsFormat = hasWordTiming ? 'word' : hasLineTiming ? 'line' : 'plain';
      const syncedLyrics = hasLineTiming ? lrcFromLyricLines(lyricLines) : undefined;
      return { format, lyrics: lyricLines, syncedLyrics, plainLyrics: syncedLyrics ? undefined : lyricLines.map((line) => line.text).join('\n') };
    }
    const plainLyrics = typeof document?.plain === 'string' ? document.plain.trim() : '';
    return plainLyrics ? { format: 'plain', lyrics: parseLyrics(undefined, plainLyrics), plainLyrics } : null;
  } catch {
    return null;
  }
};

const lyricsPayloadFromRecord = (record: Record<string, unknown>, provider: string, track?: Track): Track | null => {
  const lyricsValue = typeof record.lyrics === 'string' ? record.lyrics : '';
  const ttml = [record.ttml, record.ttmlContent, record.lyricsTtml, record.ttmlLyrics, record.content, lyricsValue]
    .find((value): value is string => typeof value === 'string' && value.trim().startsWith('<'));
  if (ttml && /<(?:[\w.-]+:)?tt\b|<(?:[\w.-]+:)?p\b/i.test(ttml)) {
    const lyrics = parseTtmlLyrics(ttml);
    const syncedLyrics = lrcFromLyricLines(lyrics);
    if (lyrics.length && syncedLyrics) return {
      id: '', title: '', artist: '', album: '', duration: '', artwork: '',
      lyrics, syncedLyrics, lyricsFormat: 'ttml', lyricsTtml: ttml,
      lyricsAvailable: true, hasSyncedLyrics: true, lyricsSource: provider,
      lyricsAttribution: providerAttribution(provider),
    };
  }

  const lyricsFileText = [record.lyricsfile, record.lyricsFile, record.lyrics_file]
    .find((value): value is string => typeof value === 'string');
  const lyricsFile = lyricsFileText ? parseLyricsfile(lyricsFileText) : null;
  if (lyricsFile) {
    const fallbackSyncedLyrics = lyricsFile.format === 'plain'
      ? [record.syncedLyrics, record.lrc].find((value): value is string => typeof value === 'string' && hasTimedText(value))?.trim()
      : undefined;
    if (fallbackSyncedLyrics) return {
      id: '', title: '', artist: '', album: '', duration: '', artwork: '',
      lyrics: parseLyrics(fallbackSyncedLyrics), syncedLyrics: fallbackSyncedLyrics,
      lyricsFormat: 'line', lyricsAvailable: true, hasSyncedLyrics: true,
      lyricsSource: provider, lyricsAttribution: providerAttribution(provider),
    };
    return {
      id: '', title: '', artist: '', album: '', duration: '', artwork: '',
      lyrics: lyricsFile.lyrics, syncedLyrics: lyricsFile.syncedLyrics, plainLyrics: lyricsFile.plainLyrics,
      lyricsFormat: lyricsFile.format,
      lyricsTtml: lyricsFile.format === 'word' ? serializeLyricsAsTtml(lyricsFile.lyrics) : undefined,
      lyricsAvailable: true,
      hasSyncedLyrics: lyricsFile.format === 'word' || lyricsFile.format === 'line',
      hasPlainLyrics: lyricsFile.format === 'plain', lyricsSource: provider,
      lyricsAttribution: providerAttribution(provider),
    };
  }

  const qrc = [record.lyrics, record.content]
    .find((value): value is string => typeof value === 'string' && /<(?:[\w.-]+:)?QrcInfos\b|\[\d+,\d+\]/i.test(value));
  if (qrc) {
    const lyrics = parseQrcLyrics(qrc, track);
    const syncedLyrics = lrcFromLyricLines(lyrics);
    if (lyrics.length && syncedLyrics) return {
      id: '', title: '', artist: '', album: '', duration: '', artwork: '',
      lyrics, syncedLyrics, lyricsTtml: serializeLyricsAsTtml(lyrics), lyricsFormat: 'word',
      lyricsAvailable: true, hasSyncedLyrics: true, lyricsSource: provider,
      lyricsAttribution: providerAttribution(provider),
    };
  }

  const lines = Array.isArray(record.lines) ? record.lines : null;
  if (lines?.length) {
    const parsedLines: LyricLine[] = lines.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const startValue = row.start ?? row.start_ms ?? row.timeMs;
      const endValue = row.end ?? row.end_ms ?? row.endTimeMs;
      const start = typeof startValue === 'number' ? startValue : null;
      const end = typeof endValue === 'number' ? endValue : null;
      const words = Array.isArray(row.words) ? row.words.flatMap((word): LyricWord[] => {
        if (!word || typeof word !== 'object') return [];
        const part = word as Record<string, unknown>;
        if (typeof part.text !== 'string') return [];
        return [{
          text: part.text,
          startTimeMs: typeof (part.start ?? part.start_ms) === 'number' ? Number(part.start ?? part.start_ms) : null,
          endTimeMs: typeof (part.end ?? part.end_ms) === 'number' ? Number(part.end ?? part.end_ms) : null,
        }];
      }) : [];
      const text = typeof row.text === 'string' && row.text.trim()
        ? row.text.trim()
        : words.map((word) => word.text).join('').trim();
      if (!text) return [];
      return [{
        timeMs: start,
        endTimeMs: end,
        text,
        ...(words.length ? { words } : {}),
      }];
    });
    if (parsedLines.length) {
      const hasWordTiming = parsedLines.some((line) => line.words?.some((word) => word.startTimeMs !== null || word.endTimeMs !== null));
      const hasTiming = parsedLines.some((line) => line.timeMs !== null);
      const format: LyricsFormat = hasWordTiming ? 'word' : hasTiming ? 'line' : 'plain';
      const syncedLyrics = hasTiming ? lrcFromLyricLines(parsedLines) : undefined;
      return {
        id: '', title: '', artist: '', album: '', duration: '', artwork: '',
        lyrics: parsedLines, syncedLyrics,
        plainLyrics: syncedLyrics ? undefined : parsedLines.map((line) => line.text).join('\n'),
        lyricsFormat: format, lyricsAvailable: true,
        lyricsTtml: format === 'word' ? serializeLyricsAsTtml(parsedLines) : undefined,
        hasSyncedLyrics: hasTiming, hasPlainLyrics: !hasTiming,
        lyricsSource: provider, lyricsAttribution: providerAttribution(provider),
      };
    }
  }

  const syncedLyrics = [record.syncedLyrics, record.lrc, record.lyrics]
    .find((value): value is string => typeof value === 'string' && hasTimedText(value))?.trim();
  if (syncedLyrics) return {
    id: '', title: '', artist: '', album: '', duration: '', artwork: '',
    syncedLyrics, lyrics: parseLyrics(syncedLyrics), lyricsFormat: 'line',
    lyricsAvailable: true, hasSyncedLyrics: true, lyricsSource: provider,
    lyricsAttribution: providerAttribution(provider),
  };

  const plainLyrics = [record.plainLyrics, record.plain, record.lyrics, record.text]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
  if (!plainLyrics) return null;
  return {
    id: '', title: '', artist: '', album: '', duration: '', artwork: '',
    plainLyrics, lyrics: parseLyrics(undefined, plainLyrics), lyricsFormat: 'plain',
    lyricsAvailable: true, hasPlainLyrics: true, lyricsSource: provider,
    lyricsAttribution: providerAttribution(provider),
  };
};

const providerAttribution = (provider: string): LyricsAttribution => {
  const details: Record<string, { name: string; url: string }> = {
    'LRCLIB': { name: 'LRCLIB', url: 'https://lrclib.net/' },
    'Better Lyrics': { name: 'Better Lyrics', url: 'https://better-lyrics.boidu.dev/' },
    'lrc.red': { name: 'lrc.red', url: 'https://lrc.red/' },
    'LiriQo': { name: 'LiriQo', url: 'https://github.com/AlFarrizi-Studio/Liriqo' },
    'Spicy Lyrics': { name: 'Spicy Lyrics', url: 'https://spicylyrics.org/' },
  };
  const info = details[provider];
  return { provider: info?.name ?? provider, ...(info ? { providerUrl: info.url } : {}) };
};

const titleFromUrl = (url: string) => {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const value = pathname.split('/').filter(Boolean).at(-1) ?? 'Imported audio';
    return value.replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported audio';
  } catch {
    return 'Imported audio';
  }
};

const persistLyricsAsEmbedded = async (
  track: Track,
  resolvedTrack: Track,
  format: 'ttml' | 'line' | 'plain',
  text: string,
): Promise<Track> => {
  const payload = { version: 1 as const, format, text: text.trim(), source: resolvedTrack.lyricsAttribution?.provider, attribution: resolvedTrack.lyricsAttribution };
  const embeddedTrack: Track = {
    ...resolvedTrack,
    lyricsFormat: format,
    lyricsSource: 'embedded_musiqapp',
  };
  if (track.localUri && new File(track.localUri).extension.toLowerCase() === '.mp3') {
    try {
      await OfflineMusicService.embedLyricsInTrackAudio(embeddedTrack, payload);
    } catch {
      // Keep a private indexed copy even when an older MP3 cannot be rewritten.
    }
  }
  try {
    return await OfflineMusicService.saveEmbeddedLyrics(embeddedTrack, payload.text);
  } catch {
    // Keep the discovered lyrics available even when a legacy file cannot be migrated.
    return resolvedTrack;
  }
};

const readLyricsFile = async (track: Track): Promise<Track> => {
  const ttmlCandidates: File[] = [];
  const lrcCandidates: File[] = [];
  const addCandidate = (uri: string | undefined, expectedExtension?: string) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (expectedExtension && file.extension.toLowerCase() !== expectedExtension) return;
      const list = file.extension.toLowerCase() === '.ttml' ? ttmlCandidates : lrcCandidates;
      if (!list.some((candidate) => candidate.uri === file.uri)) list.push(file);
    } catch {
      // Ignore malformed or stale sidecar references and keep checking.
    }
  };

  // Legacy sidecars are considered only after audio metadata has been checked.
  if (track.localUri) {
    try {
      const audioFile = new File(track.localUri);
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      addCandidate(new File(audioFile.parentDirectory, `${baseName}.ttml`).uri, '.ttml');
      addCandidate(new File(audioFile.parentDirectory, `${baseName}.lrc`).uri, '.lrc');
    } catch {
      // Continue with the indexed lyric URI and embedded metadata.
    }
  }
  addCandidate(track.lyricsFileUri, '.ttml');
  addCandidate(track.lyricsFileUri, '.lrc');

  for (const lyricsFile of ttmlCandidates) {
    try {
      if (!lyricsFile.exists) continue;
      const ttml = (await lyricsFile.text()).trim();
      const lyrics = parseTtmlLyrics(ttml);
      const syncedLyrics = lrcFromLyricLines(lyrics);
      if (!lyrics.length || !syncedLyrics) continue;
      const resolvedTrack: Track = {
        ...track,
        syncedLyrics,
        plainLyrics: undefined,
        lyrics,
        lyricsFormat: 'ttml',
        lyricsTtml: ttml,
        lyricsAvailable: true,
        hasSyncedLyrics: true,
        hasPlainLyrics: false,
        lyricsSource: 'local_ttml',
      };
      return persistLyricsAsEmbedded(track, resolvedTrack, 'ttml', ttml);
    } catch {
      // An unavailable or malformed rich sidecar should not block LRC fallback.
    }
  }

  for (const lyricsFile of lrcCandidates) {
    try {
      if (!lyricsFile.exists) continue;
      const text = (await lyricsFile.text()).trim();
      if (!text) continue;
      const syncedLyrics = deduplicateSyncedLyrics(text);
      if (!syncedLyrics) continue;
      const resolvedTrack: Track = {
        ...track,
        syncedLyrics,
        plainLyrics: undefined,
        lyrics: parseLyrics(syncedLyrics),
        lyricsFormat: 'line',
        lyricsAvailable: true,
        hasSyncedLyrics: true,
        hasPlainLyrics: false,
        lyricsSource: 'local_lrc',
      };
      return persistLyricsAsEmbedded(track, resolvedTrack, 'line', syncedLyrics);
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
        const resolvedTrack: Track = {
          ...track,
          syncedLyrics,
          plainLyrics: undefined,
          lyrics: parseLyrics(syncedLyrics),
          lyricsFormat: 'line',
          lyricsAvailable: true,
          hasSyncedLyrics: true,
          hasPlainLyrics: false,
          lyricsSource: 'local_lrc',
        };
        return persistLyricsAsEmbedded(track, resolvedTrack, 'line', syncedLyrics);
      }
      const resolvedTrack: Track = {
        ...track,
        plainLyrics: text,
        lyrics: parseLyrics(undefined, text),
        lyricsFormat: 'plain',
        lyricsAvailable: true,
        hasPlainLyrics: true,
        lyricsSource: 'local_text',
      };
      return persistLyricsAsEmbedded(track, resolvedTrack, 'plain', text);
    } catch {
      // Keep the fallback non-fatal for offline playback.
    }
  }

  // Retain indexed lyrics as a compatibility fallback for older imports.
  if (track.lyricsTtml?.trim()) {
    const ttml = track.lyricsTtml.trim();
    const lyrics = parseTtmlLyrics(ttml);
    const syncedLyrics = lrcFromLyricLines(lyrics);
    if (lyrics.length && syncedLyrics) {
      return persistLyricsAsEmbedded(track, {
        ...track,
        syncedLyrics,
        plainLyrics: undefined,
        lyrics,
        lyricsFormat: 'ttml',
        lyricsAvailable: true,
        hasSyncedLyrics: true,
        hasPlainLyrics: false,
        lyricsSource: 'embedded_musiqapp',
      }, 'ttml', ttml);
    }
  }
  const indexedSyncedLyrics = track.syncedLyrics?.trim();
  const indexedPlainLyrics = track.plainLyrics?.trim();
  if (indexedSyncedLyrics || indexedPlainLyrics) {
    const syncedLyrics = indexedSyncedLyrics
      ? deduplicateSyncedLyrics(indexedSyncedLyrics)
      : undefined;
    const plainLyrics = indexedPlainLyrics || (syncedLyrics && !hasTimedText(syncedLyrics) ? syncedLyrics : undefined);
    const timedLyrics = syncedLyrics && hasTimedText(syncedLyrics) ? syncedLyrics : undefined;
    const resolvedTrack: Track = {
      ...track,
      syncedLyrics: timedLyrics,
      plainLyrics: timedLyrics ? undefined : plainLyrics,
      lyrics: parseLyrics(timedLyrics, plainLyrics),
      lyricsFormat: timedLyrics ? 'line' : 'plain',
      lyricsAvailable: Boolean(timedLyrics || plainLyrics),
      hasSyncedLyrics: Boolean(timedLyrics),
      hasPlainLyrics: Boolean(plainLyrics),
    };
    return persistLyricsAsEmbedded(
      track,
      resolvedTrack,
      timedLyrics ? 'line' : 'plain',
      timedLyrics || plainLyrics || '',
    );
  }
  if (track.lyrics?.some((line) => line.text.trim())) {
    const timedLyrics = lrcFromLyricLines(track.lyrics);
    const plainLyrics = track.lyrics.map((line) => line.text.trim()).filter(Boolean).join('\n');
    return persistLyricsAsEmbedded(
      track,
      {
        ...track,
        syncedLyrics: timedLyrics || undefined,
        plainLyrics: timedLyrics ? undefined : plainLyrics,
        lyricsFormat: timedLyrics ? 'line' : 'plain',
        lyricsAvailable: Boolean(timedLyrics || plainLyrics),
        hasSyncedLyrics: Boolean(timedLyrics),
        hasPlainLyrics: Boolean(!timedLyrics && plainLyrics),
      },
      timedLyrics ? 'line' : 'plain',
      timedLyrics || plainLyrics,
    );
  }

  return track;
};

const readEmbeddedLyrics = async (track: Track, localTrack: Track): Promise<Track> => {
  const isIndexedEmbeddedLyrics = localTrack.lyricsSource === 'embedded_lrc'
    || localTrack.lyricsSource === 'embedded_text'
    || localTrack.lyricsSource === 'embedded_musiqapp';
  if (isIndexedEmbeddedLyrics && localTrack.lyricsFormat === 'ttml' && localTrack.lyricsTtml?.trim()) {
    const lyrics = parseTtmlLyrics(localTrack.lyricsTtml);
    const syncedLyrics = lrcFromLyricLines(lyrics);
    if (lyrics.length) return {
      ...localTrack,
      lyrics,
      syncedLyrics: syncedLyrics || localTrack.syncedLyrics,
      lyricsAvailable: true,
      hasSyncedLyrics: Boolean(syncedLyrics),
    };
  }
  if (isIndexedEmbeddedLyrics && hasRenderableLyrics(localTrack)) return localTrack;
  if (!track.localUri) return localTrack;
  try {
    const audioFile = new File(track.localUri);
    const cacheKey = `${track.id}:${audioFile.uri}:${audioFile.size ?? 0}:${audioFile.modificationTime ?? 0}`;
    let lookup = embeddedLyricsLookups.get(cacheKey);
    if (!lookup) {
      lookup = OfflineMusicService.inspectLocalAudioMetadata(track.localUri)
        .then((metadata) => {
          const format: 'ttml' | 'line' | 'plain' = metadata.lyricsFormat === 'ttml'
            ? 'ttml'
            : metadata.lyricsFormat === 'line' || metadata.hasSyncedLyrics
              ? 'line'
              : 'plain';
          const text = (format === 'ttml'
            ? metadata.lyricsTtml
            : format === 'line'
              ? metadata.syncedLyrics ?? metadata.lyricsText
              : metadata.plainLyrics ?? metadata.lyricsText)?.trim();
          return text ? {
            text,
            format,
            source: metadata.lyricsSource ?? (format === 'plain' ? 'embedded_text' : 'embedded_lrc'),
            attribution: metadata.lyricsAttribution,
          } : null;
        })
        .catch(() => null);
      embeddedLyricsLookups.set(cacheKey, lookup);
      if (embeddedLyricsLookups.size > 64) {
        const oldestKey = embeddedLyricsLookups.keys().next().value;
        if (oldestKey) embeddedLyricsLookups.delete(oldestKey);
      }
    }
    if (!lookup) return localTrack;
    const embedded = await lookup;
    if (!embedded) return localTrack;
    if (embedded.format === 'ttml') {
      const lyrics = parseTtmlLyrics(embedded.text);
      if (!lyrics.length) return localTrack;
      const syncedLyrics = lrcFromLyricLines(lyrics);
      return {
        ...localTrack,
        syncedLyrics: syncedLyrics || undefined,
        plainLyrics: undefined,
        lyrics,
        lyricsTtml: embedded.text,
        lyricsFormat: 'ttml',
        lyricsAvailable: true,
        hasSyncedLyrics: Boolean(syncedLyrics),
        hasPlainLyrics: false,
        lyricsSource: embedded.source,
        lyricsAttribution: embedded.attribution,
      };
    }
    const syncedLyrics = embedded.format === 'line' || hasTimedText(embedded.text)
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
      lyricsFormat: syncedLyrics ? 'line' : 'plain',
      lyricsSource: embedded.source,
      lyricsAttribution: embedded.attribution,
    };
  } catch {
    // Embedded metadata is a last local fallback; keep audio playback intact.
    return localTrack;
  }
};

const resolveLocalLyrics = async (track: Track) => {
  const embeddedTrack = await readEmbeddedLyrics(track, track);
  if (
    (embeddedTrack.lyricsSource === 'embedded_lrc'
      || embeddedTrack.lyricsSource === 'embedded_text'
      || embeddedTrack.lyricsSource === 'embedded_musiqapp')
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

const providerRequestTails = new Map<string, Promise<void>>();
const providerNextRequestAt = new Map<string, number>();

const fetchLyricsProvider = async (
  provider: string,
  url: string,
  minimumIntervalMs: number,
  headers: Record<string, string> = {},
  timeoutMs = 12_000,
) => {
  const previous = providerRequestTails.get(provider) ?? Promise.resolve();
  const operation = previous.then(async () => {
    const waitMs = Math.max(0, (providerNextRequestAt.get(provider) ?? 0) - Date.now());
    if (waitMs) await sleep(waitMs);
    providerNextRequestAt.set(provider, Date.now() + minimumIntervalMs);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : minimumIntervalMs;
        providerNextRequestAt.set(provider, Math.max(providerNextRequestAt.get(provider) ?? 0, Date.now() + retryDelay));
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  });
  providerRequestTails.set(provider, operation.then(() => undefined, () => undefined));
  return operation;
};

const fetchProviderJson = async (
  provider: string,
  url: string,
  minimumIntervalMs: number,
  headers: Record<string, string> = {},
  missStatuses: number[] = [404],
  timeoutMs = 12_000,
) => {
  const response = await fetchLyricsProvider(provider, url, minimumIntervalMs, {
    Accept: 'application/json',
    ...headers,
  }, timeoutMs);
  if (missStatuses.includes(response.status)) return null;
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
  return asRecord(await response.json());
};

const fetchProviderText = async (
  provider: string,
  url: string,
  minimumIntervalMs: number,
  headers: Record<string, string> = {},
) => {
  const response = await fetchLyricsProvider(provider, url, minimumIntervalMs, {
    Accept: 'application/xml, text/plain, */*',
    ...headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
  return response.text();
};

const candidateFromPayload = (track: Track, payload: unknown, provider: string): Track | null => {
  const record = asRecord(payload);
  if (!record) return null;
  const nested = asRecord(record.data) ?? asRecord(record.result);
  const sourceRecord = nested ?? record;
  const lyrics = lyricsPayloadFromRecord(sourceRecord, provider, track);
  if (!lyrics) return null;
  return {
    ...track,
    syncedLyrics: lyrics.syncedLyrics,
    plainLyrics: lyrics.plainLyrics,
    lyrics: lyrics.lyrics,
    lyricsFormat: lyrics.lyricsFormat,
    lyricsTtml: lyrics.lyricsTtml,
    lyricsAvailable: lyrics.lyricsAvailable,
    hasSyncedLyrics: lyrics.hasSyncedLyrics,
    hasPlainLyrics: lyrics.hasPlainLyrics,
    lyricsSource: provider,
    lyricsAttribution: lyrics.lyricsAttribution,
  };
};

const candidateFromLrc = (track: Track, text: string, provider: string): Track | null => {
  const syncedLyrics = text.trim();
  if (!syncedLyrics || !hasTimedText(syncedLyrics)) return null;
  return {
    ...track,
    syncedLyrics,
    plainLyrics: undefined,
    lyrics: parseLyrics(syncedLyrics),
    lyricsFormat: 'line',
    lyricsAvailable: true,
    hasSyncedLyrics: true,
    hasPlainLyrics: false,
    lyricsSource: provider,
    lyricsAttribution: providerAttribution(provider),
  };
};

const withLookupProviders = (result: Track, providers: string[], issues: string[]): Track => ({
  ...result,
  lyricsLookupProviders: providers,
  lyricsLookupIssues: issues.length ? issues : undefined,
});

const qualityForLyrics = (track: Track) => {
  if (track.lyricsFormat === 'ttml') return 5;
  if (track.lyricsFormat === 'word' || track.lyrics?.some((line) => line.words?.some((word) => (
    word.startTimeMs !== null || word.endTimeMs !== null
    || word.syllables?.some((syllable) => syllable.startTimeMs !== null || syllable.endTimeMs !== null)
  )))) return 4;
  if (track.syncedLyrics?.trim() || track.lyricsFormat === 'line') return 3;
  if (track.plainLyrics?.trim() || track.lyricsFormat === 'plain' || track.lyrics?.some((line) => line.text.trim())) return 1;
  return 0;
};

const liriQoCandidateFromRecord = (track: Track, record: Record<string, unknown>): Track | null => {
  const source = 'LiriQo';
  const upstream = [record.upstreamProvider, record.lyricsSource, record.provider]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const attribution: LyricsAttribution = {
    provider: upstream && upstream !== source ? `${source} · ${upstream}` : source,
    providerUrl: providerAttribution(source).providerUrl,
  };

  const normalized = candidateFromPayload(track, record, source);
  if (normalized && qualityForLyrics(normalized) >= 4) {
    return { ...normalized, lyricsAttribution: attribution };
  }

  const timed = Array.isArray(record.timed) ? record.timed : [];
  const wordsByLine = asRecord(record.words);
  const lyrics: LyricLine[] = timed.flatMap((value): LyricLine[] => {
    const row = asRecord(value);
    if (!row) return [];
    const lineId = row.id;
    const separateWords = lineId !== undefined && wordsByLine
      ? wordsByLine[String(lineId)]
      : undefined;
    const rawWords = Array.isArray(row.words) ? row.words : Array.isArray(separateWords) ? separateWords : [];
    const words: LyricWord[] = rawWords.flatMap((value): LyricWord[] => {
      const word = asRecord(value);
      if (!word || typeof word.text !== 'string' || !word.text.trim()) return [];
      const start = typeof word.start === 'number' ? word.start : typeof word.start_ms === 'number' ? word.start_ms : null;
      const end = typeof word.end === 'number' ? word.end : typeof word.end_ms === 'number' ? word.end_ms : null;
      return [{ text: word.text, startTimeMs: start, endTimeMs: end }];
    });
    const start = typeof row.start === 'number' ? row.start : typeof row.start_ms === 'number' ? row.start_ms : null;
    const end = typeof row.end === 'number' ? row.end : typeof row.end_ms === 'number' ? row.end_ms : null;
    const text = typeof row.text === 'string' && row.text.trim()
      ? row.text.trim()
      : words.map((word) => word.text).join('').trim();
    if (!text) return [];
    const wordStart = words.map((word) => word.startTimeMs).filter((time): time is number => time !== null);
    const wordEnd = words.map((word) => word.endTimeMs).filter((time): time is number => time !== null);
    return [{
      timeMs: start ?? (wordStart.length ? Math.min(...wordStart) : null),
      endTimeMs: end ?? (wordEnd.length ? Math.max(...wordEnd) : null),
      text,
      ...(words.length ? { words } : {}),
    }];
  });

  if (lyrics.length) {
    const hasWordTiming = lyrics.some((line) => line.words?.some((word) => word.startTimeMs !== null || word.endTimeMs !== null));
    const hasLineTiming = lyrics.some((line) => line.timeMs !== null);
    const lyricsFormat: LyricsFormat = hasWordTiming ? 'word' : hasLineTiming ? 'line' : 'plain';
    const syncedLyrics = hasLineTiming ? lrcFromLyricLines(lyrics) : undefined;
    const plainLyrics = syncedLyrics ? undefined : lyrics.map((line) => line.text).join('\n');
    return {
      ...track,
      lyrics,
      syncedLyrics,
      plainLyrics,
      lyricsFormat,
      lyricsTtml: lyricsFormat === 'word' ? serializeLyricsAsTtml(lyrics) : undefined,
      lyricsAvailable: true,
      hasSyncedLyrics: Boolean(syncedLyrics),
      hasPlainLyrics: Boolean(plainLyrics),
      lyricsSource: source,
      lyricsAttribution: attribution,
    };
  }

  if (normalized) return { ...normalized, lyricsAttribution: attribution };

  const plain = typeof record.plain === 'string' ? record.plain.trim() : '';
  return plain ? {
    ...track,
    plainLyrics: plain,
    lyrics: parseLyrics(undefined, plain),
    lyricsFormat: 'plain',
    lyricsAvailable: true,
    hasSyncedLyrics: false,
    hasPlainLyrics: true,
    lyricsSource: source,
    lyricsAttribution: attribution,
  } : null;
};

const searchLiriQoForTrack = async (track: Track, onIssue: (message: string) => void) => {
  if (!track.title.trim() || !track.artist.trim()) return [] as Track[];
  const params = new URLSearchParams({ title: track.title.trim(), artist: track.artist.trim(), full: '1' });
  if (track.album.trim()) params.set('album', track.album.trim());
  const duration = durationSecondsForTrack(track);
  if (duration && duration > 0 && duration <= 3600) params.set('duration', String(Math.round(duration)));

  const payload = await fetchProviderJson(
    'LiriQo',
    `https://api.liriqo-alfarrizi.my.id/v1/lyrics?${params.toString()}`,
    500,
    { 'User-Agent': 'Musiqapp/2.0.1 (+https://github.com/egokam/MusicLocal)' },
    [404],
    30_000,
  );
  if (!payload) return [] as Track[];
  if (typeof payload.error === 'string' && payload.error.trim()) {
    onIssue(`LiriQo: ${payload.error.trim()}`);
    return [] as Track[];
  }
  if (payload.partial === true) onIssue('LiriQo returned a partial provider result.');

  const records = [
    asRecord(payload.primary),
    ...(Array.isArray(payload.tracks) ? payload.tracks.map(asRecord) : []),
  ].filter((record): record is Record<string, unknown> => Boolean(record));
  const seen = new Set<string>();
  const candidates: Track[] = [];
  for (const record of records) {
    const candidate = liriQoCandidateFromRecord(track, record);
    if (!candidate) continue;
    const signature = `${candidate.lyricsAttribution?.provider ?? ''}|${candidate.lyricsFormat}|${candidate.lyricsTtml ?? candidate.syncedLyrics ?? candidate.plainLyrics ?? ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(candidate);
  }
  return candidates;
};

const searchLrclibForTrack = async (track: Track, onIssue: (message: string) => void) => {
  if (!track.title.trim() || !track.artist.trim()) return null;
  const params = new URLSearchParams({ track_name: track.title.trim(), artist_name: track.artist.trim() });
  if (track.album.trim()) params.set('album_name', track.album.trim());
  const duration = durationSecondsForTrack(track);
  if (duration && duration > 0 && duration <= 3600) params.set('duration', String(Math.round(duration)));
  const candidates: Track[] = [];
  const headers = { 'X-User-Agent': 'Musiqapp/2.0.1 (+https://github.com/egokam/MusicLocal)' };
  const addRecord = (record: Record<string, unknown> | null) => {
    if (!record) return;
    const candidate = candidateFromPayload(track, record, 'LRCLIB');
    if (candidate) candidates.push(candidate);
    else {
      const plainLyrics = typeof record.plainLyrics === 'string' ? record.plainLyrics.trim() : '';
      if (plainLyrics) candidates.push({
        ...track,
        plainLyrics,
        lyrics: parseLyrics(undefined, plainLyrics),
        lyricsFormat: 'plain',
        lyricsAvailable: true,
        hasSyncedLyrics: false,
        hasPlainLyrics: true,
        lyricsSource: 'LRCLIB',
        lyricsAttribution: providerAttribution('LRCLIB'),
      });
    }
  };

  try {
    const exactResponse = await fetchLyricsProvider('LRCLIB', `https://lrclib.net/api/get?${params.toString()}`, 500, headers);
    if (exactResponse.status !== 404) {
      if (!exactResponse.ok) throw new Error(`LRCLIB returned HTTP ${exactResponse.status}.`);
      addRecord(asRecord(await exactResponse.json()));
    }
  } catch (error) {
    // Still try the broader search endpoint if the exact lookup is unavailable.
    onIssue(error instanceof Error ? error.message : 'LRCLIB exact lookup could not be completed.');
  }

  // Search can reveal alternate releases that the exact endpoint did not
  // return, including richer Lyricsfile/word-timed results.
  const searchParams = new URLSearchParams({ q: `${track.title.trim()} ${track.artist.trim()}` });
  try {
    const searchResponse = await fetchLyricsProvider('LRCLIB', `https://lrclib.net/api/search?${searchParams.toString()}`, 500, headers);
    if (searchResponse.status === 404) return candidates;
    if (!searchResponse.ok) throw new Error(`LRCLIB search returned HTTP ${searchResponse.status}.`);
    const searchResults = await searchResponse.json();
    if (!Array.isArray(searchResults)) throw new Error('LRCLIB search returned an unexpected response.');
    const matchingResults = searchResults.map(asRecord).filter((record): record is Record<string, unknown> => {
      if (!record) return false;
      const title = typeof record.trackName === 'string' ? record.trackName : typeof record.track_name === 'string' ? record.track_name : '';
      const artist = typeof record.artistName === 'string' ? record.artistName : typeof record.artist_name === 'string' ? record.artist_name : '';
      const actualDuration = typeof record.duration === 'number' ? record.duration : undefined;
      return trackTextMatches(title, track.title)
        && trackTextMatches(artist, track.artist)
        && (!duration || !actualDuration || Math.abs(duration - actualDuration) <= 5);
    });
    matchingResults.sort((left, right) => {
      const distance = (record: Record<string, unknown>) => typeof record.duration === 'number' && duration
        ? Math.abs(record.duration - duration)
        : Number.MAX_SAFE_INTEGER;
      return distance(left) - distance(right);
    });
    matchingResults.forEach(addRecord);
  } catch (error) {
    onIssue(error instanceof Error ? error.message : 'LRCLIB search could not be completed.');
  }
  return candidates;
};

const betterLyricsParams = (track: Track) => {
  const params = new URLSearchParams();
  const duration = durationSecondsForTrack(track);
  params.set('s', track.title.trim());
  params.set('a', track.artist.trim());
  params.set('al', track.album.trim());
  params.set('d', String(Math.round(duration ?? 0)));
  return params;
};

const searchBetterLyricsForTrack = async (track: Track, onIssue: (message: string) => void) => {
  if (!track.title.trim() || !track.artist.trim()) return [] as Track[];
  const candidates: Track[] = [];
  for (const endpoint of ['/getLyrics', '/qq/getLyrics', '/kugou/getLyrics']) {
    const provider = 'Better Lyrics';
    try {
      const record = await fetchProviderJson(
        provider,
        `https://api.betterlyrics.org${endpoint}?${betterLyricsParams(track).toString()}`,
        700,
        { 'User-Agent': 'Musiqapp/2.0.1 (+https://github.com/egokam/MusicLocal)' },
      );
      if (!record) continue;
      const candidate = candidateFromPayload(track, record, provider);
      if (candidate) candidates.push(candidate);
    } catch (error) {
      onIssue(error instanceof Error ? error.message : `Better Lyrics ${endpoint} could not be reached.`);
    }
  }
  return candidates;
};

const isrcJsonUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['lrc.red', 'www.lrc.red'].includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch {
    return null;
  }
};

const searchLrcRedForTrack = async (track: Track, onIssue: (message: string) => void) => {
  if (!track.title.trim() || !track.artist.trim()) return [] as Track[];
  const query = new URLSearchParams({ q: `${track.title.trim()} ${track.artist.trim()}` });
  const headers = {
    'User-Agent': 'Musiqapp/2.0.1 (+https://github.com/egokam/MusicLocal)',
    'X-Client-ID': 'Musiqapp/2.0.1 (https://github.com/egokam/MusicLocal/issues)',
  };
  const hits: Record<string, unknown>[] = [];
  let after: string | undefined;
  const cursors = new Set<string>();
  do {
    const params = new URLSearchParams(query);
    if (after) params.set('after', after);
    const page = await fetchProviderJson('lrc.red', `https://lrc.red/search.json?${params.toString()}`, 1_000, headers);
    if (!page || !Array.isArray(page.hits)) break;
    hits.push(...page.hits.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)));
    after = typeof page.next === 'string' && page.next ? page.next : undefined;
    if (after && cursors.has(after)) break;
    if (after) cursors.add(after);
  } while (after);

  const duration = durationSecondsForTrack(track);
  const matches = hits
    .filter((hit) => {
      if (typeof hit.title !== 'string' || !trackTextMatches(hit.title, track.title)) return false;
      if (typeof hit.artist !== 'string' || !trackTextMatches(hit.artist, track.artist)) return false;
      const recordDuration = typeof hit.duration === 'number' ? hit.duration : undefined;
      return !duration || !recordDuration || Math.abs(duration - recordDuration) <= 5;
    })
    .sort((left, right) => {
      const distance = (hit: Record<string, unknown>) => duration && typeof hit.duration === 'number'
        ? Math.abs(duration - hit.duration)
        : Number.MAX_SAFE_INTEGER;
      return distance(left) - distance(right);
    });

  const candidates: Track[] = [];
  for (const hit of matches) {
    const isrc = typeof hit.isrc === 'string' ? hit.isrc.trim() : '';
    if (!isrc) continue;
    let record: Record<string, unknown> | null;
    try {
      record = await fetchProviderJson('lrc.red', `https://lrc.red/s/${encodeURIComponent(isrc)}.json`, 1_000, headers);
    } catch (error) {
      onIssue(error instanceof Error ? error.message : 'lrc.red could not be reached.');
      continue;
    }
    if (!record) continue;
    const files = asRecord(record.files) ?? {};
    const ttmlUrl = isrcJsonUrl(files.ttml);
    if (ttmlUrl) {
      let ttml: string | null;
      try {
        ttml = await fetchProviderText('lrc.red', ttmlUrl, 1_000, headers);
      } catch (error) {
        onIssue(error instanceof Error ? error.message : 'lrc.red TTML could not be reached.');
        ttml = null;
      }
      const parsed = ttml ? parseTtmlLyrics(ttml) : [];
      const syncedLyrics = lrcFromLyricLines(parsed);
      if (ttml && parsed.length && syncedLyrics) {
        candidates.push({
          ...track,
          lyrics: parsed,
          syncedLyrics,
          lyricsFormat: 'ttml',
          lyricsTtml: ttml,
          lyricsAvailable: true,
          hasSyncedLyrics: true,
          lyricsSource: 'lrc.red',
          lyricsAttribution: providerAttribution('lrc.red'),
        });
        continue;
      }
    }
    const lrcUrl = isrcJsonUrl(files.lrc);
    if (lrcUrl) {
      let lrc: string | null;
      try {
        lrc = await fetchProviderText('lrc.red', lrcUrl, 1_000, headers);
      } catch (error) {
        onIssue(error instanceof Error ? error.message : 'lrc.red LRC could not be reached.');
        lrc = null;
      }
      const candidate = lrc ? candidateFromLrc(track, lrc, 'lrc.red') : null;
      if (candidate) candidates.push(candidate);
    }
    const lyricsFileUrl = isrcJsonUrl(files.lyricsfile);
    if (lyricsFileUrl) {
      let lyricsFile: string | null;
      try {
        lyricsFile = await fetchProviderText('lrc.red', lyricsFileUrl, 1_000, headers);
      } catch (error) {
        onIssue(error instanceof Error ? error.message : 'lrc.red Lyricsfile could not be reached.');
        lyricsFile = null;
      }
      const candidate = lyricsFile
        ? candidateFromPayload(track, { lyricsfile: lyricsFile }, 'lrc.red')
        : null;
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
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
  onLookupError?: (message: string) => void,
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
      if (search.status !== 200) {
        if (search.status !== 404) onLookupError?.(`Spicy Lyrics returned HTTP ${search.status}.`);
        return legacyCachedEntry;
      }
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
    if (lyricsResponse.status !== 200) {
      onLookupError?.(`Spicy Lyrics returned HTTP ${lyricsResponse.status}.`);
      return legacyCachedEntry;
    }
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
    onLookupError?.('Spicy Lyrics could not be reached.');
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

const applySpicyLyricsEntry = (local: Track, entry: SpicyLyricsCacheEntry, syncedOnly: boolean): Track => {
  if (entry.noLyrics || (!entry.syncedLyrics && (!entry.plainLyrics || syncedOnly))) return local;
  return {
    ...local,
    syncedLyrics: entry.syncedLyrics,
    plainLyrics: entry.plainLyrics,
    lyrics: entry.lyrics?.length ? entry.lyrics : parseLyrics(entry.syncedLyrics, entry.plainLyrics),
    lyricsFormat: entry.precision === 'syllable'
      ? 'word'
      : entry.precision === 'line'
        ? 'line'
        : 'plain',
    lyricsAvailable: Boolean(entry.syncedLyrics || entry.plainLyrics),
    hasSyncedLyrics: Boolean(entry.syncedLyrics),
    hasPlainLyrics: Boolean(entry.plainLyrics),
    lyricsSource: 'spicy_lyrics_api',
    lyricsAttribution: entry.attribution,
  };
};

const searchLyricsForChecker = async (track: Track): Promise<Track> => {
  const candidates: Track[] = [];
  const searchedProviders: string[] = [];
  const issues: string[] = [];
  const addIssue = (provider: string, message: string) => {
    issues.push(`${provider}: ${message}`);
  };

  if (spicyLyricsEnabled && spicyLyricsClientKey) {
    const provider = 'Spicy Lyrics';
    try {
      const entry = await requestSpicyLyrics(track, true, false, (message) => addIssue(provider, message));
      searchedProviders.push(provider);
      if (entry && !entry.noLyrics) {
        const candidate = applySpicyLyricsEntry(withoutSpicyApiLyrics(track), entry, false);
        if (hasRenderableLyrics(candidate)) candidates.push(candidate);
      }
    } catch (error) {
      searchedProviders.push(provider);
      addIssue(provider, error instanceof Error ? error.message : 'The request failed.');
    }
  } else {
    addIssue(
      'Spicy Lyrics',
      spicyLyricsClientKey
        ? 'Skipped because Spicy Lyrics is disabled in Profile.'
        : 'Skipped because no Spicy Lyrics client key is configured.',
    );
  }

  const attempt = async (provider: string, search: () => Promise<Track | Track[] | null>) => {
    searchedProviders.push(provider);
    try {
      const result = await search();
      if (Array.isArray(result)) candidates.push(...result);
      else if (result) candidates.push(result);
    } catch (error) {
      addIssue(provider, error instanceof Error ? error.message : 'The request failed.');
    }
  };

  // Query independent providers together, then compare every returned result.
  // This keeps TTML-first selection without making the user wait for the sum of
  // each provider's response time.
  await Promise.all([
    attempt('LiriQo', () => searchLiriQoForTrack(track, (message) => addIssue('LiriQo', message))),
    attempt('Better Lyrics', () => searchBetterLyricsForTrack(track, (message) => addIssue('Better Lyrics', message))),
    attempt('lrc.red', () => searchLrcRedForTrack(track, (message) => addIssue('lrc.red', message))),
    attempt('LRCLIB', () => searchLrclibForTrack(track, (message) => addIssue('LRCLIB', message))),
  ]);

  candidates.sort((left, right) => qualityForLyrics(right) - qualityForLyrics(left));
  const bestCandidate = candidates[0];
  const result = bestCandidate ?? await resolveLocalLyrics(withoutSpicyApiLyrics(track));
  return withLookupProviders(result, searchedProviders, [...new Set(issues)]);
};

const sleep = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const runSpicyLyricsPrefetch = async (generation: number) => {
  if (spicyLyricsPrefetchRunning) return;
  spicyLyricsPrefetchRunning = true;
  try {
    while (
      spicyLyricsEnabled
      && spicyLyricsClientKey
      && spicyLyricsAutoDownloadAllowed
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
      && spicyLyricsAutoDownloadAllowed
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

  setSpicyLyricsAutoDownloadAllowed(allowed: boolean): void {
    const wasAllowed = spicyLyricsAutoDownloadAllowed;
    spicyLyricsAutoDownloadAllowed = allowed;
    if (
      allowed
      && !wasAllowed
      && spicyLyricsEnabled
      && spicyLyricsClientKey
      && spicyLyricsPrefetchQueue.length > 0
    ) {
      void runSpicyLyricsPrefetch(spicyLyricsPrefetchGeneration);
    }
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

  async searchLyricsForChecker(track: Track): Promise<Track> {
    return searchLyricsForChecker(track);
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
