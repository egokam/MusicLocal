import { Directory, File, Paths } from 'expo-file-system';
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

const extractEmbeddedMetadata = async (audioFile: File, id: string, fallback: { title: string; artist: string }) => {
  let title = fallback.title;
  let artist = fallback.artist;
  let album = '';
  let albumArtist: string | undefined;
  let trackNumber: number | undefined;
  let year: number | undefined;
  let genre: string[] | undefined;
  let composer: string[] | undefined;
  let artwork: string | undefined;
  let durationSeconds: number | undefined;
  let lyricsFileUri: string | undefined;
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
      const mimeType = picture.format.toLowerCase();
      const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg';
      const artworkFile = new File(downloadsDirectory, `${safeName(id)}-artwork.${extension}`);
      if (artworkFile.exists) artworkFile.delete();
      artworkFile.create({ intermediates: true });
      artworkFile.write(picture.data);
      if (artworkFile.exists && (artworkFile.size ?? 0) > 0) artwork = artworkFile.uri;
      else console.warn(`[Music import] Embedded artwork was parsed but not saved for ${audioFile.name}.`);
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
      hasSyncedLyrics = (result.common.lyrics ?? []).some((entry) => Boolean(entry.syncText?.length));
      hasPlainLyrics = !hasSyncedLyrics;
      const lyricsFile = new File(downloadsDirectory, `${safeName(id)}.${hasSyncedLyrics ? 'lrc' : 'txt'}`);
      if (lyricsFile.exists) lyricsFile.delete();
      writeTextFile(lyricsFile, embeddedLyrics);
      lyricsFileUri = lyricsFile.uri;
    }
  } catch (error) {
    // Keep importing the audio, but report the parser failure instead of
    // silently making an embedded-cover failure impossible to diagnose.
    console.warn(`[Music import] Could not read embedded metadata from ${audioFile.name}:`, error);
  }
  return { title, artist, album, albumArtist, trackNumber, year, genre, composer, artwork, artworkFileUri: artwork, durationSeconds, lyricsFileUri, hasSyncedLyrics, hasPlainLyrics };
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
      const lyricsFileUri = lrc.exists ? lrc.uri : txt.exists ? txt.uri : undefined;
      const artwork = await cacheArtworkForTrack(audioFile, downloadsDirectory, track.id, track.artwork);
      const next = {
        ...track,
        lyricsFileUri,
        ...(artwork ? { artwork } : {}),
        lyricsAvailable: Boolean(track.lyricsAvailable || lyricsFileUri),
        hasSyncedLyrics: Boolean(track.hasSyncedLyrics || lrc.exists),
        hasPlainLyrics: Boolean(track.hasPlainLyrics || (!lrc.exists && txt.exists)),
      };
      if (next.lyricsFileUri !== track.lyricsFileUri || next.artwork !== track.artwork || next.hasSyncedLyrics !== track.hasSyncedLyrics || next.hasPlainLyrics !== track.hasPlainLyrics) indexChanged = true;
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
    const { title, artist } = metadataFromFile(item.name);
    const id = idForImport(item.uri, title, artist);
    const lrc = new File(downloadsDirectory, `${baseName}.lrc`);
    const txt = new File(downloadsDirectory, `${baseName}.txt`);
    const artwork = await cacheArtworkForTrack(item, downloadsDirectory, id);
    discovered.push({
      id,
      title,
      artist,
      album: '',
      duration: '—',
      artwork: artwork ?? '',
      provider: 'local',
      providerId: id,
      fileExtension: item.extension,
      localUri: item.uri,
      lyricsFileUri: lrc.exists ? lrc.uri : txt.exists ? txt.uri : undefined,
      lyricsAvailable: lrc.exists || txt.exists,
      hasSyncedLyrics: lrc.exists,
      hasPlainLyrics: !lrc.exists && txt.exists,
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
  async getDownloadedTracks(): Promise<Track[]> {
    ensureDirectory();
    const indexed = await readIndexedTracks();
    const tracks = await scanLooseAudioFiles(indexed);
    return tracks.filter((track) => track.localUri && new File(track.localUri).exists);
  },

  async exportDownloadedTracks(destinationDirectory: Directory): Promise<{ exportedCount: number; lyricCount: number; artworkCount: number }> {
    const tracks = await this.getDownloadedTracks();
    let exportedCount = 0;
    let lyricCount = 0;
    let artworkCount = 0;

    for (const track of tracks) {
      if (!track.localUri) continue;
      const audioFile = new File(track.localUri);
      if (!audioFile.exists) continue;

      const baseName = `${safeExportName(track.artist)} - ${safeExportName(track.title)}`;
      const extension = audioFile.extension || track.fileExtension || '.mp3';
      let exportBaseName = baseName;
      let suffix = 2;
      while (new File(destinationDirectory, `${exportBaseName}${extension}`).exists) {
        exportBaseName = `${baseName} (${suffix})`;
        suffix += 1;
      }
      const exportedAudio = new File(destinationDirectory, `${exportBaseName}${extension}`);
      await audioFile.copy(exportedAudio);
      exportedCount += 1;

      if (track.lyricsFileUri) {
        const lyricsFile = new File(track.lyricsFileUri);
        if (lyricsFile.exists) {
          const lyricsExtension = lyricsFile.extension || (track.hasSyncedLyrics ? '.lrc' : '.txt');
          await lyricsFile.copy(new File(destinationDirectory, `${exportBaseName}${lyricsExtension}`), { overwrite: true });
          lyricCount += 1;
        }
      } else {
        const lyricsText = track.syncedLyrics?.trim() ? track.syncedLyrics : track.plainLyrics;
        if (lyricsText?.trim()) {
          const lyricsExtension = track.syncedLyrics?.trim() || track.hasSyncedLyrics ? '.lrc' : '.txt';
          const exportedLyrics = new File(destinationDirectory, `${exportBaseName}${lyricsExtension}`);
          exportedLyrics.create({ overwrite: true });
          exportedLyrics.write(lyricsText);
          lyricCount += 1;
        }
      }

      const artworkUri = track.artworkFileUri || (track.artwork.startsWith('file://') ? track.artwork : undefined);
      if (artworkUri) {
        const artworkFile = new File(artworkUri);
        if (artworkFile.exists) {
          const artworkExtension = artworkFile.extension || '.jpg';
          await artworkFile.copy(new File(destinationDirectory, `${exportBaseName}${artworkExtension}`), { overwrite: true });
          artworkCount += 1;
        }
      }
    }

    return { exportedCount, lyricCount, artworkCount };
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
    const artwork = await cacheArtworkForTrack(audioFile, downloadsDirectory, id);
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
  async importLocalFile(sourceUri: string, title: string, artist: string, album = ''): Promise<Track> {
    ensureDirectory();
    const id = idForImport(sourceUri, title, artist);
    const fileExtension = extensionFromUrl(sourceUri);
    const audioFile = new File(downloadsDirectory, `${safeName(id)}${fileExtension}`);
    if (audioFile.exists) audioFile.delete();
    await new File(sourceUri).copy(audioFile);
    const embedded = await extractEmbeddedMetadata(audioFile, id, { title, artist });
    const artwork = embedded.artwork || await cacheArtworkForTrack(new File(sourceUri), downloadsDirectory, id);
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
    const original = new File(savedTrack.localUri);
    const replacement = new File(replacementUri);
    const staging = new File(downloadsDirectory, `${safeName(track.id)}.sync-pending`);
    const backup = new File(downloadsDirectory, `${safeName(track.id)}.sync-backup`);

    if (backup.exists) {
      if (original.exists) original.delete();
      try {
        await backup.move(original);
      } catch {
        throw new Error(`Could not restore the original MP3. Its backup is at ${backup.uri}.`);
      }
    }
    if (!original.exists) throw new Error('The original library MP3 is no longer available.');
    if (!replacement.exists || (replacement.size ?? 0) <= 0) {
      throw new Error('The synchronized MP3 could not be found. The library track was not changed.');
    }
    if (original.uri === replacement.uri) throw new Error('The synchronized copy must be separate from the library original.');

    if (staging.exists) staging.delete();

    const expectedSize = replacement.size ?? 0;
    await replacement.copy(staging);
    if (!staging.exists || (staging.size ?? 0) !== expectedSize) {
      if (staging.exists) staging.delete();
      throw new Error('Could not stage the synchronized MP3. The library track was not changed.');
    }

    try {
      await original.move(backup);
      try {
        await staging.move(original);
        if (!original.exists || (original.size ?? 0) !== expectedSize) {
          throw new Error('The synchronized MP3 could not replace the original completely.');
        }
      } catch (error) {
        if (original.exists) original.delete();
        if (backup.exists) {
          try {
            await backup.move(original);
          } catch {
            throw new Error(`Could not restore the original MP3. Its backup is at ${backup.uri}.`);
          }
        }
        throw error;
      }
    } finally {
      if (staging.exists) staging.delete();
    }

    if (backup.exists) backup.delete();
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
