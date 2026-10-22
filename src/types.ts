export type LyricLine = {
  timeMs: number | null;
  text: string;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNumber?: number;
  year?: number;
  genre?: string[];
  composer?: string[];
  duration: string;
  durationSeconds?: number;
  dateAdded?: number | string;
  artwork: string;
  artworkFileUri?: string;
  provider?: string;
  providerId?: string;
  mixId?: string;
  mixOffset?: number;
  fileExtension?: string;
  streamUrl?: string;
  downloadUrl?: string | null;
  downloadAllowed?: boolean;
  lyricsAvailable?: boolean;
  hasSyncedLyrics?: boolean;
  hasPlainLyrics?: boolean;
  lyricsSource?: string;
  isFavorite?: boolean;
  playCount?: number;
  licenseUrl?: string;
  shareUrl?: string;
  localUri?: string;
  lyricsFileUri?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  lyrics?: LyricLine[];
};

export type PlaylistSummary = {
  id: string;
  name: string;
  trackCount: number;
  coverUrl?: string | null;
  coverUri?: string;
  coverCachedUrl?: string;
};

export type PlaylistCoverSelection = {
  uri: string;
  mimeType: string;
};
