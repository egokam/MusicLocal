import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { parseBuffer } from 'music-metadata';
import { deduplicateSyncedLyrics, parseLyrics } from './LyricsParser';
import { cacheArtworkForTrack } from './ArtworkService';
import type { Track } from '../types';

// This directory stays inside the app's private Documents container.
const downloadsDirectory = new Directory(Paths.document, 'Musiqapp');
const indexFile = new File(downloadsDirectory, 'downloads.json');

const ensureDirectory = () => {
  if (!downloadsDirectory.exists) {
    downloadsDirectory.create({ idempotent: true, intermediates: true });
  }
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const safeExportName = (value: string) => value
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  .replace(/[. ]+$/g, '')
  .trim() || 'Untitled';
const safeExportExtension = (value: string | undefined, fallback: string) => {
  const cleaned = (value || fallback).replace(/[^a-z0-9.]/gi, '');
  if (!cleaned || cleaned === '.') return fallback;
  return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
};

type ZipEntry = {
  name: string;
  file?: File;
  bytes?: Uint8Array;
};

type ZipCentralEntry = {
  name: Uint8Array;
  crc: number;
  size: number;
  localOffset: number;
};

const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const updateZipCrc = (crc: number, bytes: Uint8Array) => {
  let value = crc;
  for (let index = 0; index < bytes.length; index += 1) {
    value = (value >>> 8) ^ zipCrcTable[(value ^ bytes[index]) & 0xff];
  }
  return value >>> 0;
};

const setZip16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
};

const setZip32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};

const setZip64 = (bytes: Uint8Array, offset: number, value: number) => {
  const lowWord = value % 0x100000000;
  const highWord = Math.floor(value / 0x100000000);
  setZip32(bytes, offset, lowWord);
  setZip32(bytes, offset + 4, highWord);
};

const zipDosTimestamp = (date: Date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: (Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate(),
});

const makeZipLocalHeader = (name: Uint8Array, time: number, date: number) => {
  const header = new Uint8Array(30 + name.length + 20);
  setZip32(header, 0, 0x04034b50);
  setZip16(header, 4, 45);
  setZip16(header, 6, 0x0808); // UTF-8 names and a ZIP64 data descriptor follow each file.
  setZip16(header, 8, 0); // Stored: audio and image files are already compressed.
  setZip16(header, 10, time);
  setZip16(header, 12, date);
  setZip32(header, 14, 0); // CRC is supplied in the data descriptor.
  setZip32(header, 18, 0xffffffff);
  setZip32(header, 22, 0xffffffff);
  setZip16(header, 26, name.length);
  setZip16(header, 28, 20);
  header.set(name, 30);
  const extraOffset = 30 + name.length;
  setZip16(header, extraOffset, 1); // ZIP64 extended information.
  setZip16(header, extraOffset + 2, 16);
  // The sizes are unknown until the entry has streamed; ZIP64 data descriptors carry them.
  return header;
};

const makeZipDataDescriptor = (crc: number, size: number) => {
  const descriptor = new Uint8Array(24);
  setZip32(descriptor, 0, 0x08074b50);
  setZip32(descriptor, 4, crc);
  setZip64(descriptor, 8, size);
  setZip64(descriptor, 16, size);
  return descriptor;
};

const makeZipCentralEntry = (entry: ZipCentralEntry, time: number, date: number) => {
  const record = new Uint8Array(46 + entry.name.length + 28);
  setZip32(record, 0, 0x02014b50);
  setZip16(record, 4, 0x032d); // Unix creator, ZIP 4.5.
  setZip16(record, 6, 45);
  setZip16(record, 8, 0x0808);
  setZip16(record, 10, 0);
  setZip16(record, 12, time);
  setZip16(record, 14, date);
  setZip32(record, 16, entry.crc);
  setZip32(record, 20, 0xffffffff);
  setZip32(record, 24, 0xffffffff);
  setZip16(record, 28, entry.name.length);
  setZip16(record, 30, 28);
  setZip16(record, 32, 0); // No file comment.
  setZip16(record, 34, 0);
  setZip16(record, 36, 0);
  setZip32(record, 38, 0);
  setZip32(record, 42, 0xffffffff);
  record.set(entry.name, 46);
  const extraOffset = 46 + entry.name.length;
  setZip16(record, extraOffset, 1);
  setZip16(record, extraOffset + 2, 24);
  setZip64(record, extraOffset + 4, entry.size);
  setZip64(record, extraOffset + 12, entry.size);
  setZip64(record, extraOffset + 20, entry.localOffset);
  return record;
};

const makeZip64EndRecord = (entryCount: number, centralSize: number, centralOffset: number) => {
  const record = new Uint8Array(56);
  setZip32(record, 0, 0x06064b50);
  setZip64(record, 4, 44);
  setZip16(record, 12, 0x032d);
  setZip16(record, 14, 45);
  setZip32(record, 16, 0);
  setZip32(record, 20, 0);
  setZip64(record, 24, entryCount);
  setZip64(record, 32, entryCount);
  setZip64(record, 40, centralSize);
  setZip64(record, 48, centralOffset);
  return record;
};

const makeZip64Locator = (endRecordOffset: number) => {
  const locator = new Uint8Array(20);
  setZip32(locator, 0, 0x07064b50);
  setZip32(locator, 4, 0);
  setZip64(locator, 8, endRecordOffset);
  setZip32(locator, 16, 1);
  return locator;
};

const makeZipEndRecord = () => {
  const record = new Uint8Array(22);
  setZip32(record, 0, 0x06054b50);
  setZip16(record, 4, 0);
  setZip16(record, 6, 0);
  setZip16(record, 8, 0xffff);
  setZip16(record, 10, 0xffff);
  setZip32(record, 12, 0xffffffff);
  setZip32(record, 16, 0xffffffff);
  setZip16(record, 20, 0);
  return record;
};

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const idForImport = (url: string, title: string, artist: string) => {
  let hash = 2166136261;
  for (const character of `${url}\u0000${title}\u0000${artist}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16)}`;
};

const extensionFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(mp3|m4a|aac|wav|flac|ogg|opus)(?:$|\?)/i);
    return match ? `.${match[1].toLowerCase()}` : '.mp3';
  } catch {
    return '.mp3';
  }
};

const writeTextFile = (file: File, text: string) => {
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  file.write(text);
};

const supportedAudio = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;

const metadataFromFile = (fileName: string) => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const [artistPart, ...titleParts] = baseName.split(' - ');
  return {
    artist: titleParts.length > 0 ? artistPart.trim() : 'Unknown artist',
    title: (titleParts.length > 0 ? titleParts.join(' - ') : baseName).trim() || 'Untitled track',
  };
};

const isGeneratedLocalId = (value: string) => /^local-[a-f0-9]+$/i.test(value.trim());
const isFallbackArtist = (value: string) => !value.trim() || value.trim().toLowerCase() === 'unknown artist';
const isUsefulEmbeddedText = (value: string | undefined) => Boolean(
  value?.trim()
  && value.trim().toLowerCase() !== 'unknown artist'
  && !isGeneratedLocalId(value),
);

const formatDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

const audioMimeType = (extension: string) => ({
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
}[extension.toLowerCase()] || 'audio/mpeg');

// Expo's Hermes TextDecoder intentionally supports UTF-8 only, while
// music-metadata needs ISO-8859-1 for the legacy ID3v1 footer in MP3 files.
// Supply the missing decoder label while keeping Expo's normal UTF-8 path.
const installLegacyTextDecoderSupport = () => {
  const NativeTextDecoder = globalThis.TextDecoder;
  try {
    new NativeTextDecoder('latin1');
    new NativeTextDecoder('ascii');
    return;
  } catch {
    // Hermes' UTF-8-only decoder rejects this label.
  }

  const windows1252 = [
    0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
    0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
    0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
  ];

  class Latin1CompatibleTextDecoder extends NativeTextDecoder {
    private readonly usesLatin1: boolean;

    constructor(label = 'utf-8', options?: TextDecoderOptions) {
      const normalized = label.trim().toLowerCase();
      const needsSingleByteDecoder = ['latin1', 'iso-8859-1', 'iso8859-1', 'ascii', 'us-ascii'].includes(normalized);
      super(needsSingleByteDecoder ? 'utf-8' : label, options);
      this.usesLatin1 = needsSingleByteDecoder;
    }

    override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
      if (!this.usesLatin1) return super.decode(input, options);
      if (input === undefined) return '';
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input as ArrayBuffer);
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        const end = Math.min(offset + 4096, bytes.length);
        const chars = new Array<number>(end - offset);
        for (let index = offset; index < end; index += 1) {
          const byte = bytes[index];
          chars[index - offset] = byte >= 0x80 && byte <= 0x9f ? windows1252[byte - 0x80] : byte;
        }
        chunks.push(String.fromCharCode(...chars));
      }
      return chunks.join('');
    }
  }

  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    writable: true,
    value: Latin1CompatibleTextDecoder,
  });
};

installLegacyTextDecoderSupport();

const extractEmbeddedMetadata = async (
  audioFile: File,
  id: string,
  fallback: { title: string; artist: string },
  persistAssets = true,
) => {
  let title = fallback.title;
  let artist = fallback.artist;
  let album = '';
  let albumArtist: string | undefined;
  let trackNumber: number | undefined;
  let year: number | undefined;
  let genre: string[] | undefined;
  let composer: string[] | undefined;
  let artwork: string | undefined;
  let artworkData: Uint8Array | undefined;
  let artworkMimeType: string | undefined;
  let durationSeconds: number | undefined;
  let lyricsFileUri: string | undefined;
  let lyricsText: string | undefined;
  let hasSyncedLyrics = false;
  let hasPlainLyrics = false;
  try {
    const bytes = await audioFile.bytes();
    const result = await parseBuffer(bytes, audioMimeType(audioFile.extension));
    title = result.common.title?.trim() || title;
    artist = result.common.artist?.trim() || result.common.albumartist?.trim() || artist;
    album = result.common.album?.trim() || album;
    albumArtist = result.common.albumartist?.trim() || undefined;
    trackNumber = result.common.track.no ?? undefined;
    year = result.common.year;
    genre = result.common.genre;
    composer = result.common.composer;
    durationSeconds = result.format.duration ? Math.round(result.format.duration) : undefined;
    // Prefer the explicitly marked front cover when files contain several
    // pictures (booklets, artist photos, back covers, etc.).
    const pictures = result.common.picture ?? [];
    const picture = pictures.find((candidate) => /cover\s*\(front\)|front/i.test(candidate.type ?? ''))
      ?? pictures.find((candidate) => candidate.data?.length > 0);
    if (picture?.data?.length) {
      artworkData = picture.data;
      artworkMimeType = picture.format.toLowerCase() || 'image/jpeg';
      if (persistAssets) {
        const extension = artworkMimeType.includes('png') ? 'png' : artworkMimeType.includes('webp') ? 'webp' : artworkMimeType.includes('gif') ? 'gif' : 'jpg';
        const artworkFile = new File(downloadsDirectory, `${safeName(id)}-artwork.${extension}`);
        if (artworkFile.exists) artworkFile.delete();
        artworkFile.create({ intermediates: true });
        artworkFile.write(picture.data);
        if (artworkFile.exists && (artworkFile.size ?? 0) > 0) artwork = artworkFile.uri;
        else console.warn(`[Music import] Embedded artwork was parsed but not saved for ${audioFile.name}.`);
      }
    }
    const lyricParts = (result.common.lyrics ?? []).flatMap((entry) => {
      if (entry.text?.trim()) return [entry.text.trim()];
      if (entry.syncText?.length) return [entry.syncText.map((line) => {
        const rawTime = Math.max(0, line.timestamp ?? 0);
        const time = entry.timeStampFormat === 1
          ? rawTime * 1152 / (result.format.sampleRate || 44100) * 1000
          : rawTime;
        const minutes = Math.floor(time / 60000);
        const seconds = (time % 60000) / 1000;
        return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}]${line.text}`;
      }).join('\n')];
      return [];
    });
    const embeddedLyrics = lyricParts.join('\n\n').trim();
    if (embeddedLyrics) {
      lyricsText = embeddedLyrics;
      hasSyncedLyrics = (result.common.lyrics ?? []).some((entry) => Boolean(entry.syncText?.length));
      hasPlainLyrics = !hasSyncedLyrics;
      if (persistAssets) {
        const lyricsFile = new File(downloadsDirectory, `${safeName(id)}.${hasSyncedLyrics ? 'lrc' : 'txt'}`);
        if (lyricsFile.exists) lyricsFile.delete();
        writeTextFile(lyricsFile, embeddedLyrics);
        lyricsFileUri = lyricsFile.uri;
      }
    }
  } catch (error) {
    // Keep importing the audio, but report the parser failure instead of
    // silently making an embedded-cover failure impossible to diagnose.
    console.warn(`[Music import] Could not read embedded metadata from ${audioFile.name}:`, error);
  }
  return {
    title,
    artist,
    album,
    albumArtist,
    trackNumber,
    year,
    genre,
    composer,
    artwork,
    artworkData,
    artworkMimeType,
    artworkFileUri: artwork,
    durationSeconds,
    lyricsFileUri,
    lyricsText,
    hasSyncedLyrics,
    hasPlainLyrics,
  };
};

const readIndexedTracks = async (): Promise<Track[]> => {
  if (!indexFile.exists) return [];
  try {
    return JSON.parse(await indexFile.text()) as Track[];
  } catch {
    return [];
  }
};

const scanLooseAudioFiles = async (indexed: Track[]): Promise<Track[]> => {
  let indexChanged = false;
  const refreshed: Track[] = [];
  for (const track of indexed) {
    if (!track.localUri) {
      refreshed.push(track);
      continue;
    }
    try {
      const audioFile = new File(track.localUri);
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      const lrc = new File(audioFile.parentDirectory, `${baseName}.lrc`);
      const txt = new File(audioFile.parentDirectory, `${baseName}.txt`);
      const needsMetadataRecovery = !track.title.trim()
        || isGeneratedLocalId(track.title)
        || isFallbackArtist(track.artist);
      const embedded = needsMetadataRecovery
        ? await extractEmbeddedMetadata(audioFile, track.id, {
          title: track.title.trim() || baseName,
          artist: track.artist.trim() || 'Unknown artist',
        })
        : undefined;
      const lyricsFileUri = lrc.exists
        ? lrc.uri
        : txt.exists
          ? txt.uri
          : (track.lyricsFileUri && new File(track.lyricsFileUri).exists ? track.lyricsFileUri : embedded?.lyricsFileUri);
      const artwork = await cacheArtworkForTrack(audioFile, downloadsDirectory, track.id, track.artwork);
      const next = {
        ...track,
        title: (isGeneratedLocalId(track.title) || !track.title.trim()) && isUsefulEmbeddedText(embedded?.title)
          ? embedded!.title
          : track.title,
        artist: isFallbackArtist(track.artist) && isUsefulEmbeddedText(embedded?.artist)
          ? embedded!.artist
          : track.artist,
        album: track.album.trim() || embedded?.album || '',
        albumArtist: track.albumArtist || embedded?.albumArtist,
        trackNumber: track.trackNumber ?? embedded?.trackNumber,
        year: track.year ?? embedded?.year,
        genre: track.genre?.length ? track.genre : embedded?.genre,
        composer: track.composer?.length ? track.composer : embedded?.composer,
        durationSeconds: track.durationSeconds ?? embedded?.durationSeconds,
        duration: (!track.duration || track.duration === '—') && embedded?.durationSeconds
          ? formatDuration(embedded.durationSeconds)
          : track.duration,
        lyricsFileUri,
        artwork: artwork || embedded?.artwork || track.artwork,
        artworkFileUri: track.artworkFileUri || embedded?.artworkFileUri || artwork,
        lyricsAvailable: Boolean(track.lyricsAvailable || lyricsFileUri),
        hasSyncedLyrics: Boolean(track.hasSyncedLyrics || lrc.exists || embedded?.hasSyncedLyrics),
        hasPlainLyrics: Boolean(track.hasPlainLyrics || (!lrc.exists && txt.exists) || embedded?.hasPlainLyrics),
      };
      if (JSON.stringify(next) !== JSON.stringify(track)) indexChanged = true;
      refreshed.push(next);
    } catch {
      refreshed.push(track);
    }
  }
  const knownUris = new Set(refreshed.map((track) => track.localUri).filter(Boolean));
  const discovered: Track[] = [];
  for (const item of downloadsDirectory.list()) {
    if (!(item instanceof File) || !supportedAudio.test(item.name) || knownUris.has(item.uri)) continue;
    const baseName = item.name.replace(/\.[^.]+$/, '');
    const fallback = metadataFromFile(item.name);
    const id = isGeneratedLocalId(baseName) ? baseName : idForImport(item.uri, fallback.title, fallback.artist);
    const embedded = await extractEmbeddedMetadata(item, id, fallback);
    const title = isUsefulEmbeddedText(embedded.title) ? embedded.title : fallback.title;
    const artist = isUsefulEmbeddedText(embedded.artist) ? embedded.artist : fallback.artist;
    const lrc = new File(downloadsDirectory, `${baseName}.lrc`);
    const txt = new File(downloadsDirectory, `${baseName}.txt`);
    const artwork = embedded.artwork || await cacheArtworkForTrack(item, downloadsDirectory, id);
    discovered.push({
      id,
      title,
      artist,
      album: embedded.album,
      albumArtist: embedded.albumArtist,
      trackNumber: embedded.trackNumber,
      year: embedded.year,
      genre: embedded.genre,
      composer: embedded.composer,
      duration: formatDuration(embedded.durationSeconds),
      durationSeconds: embedded.durationSeconds,
      artwork: artwork ?? '',
      artworkFileUri: embedded.artworkFileUri || artwork,
      provider: 'local',
      providerId: id,
      fileExtension: item.extension,
      localUri: item.uri,
      lyricsFileUri: lrc.exists ? lrc.uri : txt.exists ? txt.uri : embedded.lyricsFileUri,
      lyricsAvailable: lrc.exists || txt.exists || Boolean(embedded.lyricsFileUri),
      hasSyncedLyrics: lrc.exists || embedded.hasSyncedLyrics,
      hasPlainLyrics: !lrc.exists && (txt.exists || embedded.hasPlainLyrics),
      dateAdded: Date.now(),
    });
  }
  if (discovered.length === 0) {
    if (indexChanged) writeTextFile(indexFile, JSON.stringify(refreshed));
    return refreshed;
  }
  const merged = [...refreshed, ...discovered];
  writeTextFile(indexFile, JSON.stringify(merged));
  return merged;
};

export const OfflineMusicService = {
  async inspectLocalAudioMetadata(sourceUri: string) {
    const audioFile = new File(sourceUri);
    return extractEmbeddedMetadata(
      audioFile,
      'local-audio-preview',
      { title: 'Unknown', artist: 'Unknown' },
      false,
    );
  },

  async getDownloadedTracks(): Promise<Track[]> {
    ensureDirectory();
    const indexed = await readIndexedTracks();
    const tracks = await scanLooseAudioFiles(indexed);
    return tracks.filter((track) => track.localUri && new File(track.localUri).exists);
  },

  async exportDownloadedTracksAsZip(destinationDirectory: Directory): Promise<{ fileName: string; exportedCount: number; lyricCount: number; artworkCount: number }> {
    const tracks = await this.getDownloadedTracks();
    const entries: ZipEntry[] = [];
    const manifestTracks: Record<string, unknown>[] = [];
    let exportedCount = 0;
    let lyricCount = 0;
    let artworkCount = 0;
    const usedExportBases = new Set<string>();
    const textEncoder = new TextEncoder();

    for (const track of tracks) {
      if (!track.localUri) continue;
      const audioFile = new File(track.localUri);
      if (!audioFile.exists) continue;

      const baseName = `${safeExportName(track.artist)} - ${safeExportName(track.title)}`;
      const extension = safeExportExtension(audioFile.extension || track.fileExtension, '.mp3');
      let exportBaseName = baseName;
      let suffix = 2;
      while (usedExportBases.has(exportBaseName.toLowerCase())) {
        exportBaseName = `${baseName} (${suffix})`;
        suffix += 1;
      }
      usedExportBases.add(exportBaseName.toLowerCase());
      const audioPath = `tracks/${exportBaseName}${extension}`;
      entries.push({ name: audioPath, file: audioFile });
      exportedCount += 1;
      const manifestTrack: Record<string, unknown> = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        durationSeconds: track.durationSeconds,
        albumArtist: track.albumArtist,
        trackNumber: track.trackNumber,
        year: track.year,
        genre: track.genre,
        composer: track.composer,
        isFavorite: track.isFavorite,
        playCount: track.playCount,
        provider: track.provider,
        providerId: track.providerId,
        mixId: track.mixId,
        mixOffset: track.mixOffset,
        lyricsAvailable: track.lyricsAvailable,
        hasSyncedLyrics: track.hasSyncedLyrics,
        hasPlainLyrics: track.hasPlainLyrics,
        lyricsSource: track.lyricsSource,
        licenseUrl: track.licenseUrl,
        shareUrl: track.shareUrl,
        audio: audioPath,
      };

      if (track.lyricsFileUri) {
        const lyricsFile = new File(track.lyricsFileUri);
        if (lyricsFile.exists) {
          const lyricsExtension = safeExportExtension(lyricsFile.extension, track.hasSyncedLyrics ? '.lrc' : '.txt');
          const lyricsPath = `lyrics/${exportBaseName}${lyricsExtension}`;
          entries.push({ name: lyricsPath, file: lyricsFile });
          manifestTrack.lyrics = lyricsPath;
          lyricCount += 1;
        }
      } else {
        const lyricsText = track.syncedLyrics?.trim() ? track.syncedLyrics : track.plainLyrics;
        if (lyricsText?.trim()) {
          const lyricsExtension = track.syncedLyrics?.trim() || track.hasSyncedLyrics ? '.lrc' : '.txt';
          const lyricsPath = `lyrics/${exportBaseName}${lyricsExtension}`;
          entries.push({ name: lyricsPath, bytes: textEncoder.encode(lyricsText) });
          manifestTrack.lyrics = lyricsPath;
          lyricCount += 1;
        }
      }

      const artworkUri = track.artworkFileUri || (track.artwork.startsWith('file://') ? track.artwork : undefined);
      if (artworkUri) {
        const artworkFile = new File(artworkUri);
        if (artworkFile.exists) {
          const artworkExtension = safeExportExtension(artworkFile.extension, '.jpg');
          const artworkPath = `artwork/${exportBaseName}${artworkExtension}`;
          entries.push({ name: artworkPath, file: artworkFile });
          manifestTrack.artwork = artworkPath;
          artworkCount += 1;
        }
      }

      manifestTracks.push(manifestTrack);
    }

    if (exportedCount === 0) return { fileName: '', exportedCount, lyricCount, artworkCount };

    entries.push({
      name: 'library.json',
      bytes: textEncoder.encode(JSON.stringify({
        format: 'Musiqapp library archive',
        version: 1,
        exportedAt: new Date().toISOString(),
        tracks: manifestTracks,
      }, null, 2)),
    });

    const baseFileName = 'Musiqapp Library Export';
    let fileName = `${baseFileName}.zip`;
    let suffix = 2;
    while (new File(destinationDirectory, fileName).exists) {
      fileName = `${baseFileName} (${suffix}).zip`;
      suffix += 1;
    }

    const archiveFile = new File(destinationDirectory, fileName);
    const centralEntries: ZipCentralEntry[] = [];
    const timestamp = zipDosTimestamp(new Date());
    let outputHandle: FileHandle | undefined;
    let archiveComplete = false;
    let outputOffset = 0;

    try {
      archiveFile.create({ intermediates: true });
      outputHandle = archiveFile.open(FileMode.WriteOnly);

      for (const entry of entries) {
        const encodedName = textEncoder.encode(entry.name);
        if (encodedName.length > 0xffff) throw new Error(`A library filename is too long to include: ${entry.name}`);

        const localOffset = outputOffset;
        const header = makeZipLocalHeader(encodedName, timestamp.time, timestamp.date);
        outputHandle.writeBytes(header);
        outputOffset += header.length;

        let crc = 0xffffffff;
        let entrySize = 0;
        let bytesSinceYield = 0;
        const writeData = (bytes: Uint8Array) => {
          if (!outputHandle) throw new Error('The ZIP archive is no longer open.');
          outputHandle.writeBytes(bytes);
          crc = updateZipCrc(crc, bytes);
          entrySize += bytes.length;
          outputOffset += bytes.length;
          bytesSinceYield += bytes.length;
        };

        if (entry.file) {
          const expectedSize = entry.file.size;
          if (!Number.isFinite(expectedSize) || expectedSize < 0) {
            throw new Error(`Could not read the size of ${entry.file.name}.`);
          }
          const sourceHandle = entry.file.open(FileMode.ReadOnly);
          try {
            let remaining = expectedSize;
            while (remaining > 0) {
              const chunk = sourceHandle.readBytes(Math.min(256 * 1024, remaining));
              if (chunk.length === 0) throw new Error(`${entry.file.name} changed while the library was being exported.`);
              writeData(chunk);
              remaining -= chunk.length;
              if (bytesSinceYield >= 4 * 1024 * 1024) {
                bytesSinceYield = 0;
                await yieldToUi();
              }
            }
          } finally {
            sourceHandle.close();
          }
        } else if (entry.bytes) {
          for (let start = 0; start < entry.bytes.length; start += 256 * 1024) {
            writeData(entry.bytes.subarray(start, Math.min(start + 256 * 1024, entry.bytes.length)));
            if (bytesSinceYield >= 4 * 1024 * 1024) {
              bytesSinceYield = 0;
              await yieldToUi();
            }
          }
        }

        const finalCrc = (crc ^ 0xffffffff) >>> 0;
        const descriptor = makeZipDataDescriptor(finalCrc, entrySize);
        outputHandle.writeBytes(descriptor);
        outputOffset += descriptor.length;
        centralEntries.push({ name: encodedName, crc: finalCrc, size: entrySize, localOffset });
        if (bytesSinceYield > 0) await yieldToUi();
      }

      const centralOffset = outputOffset;
      for (const entry of centralEntries) {
        const record = makeZipCentralEntry(entry, timestamp.time, timestamp.date);
        outputHandle.writeBytes(record);
        outputOffset += record.length;
      }
      const centralSize = outputOffset - centralOffset;
      const zip64EndOffset = outputOffset;
      const zip64EndRecord = makeZip64EndRecord(centralEntries.length, centralSize, centralOffset);
      outputHandle.writeBytes(zip64EndRecord);
      outputOffset += zip64EndRecord.length;
      const zip64Locator = makeZip64Locator(zip64EndOffset);
      outputHandle.writeBytes(zip64Locator);
      outputOffset += zip64Locator.length;
      const endRecord = makeZipEndRecord();
      outputHandle.writeBytes(endRecord);
      outputOffset += endRecord.length;

      outputHandle.close();
      outputHandle = undefined;
      archiveComplete = true;
    } finally {
      outputHandle?.close();
      if (!archiveComplete && archiveFile.exists) {
        try {
          archiveFile.delete();
        } catch {
          // Preserve the original export error if the destination refuses cleanup.
        }
      }
    }

    return { fileName, exportedCount, lyricCount, artworkCount };
  },

  async downloadTrack(track: Track): Promise<Track> {
    if (!track.downloadAllowed || !track.downloadUrl) {
      throw new Error('This track is not available for download.');
    }
    ensureDirectory();
    const fileExtension = track.fileExtension || '.mp3';
    const fileName = `${safeName(track.id)}${fileExtension}`;
    const audioFile = new File(downloadsDirectory, fileName);
    await File.downloadFileAsync(track.downloadUrl, audioFile, {
      idempotent: true,
    });
    const artwork = await cacheArtworkForTrack(audioFile, downloadsDirectory, track.id, track.artwork);

    let lyricsFileUri: string | undefined;
    if (track.syncedLyrics?.trim()) {
      const lyricsFile = new File(downloadsDirectory, `${safeName(track.id)}.lrc`);
      writeTextFile(lyricsFile, track.syncedLyrics);
      lyricsFileUri = lyricsFile.uri;
    } else if (track.plainLyrics?.trim()) {
      const lyricsFile = new File(downloadsDirectory, `${safeName(track.id)}.txt`);
      writeTextFile(lyricsFile, track.plainLyrics);
      lyricsFileUri = lyricsFile.uri;
    }

    const downloadedTrack: Track = { ...track, ...(artwork ? { artwork } : {}), localUri: audioFile.uri, lyricsFileUri };
    const current = await this.getDownloadedTracks();
    const updated = [...current.filter((item) => item.id !== track.id), downloadedTrack];
    writeTextFile(indexFile, JSON.stringify(updated));
    return downloadedTrack;
  },

  /** Import a direct audio URL into the app's private Documents library. */
  async importAudioUrl(
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: { progress: number | null; message: string; bytesDownloaded: number; totalBytes: number | null }) => void,
    sourceArtwork = '',
  ): Promise<Track> {
    const normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error('Only a direct HTTP audio URL can be imported locally.');
    }
    ensureDirectory();
    const id = idForImport(normalizedUrl, title, artist);
    const fileExtension = extensionFromUrl(normalizedUrl);
    const audioFile = new File(downloadsDirectory, `${safeName(id)}${fileExtension}`);
    onProgress({ progress: 0, message: 'Saving audio to this device…', bytesDownloaded: 0, totalBytes: null });
    await File.downloadFileAsync(normalizedUrl, audioFile, { idempotent: true });
    const artwork = await cacheArtworkForTrack(audioFile, downloadsDirectory, id, sourceArtwork);
    const track: Track = {
      id,
      title: title.trim() || 'Untitled track',
      artist: artist.trim() || 'Unknown artist',
      album: '',
      duration: '—',
      artwork: artwork ?? '',
      provider: 'local',
      providerId: id,
      fileExtension,
      downloadAllowed: false,
      downloadUrl: null,
      streamUrl: undefined,
      shareUrl: sourceUrl || normalizedUrl,
      localUri: audioFile.uri,
      dateAdded: Date.now(),
      lyricsAvailable: false,
    };
    const current = await this.getDownloadedTracks();
    const updated = [...current.filter((item) => item.id !== id), track];
    writeTextFile(indexFile, JSON.stringify(updated));
    onProgress({ progress: 1, message: 'Saved to this device.', bytesDownloaded: audioFile.size ?? 0, totalBytes: audioFile.size ?? null });
    return track;
  },

  /** Copy a file selected from the Files app into the private music library. */
  async importLocalFile(
    sourceUri: string,
    title: string,
    artist: string,
    album = '',
    sourceUrl = '',
    sourceArtwork = '',
  ): Promise<Track> {
    ensureDirectory();
    const id = idForImport(sourceUrl || sourceUri, title, artist);
    const fileExtension = extensionFromUrl(sourceUri);
    const audioFile = new File(downloadsDirectory, `${safeName(id)}${fileExtension}`);
    if (audioFile.exists) audioFile.delete();
    await new File(sourceUri).copy(audioFile);
    const embedded = await extractEmbeddedMetadata(audioFile, id, { title, artist });
    const artwork = embedded.artwork || await cacheArtworkForTrack(new File(sourceUri), downloadsDirectory, id, sourceArtwork);
    const track: Track = {
      id,
      title: embedded.title.trim() || 'Untitled track',
      artist: embedded.artist.trim() || 'Unknown artist',
      album: embedded.album || album,
      albumArtist: embedded.albumArtist,
      trackNumber: embedded.trackNumber,
      year: embedded.year,
      genre: embedded.genre,
      composer: embedded.composer,
      duration: formatDuration(embedded.durationSeconds),
      durationSeconds: embedded.durationSeconds,
      artwork: artwork || '',
      artworkFileUri: embedded.artworkFileUri,
      provider: 'local',
      providerId: id,
      fileExtension,
      downloadAllowed: false,
      localUri: audioFile.uri,
      shareUrl: sourceUrl || undefined,
      dateAdded: Date.now(),
      lyricsFileUri: embedded.lyricsFileUri,
      lyricsAvailable: Boolean(embedded.lyricsFileUri),
      hasSyncedLyrics: embedded.hasSyncedLyrics,
      hasPlainLyrics: embedded.hasPlainLyrics,
    };
    const current = await this.getDownloadedTracks();
    writeTextFile(indexFile, JSON.stringify([...current.filter((item) => item.id !== id), track]));
    return track;
  },

  /** Recursively copy supported audio and matching lyric sidecars into private storage. */
  async importLocalFolder(sourceDirectory: Directory): Promise<{ importedCount: number; skippedCount: number; artworkCount: number }> {
    ensureDirectory();
    const current = await this.getDownloadedTracks();
    const imported: Track[] = [];
    let skippedCount = 0;

    const visit = async (directory: Directory): Promise<void> => {
      let entries: (Directory | File)[];
      try {
        entries = directory.list();
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry instanceof Directory) {
          await visit(entry);
          continue;
        }
        if (!supportedAudio.test(entry.name)) {
          skippedCount += 1;
          continue;
        }

        const { title, artist } = metadataFromFile(entry.name);
        const id = idForImport(entry.uri, title, artist);
        const fileExtension = entry.extension || '.mp3';
        const audioFile = new File(downloadsDirectory, `${safeName(id)}${fileExtension}`);
        try {
          if (audioFile.exists) audioFile.delete();
          await entry.copy(audioFile);
          const embedded = await extractEmbeddedMetadata(audioFile, id, { title, artist });
          const artwork = embedded.artwork || await cacheArtworkForTrack(entry, downloadsDirectory, id);
          const baseName = entry.name.replace(/\.[^.]+$/, '');
          const sourceLrc = new File(entry.parentDirectory, `${baseName}.lrc`);
          const sourceText = new File(entry.parentDirectory, `${baseName}.txt`);
          let lyricsFileUri: string | undefined = embedded.lyricsFileUri;
          let hasSyncedLyrics = embedded.hasSyncedLyrics;
          let hasPlainLyrics = embedded.hasPlainLyrics;
          if (sourceLrc.exists) {
            const destination = new File(downloadsDirectory, `${safeName(id)}.lrc`);
            if (destination.exists) destination.delete();
            await sourceLrc.copy(destination);
            lyricsFileUri = destination.uri;
            hasSyncedLyrics = true;
            hasPlainLyrics = false;
          } else if (sourceText.exists) {
            const destination = new File(downloadsDirectory, `${safeName(id)}.txt`);
            if (destination.exists) destination.delete();
            await sourceText.copy(destination);
            lyricsFileUri = destination.uri;
            hasSyncedLyrics = false;
            hasPlainLyrics = true;
          }
          imported.push({
            id,
            title: embedded.title,
            artist: embedded.artist,
            album: embedded.album,
            albumArtist: embedded.albumArtist,
            trackNumber: embedded.trackNumber,
            year: embedded.year,
            genre: embedded.genre,
            composer: embedded.composer,
            duration: formatDuration(embedded.durationSeconds),
            durationSeconds: embedded.durationSeconds,
            artwork: artwork || '',
            artworkFileUri: embedded.artworkFileUri,
            provider: 'local',
            providerId: id,
            fileExtension,
            downloadAllowed: false,
            localUri: audioFile.uri,
            lyricsFileUri,
            lyricsAvailable: Boolean(lyricsFileUri),
            hasSyncedLyrics,
            hasPlainLyrics,
            dateAdded: Date.now(),
          });
        } catch {
          skippedCount += 1;
        }
      }
    };

    await visit(sourceDirectory);
    if (imported.length > 0) {
      const byId = new Map(current.map((track) => [track.id, track]));
      imported.forEach((track) => byId.set(track.id, track));
      writeTextFile(indexFile, JSON.stringify([...byId.values()]));
    }
    return { importedCount: imported.length, skippedCount, artworkCount: imported.filter((track) => Boolean(track.artwork)).length };
  },

  async saveSyncedLyrics(track: Track, syncedLyrics: string): Promise<Track> {
    const replacementLyrics = deduplicateSyncedLyrics(syncedLyrics);
    const trackWithLyrics: Track = {
      ...track,
      syncedLyrics: replacementLyrics,
      lyrics: parseLyrics(replacementLyrics),
      lyricsAvailable: true,
      hasSyncedLyrics: true,
    };
    const current = await this.getDownloadedTracks();
    const savedTrack = current.find((item) => item.id === track.id);
    if (!savedTrack) return trackWithLyrics;

    ensureDirectory();
    const lyricsFile = new File(downloadsDirectory, `${safeName(track.id)}.lrc`);
    writeTextFile(lyricsFile, replacementLyrics);
    const textFile = new File(downloadsDirectory, `${safeName(track.id)}.txt`);
    if (textFile.exists) textFile.delete();

    const updatedTrack: Track = {
      ...savedTrack,
      ...trackWithLyrics,
      localUri: savedTrack.localUri,
      lyricsFileUri: lyricsFile.uri,
    };
    const updatedTracks = [...current.filter((item) => item.id !== track.id), updatedTrack];
    writeTextFile(indexFile, JSON.stringify(updatedTracks));
    return updatedTrack;
  },

  async replaceTrackAudio(track: Track, replacementUri: string): Promise<void> {
    const indexedTracks = await readIndexedTracks();
    const savedTrack = indexedTracks.find((item) => item.id === track.id);
    if (!savedTrack?.localUri) throw new Error('This track is no longer in your local library.');

    ensureDirectory();
    const originalUri = savedTrack.localUri;
    const replacement = new File(replacementUri);
    const stagingUri = new File(downloadsDirectory, `${safeName(track.id)}.sync-pending`).uri;
    const backupUri = new File(downloadsDirectory, `${safeName(track.id)}.sync-backup`).uri;
    const originalFile = () => new File(originalUri);
    const stagingFile = () => new File(stagingUri);
    const backupFile = () => new File(backupUri);

    if (backupFile().exists) {
      if (originalFile().exists) backupFile().delete();
      else {
        try {
          await backupFile().move(originalFile(), { overwrite: true });
        } catch {
          throw new Error(`Could not restore the original MP3. Its backup is at ${backupUri}.`);
        }
      }
    }
    if (!replacement.exists || (replacement.size ?? 0) <= 0) {
      throw new Error('The synchronized MP3 could not be found. The library track was not changed.');
    }
    if (originalUri === replacement.uri) throw new Error('The synchronized copy must be separate from the library original.');

    if (stagingFile().exists) stagingFile().delete();

    const expectedSize = replacement.size ?? 0;
    await replacement.copy(stagingFile());
    if (!stagingFile().exists || (stagingFile().size ?? 0) !== expectedSize) {
      if (stagingFile().exists) stagingFile().delete();
      throw new Error('Could not stage the synchronized MP3. The library track was not changed.');
    }

    let hasBackup = false;
    try {
      if (originalFile().exists) {
        await originalFile().move(backupFile());
        hasBackup = true;
      }
      try {
        // File.move mutates the source File's URI. Use fresh File references for
        // both paths so the staged file cannot accidentally target its backup.
        await stagingFile().move(originalFile(), { overwrite: true });
        const installedFile = originalFile();
        if (!installedFile.exists || (installedFile.size ?? 0) !== expectedSize) {
          throw new Error('The synchronized MP3 could not replace the original completely.');
        }
      } catch (error) {
        const installedFile = originalFile();
        if (installedFile.exists) installedFile.delete();
        if (hasBackup && backupFile().exists) {
          try {
            await backupFile().move(originalFile(), { overwrite: true });
          } catch {
            throw new Error(`Could not restore the original MP3. Its backup is at ${backupUri}.`);
          }
        }
        throw error;
      }
    } finally {
      if (stagingFile().exists) stagingFile().delete();
    }

    if (hasBackup && backupFile().exists) {
      try {
        backupFile().delete();
      } catch {
        // Keep the completed replacement; a later save can clean up this backup.
      }
    }
  },

  async updateTrack(track: Track): Promise<void> {
    const current = await this.getDownloadedTracks();
    if (!current.some((item) => item.id === track.id)) return;
    const updatedTracks = current.map((item) => item.id === track.id
      ? { ...item, ...track, localUri: item.localUri }
      : item,
    );
    writeTextFile(indexFile, JSON.stringify(updatedTracks));
  },

  async removeDownloadedTracks(trackIds: string[]): Promise<{ removedTrackIds: string[]; freedBytes: number }> {
    const requestedIds = new Set(trackIds);
    const current = await this.getDownloadedTracks();
    const remaining: Track[] = [];
    const removedTrackIds: string[] = [];
    let freedBytes = 0;

    for (const track of current) {
      if (!requestedIds.has(track.id) || !track.localUri) {
        remaining.push(track);
        continue;
      }

      const audioFile = new File(track.localUri);
      if (audioFile.exists) {
        try {
          const audioBytes = audioFile.size;
          audioFile.delete();
          freedBytes += audioBytes;
        } catch {
          remaining.push(track);
          continue;
        }
      }

      if (track.lyricsFileUri) {
        const lyricsFile = new File(track.lyricsFileUri);
        if (lyricsFile.exists) {
          try {
            const lyricsBytes = lyricsFile.size;
            lyricsFile.delete();
            freedBytes += lyricsBytes;
          } catch {
            // The audio is already removed; keep the download removal successful.
          }
        }
      }
      if (track.artworkFileUri) {
        const artworkFile = new File(track.artworkFileUri);
        if (artworkFile.exists) {
          try {
            const artworkBytes = artworkFile.size;
            artworkFile.delete();
            freedBytes += artworkBytes;
          } catch {
            // The audio is already removed; keep the download removal successful.
          }
        }
      }
      removedTrackIds.push(track.id);
    }

    writeTextFile(indexFile, JSON.stringify(remaining));
    return { removedTrackIds, freedBytes };
  },

};
