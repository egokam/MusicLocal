import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Directory } from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { LibraryList } from '../components/library/LibraryList';
import { TopBar } from '../components/library/TopBar';
import { SkeletonBlock, SkeletonPulse } from '../components/Skeleton';
import { usePlaybackActions } from '../contexts/PlaybackContext';
import type { PlaylistSummary, Track } from '../types';
import type { TrackEditChanges } from '../services/MusicCatalogService';
import { getMusicApiHeaders } from '../services/MusicCatalogService';
import { OfflineMusicService } from '../services/OfflineMusicService';
import { LrcCheckerScreen } from './LrcCheckerScreen';
import { LrcSynchronizerScreen } from './LrcSynchronizerScreen';
import { PlaylistsScreen } from './PlaylistsScreen';
import { SongsScreen } from './SongsScreen';
import { AlbumsScreen } from './AlbumsScreen';
import { ArtistsScreen } from './ArtistsScreen';

type LibraryStackParamList = {
  LibraryHome: undefined;
  DeveloperProfile: undefined;
  ProfileWeb: { title: string; url: string };
  Songs: undefined;
  Albums: undefined;
  Artists: undefined;
  AlbumTracks: { album: string; artist: string };
  ArtistTracks: { artist: string };
  Favorites: undefined;
  Playlists: undefined;
  PlaylistTracks: { playlistId: string; title: string };
  AddSongsToPlaylist: { playlistId: string; title: string };
  LrcChecker: undefined;
  LrcSynchronizer: undefined;
};

const Stack = createNativeStackNavigator<LibraryStackParamList>();

const LibraryHomeScreen = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'LibraryHome'>) => {
  const { mostPlayedTracks, playTrack, isLoadingTracks, apiInitializing } = usePlaybackActions();

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 190 }}>
        <TopBar onProfilePress={() => navigation.navigate('DeveloperProfile')} />
        <LibraryList
          onSelectCategory={(title) => {
            if (title === 'Songs') navigation.navigate('Songs');
            if (title === 'Albums') navigation.navigate('Albums');
            if (title === 'Artists') navigation.navigate('Artists');
            if (title === 'Favorites') navigation.navigate('Favorites');
            if (title === 'Playlists') navigation.navigate('Playlists');
            if (title === 'LRC Checker') navigation.navigate('LrcChecker');
            if (title === 'LRC Synchronizer') navigation.navigate('LrcSynchronizer');
          }}
        />
        <View style={{ marginTop: 26, marginBottom: 12 }}>
          <Text style={{ color: 'white', fontSize: 22, fontWeight: '700', marginHorizontal: 20, marginBottom: 14 }}>
            Most Played
          </Text>
          {mostPlayedTracks.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
              {mostPlayedTracks.map((track) => (
                <TouchableOpacity
                  key={track.id}
                  onPress={() => playTrack(track, mostPlayedTracks)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${track.title} by ${track.artist}, played ${track.playCount} times`}
                  style={{ width: 148 }}
                >
                  <View style={{ width: 148, height: 148, borderRadius: 15, overflow: 'hidden', backgroundColor: '#202024' }}>
                    {track.artwork ? (
                      <Image
                        source={{ uri: track.artwork, ...(track.artwork.startsWith('http') ? { headers: getMusicApiHeaders() } : {}) }}
                        resizeMode="cover"
                        style={{ width: '100%', height: '100%' }}
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#FA243C', fontSize: 30 }}>♫</Text>
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '600', marginTop: 9 }}>
                    {track.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, fontWeight: '500', marginTop: 3 }}>
                    {track.artist}
                  </Text>
                  <Text style={{ color: '#8E8E93', fontSize: 12, marginTop: 4 }}>
                    {track.playCount} plays
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            isLoadingTracks || apiInitializing ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
                <SkeletonPulse style={{ flexDirection: 'row', gap: 14 }}>
                  {[0, 1, 2, 3].map((index) => (
                    <View key={index} style={{ width: 148 }}>
                      <SkeletonBlock style={{ width: 148, height: 148, borderRadius: 15 }} />
                      <SkeletonBlock style={{ width: index % 2 === 0 ? 112 : 88, height: 15, borderRadius: 8, marginTop: 10 }} />
                      <SkeletonBlock style={{ width: 82, height: 12, borderRadius: 7, marginTop: 7 }} />
                    </View>
                  ))}
                </SkeletonPulse>
              </ScrollView>
            ) : (
              <Text style={{ color: '#8E8E93', fontSize: 14, marginHorizontal: 20 }}>
                Your most played tracks will appear here as you listen.
              </Text>
            )
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const DeveloperProfileScreen = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'DeveloperProfile'>) => {
  const { importMusicFolder, downloadedTracks, deleteDownloadedTracks } = usePlaybackActions();
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [isExportingLibrary, setIsExportingLibrary] = useState(false);
  const [isEmptyingLibrary, setIsEmptyingLibrary] = useState(false);
  const links = [
    { title: 'GitHub', subtitle: 'github.com/egokam', icon: 'logo-github' as const, url: 'https://github.com/egokam' },
    { title: 'Instagram', subtitle: '@kotmanii', icon: 'logo-instagram' as const, url: 'https://instagram.com/kotmanii' },
    { title: 'Portfolio', subtitle: 'portfolio.egokam.site', icon: 'globe-outline' as const, url: 'https://portfolio.egokam.site' },
  ];

  const emptyLibrary = async () => {
    if (downloadedTracks.length === 0) {
      Alert.alert('Library is empty', 'There is no music saved in Musiqapp on this device.');
      return;
    }

    Alert.alert(
      'Empty your library?',
      `This permanently deletes all ${downloadedTracks.length} saved audio files and their lyric files from this device. This cannot be undone. Songs available to stream remain in your catalog.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Library',
          style: 'destructive',
          onPress: () => {
            if (isEmptyingLibrary) return;
            setIsEmptyingLibrary(true);
            void deleteDownloadedTracks(downloadedTracks.map((track) => track.id))
              .then((freedBytes) => {
                Alert.alert('Library cleared', `${(freedBytes / (1024 * 1024)).toFixed(2)} MB of saved music was removed.`);
              })
              .catch((error) => {
                Alert.alert('Could not empty library', error instanceof Error ? error.message : 'Please try again.');
              })
              .finally(() => setIsEmptyingLibrary(false));
          },
        },
      ],
    );
  };

  const exportLibrary = async () => {
    if (isExportingLibrary) return;
    if (downloadedTracks.length === 0) {
      Alert.alert('Library is empty', 'There are no saved music tracks to export.');
      return;
    }

    setIsExportingLibrary(true);
    try {
      const destinationDirectory = await Directory.pickDirectoryAsync();
      const result = await OfflineMusicService.exportDownloadedTracksAsZip(destinationDirectory);
      Alert.alert(
        result.exportedCount > 0 ? 'Library ZIP exported' : 'No tracks exported',
        result.exportedCount > 0
          ? `${result.fileName} saved with ${result.exportedCount} audio track${result.exportedCount === 1 ? '' : 's'}${result.lyricCount ? `, ${result.lyricCount} lyric file${result.lyricCount === 1 ? '' : 's'}` : ''}${result.artworkCount ? `, and ${result.artworkCount} artwork file${result.artworkCount === 1 ? '' : 's'}` : ''}.`
          : 'No saved audio files were available to export.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(message)) Alert.alert('Could not export library', message);
    } finally {
      setIsExportingLibrary(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top', 'bottom']}>
      <View style={{ height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={navigation.goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={23} color="white" />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: 'white', fontSize: 17, fontWeight: '700', textAlign: 'center', marginRight: 42 }}>
          Developer
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 160 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: 30, marginBottom: 34 }}>
          <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#4A222A' }}>
            <Ionicons name="person" size={52} color="#FA5265" />
          </View>
          <Text style={{ color: 'white', fontSize: 34, fontWeight: '800', marginTop: 18 }}>Kamal</Text>
          <Text style={{ color: '#A1A1A6', fontSize: 16, marginTop: 5 }}>Developer</Text>
        </View>

        <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
          FIND ME ONLINE
        </Text>
        {links.map((link) => (
          <TouchableOpacity
            key={link.title}
            onPress={() => navigation.navigate('ProfileWeb', { title: link.title, url: link.url })}
            accessibilityRole="link"
            accessibilityLabel={`Open Kamal’s ${link.title} profile`}
            activeOpacity={0.78}
            style={{ minHeight: 76, borderRadius: 18, backgroundColor: '#1C1C1E', paddingHorizontal: 16, marginBottom: 11, flexDirection: 'row', alignItems: 'center' }}
          >
            <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: '#2B2B2F', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={link.icon} size={21} color={link.title === 'Portfolio' ? '#FA5265' : 'white'} />
            </View>
            <View style={{ flex: 1, marginLeft: 13 }}>
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{link.title}</Text>
              <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 3 }}>{link.subtitle}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color="#8E8E93" />
          </TouchableOpacity>
        ))}

        <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 18, marginBottom: 12 }}>
          YOUR MUSIC
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (isImportingFolder) return;
            setIsImportingFolder(true);
            void importMusicFolder()
              .then((result) => {
                if (!result) return;
                Alert.alert(
                  result.importedCount > 0 ? 'Music imported' : 'No audio found',
                  result.importedCount > 0
                    ? `${result.importedCount} track${result.importedCount === 1 ? '' : 's'} copied into your private Musiqapp library. Embedded artwork found on ${result.artworkCount} track${result.artworkCount === 1 ? '' : 's'}.${result.skippedCount ? ` ${result.skippedCount} unsupported file${result.skippedCount === 1 ? '' : 's'} skipped.` : ''}`
                    : 'Choose a folder containing MP3, M4A, AAC, WAV, FLAC, OGG, or OPUS files.',
                );
              })
              .catch((error) => {
                Alert.alert('Could not import folder', error instanceof Error ? error.message : 'Choose the music folder again.');
              })
              .finally(() => setIsImportingFolder(false));
          }}
          disabled={isImportingFolder}
          accessibilityRole="button"
          accessibilityLabel="Import a music folder"
          style={{ minHeight: 112, borderRadius: 22, backgroundColor: '#2A171C', borderWidth: 1, borderColor: '#5A2630', paddingHorizontal: 18, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', opacity: isImportingFolder ? 0.65 : 1 }}
        >
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: '#FA243C', alignItems: 'center', justifyContent: 'center' }}>
            {isImportingFolder ? <ActivityIndicator color="white" /> : <Ionicons name="folder-open" size={28} color="white" />}
          </View>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>Import a music folder</Text>
            <Text style={{ color: '#D2A9AF', fontSize: 13, lineHeight: 18, marginTop: 5 }}>
              Copy your audio and matching LRC files into Musiqapp’s private library.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color="#FA5265" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => void exportLibrary()}
          disabled={isExportingLibrary}
          accessibilityRole="button"
          accessibilityLabel="Export the full music library as a ZIP file"
          style={{ minHeight: 112, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#3A3A3E', paddingHorizontal: 18, paddingVertical: 17, marginTop: 12, flexDirection: 'row', alignItems: 'center', opacity: isExportingLibrary ? 0.65 : 1 }}
        >
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: '#FA243C', alignItems: 'center', justifyContent: 'center' }}>
            {isExportingLibrary ? <ActivityIndicator color="white" /> : <Ionicons name="download-outline" size={28} color="white" />}
          </View>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>Export library ZIP</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 13, lineHeight: 18, marginTop: 5 }}>
              Create one ZIP with your tracks, available lyrics, artwork, and library details.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color="#FA5265" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => void emptyLibrary()}
          disabled={isEmptyingLibrary}
          accessibilityRole="button"
          accessibilityLabel="Empty library. Permanently delete all saved music from this device."
          style={{ minHeight: 112, borderRadius: 22, backgroundColor: '#201417', borderWidth: 1, borderColor: '#6A2731', paddingHorizontal: 18, paddingVertical: 17, marginTop: 12, flexDirection: 'row', alignItems: 'center', opacity: isEmptyingLibrary ? 0.65 : 1 }}
        >
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: '#FA243C', alignItems: 'center', justifyContent: 'center' }}>
            {isEmptyingLibrary ? <ActivityIndicator color="white" /> : <Ionicons name="trash" size={27} color="white" />}
          </View>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>Empty library</Text>
            <Text style={{ color: '#E0A7AE', fontSize: 13, lineHeight: 18, marginTop: 5 }}>
              Warning: permanently remove all music saved on this device.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color="#FA5265" />
        </TouchableOpacity>

        <Text style={{ color: '#65656B', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 34 }}>
          {'© 2026 Egokam. All rights reserved.\nEnjoy, don\'t try to make it commercial, contact admin for support.'}
        </Text>
        <Text style={{ color: '#55555A', fontSize: 11, textAlign: 'center', marginTop: 10 }}>
          Version {Constants.expoConfig?.version ?? '1.1.7'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const ProfileWebScreen = ({
  navigation,
  route,
}: NativeStackScreenProps<LibraryStackParamList, 'ProfileWeb'>) => {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);

  const goBack = () => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top', 'bottom']}>
      <View style={{ height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={canGoBack ? 'Back in page' : 'Back to developer profile'}
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={23} color="white" />
        </TouchableOpacity>
        <Text numberOfLines={1} style={{ flex: 1, color: 'white', fontSize: 16, fontWeight: '700', textAlign: 'center', marginHorizontal: 12 }}>
          {route.params.title}
        </Text>
        <View style={{ width: 42 }} />
      </View>

      <View style={{ flex: 1, overflow: 'hidden', backgroundColor: '#000000' }}>
        <WebView
          ref={webViewRef}
          source={{ uri: route.params.url }}
          style={{ flex: 1, backgroundColor: '#000000' }}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
        />
        {loading ? (
          <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
            <ActivityIndicator size="small" color="#FA5265" />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const SongCatalogRoute = ({
  navigation,
  title,
  tracks,
  apiConnected,
  apiInitializing,
  isLoadingTracks,
  loadError,
  onTrackUpdated,
  onTrackRemoved,
  offlineMode = false,
  showTrackActions = true,
  emptyMessage,
  onDeleteDownloadedTracks,
  onOpenAddSongs,
  addToPlaylistMode = false,
  addedPlaylistTrackIds,
  addingPlaylistTrackIds,
  onAddPlaylistTrack,
  playlistMode = false,
  onRemoveFromPlaylist,
  onSearchOverride,
}: {
  navigation: { goBack: () => void };
  title: string;
  tracks: Track[];
  apiConnected: boolean;
  apiInitializing: boolean;
  isLoadingTracks: boolean;
  loadError: string | null;
  onTrackUpdated?: (track: Track) => void;
  onTrackRemoved?: (trackId: string) => void;
  offlineMode?: boolean;
  showTrackActions?: boolean;
  emptyMessage?: string;
  onDeleteDownloadedTracks?: (trackIds: string[]) => Promise<number>;
  onOpenAddSongs?: () => void;
  addToPlaylistMode?: boolean;
  addedPlaylistTrackIds?: string[];
  addingPlaylistTrackIds?: string[];
  onAddPlaylistTrack?: (track: Track) => Promise<void>;
  playlistMode?: boolean;
  onRemoveFromPlaylist?: (track: Track) => Promise<void>;
  onSearchOverride?: (query?: string) => Promise<void>;
}) => {
  const actions = usePlaybackActions();
  const { loadPlaylists, apiInitializing: libraryInitializing } = actions;
  const favoriteTrackIds = useMemo(() => new Set([
    ...actions.favoriteTracks.map((track) => track.id),
    ...actions.tracks.filter((track) => track.isFavorite).map((track) => track.id),
  ]), [actions.favoriteTracks, actions.tracks]);
  const tracksWithFavoriteState = useMemo(() => tracks.map((track) => ({
    ...track,
    isFavorite: favoriteTrackIds.has(track.id),
  })), [favoriteTrackIds, tracks]);

  useEffect(() => {
    if (apiConnected && !libraryInitializing && showTrackActions) void loadPlaylists().catch(() => undefined);
  }, [loadPlaylists, apiConnected, libraryInitializing, showTrackActions]);

  return (
    <SongsScreen
      title={title}
      onBack={navigation.goBack}
      onSelectTrack={actions.playTrack}
      onPlayAll={actions.playAllSongs}
      onShuffle={actions.shuffleSongs}
      tracks={tracksWithFavoriteState}
      apiConnected={apiConnected}
      apiInitializing={apiInitializing}
      isLoadingTracks={isLoadingTracks}
      loadError={loadError}
      downloadedTrackIds={actions.downloadedTrackIds}
      downloadingTrackIds={actions.downloadingTrackIds}
      onSearch={onSearchOverride ?? (title === 'Songs' ? actions.searchTracks : async () => undefined)}
      onConnect={actions.connectToLibrary}
      onDownload={actions.downloadTrack}
      onPlayNext={actions.playNext}
      onToggleFavorite={async (track) => {
        const updated = await actions.toggleFavorite(track);
        onTrackUpdated?.(updated);
        return updated;
      }}
      onAddToPlaylist={actions.addTrackToPlaylist}
      onCreatePlaylist={actions.createPlaylist}
      onSaveTrack={async (track: Track, changes: TrackEditChanges) => {
        const updated = await actions.updateTrack(track, changes);
        onTrackUpdated?.(updated);
      }}
      onDeleteTrack={async (track) => {
        await actions.deleteTrack(track);
        onTrackRemoved?.(track.id);
      }}
      playlists={actions.playlists}
      hasActiveTrack={actions.hasActiveTrack}
      offlineMode={offlineMode}
      showTrackActions={showTrackActions}
      emptyMessage={emptyMessage}
      onDeleteDownloadedTracks={onDeleteDownloadedTracks}
      onOpenAddSongs={onOpenAddSongs}
      addToPlaylistMode={addToPlaylistMode}
      addedPlaylistTrackIds={addedPlaylistTrackIds}
      addingPlaylistTrackIds={addingPlaylistTrackIds}
      onAddPlaylistTrack={onAddPlaylistTrack}
      playlistMode={playlistMode}
      onRemoveFromPlaylist={onRemoveFromPlaylist}
    />
  );
};

const useLoadFullCatalog = (apiConnected: boolean, apiInitializing: boolean, loadAllTracks: () => Promise<Track[]>) => {
  const [loadingFullCatalog, setLoadingFullCatalog] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!apiConnected || apiInitializing) {
      setLoadingFullCatalog(false);
      return;
    }
    let mounted = true;
    setLoadingFullCatalog(true);
    void loadAllTracks().catch(() => undefined).finally(() => {
      if (mounted) setLoadingFullCatalog(false);
    });
    return () => {
      mounted = false;
    };
  }, [apiConnected, apiInitializing, loadAllTracks]));

  return loadingFullCatalog;
};

const SongsRoute = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Songs'>) => {
  const actions = usePlaybackActions();
  const loadingFullCatalog = useLoadFullCatalog(actions.apiConnected, actions.apiInitializing, actions.loadAllTracks);
  const skipRemoteSearch = useCallback(async () => undefined, []);
  return (
    <SongCatalogRoute
      navigation={navigation}
      title="Songs"
      tracks={actions.tracks}
      apiConnected={actions.apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={actions.isLoadingTracks || loadingFullCatalog}
      loadError={actions.loadError}
      onSearchOverride={skipRemoteSearch}
    />
  );
};

const AlbumsRoute = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Albums'>) => {
  const actions = usePlaybackActions();
  const loadingFullCatalog = useLoadFullCatalog(actions.apiConnected, actions.apiInitializing, actions.loadAllTracks);
  return (
    <AlbumsScreen
      tracks={actions.tracks}
      loading={actions.apiInitializing || loadingFullCatalog}
      onBack={navigation.goBack}
      onOpenAlbum={(album, artist) => navigation.navigate('AlbumTracks', { album, artist })}
      onPlayAll={actions.playAllSongs}
      onShuffle={actions.shuffleSongs}
    />
  );
};

const ArtistsRoute = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Artists'>) => {
  const actions = usePlaybackActions();
  const loadingFullCatalog = useLoadFullCatalog(actions.apiConnected, actions.apiInitializing, actions.loadAllTracks);
  return (
    <ArtistsScreen
      tracks={actions.tracks}
      loading={actions.apiInitializing || loadingFullCatalog}
      onBack={navigation.goBack}
      onOpenArtist={(artist) => navigation.navigate('ArtistTracks', { artist })}
    />
  );
};

const AlbumTracksRoute = ({
  navigation,
  route,
}: NativeStackScreenProps<LibraryStackParamList, 'AlbumTracks'>) => {
  const actions = usePlaybackActions();
  const albumTracks = actions.tracks.filter((track) =>
    (track.album.trim() || 'Unknown Album').toLocaleLowerCase() === route.params.album.toLocaleLowerCase() &&
    (track.artist.trim() || 'Unknown Artist').toLocaleLowerCase() === route.params.artist.toLocaleLowerCase(),
  );
  return (
    <SongCatalogRoute
      navigation={navigation}
      title={route.params.album}
      tracks={albumTracks}
      apiConnected={actions.apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={actions.isLoadingTracks}
      loadError={actions.loadError}
    />
  );
};

const ArtistTracksRoute = ({
  navigation,
  route,
}: NativeStackScreenProps<LibraryStackParamList, 'ArtistTracks'>) => {
  const actions = usePlaybackActions();
  const artistTracks = actions.tracks.filter((track) =>
    (track.artist.trim() || 'Unknown Artist').toLocaleLowerCase() === route.params.artist.toLocaleLowerCase(),
  );
  return (
    <SongCatalogRoute
      navigation={navigation}
      title={route.params.artist}
      tracks={artistTracks}
      apiConnected={actions.apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={actions.isLoadingTracks}
      loadError={actions.loadError}
    />
  );
};

const FavoritesRoute = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Favorites'>) => {
  const actions = usePlaybackActions();
  const { apiConnected, loadFavoriteTracks, favoriteTracks } = actions;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!apiConnected) return;
    void loadFavoriteTracks().catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : 'Could not load favorites.');
    }).finally(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [apiConnected, loadFavoriteTracks]);

  return (
    <SongCatalogRoute
      navigation={navigation}
      title="Favorites"
      tracks={favoriteTracks}
      apiConnected={apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={apiConnected && !loaded && !error}
      loadError={error}
    />
  );
};

const PlaylistsRoute = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Playlists'>) => {
  const actions = usePlaybackActions();
  const { apiConnected, loadPlaylists } = actions;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!apiConnected) return;
    void loadPlaylists().catch((error) => {
      if (mounted) Alert.alert('Could not load playlists', error instanceof Error ? error.message : 'Try again.');
    }).finally(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [apiConnected, loadPlaylists]);

  return (
    <PlaylistsScreen
      onBack={navigation.goBack}
      playlists={actions.playlists}
      loading={apiConnected && !loaded}
      onCreate={actions.createPlaylist}
      onOpen={(playlist: PlaylistSummary) => navigation.navigate('PlaylistTracks', { playlistId: playlist.id, title: playlist.name })}
      onDelete={actions.deletePlaylist}
    />
  );
};

const PlaylistTracksRoute = ({
  navigation,
  route,
}: NativeStackScreenProps<LibraryStackParamList, 'PlaylistTracks'>) => {
  const actions = usePlaybackActions();
  const { apiConnected, loadPlaylistTracks } = actions;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    setLoaded(false);
    setError(null);
    void loadPlaylistTracks(route.params.playlistId).then((items) => {
      if (mounted) setTracks(items);
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : 'Could not load this playlist.');
    }).finally(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [loadPlaylistTracks, route.params.playlistId]));

  return (
    <SongCatalogRoute
      navigation={navigation}
      title={route.params.title}
      tracks={tracks}
      apiConnected={apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={apiConnected && !loaded && !error}
      loadError={error}
      onTrackUpdated={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))}
      onTrackRemoved={(trackId) => setTracks((current) => current.filter((track) => track.id !== trackId))}
      playlistMode
      onRemoveFromPlaylist={async (track) => {
        await actions.removeTrackFromPlaylist(route.params.playlistId, track);
        setTracks((current) => current.filter((item) => item.id !== track.id));
      }}
      onOpenAddSongs={() => navigation.navigate('AddSongsToPlaylist', {
        playlistId: route.params.playlistId,
        title: route.params.title,
      })}
    />
  );
};

const AddSongsToPlaylistRoute = ({
  navigation,
  route,
}: NativeStackScreenProps<LibraryStackParamList, 'AddSongsToPlaylist'>) => {
  const actions = usePlaybackActions();
  const { apiConnected, loadAllTracks, loadPlaylistTracks } = actions;
  const [tracks, setTracks] = useState<Track[]>(actions.tracks);
  const [addedTrackIds, setAddedTrackIds] = useState<string[]>([]);
  const [addingTrackIds, setAddingTrackIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadAllTracks(),
      loadPlaylistTracks(route.params.playlistId),
    ]).then(([libraryTracks, playlistTracks]) => {
      if (!mounted) return;
      setTracks(libraryTracks);
      setAddedTrackIds(playlistTracks.map((track) => track.id));
      setError(null);
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : 'Could not load songs for this playlist.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [apiConnected, loadAllTracks, loadPlaylistTracks, route.params.playlistId]);

  const toggleTrack = async (track: Track) => {
    if (addingTrackIds.includes(track.id)) return;
    const alreadyAdded = addedTrackIds.includes(track.id);
    setAddingTrackIds((current) => [...current, track.id]);
    try {
      if (alreadyAdded) {
        await actions.removeTrackFromPlaylist(route.params.playlistId, track);
        setAddedTrackIds((current) => current.filter((id) => id !== track.id));
      } else {
        await actions.addTrackToPlaylist(route.params.playlistId, track);
        setAddedTrackIds((current) => current.includes(track.id) ? current : [...current, track.id]);
      }
    } catch (reason) {
      Alert.alert(
        alreadyAdded ? 'Could not remove song' : 'Could not add song',
        reason instanceof Error ? reason.message : 'Please try again.',
      );
    } finally {
      setAddingTrackIds((current) => current.filter((id) => id !== track.id));
    }
  };

  return (
    <SongCatalogRoute
      navigation={navigation}
      title="Add Songs"
      tracks={tracks}
      apiConnected={actions.apiConnected}
      apiInitializing={actions.apiInitializing}
      isLoadingTracks={loading}
      loadError={error}
      addToPlaylistMode
      addedPlaylistTrackIds={addedTrackIds}
      addingPlaylistTrackIds={addingTrackIds}
      onAddPlaylistTrack={toggleTrack}
      onTrackUpdated={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))}
    />
  );
};

const LrcCheckerRoute = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'LrcChecker'>) => {
  const {
    tracks,
    apiConnected,
    isLoadingTracks,
    loadAllTracks,
    checkTrackLyrics,
    saveTrackLyrics,
  } = usePlaybackActions();

  return (
    <LrcCheckerScreen
      onBack={() => navigation.goBack()}
      onConnect={() => navigation.navigate('Songs')}
      tracks={tracks}
      apiConnected={apiConnected}
      isLoadingTracks={isLoadingTracks}
      onLoadAllTracks={loadAllTracks}
      onCheckTrack={checkTrackLyrics}
      onSaveTrackLyrics={saveTrackLyrics}
    />
  );
};

const LrcSynchronizerRoute = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'LrcSynchronizer'>) => (
  <LrcSynchronizerScreen onBack={navigation.goBack} />
);

export const LibraryScreen = () => (
  <Stack.Navigator
    initialRouteName="LibraryHome"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: '#000000' },
      animation: 'simple_push',
      animationDuration: 280,
      gestureEnabled: true,
      gestureDirection: 'horizontal',
      fullScreenGestureEnabled: true,
      animationMatchesGesture: true,
    }}
  >
    <Stack.Screen name="LibraryHome" component={LibraryHomeScreen} />
    <Stack.Screen name="DeveloperProfile" component={DeveloperProfileScreen} />
    <Stack.Screen name="ProfileWeb" component={ProfileWebScreen} />
    <Stack.Screen name="Songs" component={SongsRoute} />
    <Stack.Screen name="Albums" component={AlbumsRoute} />
    <Stack.Screen name="Artists" component={ArtistsRoute} />
    <Stack.Screen name="AlbumTracks" component={AlbumTracksRoute} />
    <Stack.Screen name="ArtistTracks" component={ArtistTracksRoute} />
    <Stack.Screen name="Favorites" component={FavoritesRoute} />
    <Stack.Screen name="Playlists" component={PlaylistsRoute} />
    <Stack.Screen name="PlaylistTracks" component={PlaylistTracksRoute} />
    <Stack.Screen name="AddSongsToPlaylist" component={AddSongsToPlaylistRoute} />
    <Stack.Screen name="LrcChecker" component={LrcCheckerRoute} />
    <Stack.Screen name="LrcSynchronizer" component={LrcSynchronizerRoute} />
  </Stack.Navigator>
);
