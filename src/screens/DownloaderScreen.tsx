import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SongListItem, type SongMenuAnchor } from '../components/songs/SongListItem';
import { TrackActionsSheet } from '../components/songs/TrackActionsSheet';
import type { PlaylistSummary, Track } from '../types';
import { MusicCatalogService, type ImportProgress, type MediaLinkMetadata, type TrackEditChanges } from '../services/MusicCatalogService';

const providers = [
  {
    name: 'Spotify',
    icon: 'musical-notes' as const,
    color: '#1DB954',
    searchUrl: (query: string) => `https://open.spotify.com/search/${encodeURIComponent(query)}`,
  },
  {
    name: 'YouTube',
    icon: 'logo-youtube' as const,
    color: '#FF3B30',
    searchUrl: (query: string) => `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'SoundCloud',
    icon: 'cloud-outline' as const,
    color: '#FF7A00',
    searchUrl: (query: string) => `https://soundcloud.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'Apple Music',
    icon: 'logo-apple' as const,
    color: '#FA5265',
    searchUrl: (query: string) => `https://music.apple.com/search?term=${encodeURIComponent(query)}`,
  },
  {
    name: 'Bandcamp',
    icon: 'globe-outline' as const,
    color: '#61A8B8',
    searchUrl: (query: string) => `https://bandcamp.com/search?q=${encodeURIComponent(query)}`,
  },
];

const isHttpsLink = (value: string) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

const getPlatformFromLink = (value: string): 'Spotify' | 'SoundCloud' | 'YouTube' | 'TikTok' | null => {
  try {
    const hostname = new URL(value.trim()).hostname.replace(/^www\./, '').toLowerCase();
    if (hostname === 'spotify.com' || hostname.endsWith('.spotify.com')) return 'Spotify';
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') return 'YouTube';
    if (hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com')) return 'SoundCloud';
    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) return 'TikTok';
  } catch {
    return null;
  }
  return null;
};

export const DownloaderScreen = ({
  onBack,
  onConnectLibrary,
  onSelectTrack,
  tracks,
  apiConnected,
  isLoadingTracks,
  loadError,
  downloadedTrackIds,
  downloadingTrackIds,
  onSearch,
  onDownload,
  onImportAudioToLibrary,
  onImportLocalFile,
  playlists,
  hasActiveTrack,
  onPlayNext,
  onToggleFavorite,
  onAddToPlaylist,
  onCreatePlaylist,
  onSaveTrack,
  onDeleteTrack,
}: {
  onBack: () => void;
  onConnectLibrary: () => void;
  onSelectTrack: (track: Track, queue?: Track[]) => void;
  tracks: Track[];
  apiConnected: boolean;
  isLoadingTracks: boolean;
  loadError: string | null;
  downloadedTrackIds: string[];
  downloadingTrackIds: string[];
  onSearch: (query?: string) => Promise<void>;
  onDownload: (track: Track) => Promise<Track>;
  onImportAudioToLibrary: (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
  ) => Promise<Track>;
  onImportLocalFile: () => Promise<Track | null>;
  playlists: PlaylistSummary[];
  hasActiveTrack: boolean;
  onPlayNext: (track: Track) => void;
  onToggleFavorite: (track: Track) => Promise<Track>;
  onAddToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<PlaylistSummary>;
  onSaveTrack: (track: Track, changes: TrackEditChanges) => Promise<void>;
  onDeleteTrack: (track: Track) => Promise<void>;
}) => {
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [trackName, setTrackName] = useState('');
  const [artistName, setArtistName] = useState('');
  const [isImportingToDevice, setIsImportingToDevice] = useState(false);
  const [isResolvingLink, setIsResolvingLink] = useState(false);
  const [linkMetadata, setLinkMetadata] = useState<MediaLinkMetadata | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);

  useEffect(() => {
    if (mode !== 'search' || !apiConnected) return;
    const timeout = setTimeout(() => void onSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timeout);
  }, [apiConnected, mode, onSearch, searchQuery]);

  const downloadedIds = useMemo(() => new Set(downloadedTrackIds), [downloadedTrackIds]);
  const downloadingIds = useMemo(() => new Set(downloadingTrackIds), [downloadingTrackIds]);
  const audioPlatformLink = getPlatformFromLink(audioUrl);
  const canImportToDevice = isHttpsLink(audioUrl) && audioPlatformLink !== 'Spotify';

  const resolvePlatformLink = async () => {
    if (!isHttpsLink(referenceUrl)) {
      Alert.alert('Paste a supported track link', 'Use an HTTPS track or direct audio URL.');
      return;
    }
    if (!apiConnected) {
      Alert.alert('Local library unavailable', 'The local library is still loading.');
      return;
    }
    setIsResolvingLink(true);
    try {
      const metadata = await MusicCatalogService.resolveMediaLink(referenceUrl.trim());
      setLinkMetadata(metadata);
      setTrackName(metadata.title);
      setArtistName(metadata.artist);
    } catch (error) {
      Alert.alert('Could not read this link', error instanceof Error ? error.message : 'Check the Spotify or SoundCloud URL and try again.');
    } finally {
      setIsResolvingLink(false);
    }
  };

  const searchProvider = async (searchUrl: (query: string) => string) => {
    const query = searchQuery.trim();
    if (!query) {
      Alert.alert('Add a search first', 'Enter a track or artist name, then choose a service.');
      return;
    }
    try {
      await Linking.openURL(searchUrl(query));
    } catch {
      Alert.alert('Could not open service', 'Try opening the service from its app or website.');
    }
  };

  const handleAction = async () => {
    if (canImportToDevice) {
      setIsImportingToDevice(true);
      setImportProgress({ progress: 0, message: 'Starting import…', bytesDownloaded: 0, totalBytes: null });
      try {
        const imported = await onImportAudioToLibrary(
          audioUrl.trim(),
          trackName,
          artistName,
          referenceUrl.trim(),
          setImportProgress,
        );
        setImportProgress({ progress: 1, message: 'Saved to this device.', bytesDownloaded: 0, totalBytes: null });
        Alert.alert('Saved locally', `${imported.title} is now in your local music folder.`);
        setAudioUrl('');
        setReferenceUrl('');
        setTrackName('');
        setArtistName('');
        setLinkMetadata(null);
      } catch (error) {
        Alert.alert('Could not save audio', error instanceof Error ? error.message : 'Check the direct audio URL and try again.');
        setImportProgress(null);
      } finally {
        setIsImportingToDevice(false);
      }
      return;
    }

    if (audioPlatformLink === 'Spotify') {
      Alert.alert(
        'Spotify links provide track details only',
        'Paste a YouTube or TikTok video link, a SoundCloud track link, or provide a direct MP3/M4A file URL.',
      );
      return;
    }

    Alert.alert(
      'Use a supported HTTPS link',
      'Paste a direct MP3, M4A, WAV, FLAC, or OGG file URL. The file will be saved to this device.',
    );
  };

  const handleLocalFileImport = async () => {
    try {
      const imported = await onImportLocalFile();
      if (imported) Alert.alert('Added locally', `${imported.title} is now available in your library.`);
    } catch (error) {
      Alert.alert('Could not import file', error instanceof Error ? error.message : 'Choose a supported audio file and try again.');
    }
  };

  const renderSearchContent = () => (
    <>
      <View
        style={{
          height: 54,
          marginTop: 20,
          paddingHorizontal: 15,
          borderRadius: 27,
          backgroundColor: '#1C1C1E',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Ionicons name="search" size={21} color="#A1A1A6" />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Song, artist, or album"
          placeholderTextColor="#8E8E93"
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => void onSearch(searchQuery.trim())}
          style={{ flex: 1, height: '100%', marginLeft: 11, padding: 0, color: 'white', fontSize: 17 }}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={20} color="#8E8E93" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '700', letterSpacing: 0.7, marginBottom: 12 }}>
          SEARCH ON A SERVICE
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
          {providers.map((provider) => (
            <TouchableOpacity
              key={provider.name}
              onPress={() => void searchProvider(provider.searchUrl)}
              accessibilityRole="button"
              accessibilityLabel={`Search ${provider.name}`}
              style={{
                height: 39,
                paddingHorizontal: 13,
                borderRadius: 20,
                backgroundColor: '#1C1C1E',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <Ionicons name={provider.icon} size={16} color={provider.color} />
              <Text style={{ color: '#F2F2F7', fontSize: 13, fontWeight: '600' }}>{provider.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={{ color: '#74747A', fontSize: 12, lineHeight: 17, marginTop: 10 }}>
          Opens the service’s own search. Direct audio files can be saved to this device below.
        </Text>
      </View>

      <View style={{ marginTop: 29, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: 'white', fontSize: 21, fontWeight: '700' }}>Your library</Text>
        {isLoadingTracks ? <ActivityIndicator size="small" color="#FA243C" /> : null}
      </View>
      {!apiConnected ? (
        <View style={{ marginTop: 9, padding: 18, borderRadius: 20, backgroundColor: '#1C1C1E' }}>
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Local music library</Text>
          <Text style={{ color: '#A1A1A6', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 14 }}>
            Search your own collection and save tracks for offline listening.
          </Text>
          <TouchableOpacity
            onPress={onConnectLibrary}
            style={{ alignSelf: 'flex-start', paddingHorizontal: 15, height: 38, borderRadius: 19, backgroundColor: '#FA243C', justifyContent: 'center' }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>Connect library</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {loadError ? <Text style={{ color: '#FA5265', fontSize: 14, marginVertical: 12 }}>{loadError}</Text> : null}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <View style={{ position: 'absolute', zIndex: 5, top: 10, left: 16, right: 16, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Library"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Alert.alert('About Downloader', 'Search your private library or import audio from a YouTube or TikTok video, a SoundCloud track, or a direct MP3/M4A file link.')}
            accessibilityRole="button"
            accessibilityLabel="About downloader"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-horizontal" size={23} color="white" />
          </TouchableOpacity>
        </View>

        <FlatList
          data={mode === 'search' && apiConnected ? tracks : []}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 68, paddingBottom: 190, flexGrow: 1 }}
          ListHeaderComponent={(
            <>
              <Text style={{ color: 'white', fontSize: 37, lineHeight: 44, fontWeight: '800' }}>Downloader</Text>
              <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginTop: 5 }}>
                Find a track or save audio to your library.
              </Text>

              <View style={{ height: 48, marginTop: 25, padding: 4, borderRadius: 25, backgroundColor: '#1C1C1E', flexDirection: 'row' }}>
                {(['search', 'link'] as const).map((item) => {
                  const selected = mode === item;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => setMode(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{ flex: 1, borderRadius: 22, backgroundColor: selected ? '#39393D' : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                    >
                      <Ionicons name={item === 'search' ? 'search' : 'link'} size={17} color={selected ? '#FA5265' : '#A1A1A6'} />
                      <Text style={{ color: selected ? 'white' : '#A1A1A6', fontSize: 14, fontWeight: '700' }}>{item === 'search' ? 'Search' : 'Paste link'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {mode === 'search' ? renderSearchContent() : (
                <View style={{ marginTop: 20 }}>
                  <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginBottom: 9 }}>
                    SPOTIFY OR SOUNDCLOUD DETAILS
                  </Text>
                  <View style={{ height: 54, paddingHorizontal: 15, borderRadius: 17, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="link" size={20} color="#A1A1A6" />
                    <TextInput
                      value={referenceUrl}
                      onChangeText={(value) => {
                        setReferenceUrl(value);
                        setLinkMetadata(null);
                      }}
                      placeholder="Paste Spotify or SoundCloud track link"
                      placeholderTextColor="#8E8E93"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={{ flex: 1, height: '100%', marginLeft: 10, padding: 0, color: 'white', fontSize: 15 }}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => void resolvePlatformLink()}
                    disabled={isResolvingLink || !referenceUrl.trim()}
                    accessibilityRole="button"
                    style={{ height: 43, alignSelf: 'flex-start', paddingHorizontal: 15, marginTop: 10, borderRadius: 22, backgroundColor: '#29292D', flexDirection: 'row', alignItems: 'center', gap: 8, opacity: isResolvingLink || !referenceUrl.trim() ? 0.55 : 1 }}
                  >
                    {isResolvingLink ? <ActivityIndicator color="#FA5265" size="small" /> : <Ionicons name="sparkles-outline" size={17} color="#FA5265" />}
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>{isResolvingLink ? 'Reading link…' : 'Get track details'}</Text>
                  </TouchableOpacity>

                  {linkMetadata ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: '#151517' }}>
                      {linkMetadata.artwork ? <Image source={{ uri: linkMetadata.artwork }} style={{ width: 58, height: 58, borderRadius: 9, backgroundColor: '#29292D' }} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>{linkMetadata.title}</Text>
                        <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 13, marginTop: 4 }}>{linkMetadata.artist || linkMetadata.provider}</Text>
                        <Text style={{ color: '#74747A', fontSize: 11, marginTop: 4 }}>{linkMetadata.provider} link details</Text>
                      </View>
                    </View>
                  ) : null}

                  <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 20, marginBottom: 9 }}>
                    AUDIO SOURCE LINK
                  </Text>
                  <TouchableOpacity
                    onPress={() => void handleLocalFileImport()}
                    accessibilityRole="button"
                    style={{ height: 48, borderRadius: 24, backgroundColor: '#29292D', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
                  >
                    <Ionicons name="folder-open-outline" size={19} color="#FA5265" />
                    <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>Choose audio from Files</Text>
                  </TouchableOpacity>
                  <View style={{ height: 54, paddingHorizontal: 15, borderRadius: 17, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="cloud-download-outline" size={20} color="#A1A1A6" />
                    <TextInput
                      value={audioUrl}
                      onChangeText={setAudioUrl}
                      placeholder="Direct MP3, M4A, WAV, FLAC, or OGG link"
                      placeholderTextColor="#8E8E93"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={{ flex: 1, height: '100%', marginLeft: 10, padding: 0, color: 'white', fontSize: 15 }}
                    />
                  </View>
                  <Text style={{ color: '#74747A', fontSize: 12, lineHeight: 17, marginTop: 7 }}>
                    Only direct audio file URLs are imported locally. Platform pages do not expose an audio file to the app.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TextInput
                      value={trackName}
                      onChangeText={setTrackName}
                      placeholder="Track name"
                      placeholderTextColor="#8E8E93"
                      style={{ flex: 1, height: 48, paddingHorizontal: 13, borderRadius: 15, backgroundColor: '#1C1C1E', color: 'white', fontSize: 14 }}
                    />
                    <TextInput
                      value={artistName}
                      onChangeText={setArtistName}
                      placeholder="Artist"
                      placeholderTextColor="#8E8E93"
                      style={{ flex: 1, height: 48, paddingHorizontal: 13, borderRadius: 15, backgroundColor: '#1C1C1E', color: 'white', fontSize: 14 }}
                    />
                  </View>

                  <TouchableOpacity
                    onPress={() => void handleAction()}
                    disabled={isImportingToDevice || !audioUrl.trim()}
                    accessibilityRole="button"
                    style={{ height: 52, marginTop: 17, borderRadius: 26, backgroundColor: '#FA243C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, opacity: isImportingToDevice || !audioUrl.trim() ? 0.55 : 1 }}
                  >
                    {isImportingToDevice ? <ActivityIndicator color="white" /> : <Ionicons name={canImportToDevice ? 'download-outline' : audioPlatformLink === 'Spotify' ? 'alert-circle-outline' : 'arrow-down-circle-outline'} size={21} color="white" />}
                    <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                      {isImportingToDevice ? 'Saving to this device…' : canImportToDevice ? 'Save to this device' : audioPlatformLink === 'Spotify' ? 'Spotify links provide details only' : 'Import'}
                    </Text>
                  </TouchableOpacity>

                  {importProgress && (isImportingToDevice || importProgress.progress === 1) ? (
                    <View style={{ marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: '#151517' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {importProgress.progress === null ? <ActivityIndicator color="#FA5265" size="small" /> : null}
                        <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((importProgress.progress ?? 0) * 100) }} style={{ flex: 1, color: 'white', fontWeight: '700', fontSize: 14 }}>
                          {importProgress.message}
                        </Text>
                        {importProgress.progress !== null ? <Text style={{ color: '#A1A1A6', fontSize: 13 }}>{Math.round(importProgress.progress * 100)}%</Text> : null}
                      </View>
                      <View style={{ height: 5, overflow: 'hidden', borderRadius: 3, marginTop: 12, backgroundColor: '#39393D' }}>
                        <View style={{ width: `${Math.round((importProgress.progress ?? 0) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: '#FA5265' }} />
                      </View>
                      {importProgress.bytesDownloaded > 0 ? (
                        <Text style={{ color: '#8E8E93', fontSize: 12, marginTop: 8 }}>
                          {(importProgress.bytesDownloaded / 1048576).toFixed(1)} MB received{importProgress.totalBytes ? ` of ${(importProgress.totalBytes / 1048576).toFixed(1)} MB` : ''}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={{ marginTop: 17, padding: 15, borderRadius: 17, backgroundColor: '#151517', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <Ionicons name="information-circle-outline" size={20} color="#A1A1A6" />
                    <Text style={{ flex: 1, color: '#A1A1A6', fontSize: 13, lineHeight: 19 }}>
                      Track details can be entered manually. Provide a direct audio file URL to save music locally; no server-side extraction or lyrics lookup is used.
                    </Text>
                  </View>

                </View>
              )}
            </>
          )}
          renderItem={({ item, index }) => (
            <SongListItem
              track={item}
              onPress={() => onSelectTrack(item, tracks)}
              onMore={(anchor) => setSelectedTrack({ track: item, anchor })}
              onDownload={() => {
                void onDownload(item).catch((error) => {
                  Alert.alert('Download failed', error instanceof Error ? error.message : 'Could not save this track.');
                });
              }}
              downloaded={downloadedIds.has(item.id)}
              downloading={downloadingIds.has(item.id)}
              isLast={index === tracks.length - 1}
            />
          )}
          ListEmptyComponent={mode === 'search' && apiConnected ? (
            <Text style={{ color: isLoadingTracks ? '#A1A1A6' : '#74747A', fontSize: 14, marginTop: 8 }}>
              {isLoadingTracks ? 'Searching your local library…' : loadError ?? (searchQuery ? 'No matching tracks in your library.' : 'Your local tracks will appear here.')}
            </Text>
          ) : null}
        />
      </View>
      {selectedTrack ? (
        <TrackActionsSheet
          key={selectedTrack.track.id}
          track={selectedTrack.track}
          anchor={selectedTrack.anchor}
          visible
          playlists={playlists}
          hasActiveTrack={hasActiveTrack}
          onClose={() => setSelectedTrack(null)}
          onPlayNext={onPlayNext}
          onToggleFavorite={onToggleFavorite}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onSaveTrack={onSaveTrack}
          onDeleteTrack={onDeleteTrack}
        />
      ) : null}
    </SafeAreaView>
  );
};
