import { Directory, File, Paths } from 'expo-file-system';
import type { PlaylistSummary, Track } from '../types';

type PlaylistState = {
  playlists: PlaylistSummary[];
  tracksByPlaylistId: Record<string, Track[]>;
};

const directory = new Directory(Paths.document, 'musiqapp-playlists');
const stateFile = new File(directory, 'playlists.json');
let writeQueue: Promise<unknown> = Promise.resolve();

const emptyState = (): PlaylistState => ({ playlists: [], tracksByPlaylistId: {} });

const ensureDirectory = () => {
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
};

const readState = async (): Promise<PlaylistState> => {
  ensureDirectory();
  if (!stateFile.exists) return emptyState();
  try {
    const state = JSON.parse(await stateFile.text()) as Partial<PlaylistState>;
    return {
      playlists: Array.isArray(state.playlists) ? state.playlists : [],
      tracksByPlaylistId: state.tracksByPlaylistId ?? {},
    };
  } catch {
    return emptyState();
  }
};

const writeState = (state: PlaylistState) => {
  ensureDirectory();
  if (stateFile.exists) stateFile.delete();
  stateFile.create({ intermediates: true });
  stateFile.write(JSON.stringify(state));
};

const updateState = async <T,>(mutate: (state: PlaylistState) => T | Promise<T>): Promise<T> => {
  const operation = writeQueue.then(async () => {
    const state = await readState();
    const result = await mutate(state);
    writeState(state);
    return result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
};

const imageExtension = (mimeType: string) => {
  if (mimeType.toLowerCase() === 'image/png') return 'png';
  if (mimeType.toLowerCase() === 'image/webp') return 'webp';
  return 'jpg';
};

const coverFile = (playlistId: string, extension: string) =>
  new File(directory, `cover-${playlistId}.${extension}`);

export const PlaylistStorageService = {
  async getPlaylists(): Promise<PlaylistSummary[]> {
    await writeQueue;
    return (await readState()).playlists;
  },

  /** Remove stale remote playlist entries and keep only tracks present in the local library. */
  async reconcileWithLocalTracks(localTracks: Track[]): Promise<PlaylistSummary[]> {
    return updateState((state) => {
      const localById = new Map(localTracks.map((track) => [track.id, track]));

      state.playlists = state.playlists.map((playlist) => {
        const seen = new Set<string>();
        const localPlaylistTracks = (state.tracksByPlaylistId[playlist.id] ?? []).flatMap((storedTrack) => {
          if (seen.has(storedTrack.id)) return [];
          const localTrack = localById.get(storedTrack.id);
          if (!localTrack) return [];
          seen.add(storedTrack.id);
          return [{ ...storedTrack, ...localTrack, localUri: localTrack.localUri }];
        });

        state.tracksByPlaylistId[playlist.id] = localPlaylistTracks;
        return {
          ...playlist,
          trackCount: localPlaylistTracks.length,
          // A local playlist may keep a local file URI, but never a VPS cover URL.
          coverUrl: playlist.coverUrl?.startsWith('http') ? undefined : playlist.coverUrl,
          coverCachedUrl: playlist.coverCachedUrl?.startsWith('http') ? undefined : playlist.coverCachedUrl,
        };
      });

      return state.playlists;
    });
  },

  async mergeRemotePlaylists(remotePlaylists: PlaylistSummary[], headers: Record<string, string>): Promise<PlaylistSummary[]> {
    return updateState(async (state) => {
      const cachedById = new Map(state.playlists.map((playlist) => [playlist.id, playlist]));
      const merged: PlaylistSummary[] = [];

      for (const remote of remotePlaylists) {
        const cached = cachedById.get(remote.id);
        const hasMatchingLocalCover = Boolean(
          cached?.coverUri && cached.coverCachedUrl && cached.coverCachedUrl === remote.coverUrl,
        );
        let coverUri = hasMatchingLocalCover ? cached?.coverUri : undefined;

        if (remote.coverUrl && !hasMatchingLocalCover) {
          try {
            const extension = remote.coverUrl.split('?')[0]?.split('.').pop()?.toLowerCase();
            const safeExtension = extension && ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'jpg';
            const destination = coverFile(remote.id, safeExtension);
            if (destination.exists) destination.delete();
            await File.downloadFileAsync(remote.coverUrl, destination, { headers, idempotent: true });
            coverUri = destination.uri;
          } catch {
            coverUri = undefined;
          }
        }

        merged.push({
          ...remote,
          coverUri,
          coverCachedUrl: remote.coverUrl ?? undefined,
        });
      }

      state.playlists = merged;
      return merged;
    });
  },

  async savePlaylist(playlist: PlaylistSummary): Promise<void> {
    await updateState((state) => {
      const index = state.playlists.findIndex((item) => item.id === playlist.id);
      if (index < 0) state.playlists.unshift(playlist);
      else state.playlists[index] = { ...state.playlists[index], ...playlist };
    });
  },

  async cacheCover(playlistId: string, sourceUri: string, mimeType: string): Promise<string> {
    ensureDirectory();
    const destination = coverFile(playlistId, imageExtension(mimeType));
    if (destination.exists) destination.delete();
    await new File(sourceUri).copy(destination);
    return destination.uri;
  },

  async removeCachedCover(uri: string): Promise<void> {
    try {
      const cover = new File(uri);
      if (cover.exists) cover.delete();
    } catch {
      // A failed create should not be masked by an unavailable temporary cover.
    }
  },

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    await writeQueue;
    const state = await readState();
    return state.tracksByPlaylistId[playlistId] ?? [];
  },

  async savePlaylistTracks(playlistId: string, tracks: Track[]): Promise<void> {
    await updateState((state) => {
      state.tracksByPlaylistId[playlistId] = tracks;
      const playlist = state.playlists.find((item) => item.id === playlistId);
      if (playlist) playlist.trackCount = tracks.length;
    });
  },

  async addTrack(playlistId: string, track: Track): Promise<boolean> {
    return updateState((state) => {
      const tracks = state.tracksByPlaylistId[playlistId] ?? [];
      if (tracks.some((item) => item.id === track.id)) return false;
      state.tracksByPlaylistId[playlistId] = [...tracks, track];
      const playlist = state.playlists.find((item) => item.id === playlistId);
      if (playlist) playlist.trackCount += 1;
      return true;
    });
  },

  async removeTrack(playlistId: string, trackId: string): Promise<boolean> {
    return updateState((state) => {
      const tracks = state.tracksByPlaylistId[playlistId] ?? [];
      const filtered = tracks.filter((track) => track.id !== trackId);
      const removed = filtered.length < tracks.length;
      if (!removed) return false;
      state.tracksByPlaylistId[playlistId] = filtered;
      const playlist = state.playlists.find((item) => item.id === playlistId);
      if (playlist) playlist.trackCount = Math.max(0, playlist.trackCount - 1);
      return true;
    });
  },

  async updateTrack(track: Track): Promise<void> {
    await updateState((state) => {
      for (const [playlistId, tracks] of Object.entries(state.tracksByPlaylistId)) {
        if (tracks.some((item) => item.id === track.id)) {
          state.tracksByPlaylistId[playlistId] = tracks.map((item) => item.id === track.id ? { ...item, ...track } : item);
        }
      }
    });
  },

  async deleteTrack(trackId: string): Promise<void> {
    await updateState((state) => {
      for (const [playlistId, tracks] of Object.entries(state.tracksByPlaylistId)) {
        const filtered = tracks.filter((track) => track.id !== trackId);
        const removed = filtered.length < tracks.length;
        state.tracksByPlaylistId[playlistId] = filtered;
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (playlist && removed) playlist.trackCount = Math.max(0, playlist.trackCount - 1);
      }
    });
  },

  async deletePlaylist(playlistId: string): Promise<void> {
    await updateState((state) => {
      const playlist = state.playlists.find((item) => item.id === playlistId);
      if (playlist?.coverUri) {
        try {
          const localCover = new File(playlist.coverUri);
          if (localCover.exists) localCover.delete();
        } catch {
          // The cached playlist can still be removed if its old cover is unavailable.
        }
      }
      state.playlists = state.playlists.filter((item) => item.id !== playlistId);
      delete state.tracksByPlaylistId[playlistId];
    });
  },
};
