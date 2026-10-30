import type { Track } from '../types';

export type AudiusMixId = 'arabic' | 'morocco' | 'english' | 'mix-2026' | 'golden-2017';

export type AudiusMixDefinition = {
  id: AudiusMixId;
  title: string;
  query: string;
  sortMethod: 'popular' | 'recent';
  glow: string;
};

export type GenreMixId = 'lofi' | 'afrohouse' | 'trip-hop' | 'chillpop';

export type GenreMixDefinition = {
  id: GenreMixId;
  title: string;
  query: string;
};

export const GENRE_MIXES: GenreMixDefinition[] = [
  { id: 'lofi', title: 'Lo-fi', query: 'lofi hip hop' },
  { id: 'afrohouse', title: 'Afro House', query: 'afro house' },
  { id: 'trip-hop', title: 'Trip-hop', query: 'trip hop' },
  { id: 'chillpop', title: 'Chill Pop', query: 'chill pop' },
];

export const AUDIO_MIXES: AudiusMixDefinition[] = [
  { id: 'arabic', title: 'Arabic Trending', query: 'arabic', sortMethod: 'popular', glow: '#F26A31' },
  { id: 'morocco', title: 'Morocco', query: 'moroccan', sortMethod: 'popular', glow: '#D53D5B' },
  { id: 'english', title: 'English', query: 'english pop', sortMethod: 'popular', glow: '#8B5CF6' },
  { id: 'mix-2026', title: '2026 Mix', query: '2026', sortMethod: 'recent', glow: '#F3A33A' },
  { id: 'golden-2017', title: '2017 Golden Mix', query: '2017', sortMethod: 'popular', glow: '#3B8CE6' },
];

const AUDIUS_API = 'https://api.audius.co/v1';
const DEFAULT_PAGE_SIZE = 18;

type AudiusTrack = {
  id?: string | number;
  title?: string;
  duration?: number;
  genre?: string;
  tags?: string;
  permalink?: string;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  user?: { name?: string; handle?: string };
  artist_name?: string;
  album?: { name?: string } | null;
  artwork?: Record<string, string> | null;
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const toTrack = (item: AudiusTrack, mixId?: AudiusMixId, mixOffset?: number): Track | null => {
  const id = String(item.id ?? '').trim();
  const title = item.title?.trim() ?? '';
  if (!id || !title || item.is_streamable === false || item.is_stream_gated === true) return null;

  const durationSeconds = Number(item.duration) || 0;
  const artwork = item.artwork?.['480x480'] || item.artwork?.['150x150'] || '';
  const permalink = item.permalink?.startsWith('/') ? `https://audius.co${item.permalink}` : undefined;

  return {
    id: `audius:${id}`,
    provider: 'audius',
    providerId: id,
    ...(mixId ? { mixId } : {}),
    ...(mixOffset === undefined ? {} : { mixOffset }),
    title,
    artist: item.user?.name?.trim() || item.user?.handle?.trim() || item.artist_name?.trim() || 'Audius artist',
    album: item.album?.name?.trim() || 'Audius',
    durationSeconds,
    duration: durationSeconds > 0 ? formatDuration(durationSeconds) : '—',
    artwork,
    streamUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(id)}/stream`,
    shareUrl: permalink,
    downloadUrl: null,
    downloadAllowed: false,
  };
};

export const AudiusCatalogService = {
  async searchTracks(query: string, limit = 24): Promise<Track[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const params = new URLSearchParams({ query: normalizedQuery, limit: String(limit) });
    const response = await fetch(`${AUDIUS_API}/tracks/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Audius returned ${response.status}.`);

    const payload = await response.json() as { data?: AudiusTrack[] };
    if (!Array.isArray(payload.data)) throw new Error('Audius returned an invalid track list.');
    return payload.data
      .map((item) => toTrack(item))
      .filter((track): track is Track => track !== null);
  },

  async getMixTracks(mixId: AudiusMixId, offset = 0, limit = DEFAULT_PAGE_SIZE): Promise<Track[]> {
    const mix = AUDIO_MIXES.find((item) => item.id === mixId);
    if (!mix) throw new Error('This music mix is unavailable.');

    const params = new URLSearchParams({
      query: mix.query,
      sort_method: mix.sortMethod,
      limit: String(limit),
      offset: String(offset),
    });
    const response = await fetch(`${AUDIUS_API}/tracks/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Audius returned ${response.status}.`);

    const payload = await response.json() as { data?: AudiusTrack[] };
    if (!Array.isArray(payload.data)) throw new Error('Audius returned an invalid track list.');
    return payload.data
      .map((item, index) => toTrack(item, mixId, offset + index))
      .filter((track): track is Track => track !== null);
  },

  async getGenreMixTracks(genreMixId: GenreMixId, offset = 0, limit = DEFAULT_PAGE_SIZE): Promise<Track[]> {
    const genreMix = GENRE_MIXES.find((item) => item.id === genreMixId);
    if (!genreMix) throw new Error('This genre mix is unavailable.');

    const params = new URLSearchParams({
      query: genreMix.query,
      sort_method: 'popular',
      limit: String(limit),
      offset: String(offset),
    });
    const response = await fetch(`${AUDIUS_API}/tracks/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Audius returned ${response.status}.`);

    const payload = await response.json() as { data?: AudiusTrack[] };
    if (!Array.isArray(payload.data)) throw new Error('Audius returned an invalid genre track list.');
    return payload.data
      .map((item) => toTrack(item))
      .filter((track): track is Track => track !== null);
  },
};
