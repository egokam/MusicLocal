import { Directory, File, Paths } from 'expo-file-system';
import { parseLyrics } from './LyricsParser';
import type { Track } from '../types';

// This directory is inside the app's Documents container and is visible in
// Files/iTunes when UIFileSharingEnabled is enabled in app.json.
const downloadsDirectory = new Directory(Paths.document, 'Musiqapp');
const indexFile = new File(downloadsDirectory, 'downloads.json');

const ensureDirectory = () => {
  if (!downloadsDirectory.exists) {
    downloadsDirectory.create({ idempotent: true, intermediates: true });
  }
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

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
  const refreshed = indexed.map((track) => {
    if (!track.localUri) return track;
    try {
      const audioFile = new File(track.localUri);
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      const lrc = new File(audioFile.parentDirectory, `${baseName}.lrc`);
      const txt = new File(audioFile.parentDirectory, `${baseName}.txt`);
      const lyricsFileUri = lrc.exists ? lrc.uri : txt.exists ? txt.uri : undefined;
      const next = {
        ...track,
        lyricsFileUri,
        lyricsAvailable: Boolean(track.lyricsAvailable || lyricsFileUri),
        hasSyncedLyrics: Boolean(track.hasSyncedLyrics || lrc.exists),
        hasPlainLyrics: Boolean(track.hasPlainLyrics || (!lrc.exists && txt.exists)),
      };
      if (next.lyricsFileUri !== track.lyricsFileUri || next.hasSyncedLyrics !== track.hasSyncedLyrics || next.hasPlainLyrics !== track.hasPlainLyrics) indexChanged = true;
      return next;
    } catch {
      return track;
    }
  });
  const knownUris = new Set(refreshed.map((track) => track.localUri).filter(Boolean));
  const discovered: Track[] = [];
  for (const item of downloadsDirectory.list()) {
    if (!(item instanceof File) || !supportedAudio.test(item.name) || knownUris.has(item.uri)) continue;
    const baseName = item.name.replace(/\.[^.]+$/, '');
    const [artistPart, ...titleParts] = baseName.split(' - ');
    const artist = titleParts.length > 0 ? artistPart.trim() : 'Unknown artist';
    const title = (titleParts.length > 0 ? titleParts.join(' - ') : baseName).trim() || 'Untitled track';
    const id = idForImport(item.uri, title, artist);
    const lrc = new File(downloadsDirectory, `${baseName}.lrc`);
    const txt = new File(downloadsDirectory, `${baseName}.txt`);
    discovered.push({
      id,
      title,
      artist,
      album: '',
      duration: '—',
      artwork: '',
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

    const downloadedTrack: Track = { ...track, localUri: audioFile.uri, lyricsFileUri };
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
    const track: Track = {
      id,
      title: title.trim() || 'Untitled track',
      artist: artist.trim() || 'Unknown artist',
      album: '',
      duration: '—',
      artwork: '',
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
    const track: Track = {
      id,
      title: title.trim() || 'Untitled track',
      artist: artist.trim() || 'Unknown artist',
      album,
      duration: '—',
      artwork: '',
      provider: 'local',
      providerId: id,
      fileExtension,
      downloadAllowed: false,
      localUri: audioFile.uri,
      dateAdded: Date.now(),
      lyricsAvailable: false,
    };
    const current = await this.getDownloadedTracks();
    writeTextFile(indexFile, JSON.stringify([...current.filter((item) => item.id !== id), track]));
    return track;
  },

  async saveSyncedLyrics(track: Track, syncedLyrics: string): Promise<Track> {
    const trackWithLyrics: Track = {
      ...track,
      syncedLyrics,
      lyrics: parseLyrics(syncedLyrics),
      lyricsAvailable: true,
      hasSyncedLyrics: true,
    };
    const current = await this.getDownloadedTracks();
    const savedTrack = current.find((item) => item.id === track.id);
    if (!savedTrack) return trackWithLyrics;

    ensureDirectory();
    const lyricsFile = new File(downloadsDirectory, `${safeName(track.id)}.lrc`);
    writeTextFile(lyricsFile, syncedLyrics);
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
      removedTrackIds.push(track.id);
    }

    writeTextFile(indexFile, JSON.stringify(remaining));
    return { removedTrackIds, freedBytes };
  },

};
