import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { PlaylistCoverSelection, PlaylistSummary, Track } from '../types';
import type { ImportProgress, TrackEditChanges } from '../services/MusicCatalogService';

type PlaybackActions = {
  tracks: Track[];
  activeTrack: Track | null;
  mostPlayedTracks: Track[];
  downloadedTracks: Track[];
  hasActiveTrack: boolean;
  favoriteTracks: Track[];
  playlists: PlaylistSummary[];
  apiConnected: boolean;
  apiInitializing: boolean;
  isLoadingTracks: boolean;
  loadError: string | null;
  downloadedTrackIds: string[];
  downloadingTrackIds: string[];
  searchTracks: (query?: string) => Promise<void>;
  loadAllTracks: () => Promise<Track[]>;
  loadFavoriteTracks: () => Promise<Track[]>;
  loadPlaylists: () => Promise<PlaylistSummary[]>;
  loadPlaylistTracks: (playlistId: string) => Promise<Track[]>;
  checkTrackLyrics: (track: Track) => Promise<Track>;
  saveTrackLyrics: (track: Track, syncedLyrics: string) => Promise<Track>;
  connectToLibrary: (token: string) => Promise<void>;
  disconnectFromLibrary: () => Promise<void>;
  downloadTrack: (track: Track) => Promise<Track>;
  deleteDownloadedTracks: (trackIds: string[]) => Promise<number>;
  importAudioToLibrary: (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
  ) => Promise<Track>;
  importLocalFile: () => Promise<Track | null>;
  importMusicFolder: () => Promise<{ importedCount: number; skippedCount: number; artworkCount: number } | null>;
  updateTrack: (track: Track, changes: TrackEditChanges) => Promise<Track>;
  deleteTrack: (track: Track) => Promise<void>;
  toggleFavorite: (track: Track) => Promise<Track>;
  createPlaylist: (name: string, cover?: PlaylistCoverSelection) => Promise<PlaylistSummary>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, track: Track) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  playNext: (track: Track) => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  togglePlayback: () => void;
  playAllSongs: (queue?: Track[]) => void;
  shuffleSongs: (queue?: Track[]) => void;
};

export const PlaybackContext = createContext<PlaybackActions | null>(null);
export const RadioPlaybackStatusContext = createContext(false);

export type LibrarySelectionBarState = {
  selectionType: 'songs' | 'downloads';
  selectedCount: number;
  allSelected: boolean;
  canSelectAll: boolean;
  deleting: boolean;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

export const LibrarySelectionBarContext = createContext<{
  bar: LibrarySelectionBarState | null;
  setBar: Dispatch<SetStateAction<LibrarySelectionBarState | null>>;
  transitionProgress: SharedValue<number>;
} | null>(null);

export const usePlaybackActions = () => {
  const actions = useContext(PlaybackContext);
  if (!actions) throw new Error('Playback actions are unavailable outside PlaybackContext.');
  return actions;
};

export const useRadioPlaybackStatus = () => useContext(RadioPlaybackStatusContext);
