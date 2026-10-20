import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, NativeModules } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { CustomTabBar } from './src/components/navigation/CustomTabBar';
import { PlayerOverlay } from './src/components/player/PlayerOverlay';
import { PlaybackContext, RadioPlaybackStatusContext } from './src/contexts/PlaybackContext';
import { systemMediaControls } from './src/native/SystemMediaControls';
import { NowPlayingWidgetService } from './src/services/NowPlayingWidgetService';
import { AndroidUpdatePrompt } from './src/components/updates/AndroidUpdatePrompt';
import { AUDIO_MIXES, AudiusCatalogService, type AudiusMixId } from './src/services/AudiusCatalogService';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { RadioScreen } from './src/screens/RadioScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { MusicCatalogService, getMusicApiHeaders, parseLyrics, type TrackEditChanges } from './src/services/MusicCatalogService';
import { LrcCheckerService } from './src/services/LrcCheckerService';
import { OfflineMusicService } from './src/services/OfflineMusicService';
import { PlaylistStorageService } from './src/services/PlaylistStorageService';
import type { PlaylistCoverSelection, PlaylistSummary, Track } from './src/types';
import './styles.css';

type SystemVolumeManager = typeof import('react-native-volume-manager').VolumeManager;

const Tab = createBottomTabNavigator();
const playbackCountsFile = new File(Paths.document, 'musiqapp-play-counts.json');

type PlaybackCounts = Record<string, number>;

const loadPlaybackCounts = async (): Promise<PlaybackCounts> => {
  if (!playbackCountsFile.exists) return {};
  try {
    const savedCounts = JSON.parse(await playbackCountsFile.text()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(savedCounts).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    ));
  } catch {
    return {};
  }
};

const savePlaybackCounts = (counts: PlaybackCounts) => {
  if (playbackCountsFile.exists) playbackCountsFile.delete();
  playbackCountsFile.create({ intermediates: true });
  playbackCountsFile.write(JSON.stringify(counts));
};

const mergeOfflineTrack = (remoteTrack: Track, offlineTrack?: Track): Track => {
  if (!offlineTrack) return remoteTrack;
  return {
    ...remoteTrack,
    ...offlineTrack,
    lyricsAvailable: Boolean(remoteTrack.lyricsAvailable || offlineTrack.lyricsAvailable),
    hasSyncedLyrics: Boolean(remoteTrack.hasSyncedLyrics || offlineTrack.hasSyncedLyrics || offlineTrack.syncedLyrics?.trim()),
    hasPlainLyrics: Boolean(remoteTrack.hasPlainLyrics || offlineTrack.hasPlainLyrics || offlineTrack.plainLyrics?.trim()),
  };
};

const getWidgetLaunchTrackId = (url: string) => {
  const prefix = 'musiqapp://widget/play?trackId=';
  if (!url.startsWith(prefix)) return null;
  const encodedTrackId = url.slice(prefix.length).split('&')[0];
  try {
    return decodeURIComponent(encodedTrackId) || null;
  } catch {
    return null;
  }
};

export default function App() {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);
  const [playerVolume, setPlayerVolumeState] = useState(player.volume);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playCounts, setPlayCounts] = useState<PlaybackCounts>({});
  const [favoriteTracks, setFavoriteTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [downloadedTracks, setDownloadedTracks] = useState<Track[]>([]);
  // Kept in the context for existing screens, but local mode is always ready.
  const [apiConnected, setApiConnected] = useState(true);
  const [apiInitializing, setApiInitializing] = useState(true);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingTrackIds, setDownloadingTrackIds] = useState<string[]>([]);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [widgetLaunchTrackId, setWidgetLaunchTrackId] = useState<string | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const tracksRef = useRef<Track[]>([]);
  const downloadsRef = useRef<Track[]>([]);
  const favoriteIdsRef = useRef<Set<string>>(new Set());
  const playCountsRef = useRef<PlaybackCounts>({});
  const favoriteStateLoaded = useRef(false);
  const queueRef = useRef<Track[]>([]);
  const activeTrackRef = useRef<Track | null>(null);
  const playerPlayingRef = useRef(false);
  const playerCurrentTimeRef = useRef(0);
  const playerDurationRef = useRef(0);
  const searchGeneration = useRef(0);
  const handledFinishedTrack = useRef<string | null>(null);
  const loadingAudiusMixPages = useRef(new Set<string>());
  const systemVolumeManager = useRef<SystemVolumeManager | null>(null);

  const updatePlaybackQueue = useCallback((nextQueue: Track[]) => {
    queueRef.current = nextQueue;
    setPlaybackQueue(nextQueue);
  }, []);

  const incrementPlayCount = useCallback((trackId: string) => {
    const nextCounts = {
      ...playCountsRef.current,
      [trackId]: (playCountsRef.current[trackId] ?? 0) + 1,
    };
    playCountsRef.current = nextCounts;
    setPlayCounts(nextCounts);
    try {
      savePlaybackCounts(nextCounts);
    } catch {
      // Keep playback working if local play history cannot be saved.
    }
  }, []);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    playerPlayingRef.current = playerStatus.playing;
  }, [playerStatus.playing]);

  useEffect(() => {
    playerCurrentTimeRef.current = playerStatus.currentTime;
  }, [playerStatus.currentTime]);

  useEffect(() => {
    playerDurationRef.current = playerStatus.duration;
  }, [playerStatus.duration]);

  useEffect(() => {
    downloadsRef.current = downloadedTracks;
  }, [downloadedTracks]);

  useEffect(() => {
    // Expo Go does not include this native module; keep its existing per-player volume behavior there.
    if (!NativeModules.VolumeManager) return;

    // Load only when the binary contains the native module, so Expo Go does not crash at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manager = require('react-native-volume-manager').VolumeManager as SystemVolumeManager;
    systemVolumeManager.current = manager;
    let isMounted = true;
    const volumeSubscription = manager.addVolumeListener(({ volume }) => {
      setPlayerVolumeState(Math.max(0, Math.min(1, volume)));
    });

    void manager.getVolume().then(({ volume }) => {
      if (isMounted) setPlayerVolumeState(Math.max(0, Math.min(1, volume)));
    }).catch(() => undefined);

    return () => {
      isMounted = false;
      volumeSubscription.remove();
      if (systemVolumeManager.current === manager) systemVolumeManager.current = null;
    };
  }, []);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    const handleURL = (url: string) => {
      const trackId = getWidgetLaunchTrackId(url);
      if (trackId) setWidgetLaunchTrackId(trackId);
    };
    const subscription = Linking.addEventListener('url', ({ url }) => handleURL(url));
    void Linking.getInitialURL().then((url) => {
      if (mounted && url) handleURL(url);
    }).catch(() => undefined);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const manager = systemVolumeManager.current;
    if (!manager) return;

    void manager.showNativeVolumeUI({ enabled: !playerVisible }).catch(() => undefined);
    return () => {
      void manager.showNativeVolumeUI({ enabled: true }).catch(() => undefined);
    };
  }, [playerVisible]);

  const searchTracks = useCallback(async (query = '') => {
    const generation = ++searchGeneration.current;
    setIsLoadingTracks(true);
    setLoadError(null);
    try {
      const remoteTracks = query.trim()
        ? await MusicCatalogService.searchTracks(query)
        : await MusicCatalogService.searchAllTracks();
      if (generation !== searchGeneration.current) return;
      const offlineById = new Map(downloadsRef.current.map((track) => [track.id, track]));
      const merged = remoteTracks.map((track) => ({
        ...mergeOfflineTrack(track, offlineById.get(track.id)),
        isFavorite: favoriteIdsRef.current.has(track.id),
      }));
      if (!query.trim()) {
        const presentIds = new Set(merged.map((track) => track.id));
        merged.push(...downloadsRef.current
          .filter((track) => !presentIds.has(track.id))
          .map((track) => ({ ...track, isFavorite: favoriteIdsRef.current.has(track.id) })));
      }
      tracksRef.current = merged;
      setTracks(merged);
      if (!query.trim()) {
        void NowPlayingWidgetService.initialize(merged).catch(() => undefined);
      }
    } catch (error) {
      if (generation === searchGeneration.current) {
        void NowPlayingWidgetService.initialize(downloadsRef.current).catch(() => undefined);
        setLoadError(error instanceof Error ? error.message : 'Could not load the local music library.');
      }
    } finally {
      if (generation === searchGeneration.current) setIsLoadingTracks(false);
    }
  }, []);

  const loadAllTracks = useCallback(async () => {
    const remoteTracks = await MusicCatalogService.searchAllTracks();
    const offlineById = new Map(downloadsRef.current.map((track) => [track.id, track]));
    const merged = remoteTracks.map((track) => ({
      ...mergeOfflineTrack(track, offlineById.get(track.id)),
      isFavorite: favoriteIdsRef.current.has(track.id),
    }));
    const presentIds = new Set(merged.map((track) => track.id));
    merged.push(...downloadsRef.current
      .filter((track) => !presentIds.has(track.id))
      .map((track) => ({ ...track, isFavorite: favoriteIdsRef.current.has(track.id) })));
    tracksRef.current = merged;
    setTracks(merged);
    void NowPlayingWidgetService.initialize(merged).catch(() => undefined);
    return merged;
  }, []);

  const loadFavoriteTracks = useCallback(async () => {
    const localFavorites = await MusicCatalogService.getFavoriteTracks();
    const favorites = localFavorites.map((track) => ({
      ...mergeOfflineTrack(track, downloadsRef.current.find((saved) => saved.id === track.id)),
      isFavorite: true,
    }));
    const favoriteIds = new Set(favorites.map((track) => track.id));
    favoriteIdsRef.current = favoriteIds;
    favoriteStateLoaded.current = true;
    const nextTracks = tracksRef.current.map((track) => ({
      ...track,
      isFavorite: favoriteIds.has(track.id),
    }));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    downloadsRef.current = downloadsRef.current.map((track) => ({
      ...track,
      isFavorite: favoriteIds.has(track.id),
    }));
    setDownloadedTracks(downloadsRef.current);
    updatePlaybackQueue(queueRef.current.map((track) => ({
      ...track,
      isFavorite: favoriteIds.has(track.id),
    })));
    if (activeTrackRef.current) {
      const active = { ...activeTrackRef.current, isFavorite: favoriteIds.has(activeTrackRef.current.id) };
      activeTrackRef.current = active;
      setActiveTrack(active);
    }
    setFavoriteTracks(favorites);
    return favorites;
  }, [updatePlaybackQueue]);

  const loadPlaylists = useCallback(async () => {
    const nextPlaylists = await PlaylistStorageService.reconcileWithLocalTracks(downloadsRef.current);
    setPlaylists(nextPlaylists);
    return nextPlaylists;
  }, []);

  const loadPlaylistTracks = useCallback(async (playlistId: string) => {
    await PlaylistStorageService.reconcileWithLocalTracks(downloadsRef.current);
    const cachedTracks = await PlaylistStorageService.getPlaylistTracks(playlistId);
    const offlineById = new Map(downloadsRef.current.map((track) => [track.id, track]));
    return cachedTracks.map((track) => ({
      ...mergeOfflineTrack(track, offlineById.get(track.id)),
      isFavorite: favoriteIdsRef.current.has(track.id),
    }));
  }, []);

  useEffect(() => {
    // Register the widget layout as soon as the app starts. Keep this independent
    // from library/storage hydration so an unrelated startup failure cannot leave
    // WidgetKit without a layout in the shared app-group container.
    void NowPlayingWidgetService.initialize().catch((error) => {
      console.warn('[NowPlayingWidget] Initialization failed:', error);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      OfflineMusicService.getDownloadedTracks(),
      loadPlaybackCounts(),
    ]).then(async ([savedTracks, savedPlayCounts]) => {
      if (!mounted) return;
      const savedPlaylists = await PlaylistStorageService.reconcileWithLocalTracks(savedTracks);
      playCountsRef.current = savedPlayCounts;
      setPlayCounts(savedPlayCounts);
      downloadsRef.current = savedTracks;
      setDownloadedTracks(savedTracks);
      favoriteIdsRef.current = new Set(savedTracks.filter((track) => track.isFavorite).map((track) => track.id));
      setTracks(savedTracks);
      setPlaylists(savedPlaylists);
      setApiConnected(true);
      favoriteStateLoaded.current = true;
      setIsLoadingTracks(false);
      void searchTracks();
      void loadFavoriteTracks().catch(() => undefined);
      void loadPlaylists();
      void LrcCheckerService.resumeIfNeeded().catch(() => undefined);
      void NowPlayingWidgetService.initialize(savedTracks).catch(() => undefined);
      setApiInitializing(false);
    }).catch(() => {
      if (mounted) {
        setIsLoadingTracks(false);
        setApiInitializing(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [loadFavoriteTracks, loadPlaylists, searchTracks]);

  const connectToLibrary = useCallback(async (value: string) => {
    // Pairing is intentionally retired in local mode. Keep the callback so old
    // screens can still invoke it while we refresh the local catalog.
    if (value.trim()) setLoadError(null);
    setApiConnected(true);
    await searchTracks();
  }, [searchTracks]);

  const disconnectFromLibrary = useCallback(async () => {
    setApiConnected(true);
    await searchTracks();
  }, [searchTracks]);

  const playSelectedTrack = useCallback((track: Track, nextQueue: Track[]) => {
    const offlineTrack = downloadsRef.current.find((saved) => saved.id === track.id);
    const selectedTrack = offlineTrack ?? track;
    const audioUri = selectedTrack.localUri ?? selectedTrack.streamUrl;
    if (!audioUri) {
      Alert.alert('Track unavailable', 'This file does not have a playable audio source.');
      return;
    }

    updatePlaybackQueue(nextQueue);
    activeTrackRef.current = selectedTrack;
    setActiveTrack(selectedTrack);
    handledFinishedTrack.current = null;
    const isRadioTrack = selectedTrack.provider === 'radio';
    const musicApiHeaders = selectedTrack.provider === 'local' ? getMusicApiHeaders() : {};
    player.replace(
      selectedTrack.localUri
        ? selectedTrack.localUri
        : { uri: audioUri, headers: musicApiHeaders, name: selectedTrack.title },
    );
    try {
      player.setActiveForLockScreen(true, {
        title: selectedTrack.title,
        artist: selectedTrack.artist,
        albumTitle: isRadioTrack ? 'Live Radio' : selectedTrack.album,
        ...(selectedTrack.artwork ? { artworkUrl: selectedTrack.artwork } : {}),
      }, {
        // replace() has not loaded remote media yet, so Expo may report an
        // indefinite duration and infer "live" for ordinary songs.
        isLiveStream: isRadioTrack,
      });
    } catch {
      // Lock-screen metadata is optional; keep stream playback available if the OS rejects it.
    }
    player.play();
    if (!isRadioTrack) incrementPlayCount(selectedTrack.id);

    if (!isRadioTrack && !selectedTrack.lyrics?.length) {
      void MusicCatalogService.getLyrics(selectedTrack)
        .then((trackWithLyrics) => {
          if (activeTrackRef.current?.id !== selectedTrack.id) return;
          activeTrackRef.current = trackWithLyrics;
          setActiveTrack(trackWithLyrics);
          downloadsRef.current = downloadsRef.current.map((saved) =>
            saved.id === trackWithLyrics.id ? { ...saved, ...trackWithLyrics, localUri: saved.localUri } : saved,
          );
          setDownloadedTracks(downloadsRef.current);
        })
        .catch(() => undefined);
    }
  }, [incrementPlayCount, player, updatePlaybackQueue]);

  const playTrack = useCallback((track: Track, queue = tracksRef.current) => {
    playSelectedTrack(track, queue);
  }, [playSelectedTrack]);

  useEffect(() => {
    if (!activeTrack) return;
    const publishWidgetState = () => {
      void NowPlayingWidgetService.update(
        activeTrack,
        playerPlayingRef.current,
        playerCurrentTimeRef.current,
        playerDurationRef.current,
      ).catch(() => undefined);
    };

    publishWidgetState();
    if (!playerStatus.playing) return;
    const progressTimer = setInterval(publishWidgetState, 2000);
    return () => clearInterval(progressTimer);
  }, [activeTrack, playerStatus.playing]);

  const loadMoreAudiusMixTracks = useCallback(async (mixId: string) => {
    if (!AUDIO_MIXES.some((mix) => mix.id === mixId) || loadingAudiusMixPages.current.has(mixId)) return;
    loadingAudiusMixPages.current.add(mixId);
    try {
      const currentQueue = queueRef.current;
      const mixQueue = currentQueue.filter((track) => track.mixId === mixId);
      const nextOffset = mixQueue.reduce((maximum, track) => Math.max(maximum, (track.mixOffset ?? -1) + 1), 0);
      const moreTracks = await AudiusCatalogService.getMixTracks(mixId as AudiusMixId, nextOffset);
      if (activeTrackRef.current?.mixId !== mixId) return;

      const latestQueue = queueRef.current;
      const knownIds = new Set(latestQueue.map((track) => track.id));
      const additions = moreTracks.filter((track) => !knownIds.has(track.id));
      if (additions.length > 0) updatePlaybackQueue([...latestQueue, ...additions]);
    } catch {
      // Keep the current mix playing if the catalog is temporarily unavailable.
    } finally {
      loadingAudiusMixPages.current.delete(mixId);
    }
  }, [updatePlaybackQueue]);

  const togglePlayback = useCallback(() => {
    if (playerPlayingRef.current) player.pause();
    else player.play();
  }, [player]);

  useEffect(() => {
    if (!widgetLaunchTrackId || apiInitializing) return;
    let cancelled = false;

    const playWidgetTrack = async () => {
      const selectedTrack = tracksRef.current.find((track) => track.id === widgetLaunchTrackId)
        ?? await NowPlayingWidgetService.getSavedTrack();
      if (cancelled || !selectedTrack || selectedTrack.id !== widgetLaunchTrackId) return;

      setWidgetLaunchTrackId(null);
      if (activeTrackRef.current?.id === selectedTrack.id) {
        togglePlayback();
        return;
      }

      const nextQueue = tracksRef.current.some((track) => track.id === selectedTrack.id)
        ? tracksRef.current
        : [selectedTrack];
      playTrack(selectedTrack, nextQueue);
    };

    void playWidgetTrack().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiInitializing, playTrack, togglePlayback, tracks, widgetLaunchTrackId]);

  const openPlayer = useCallback(() => {
    setPlayerVisible(true);
  }, []);

  const closePlayer = useCallback(() => {
    setPlayerVisible(false);
  }, []);

  const toggleQueueAutoplay = useCallback(() => {
    setAutoplayEnabled((enabled) => !enabled);
  }, []);

  const playAllSongs = useCallback((queue = tracksRef.current) => {
    const currentQueue = queue;
    if (currentQueue.length > 0) playSelectedTrack(currentQueue[0], currentQueue);
  }, [playSelectedTrack]);

  const shuffleSongs = useCallback((queue = tracksRef.current) => {
    const shuffled = [...queue].sort(() => Math.random() - 0.5);
    if (shuffled.length > 0) {
      setShuffleEnabled(true);
      playSelectedTrack(shuffled[0], shuffled);
    }
  }, [playSelectedTrack]);

  const playNext = useCallback((track: Track) => {
    const active = activeTrackRef.current;
    if (!active || active.id === track.id) return;
    const currentQueue = queueRef.current.length > 0 ? queueRef.current : tracksRef.current;
    const nextQueue = currentQueue.filter((item) => item.id !== track.id);
    const activeIndex = nextQueue.findIndex((item) => item.id === active.id);
    nextQueue.splice(activeIndex < 0 ? 0 : activeIndex + 1, 0, track);
    updatePlaybackQueue(nextQueue);
  }, [updatePlaybackQueue]);

  const advanceQueue = useCallback((trackFinished = false) => {
    const active = activeTrackRef.current;
    if (active?.provider === 'radio') {
      const currentQueue = queueRef.current;
      const currentIndex = currentQueue.findIndex((track) => track.id === active.id);
      if (currentQueue.length > 0) {
        playSelectedTrack(currentQueue[(currentIndex + 1 + currentQueue.length) % currentQueue.length], currentQueue);
      }
      return;
    }

    if (active?.provider === 'audius') {
      const currentQueue = queueRef.current;
      const currentIndex = currentQueue.findIndex((track) => track.id === active.id);
      if (active.mixId && currentIndex >= currentQueue.length - 5) {
        void loadMoreAudiusMixTracks(active.mixId);
      }
      if (currentQueue.length > 0) {
        const nextIndex = (currentIndex + 1 + currentQueue.length) % currentQueue.length;
        playSelectedTrack(currentQueue[nextIndex], currentQueue);
      }
      return;
    }

    if (trackFinished && repeatMode === 'one' && activeTrackRef.current) {
      void player.seekTo(0);
      player.play();
      return;
    }

    const currentQueue = queueRef.current.length > 0 ? queueRef.current : tracksRef.current;
    const currentIndex = currentQueue.findIndex((track) => track.id === activeTrackRef.current?.id);
    const nextIndex = currentIndex + 1;

    if (nextIndex >= 0 && nextIndex < currentQueue.length) {
      playSelectedTrack(currentQueue[nextIndex], currentQueue);
      return;
    }

    if (currentQueue.length === 0) return;

    if (repeatMode === 'all') {
      playSelectedTrack(currentQueue[0], currentQueue);
      return;
    }

    if (trackFinished && autoplayEnabled) {
      const active = activeTrackRef.current;
      const otherTracks = tracksRef.current.filter((item) => item.id !== active?.id);
      const similarTracks = otherTracks.filter((item) =>
        item.artist.toLocaleLowerCase() === active?.artist.toLocaleLowerCase() ||
        item.album.toLocaleLowerCase() === active?.album.toLocaleLowerCase(),
      );
      const candidates = similarTracks.length > 0 ? similarTracks : otherTracks;
      if (candidates.length > 0) {
        const nextTrack = candidates[Math.floor(Math.random() * candidates.length)];
        playSelectedTrack(nextTrack, [...currentQueue, nextTrack]);
      }
    }
  }, [autoplayEnabled, loadMoreAudiusMixTracks, player, playSelectedTrack, repeatMode]);

  const skipNext = useCallback(() => advanceQueue(false), [advanceQueue]);

  const toggleQueueShuffle = useCallback(() => {
    const currentQueue = queueRef.current;
    if (!shuffleEnabled && currentQueue.length > 1) {
      const currentIndex = currentQueue.findIndex((item) => item.id === activeTrackRef.current?.id);
      const currentAndPast = currentQueue.slice(0, Math.max(0, currentIndex) + 1);
      const upcoming = currentQueue.slice(currentAndPast.length);
      for (let index = upcoming.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [upcoming[index], upcoming[swapIndex]] = [upcoming[swapIndex], upcoming[index]];
      }
      updatePlaybackQueue([...currentAndPast, ...upcoming]);
    }
    setShuffleEnabled((enabled) => !enabled);
  }, [shuffleEnabled, updatePlaybackQueue]);

  const toggleRepeatMode = useCallback(() => {
    setRepeatMode((mode) => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');
  }, []);

  const clearUpcomingQueue = useCallback(() => {
    updatePlaybackQueue(activeTrackRef.current ? [activeTrackRef.current] : []);
    setShuffleEnabled(false);
  }, [updatePlaybackQueue]);

  const playQueueTrack = useCallback((track: Track) => {
    const currentQueue = queueRef.current.length > 0 ? queueRef.current : tracksRef.current;
    playSelectedTrack(track, currentQueue);
  }, [playSelectedTrack]);

  const skipPrevious = useCallback(() => {
    const activeTrack = activeTrackRef.current;
    if (activeTrack?.provider === 'radio') {
      const currentQueue = queueRef.current;
      const currentIndex = currentQueue.findIndex((track) => track.id === activeTrack.id);
      if (currentQueue.length > 0) {
        playSelectedTrack(currentQueue[(currentIndex - 1 + currentQueue.length) % currentQueue.length], currentQueue);
      }
      return;
    }

    if (playerCurrentTimeRef.current > 3) {
      void player.seekTo(0);
      return;
    }
    const currentQueue = queueRef.current.length > 0 ? queueRef.current : tracksRef.current;
    const currentIndex = currentQueue.findIndex((track) => track.id === activeTrackRef.current?.id);
    if (currentQueue.length > 0) {
      const previousIndex = (currentIndex - 1 + currentQueue.length) % currentQueue.length;
      playSelectedTrack(currentQueue[previousIndex], currentQueue);
    }
  }, [playSelectedTrack, player]);

  useEffect(() => {
    const mediaControls = systemMediaControls;
    if (!mediaControls) return;

    const nextTrackSubscription = mediaControls.addListener('onNextTrackRequested', skipNext);
    const previousTrackSubscription = mediaControls.addListener('onPreviousTrackRequested', skipPrevious);
    mediaControls.setEnabled(true);

    return () => {
      nextTrackSubscription.remove();
      previousTrackSubscription.remove();
      mediaControls.setEnabled(false);
    };
  }, [skipNext, skipPrevious]);

  const seekTo = useCallback((seconds: number) => {
    void player.seekTo(Math.max(0, seconds));
  }, [player]);

  // AudioPlayer.volume is its documented mutable API; Expo's hooks lint rule does not recognize it.
  // eslint-disable-next-line react-hooks/immutability
  const setPlayerVolume = useCallback((volume: number) => {
    const nextVolume = Math.max(0, Math.min(1, volume));
    setPlayerVolumeState(nextVolume);

    const manager = systemVolumeManager.current;
    if (manager) {
      void manager.setVolume(nextVolume, { type: 'music', showUI: false }).catch(() => undefined);
      return;
    }

    // Keep the Expo Go preview usable when its binary lacks the native volume module.
    // eslint-disable-next-line react-hooks/immutability
    player.volume = nextVolume;
  }, [player]);

  const updateTrackWithLyrics = useCallback(async (track: Track, syncedLyrics: string) => {
    const updated = await OfflineMusicService.saveSyncedLyrics({
      ...track,
      syncedLyrics,
      lyrics: parseLyrics(syncedLyrics),
      lyricsAvailable: true,
      hasSyncedLyrics: true,
    }, syncedLyrics);
    const trackWithFavoriteState = {
      ...updated,
      isFavorite: favoriteIdsRef.current.has(updated.id),
    };
    const nextTracks = tracksRef.current.map((item) => item.id === updated.id ? trackWithFavoriteState : item);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    downloadsRef.current = downloadsRef.current.map((item) => item.id === updated.id ? trackWithFavoriteState : item);
    setDownloadedTracks(downloadsRef.current);
    await PlaylistStorageService.updateTrack(trackWithFavoriteState);
    updatePlaybackQueue(queueRef.current.map((item) => item.id === updated.id ? trackWithFavoriteState : item));
    if (activeTrackRef.current?.id === updated.id) {
      activeTrackRef.current = trackWithFavoriteState;
      setActiveTrack(trackWithFavoriteState);
    }
    return trackWithFavoriteState;
  }, [updatePlaybackQueue]);

  const updateTrackEverywhere = useCallback(async (updated: Track) => {
    const matchesTrack = (item: Track) => item.id === updated.id;
    const trackWithFavoriteState = {
      ...updated,
      isFavorite: favoriteIdsRef.current.has(updated.id),
    };
    const nextTracks = tracksRef.current.map((item) => matchesTrack(item) ? { ...item, ...trackWithFavoriteState } : item);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    updatePlaybackQueue(queueRef.current.map((item) => matchesTrack(item) ? { ...item, ...trackWithFavoriteState } : item));
    downloadsRef.current = downloadsRef.current.map((item) => matchesTrack(item)
      ? { ...item, ...trackWithFavoriteState, localUri: item.localUri }
      : item,
    );
    setDownloadedTracks(downloadsRef.current);
    await OfflineMusicService.updateTrack(trackWithFavoriteState);
    await PlaylistStorageService.updateTrack(trackWithFavoriteState);
    setFavoriteTracks((current) => {
      if (trackWithFavoriteState.isFavorite) {
        return [trackWithFavoriteState, ...current.filter((item) => !matchesTrack(item))];
      }
      return current.filter((item) => !matchesTrack(item));
    });
    if (activeTrackRef.current && matchesTrack(activeTrackRef.current)) {
      const active = { ...activeTrackRef.current, ...trackWithFavoriteState, localUri: activeTrackRef.current.localUri };
      activeTrackRef.current = active;
      setActiveTrack(active);
    }
    return trackWithFavoriteState;
  }, [updatePlaybackQueue]);

  const toggleFavorite = useCallback(async (track: Track) => {
    const currentFavorite = favoriteStateLoaded.current
      ? favoriteIdsRef.current.has(track.id)
      : Boolean(track.isFavorite ?? favoriteIdsRef.current.has(track.id));
    const isFavorite = !currentFavorite;
    if (isFavorite) favoriteIdsRef.current.add(track.id);
    else favoriteIdsRef.current.delete(track.id);
    try {
      await MusicCatalogService.setFavorite(track, isFavorite);
      return await updateTrackEverywhere({ ...track, isFavorite });
    } catch (error) {
      if (currentFavorite) favoriteIdsRef.current.add(track.id);
      else favoriteIdsRef.current.delete(track.id);
      throw error;
    }
  }, [updateTrackEverywhere]);

  const toggleActiveTrackFavorite = useCallback(() => {
    const track = activeTrackRef.current;
    if (!track) return;
    void toggleFavorite(track).catch((error) => {
      Alert.alert('Could not update favorite', error instanceof Error ? error.message : 'Try again.');
    });
  }, [toggleFavorite]);

  const updateTrack = useCallback(async (track: Track, changes: TrackEditChanges) => {
    const updated = await MusicCatalogService.updateTrack(track, changes);
    return updateTrackEverywhere(updated);
  }, [updateTrackEverywhere]);

  const deleteTrack = useCallback(async (track: Track) => {
    await MusicCatalogService.deleteTrack(track);
    const nextTracks = tracksRef.current.filter((item) => item.id !== track.id);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    setFavoriteTracks((current) => current.filter((item) => item.id !== track.id));
    favoriteIdsRef.current.delete(track.id);
    await PlaylistStorageService.deleteTrack(track.id);
    updatePlaybackQueue(queueRef.current.filter((item) => item.id !== track.id));
    if (activeTrackRef.current?.id === track.id) {
      player.pause();
      activeTrackRef.current = null;
      setActiveTrack(null);
    }
  }, [player, updatePlaybackQueue]);

  const createPlaylist = useCallback(async (name: string, cover?: PlaylistCoverSelection) => {
    const remotePlaylist = await MusicCatalogService.createPlaylist(name);
    let coverUri: string | undefined;
    try {
      const coverUrl = cover
        ? await MusicCatalogService.uploadPlaylistCover(remotePlaylist.id, cover.uri, cover.mimeType)
        : undefined;
      coverUri = cover
        ? await PlaylistStorageService.cacheCover(remotePlaylist.id, cover.uri, cover.mimeType)
        : undefined;
      const playlist: PlaylistSummary = { ...remotePlaylist, coverUrl, coverUri, coverCachedUrl: coverUrl, trackCount: 0 };
      await PlaylistStorageService.savePlaylist(playlist);
      setPlaylists((current) => [playlist, ...current.filter((item) => item.id !== playlist.id)]);
      return playlist;
    } catch (error) {
      if (coverUri) await PlaylistStorageService.removeCachedCover(coverUri);
      await MusicCatalogService.deletePlaylist(remotePlaylist.id).catch(() => undefined);
      throw error;
    }
  }, []);

  const addTrackToPlaylist = useCallback(async (playlistId: string, track: Track) => {
    const added = await MusicCatalogService.addTrackToPlaylist(playlistId, track);
    if (!added) return;
    const cachedAdded = await PlaylistStorageService.addTrack(playlistId, track);
    if (!cachedAdded) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === playlistId
      ? { ...playlist, trackCount: playlist.trackCount + 1 }
      : playlist,
    ));
  }, []);

  const removeTrackFromPlaylist = useCallback(async (playlistId: string, track: Track) => {
    const removed = await MusicCatalogService.removeTrackFromPlaylist(playlistId, track);
    const cachedRemoved = await PlaylistStorageService.removeTrack(playlistId, track.id);
    if (!removed && !cachedRemoved) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === playlistId
      ? { ...playlist, trackCount: Math.max(0, playlist.trackCount - 1) }
      : playlist,
    ));
  }, []);

  const deletePlaylist = useCallback(async (playlistId: string) => {
    await MusicCatalogService.deletePlaylist(playlistId);
    await PlaylistStorageService.deletePlaylist(playlistId);
    setPlaylists((current) => current.filter((playlist) => playlist.id !== playlistId));
  }, []);

  const saveTrackLyrics = useCallback(async (track: Track, syncedLyrics: string) => {
    const timedLines = parseLyrics(syncedLyrics).filter((line) => line.timeMs !== null && line.text.trim());
    if (timedLines.length === 0) throw new Error('This result does not contain valid synced LRC lines.');

    if (track.provider === 'local' && track.providerId) {
      await MusicCatalogService.saveSyncedLyrics(track, syncedLyrics);
    }
    return updateTrackWithLyrics({ ...track, lyricsSource: 'saved_lrc' }, syncedLyrics);
  }, [updateTrackWithLyrics]);

  const checkTrackLyrics = useCallback(async (track: Track) => {
    const result = await MusicCatalogService.getLyrics(track, true);
    if (!result.syncedLyrics?.trim()) return result;

    if (result.lyricsSource === 'local_lrc' || result.lyricsSource === 'embedded_lrc') {
      return updateTrackWithLyrics(result, result.syncedLyrics);
    }
    return result;
  }, [updateTrackWithLyrics]);

  useEffect(() => {
    if (!playerStatus.didJustFinish || !activeTrackRef.current) {
      handledFinishedTrack.current = null;
      return;
    }
    if (handledFinishedTrack.current !== activeTrackRef.current.id) {
      handledFinishedTrack.current = activeTrackRef.current.id;
      advanceQueue(true);
    }
  }, [advanceQueue, playerStatus.didJustFinish]);

  const downloadTrack = useCallback(async (track: Track) => {
    setDownloadingTrackIds((current) => current.includes(track.id) ? current : [...current, track.id]);
    try {
      let trackWithLyrics = track;
      try {
        trackWithLyrics = await MusicCatalogService.getLyrics(track, true);
      } catch {
        try {
          trackWithLyrics = await MusicCatalogService.getLyrics(track);
        } catch {
          // Lyrics are optional; the audio can still be saved for offline playback.
        }
      }
      const savedTrack = await OfflineMusicService.downloadTrack(trackWithLyrics);
      await PlaylistStorageService.updateTrack(savedTrack);
      downloadsRef.current = [...downloadsRef.current.filter((item) => item.id !== savedTrack.id), savedTrack];
      setDownloadedTracks(downloadsRef.current);
      setTracks((current) => current.map((item) => item.id === savedTrack.id ? savedTrack : item));
      return savedTrack;
    } finally {
      setDownloadingTrackIds((current) => current.filter((id) => id !== track.id));
    }
  }, []);

  const deleteDownloadedTracks = useCallback(async (trackIds: string[]) => {
    const result = await OfflineMusicService.removeDownloadedTracks(trackIds);
    const removedIds = new Set(result.removedTrackIds);
    if (removedIds.size === 0) return result.freedBytes;

    const removedTracks = downloadsRef.current.filter((track) => removedIds.has(track.id));
    downloadsRef.current = downloadsRef.current.filter((track) => !removedIds.has(track.id));
    setDownloadedTracks(downloadsRef.current);

    const clearOfflineSource = (track: Track): Track => ({ ...track, localUri: undefined, lyricsFileUri: undefined });
    const nextTracks = tracksRef.current.flatMap((track) => {
      if (!removedIds.has(track.id)) return [track];
      if (!track.streamUrl) return [];
      return [clearOfflineSource(track)];
    });
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    setFavoriteTracks((current) => current.map((track) => removedIds.has(track.id) ? clearOfflineSource(track) : track));
    updatePlaybackQueue(queueRef.current.flatMap((track) => {
      if (!removedIds.has(track.id)) return [track];
      if (!track.streamUrl) return [];
      return [clearOfflineSource(track)];
    }));

    await Promise.all(removedTracks.map((track) =>
      PlaylistStorageService.updateTrack(clearOfflineSource(track)).catch(() => undefined),
    ));

    if (activeTrackRef.current && removedIds.has(activeTrackRef.current.id)) {
      player.pause();
      activeTrackRef.current = null;
      setActiveTrack(null);
    }
    return result.freedBytes;
  }, [player, updatePlaybackQueue]);

  const importAudioToLibrary = useCallback(async (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: Parameters<typeof MusicCatalogService.importAudioUrl>[4],
  ) => {
    const importedTrack = await MusicCatalogService.importAudioUrl(url, title, artist, sourceUrl, onProgress);
    const nextTracks = [importedTrack, ...tracksRef.current.filter((track) => track.id !== importedTrack.id)];
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    return importedTrack;
  }, []);

  const importLocalFile = useCallback(async () => {
    const picked = await File.pickFileAsync({ mimeTypes: 'audio/*' });
    if (picked.canceled || !picked.result) return null;
    const title = picked.result.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    const importedTrack = await OfflineMusicService.importLocalFile(picked.result.uri, title, 'Unknown artist');
    downloadsRef.current = [importedTrack, ...downloadsRef.current.filter((track) => track.id !== importedTrack.id)];
    setDownloadedTracks(downloadsRef.current);
    const nextTracks = [importedTrack, ...tracksRef.current.filter((track) => track.id !== importedTrack.id)];
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    void NowPlayingWidgetService.initialize(nextTracks).catch(() => undefined);
    return importedTrack;
  }, []);

  const importMusicFolder = useCallback(async () => {
    let sourceDirectory: Directory;
    try {
      sourceDirectory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return null;
      throw error;
    }
    const result = await OfflineMusicService.importLocalFolder(sourceDirectory);
    if (result.importedCount === 0) return result;
    const localTracks = await OfflineMusicService.getDownloadedTracks();
    downloadsRef.current = localTracks;
    setDownloadedTracks(localTracks);
    const favoriteIds = favoriteIdsRef.current;
    const nextTracks = localTracks.map((track) => ({ ...track, isFavorite: favoriteIds.has(track.id) }));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    void NowPlayingWidgetService.initialize(nextTracks).catch(() => undefined);
    return result;
  }, []);

  const mostPlayedTracks = useMemo(() => tracks
    .map((track) => ({ ...track, playCount: playCounts[track.id] ?? 0 }))
    .filter((track) => track.playCount > 0)
    .sort((first, second) => (second.playCount ?? 0) - (first.playCount ?? 0) || first.title.localeCompare(second.title))
    .slice(0, 12), [playCounts, tracks]);

  const playbackActions = useMemo(() => ({
    tracks,
    activeTrack,
    mostPlayedTracks,
    downloadedTracks,
    hasActiveTrack: Boolean(activeTrack),
    favoriteTracks,
    playlists,
    apiConnected,
    apiInitializing,
    isLoadingTracks,
    loadError,
    downloadedTrackIds: downloadedTracks.map((track) => track.id),
    downloadingTrackIds,
    searchTracks,
    loadAllTracks,
    loadFavoriteTracks,
    loadPlaylists,
    loadPlaylistTracks,
    checkTrackLyrics,
    saveTrackLyrics,
    connectToLibrary,
    disconnectFromLibrary,
    downloadTrack,
    deleteDownloadedTracks,
    importAudioToLibrary,
    importLocalFile,
    importMusicFolder,
    updateTrack,
    deleteTrack,
    toggleFavorite,
    createPlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    playNext,
    playTrack,
    togglePlayback,
    playAllSongs,
    shuffleSongs,
  }), [
    downloadTrack,
    deleteDownloadedTracks,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    createPlaylist,
    deletePlaylist,
    deleteTrack,
    importAudioToLibrary,
    importLocalFile,
    importMusicFolder,
    downloadedTracks,
    favoriteTracks,
    checkTrackLyrics,
    downloadingTrackIds,
    isLoadingTracks,
    apiConnected,
    apiInitializing,
    loadError,
    playAllSongs,
    playTrack,
    togglePlayback,
    searchTracks,
    loadAllTracks,
    saveTrackLyrics,
    shuffleSongs,
    connectToLibrary,
    disconnectFromLibrary,
    tracks,
    mostPlayedTracks,
    activeTrack,
    playlists,
    loadFavoriteTracks,
    loadPlaylists,
    loadPlaylistTracks,
    playNext,
    toggleFavorite,
    updateTrack,
  ]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AndroidUpdatePrompt />
      <PlaybackContext.Provider value={playbackActions}>
        <RadioPlaybackStatusContext.Provider value={playerStatus.playing}>
          <NavigationContainer>
            <Tab.Navigator
              tabBar={(props) => <CustomTabBar {...props} />}
              screenOptions={{ headerShown: false }}
              initialRouteName="Library"
            >
              <Tab.Screen name="Home" component={HomeScreen} />
              <Tab.Screen name="Radio" component={RadioScreen} />
              <Tab.Screen name="Library" component={LibraryScreen} />
              <Tab.Screen name="Search" component={SearchScreen} />
            </Tab.Navigator>
          </NavigationContainer>
        </RadioPlaybackStatusContext.Provider>
      </PlaybackContext.Provider>
      {activeTrack ? (
        <PlayerOverlay
          visible={playerVisible}
          track={activeTrack}
          isFavorite={Boolean(activeTrack.isFavorite)}
          isPlaying={playerStatus.playing}
          currentTime={playerStatus.currentTime}
          durationSeconds={playerStatus.duration || activeTrack.durationSeconds || 0}
          volume={playerVolume}
          queue={playbackQueue}
          shuffleEnabled={shuffleEnabled}
          repeatMode={repeatMode}
          autoplayEnabled={autoplayEnabled}
          onOpen={openPlayer}
          onClose={closePlayer}
          onTogglePlayback={togglePlayback}
          onSkipPrevious={skipPrevious}
          onSkipNext={skipNext}
          onSeek={seekTo}
          onVolumeChange={setPlayerVolume}
          onToggleFavorite={toggleActiveTrackFavorite}
          onPlayQueueTrack={playQueueTrack}
          onToggleShuffle={toggleQueueShuffle}
          onToggleRepeat={toggleRepeatMode}
          onToggleAutoplay={toggleQueueAutoplay}
          onClearQueue={clearUpcomingQueue}
        />
      ) : null}
    </GestureHandlerRootView>
  );
}
