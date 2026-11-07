export type LyricSyllable = {
  text: string;
  startTimeMs: number | null;
  endTimeMs: number | null;
};

export type LyricWord = {
  text: string;
  startTimeMs: number | null;
  endTimeMs: number | null;
  syllables?: LyricSyllable[];
};

export type LyricVoice = {
  timeMs: number | null;
  text: string;
  words?: LyricWord[];
};

export type LyricLine = {
  timeMs: number | null;
  endTimeMs?: number | null;
  text: string;
  words?: LyricWord[];
  background?: LyricVoice[];
};

export type LyricsContributor = {
  username: string;
  url: string;
};

export type LyricsAttribution = {
  provider: string;
  providerUrl?: string;
  uploader?: LyricsContributor;
  maker?: LyricsContributor;
};

export type LyricsFormat = 'ttml' | 'word' | 'line' | 'plain';

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
  lyricsAttribution?: LyricsAttribution;
  lyricsFormat?: LyricsFormat;
  lyricsTtml?: string;
  lyricsLookupProviders?: string[];
  lyricsLookupIssues?: string[];
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
