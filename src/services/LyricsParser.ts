import type { LyricLine } from '../types';

/** Parse LRC timestamps and plain-text lyrics without contacting a server. */
export const parseLyrics = (syncedLyrics?: string | null, plainLyrics?: string | null): LyricLine[] => {
  if (syncedLyrics?.trim()) {
    const parsed: LyricLine[] = [];
    for (const rawLine of syncedLyrics.split(/\r?\n/)) {
      const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const text = rawLine.replace(/\[[^\]]+\]/g, '').trim();
      if (!text) {
        if (parsed.length > 0) parsed.push({ timeMs: null, text: '' });
        continue;
      }
      for (const timestamp of timestamps) {
        const fraction = timestamp[3] ?? '0';
        const millis = fraction.length === 1
          ? Number(fraction) * 100
          : fraction.length === 2
            ? Number(fraction) * 10
            : Number(fraction);
        parsed.push({
          timeMs: (Number(timestamp[1]) * 60 + Number(timestamp[2])) * 1000 + millis,
          text,
        });
      }
      if (timestamps.length === 0) parsed.push({ timeMs: null, text });
    }
    return parsed.sort((first, second) => (first.timeMs ?? Infinity) - (second.timeMs ?? Infinity));
  }
  return plainLyrics?.split(/\r?\n/).map((text) => ({ timeMs: null, text })) ?? [];
};

export const hasTimedLyrics = (syncedLyrics?: string | null, lyrics?: LyricLine[]) => Boolean(
  syncedLyrics?.match(/^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*\S/m)
  || lyrics?.some((line) => line.timeMs !== null && line.text.trim()),
);
