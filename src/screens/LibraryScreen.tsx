import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Directory } from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { LibraryList } from '../components/library/LibraryList';
import { TopBar } from '../components/library/TopBar';
import { SkeletonBlock, SkeletonPulse } from '../components/Skeleton';
import { TrackActionsSheet } from '../components/songs/TrackActionsSheet';
import type { SongMenuAnchor } from '../components/songs/SongListItem';
import { usePlaybackActions } from '../contexts/PlaybackContext';
import type { PlaylistSummary, Track } from '../types';
import type { TrackEditChanges } from '../services/MusicCatalogService';
import { getMusicApiHeaders, MusicCatalogService } from '../services/MusicCatalogService';
import { OfflineMusicService, SPICY_LYRICS_CACHE_MAX_AGE_MS, type SpicyLyricsCacheEntry } from '../services/OfflineMusicService';
import { DownloaderScreen } from './DownloaderScreen';
import { LrcCheckerScreen } from './LrcCheckerScreen';
import { LrcSynchronizerScreen } from './LrcSynchronizerScreen';
import { PlaylistsScreen } from './PlaylistsScreen';
import { SongsScreen } from './SongsScreen';
import { AlbumsScreen } from './AlbumsScreen';
import { ArtistsScreen } from './ArtistsScreen';

type LibraryStackParamList = {
  LibraryHome: undefined;
  DeveloperProfile: undefined;
  ApiLyrics: undefined;
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
  Downloader: undefined;
  LrcChecker: undefined;
  LrcSynchronizer: undefined;
};

const Stack = createNativeStackNavigator<LibraryStackParamList>();

const APP_ICON_CHOICES: { key: string | null; title: string; image: ImageSourcePropType; accent: string }[] = [
  { key: null, title: 'Original', image: require('../../assets/icon.png'), accent: '#FA5265' },
  { key: 'ocean', title: 'Ocean', image: require('../../assets/icons/ocean.png'), accent: '#159FDB' },
  { key: 'violet', title: 'Violet', image: require('../../assets/icons/violet.png'), accent: '#A233E5' },
  { key: 'amber', title: 'Amber', image: require('../../assets/icons/amber.png'), accent: '#E9A115' },
  { key: 'forest', title: 'Forest', image: require('../../assets/icons/forest.png'), accent: '#31B66A' },
  { key: 'midnight', title: 'Midnight', image: require('../../assets/icons/midnight.png'), accent: '#4A78E8' },
];

type AppIconNativeModule = {
  supportsAlternateIcons: () => boolean;
  getAppIconState: () => { selected: string | null; isPending: boolean };
  setAppIconAsync: (iconName: string | null, options?: { deferUntilBackground?: boolean }) => Promise<void>;
};

const getAppIconNativeModule = () =>
  requireOptionalNativeModule<AppIconNativeModule>('AwesomeAppIcon');

const RecentlyAddedTrackCard = ({
  track,
  onPlay,
  onOpenMenu,
}: {
  track: Track;
  onPlay: () => void;
  onOpenMenu: (anchor: SongMenuAnchor) => void;
}) => {
  const longPressedRef = useRef(false);
  const [pressScale] = useState(() => new Animated.Value(1));

  return (
    <Pressable
      onPress={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onPlay();
      }}
      onPressIn={() => {
        longPressedRef.current = false;
        Animated.timing(pressScale, {
          toValue: 0.95,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(pressScale, {
          toValue: 1,
          damping: 22,
          stiffness: 155,
          mass: 0.95,
          useNativeDriver: true,
        }).start();
      }}
      delayLongPress={450}
      onLongPress={(event) => {
        const { pageX, pageY, locationX, locationY } = event.nativeEvent;
        longPressedRef.current = true;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        onOpenMenu({ x: pageX - locationX, y: pageY - locationY, width: 148, height: 148 });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.title} by ${track.artist}. Hold for track options.`}
      accessibilityHint="Long press to edit, favorite, add to a playlist, play next, or delete this track."
      style={({ pressed }) => ({ width: 148, opacity: pressed ? 0.84 : 1 })}
    >
      <Animated.View style={{ width: 148, transform: [{ scale: pressScale }] }}>
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
      </Animated.View>
    </Pressable>
  );
};

const LibraryHomeScreen = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'LibraryHome'>) => {
  const {
    recentlyAddedTracks,
    playTrack,
    isLoadingTracks,
    apiInitializing,
    playlists,
    hasActiveTrack,
    playNext,
    toggleFavorite,
    addTrackToPlaylist,
    createPlaylist,
    updateTrack,
    deleteTrack,
  } = usePlaybackActions();
  const [selectedTrackMenu, setSelectedTrackMenu] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);

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
            if (title === 'Downloader') navigation.navigate('Downloader');
            if (title === 'LRC Checker') navigation.navigate('LrcChecker');
            if (title === 'LRC Synchronizer') navigation.navigate('LrcSynchronizer');
          }}
        />
        <View style={{ marginTop: 26, marginBottom: 12 }}>
          <Text style={{ color: 'white', fontSize: 22, fontWeight: '700', marginHorizontal: 20, marginBottom: 14 }}>
            Recently Added
          </Text>
          {recentlyAddedTracks.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
              {recentlyAddedTracks.map((track) => (
                <RecentlyAddedTrackCard
                  key={track.id}
                  track={track}
                  onPlay={() => playTrack(track, recentlyAddedTracks)}
                  onOpenMenu={(anchor) => setSelectedTrackMenu({ track, anchor })}
                />
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
                Tracks you download or add to your library will appear here.
              </Text>
            )
          )}
        </View>
      </ScrollView>
      {selectedTrackMenu ? (
        <TrackActionsSheet
          key={selectedTrackMenu.track.id}
          track={selectedTrackMenu.track}
          anchor={selectedTrackMenu.anchor}
          visible
          playlists={playlists}
          hasActiveTrack={hasActiveTrack}
          onClose={() => setSelectedTrackMenu(null)}
          onPlayNext={playNext}
          onToggleFavorite={toggleFavorite}
          onAddToPlaylist={addTrackToPlaylist}
          onCreatePlaylist={createPlaylist}
          onSaveTrack={async (track, changes) => { await updateTrack(track, changes); }}
          onDeleteTrack={deleteTrack}
        />
      ) : null}
    </SafeAreaView>
  );
};

const DeveloperProfileScreen = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'DeveloperProfile'>) => {
  const {
    importMusicFolder,
    downloadedTracks,
    deleteDownloadedTracks,
    spicyLyricsEnabled,
    spicyLyricsConfigured,
    spicyLyricsAutoDownloadOverCellular,
    setSpicyLyricsEnabled,
    setSpicyLyricsAutoDownloadOverCellular,
    setSpicyLyricsApiKey,
    lineSyncedWordWaveEnabled,
    setLineSyncedWordWaveEnabled,
  } = usePlaybackActions();
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [isExportingLibrary, setIsExportingLibrary] = useState(false);
  const [isEmptyingLibrary, setIsEmptyingLibrary] = useState(false);
  const [appIconSupported, setAppIconSupported] = useState<boolean | null>(null);
  const [selectedAppIcon, setSelectedAppIcon] = useState<string | null>(null);
  const [appIconChangePending, setAppIconChangePending] = useState(false);
  const [isChangingAppIcon, setIsChangingAppIcon] = useState(false);
  const [spicyLyricsKeyDraft, setSpicyLyricsKeyDraft] = useState('');
  const [isEditingSpicyLyricsKey, setIsEditingSpicyLyricsKey] = useState(false);
  const [isSavingSpicyLyricsKey, setIsSavingSpicyLyricsKey] = useState(false);
  const links = [
    { title: 'GitHub', subtitle: 'github.com/egokam', icon: 'logo-github' as const, url: 'https://github.com/egokam' },
    { title: 'Instagram', subtitle: '@kotmanii', icon: 'logo-instagram' as const, url: 'https://instagram.com/kotmanii' },
    { title: 'Portfolio', subtitle: 'portfolio.egokam.site', icon: 'globe-outline' as const, url: 'https://portfolio.egokam.site' },
  ];

  useFocusEffect(useCallback(() => {
    const iconModule = getAppIconNativeModule();
    const supported = iconModule?.supportsAlternateIcons() ?? false;
    setAppIconSupported(supported);
    if (supported && iconModule) {
      const state = iconModule.getAppIconState();
      setSelectedAppIcon(state.selected);
      setAppIconChangePending(state.isPending);
    }
  }, []));

  const selectAppIcon = async (iconName: string | null) => {
    if (!appIconSupported || isChangingAppIcon) return;
    setIsChangingAppIcon(true);
    try {
      const iconModule = getAppIconNativeModule();
      if (!iconModule?.supportsAlternateIcons()) {
        setAppIconSupported(false);
        return;
      }
      await iconModule.setAppIconAsync(
        iconName,
        Platform.OS === 'android' ? { deferUntilBackground: true } : {},
      );
      const state = iconModule.getAppIconState();
      setSelectedAppIcon(state.selected);
      setAppIconChangePending(state.isPending);
    } catch (error) {
      Alert.alert('Could not change app icon', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsChangingAppIcon(false);
    }
  };

  const showSpicyLyricsKeyHelp = () => {
    Alert.alert(
      'Get a Spicy Lyrics client key',
      'Open the Spicy Lyrics developer dashboard, create or open an application, then enable Client access and create a publishable client key beginning with sl_pk_. For this native app, allow requests without an Origin header in the key’s Client access settings. Never use a secret key beginning with sl_sk_ in the app.',
      [
        { text: 'Close', style: 'cancel' },
        {
          text: 'Open dashboard',
          onPress: () => navigation.navigate('ProfileWeb', {
            title: 'Spicy Lyrics Dashboard',
            url: 'https://developers.spicylyrics.org/dashboard/applications',
          }),
        },
      ],
    );
  };

  const saveSpicyLyricsKey = async () => {
    if (isSavingSpicyLyricsKey || !spicyLyricsKeyDraft.trim()) return;
    setIsSavingSpicyLyricsKey(true);
    try {
      await setSpicyLyricsApiKey(spicyLyricsKeyDraft);
      setSpicyLyricsKeyDraft('');
      setIsEditingSpicyLyricsKey(false);
    } catch (error) {
      Alert.alert('Could not save API key', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSavingSpicyLyricsKey(false);
    }
  };

  const removeSpicyLyricsKey = () => {
    Alert.alert(
      'Delete API key?',
      'Spicy Lyrics will be turned off. Your saved offline lyrics will remain on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete key',
          style: 'destructive',
          onPress: () => {
            setIsSavingSpicyLyricsKey(true);
            void setSpicyLyricsApiKey('')
              .then(() => {
                setSpicyLyricsKeyDraft('');
                setIsEditingSpicyLyricsKey(false);
              })
              .catch((error) => Alert.alert('Could not delete API key', error instanceof Error ? error.message : 'Please try again.'))
              .finally(() => setIsSavingSpicyLyricsKey(false));
          },
        },
      ],
    );
  };

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
        result.exportedCount > 0 ? 'Music.zip exported' : 'No tracks exported',
        result.exportedCount > 0
          ? `${result.fileName} saved with ${result.exportedCount} audio track${result.exportedCount === 1 ? '' : 's'}.${result.metadataEmbeddingSkippedCount ? ` ${result.metadataEmbeddingSkippedCount} non-MP3 track${result.metadataEmbeddingSkippedCount === 1 ? ' may have' : 's may have'} Musiqapp lyrics or cover art that are not embedded in its audio file; those files were exported unchanged.` : ''}`
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
          APP ICON
        </Text>
        <View style={{ borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', padding: 15, marginBottom: 22 }}>
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Choose your app icon</Text>
          <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
            {appIconSupported === false
              ? 'Icon switching needs an installed build; it is not available in Expo Go.'
              : appIconChangePending
                ? 'Selected. Android applies the new icon after you close Musiqapp.'
                : Platform.OS === 'ios'
                  ? 'iOS may ask you to confirm the change.'
                  : 'Choose how Musiqapp appears on your Home Screen.'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 14 }}>
            {APP_ICON_CHOICES.map((choice) => {
              const isSelected = selectedAppIcon === choice.key;
              return (
                <TouchableOpacity
                  key={choice.title}
                  onPress={() => void selectAppIcon(choice.key)}
                  disabled={!appIconSupported || isChangingAppIcon}
                  accessibilityRole="button"
                  accessibilityLabel={`${choice.title} app icon${isSelected ? ', selected' : ''}`}
                  accessibilityState={{ selected: isSelected, disabled: !appIconSupported || isChangingAppIcon }}
                  activeOpacity={0.8}
                  style={{
                    width: '31.5%',
                    minHeight: 112,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 8,
                    borderRadius: 16,
                    backgroundColor: isSelected ? '#2A2023' : '#242427',
                    borderWidth: isSelected ? 1.5 : 1,
                    borderColor: isSelected ? choice.accent : '#36363A',
                    opacity: appIconSupported === false ? 0.52 : isChangingAppIcon && !isSelected ? 0.58 : 1,
                  }}
                >
                  <View style={{ position: 'relative' }}>
                    <Image source={choice.image} resizeMode="cover" style={{ width: 68, height: 68, borderRadius: 15 }} />
                    {isSelected ? (
                      <View style={{ position: 'absolute', top: 4, right: 4, width: 21, height: 21, borderRadius: 11, backgroundColor: choice.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="checkmark" size={14} color="white" />
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={{ color: isSelected ? 'white' : '#C5C5CA', fontSize: 11, fontWeight: isSelected ? '700' : '500', marginTop: 7 }}>
                    {choice.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {isChangingAppIcon ? <ActivityIndicator color="#FA5265" size="small" style={{ marginTop: 13 }} /> : null}
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
          LYRICS
        </Text>
        <View style={{ borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', padding: 15, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="key-outline" size={22} color="#FA5265" />
            </View>
            <View style={{ flex: 1, marginLeft: 13, marginRight: 8 }}>
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Spicy Lyrics API key</Text>
              <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                {spicyLyricsConfigured ? 'Saved securely on this device.' : 'Add a client key to enable online lyrics.'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={showSpicyLyricsKeyHelp}
              accessibilityRole="button"
              accessibilityLabel="How to get a Spicy Lyrics API key"
              hitSlop={8}
              style={{ width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="information-circle-outline" size={22} color="#A1A1A6" />
            </TouchableOpacity>
          </View>
          {isEditingSpicyLyricsKey ? (
            <View style={{ marginTop: 14 }}>
              <TextInput
                value={spicyLyricsKeyDraft}
                onChangeText={setSpicyLyricsKeyDraft}
                placeholder={spicyLyricsConfigured ? 'Enter a replacement sl_pk_ key' : 'Paste your sl_pk_ client key'}
                placeholderTextColor="#77777D"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={!isSavingSpicyLyricsKey}
                accessibilityLabel="Spicy Lyrics publishable client key"
                style={{ minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: '#454549', backgroundColor: '#252527', color: 'white', paddingHorizontal: 14, fontSize: 14 }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 11 }}>
                <TouchableOpacity
                  onPress={() => { setSpicyLyricsKeyDraft(''); setIsEditingSpicyLyricsKey(false); }}
                  disabled={isSavingSpicyLyricsKey}
                  accessibilityRole="button"
                  style={{ minHeight: 42, paddingHorizontal: 13, justifyContent: 'center' }}
                >
                  <Text style={{ color: '#A1A1A6', fontSize: 14, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void saveSpicyLyricsKey()}
                  disabled={isSavingSpicyLyricsKey || !spicyLyricsKeyDraft.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Save Spicy Lyrics API key"
                  style={{ minHeight: 42, borderRadius: 13, backgroundColor: '#FA5265', paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center', opacity: isSavingSpicyLyricsKey || !spicyLyricsKeyDraft.trim() ? 0.55 : 1 }}
                >
                  {isSavingSpicyLyricsKey
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>Save key</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 11 }}>
              {spicyLyricsConfigured ? (
                <TouchableOpacity
                  onPress={removeSpicyLyricsKey}
                  disabled={isSavingSpicyLyricsKey}
                  accessibilityRole="button"
                  accessibilityLabel="Delete Spicy Lyrics API key"
                  style={{ minHeight: 40, borderRadius: 12, backgroundColor: '#292326', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', opacity: isSavingSpicyLyricsKey ? 0.55 : 1 }}
                >
                  <Ionicons name="trash-outline" size={16} color="#FA5265" />
                  <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '600', marginLeft: 6 }}>Delete</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => { setSpicyLyricsKeyDraft(''); setIsEditingSpicyLyricsKey(true); }}
                disabled={isSavingSpicyLyricsKey}
                accessibilityRole="button"
                accessibilityLabel={spicyLyricsConfigured ? 'Edit Spicy Lyrics API key' : 'Add Spicy Lyrics API key'}
                style={{ minHeight: 40, borderRadius: 12, backgroundColor: '#2A171C', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons name={spicyLyricsConfigured ? 'pencil-outline' : 'add'} size={17} color="#FA5265" />
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700', marginLeft: 6 }}>{spicyLyricsConfigured ? 'Edit key' : 'Add key'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ minHeight: 100, borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', paddingHorizontal: 16, paddingVertical: 15, marginBottom: 8, flexDirection: 'row', alignItems: 'center', opacity: spicyLyricsConfigured ? 1 : 0.62 }}>
          <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="musical-notes" size={22} color="#FA5265" />
          </View>
          <View style={{ flex: 1, marginLeft: 13, marginRight: 10 }}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Spicy Lyrics</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              {spicyLyricsConfigured
                ? 'Check the lyrics catalog in the background and keep results available offline for up to 30 days.'
                : 'Unavailable until you add a client API key above.'}
            </Text>
          </View>
          <Switch
            value={spicyLyricsEnabled}
            onValueChange={setSpicyLyricsEnabled}
            disabled={!spicyLyricsConfigured}
            trackColor={{ false: spicyLyricsConfigured ? '#48484A' : '#333337', true: '#FA5265' }}
            thumbColor="#FFFFFF"
            accessibilityState={{ disabled: !spicyLyricsConfigured }}
            accessibilityLabel="Enable Spicy Lyrics lookup and the 30-day offline lyrics cache"
          />
        </View>
        <View style={{ borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', padding: 15, marginBottom: 8, opacity: spicyLyricsConfigured && spicyLyricsEnabled ? 1 : 0.5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="cloud-download-outline" size={21} color="#FA5265" />
            </View>
            <View style={{ flex: 1, marginLeft: 13 }}>
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Automatic lyrics downloads</Text>
              <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                Choose whether API lyrics can be saved over cellular data.
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}>
            {([
              { title: 'Wi-Fi only', icon: 'wifi-outline' as const, overCellular: false },
              { title: 'Over cellular', icon: 'cellular-outline' as const, overCellular: true },
            ]).map((option) => {
              const isSelected = spicyLyricsAutoDownloadOverCellular === option.overCellular;
              const isEnabled = spicyLyricsConfigured && spicyLyricsEnabled;
              return (
                <TouchableOpacity
                  key={option.title}
                  onPress={() => setSpicyLyricsAutoDownloadOverCellular(option.overCellular)}
                  disabled={!isEnabled}
                  accessibilityRole="radio"
                  accessibilityState={{ disabled: !isEnabled, selected: isSelected }}
                  accessibilityLabel={`Automatic lyrics downloads: ${option.title}`}
                  activeOpacity={0.75}
                  style={{ flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: isSelected ? '#FA5265' : '#3A3A3E', backgroundColor: isSelected ? '#3A2026' : '#252527', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                >
                  <Ionicons name={option.icon} size={16} color={isSelected ? '#FA5265' : '#A1A1A6'} />
                  <Text style={{ color: isSelected ? 'white' : '#A1A1A6', fontSize: 13, fontWeight: isSelected ? '700' : '600' }}>{option.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('ApiLyrics')}
          accessibilityRole="button"
          accessibilityLabel="Manage downloaded API lyrics"
          activeOpacity={0.78}
          style={{ minHeight: 76, borderRadius: 18, backgroundColor: '#1C1C1E', paddingHorizontal: 16, marginTop: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}
        >
          <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="cloud-download-outline" size={21} color="#FA5265" />
          </View>
          <View style={{ flex: 1, marginLeft: 13, marginRight: 10 }}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Manage downloaded lyrics</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              Renew API lyrics or ignore them to use your local lyrics.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#8E8E93" />
        </TouchableOpacity>
        <View style={{ minHeight: 100, borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', paddingHorizontal: 16, paddingVertical: 15, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="pulse" size={22} color="#FA5265" />
          </View>
          <View style={{ flex: 1, marginLeft: 13, marginRight: 10 }}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Line-synced word wave</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              Animate line-synced lyrics with a moving word highlight. Word-timed lyrics stay animated.
            </Text>
          </View>
          <Switch
            value={lineSyncedWordWaveEnabled}
            onValueChange={setLineSyncedWordWaveEnabled}
            trackColor={{ false: '#48484A', true: '#FA5265' }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Animate line-synced lyrics with the word wave"
          />
        </View>

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
                    ? `${result.importedCount} track${result.importedCount === 1 ? '' : 's'} copied into your private Musiqapp library. Embedded lyrics found on ${result.embeddedLyricsCount} track${result.embeddedLyricsCount === 1 ? '' : 's'}; artwork found on ${result.artworkCount}.${result.skippedCount ? ` ${result.skippedCount} unsupported file${result.skippedCount === 1 ? '' : 's'} skipped.` : ''}`
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
              Import tracks with embedded lyrics and artwork. LRC, TTML, and TXT sidecars are supported as a fallback.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color="#FA5265" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => void exportLibrary()}
          disabled={isExportingLibrary}
          accessibilityRole="button"
          accessibilityLabel="Export audio tracks as Music.zip"
          style={{ minHeight: 112, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#3A3A3E', paddingHorizontal: 18, paddingVertical: 17, marginTop: 12, flexDirection: 'row', alignItems: 'center', opacity: isExportingLibrary ? 0.65 : 1 }}
        >
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: '#FA243C', alignItems: 'center', justifyContent: 'center' }}>
            {isExportingLibrary ? <ActivityIndicator color="white" /> : <Ionicons name="download-outline" size={28} color="white" />}
          </View>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>Export Music.zip</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 13, lineHeight: 18, marginTop: 5 }}>
              Export audio files only, with lyrics and artwork embedded in MP3 copies.
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
          Version {Constants.expoConfig?.version ?? '2.0.1'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

type ApiLyricsRow = {
  track: Track;
  entry: SpicyLyricsCacheEntry | null;
  ignored: boolean;
};

const hasCachedApiLyrics = (entry: SpicyLyricsCacheEntry | null): entry is SpicyLyricsCacheEntry => Boolean(
  entry && !entry.noLyrics && (entry.syncedLyrics || entry.plainLyrics || entry.lyrics?.length),
);

const ApiLyricsScreen = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'ApiLyrics'>) => {
  const {
    downloadedTracks,
    setSpicyLyricsIgnored,
    spicyLyricsConfigured,
    spicyLyricsEnabled,
  } = usePlaybackActions();
  const [rows, setRows] = useState<ApiLyricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [busyTrackAction, setBusyTrackAction] = useState<'check' | 'renew' | null>(null);
  const [busyAction, setBusyAction] = useState<'check-all' | 'renew-all' | 'renew-selected' | 'ignore-selected' | 'undo-ignore-selected' | null>(null);
  const [checkProgress, setCheckProgress] = useState<{ completed: number; total: number } | null>(null);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const canCheckOnline = spicyLyricsConfigured && spicyLyricsEnabled;
  const actionsBusy = Boolean(busyAction || busyTrackId);

  const loadRows = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [entries, ignoredIds] = await Promise.all([
        MusicCatalogService.getCachedSpicyLyricsEntries(downloadedTracks),
        OfflineMusicService.getSpicyLyricsIgnoredTrackIds(),
      ]);
      const entriesById = new Map(entries.map(({ trackId, entry }) => [trackId, entry]));
      const ignoredTrackIds = new Set(ignoredIds);
      const nextRows = downloadedTracks.map((track) => {
        const entry = entriesById.get(track.id) ?? null;
        const ignored = ignoredTrackIds.has(track.id);
        return { track, entry, ignored };
      });
      nextRows.sort((first, second) => {
        const firstRank = hasCachedApiLyrics(first.entry) ? 0 : first.entry ? 1 : 2;
        const secondRank = hasCachedApiLyrics(second.entry) ? 0 : second.entry ? 1 : 2;
        if (firstRank !== secondRank) return firstRank - secondRank;
        if (firstRank === 0 && first.entry && second.entry && first.entry.cachedAt !== second.entry.cachedAt) {
          return second.entry.cachedAt - first.entry.cachedAt;
        }
        return first.track.title.localeCompare(second.track.title);
      });
      setRows(nextRows);
    } catch {
      setMessage('Could not load saved API lyrics. Pull to retry or reopen this page.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [downloadedTracks]);

  useFocusEffect(useCallback(() => {
    void loadRows();
  }, [loadRows]));

  const renewLyrics = async (row: ApiLyricsRow) => {
    if (actionsBusy) return;
    setBusyTrackId(row.track.id);
    setBusyTrackAction('renew');
    setMessage('');
    try {
      const renewed = await MusicCatalogService.renewSpicyLyrics(row.track);
      if (!renewed) throw new Error('The lyrics could not be renewed. Check your connection and the Spicy Lyrics setting.');
      await loadRows(false);
      setMessage(`${row.track.title} is renewed for another 30 days.`);
    } catch (error) {
      Alert.alert('Could not renew lyrics', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally {
      setBusyTrackId(null);
      setBusyTrackAction(null);
    }
  };

  const showCheckUnavailable = () => {
    const detail = !spicyLyricsConfigured
      ? 'Add a Spicy Lyrics client key in Profile first.'
      : 'Turn on Spicy Lyrics in Profile to search online.';
    Alert.alert('Online lyric checks are unavailable', detail);
  };

  const checkLyrics = async (row: ApiLyricsRow) => {
    if (actionsBusy) return;
    if (!canCheckOnline) {
      showCheckUnavailable();
      return;
    }
    setBusyTrackId(row.track.id);
    setBusyTrackAction('check');
    setMessage('');
    try {
      const found = await MusicCatalogService.checkSpicyLyrics(row.track);
      await loadRows(false);
      setMessage(found
        ? `API lyrics found and saved for ${row.track.title}.`
        : `No API lyrics were found for ${row.track.title}.`);
    } catch (error) {
      Alert.alert('Could not check lyrics', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally {
      setBusyTrackId(null);
      setBusyTrackAction(null);
    }
  };

  const checkTracks = async (tracksToCheck: Track[]) => {
    if (actionsBusy) return;
    if (!canCheckOnline) {
      showCheckUnavailable();
      return;
    }
    const uniqueTracks = [...new Map(tracksToCheck.map((track) => [track.id, track])).values()];
    setMenuOpen(false);
    if (uniqueTracks.length === 0) {
      setMessage('There are no tracks to check.');
      return;
    }

    setBusyAction('check-all');
    setCheckProgress({ completed: 0, total: uniqueTracks.length });
    setMessage('');
    let foundCount = 0;
    let noLyricsCount = 0;
    let failedCount = 0;

    for (let index = 0; index < uniqueTracks.length; index += 1) {
      const track = uniqueTracks[index];
      try {
        if (await MusicCatalogService.checkSpicyLyrics(track)) foundCount += 1;
        else noLyricsCount += 1;
      } catch {
        failedCount += 1;
      }
      setCheckProgress({ completed: index + 1, total: uniqueTracks.length });
    }

    await loadRows(false);
    setBusyAction(null);
    setCheckProgress(null);
    setMessage(
      `Checked ${uniqueTracks.length} track${uniqueTracks.length === 1 ? '' : 's'}: ${foundCount} with API lyrics, ${noLyricsCount} without${failedCount ? `, ${failedCount} could not be checked` : ''}.`,
    );
  };

  const toggleIgnore = async (row: ApiLyricsRow, ignored: boolean) => {
    if (actionsBusy) return;
    setBusyTrackId(row.track.id);
    setMessage('');
    try {
      await setSpicyLyricsIgnored(row.track.id, ignored);
      await loadRows(false);
      setMessage(ignored
        ? `API lyrics ignored for ${row.track.title}. Local lyrics will be used.`
        : `API lyrics enabled again for ${row.track.title}.`);
    } catch (error) {
      Alert.alert('Could not update lyrics preference', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyTrackId(null);
    }
  };

  const cacheStatus = (row: ApiLyricsRow) => {
    if (!hasCachedApiLyrics(row.entry)) {
      return row.entry ? 'Checked · no API lyrics found' : 'Not checked';
    }
    const expiresAt = row.entry.cachedAt + SPICY_LYRICS_CACHE_MAX_AGE_MS;
    const precision = row.entry.precision === 'syllable'
      ? 'Word-synced'
      : row.entry.precision === 'line'
        ? 'Line-synced'
        : 'Static';
    return `${precision} · expires ${new Date(expiresAt).toLocaleDateString()}`;
  };

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return rows;
    return rows.filter(({ track }) => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, rows]);

  const selectedRows = useMemo(
    () => rows.filter(({ track }) => selectedTrackIds.has(track.id)),
    [rows, selectedTrackIds],
  );
  const selectedLyricsRows = useMemo(() => selectedRows.filter((row) => hasCachedApiLyrics(row.entry)), [selectedRows]);
  const selectedNotIgnoredRows = useMemo(() => selectedRows.filter((row) => !row.ignored), [selectedRows]);
  const selectedIgnoredRows = useMemo(() => selectedRows.filter((row) => row.ignored), [selectedRows]);
  const allFilteredRowsSelected = filteredRows.length > 0 && filteredRows.every(({ track }) => selectedTrackIds.has(track.id));

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTrackIds(new Set());
  };

  const toggleSelected = (trackId: string) => {
    setSelectedTrackIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedTrackIds((current) => {
      const next = new Set(current);
      if (allFilteredRowsSelected) filteredRows.forEach(({ track }) => next.delete(track.id));
      else filteredRows.forEach(({ track }) => next.add(track.id));
      return next;
    });
  };

  const renewAll = async () => {
    if (actionsBusy) return;
    const trackIds = rows.filter((row) => !row.ignored && hasCachedApiLyrics(row.entry)).map((row) => row.track.id);
    setMenuOpen(false);
    if (trackIds.length === 0) {
      setMessage('There are no active API lyrics to renew.');
      return;
    }
    setBusyAction('renew-all');
    setMessage('');
    try {
      const renewedCount = await OfflineMusicService.renewSpicyLyricsCaches(trackIds);
      await loadRows(false);
      setMessage(`${renewedCount} track${renewedCount === 1 ? '' : 's'} renewed for another 30 days.`);
    } catch (error) {
      Alert.alert('Could not renew lyrics', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const renewSelected = async () => {
    if (actionsBusy || selectedLyricsRows.length === 0) return;
    setBusyAction('renew-selected');
    setMessage('');
    let renewedCount = 0;
    for (const row of selectedLyricsRows) {
      try {
        if (await MusicCatalogService.renewSpicyLyrics(row.track)) renewedCount += 1;
      } catch {
        // Continue so one unavailable track does not stop the remaining renewals.
      }
    }
    await loadRows(false);
    setBusyAction(null);
    leaveSelectionMode();
    if (renewedCount === selectedLyricsRows.length) {
      setMessage(`${renewedCount} track${renewedCount === 1 ? '' : 's'} renewed for another 30 days.`);
    } else {
      Alert.alert('Some lyrics could not be renewed', `${renewedCount} of ${selectedLyricsRows.length} selected tracks were renewed. Check your connection and Spicy Lyrics settings.`);
    }
  };

  const ignoreSelected = async () => {
    if (actionsBusy || selectedNotIgnoredRows.length === 0) return;
    setBusyAction('ignore-selected');
    setMessage('');
    try {
      for (const row of selectedNotIgnoredRows) await setSpicyLyricsIgnored(row.track.id, true);
      await loadRows(false);
      setMessage(`API lyrics ignored for ${selectedNotIgnoredRows.length} track${selectedNotIgnoredRows.length === 1 ? '' : 's'}. Local lyrics will be used.`);
    } catch (error) {
      Alert.alert('Could not ignore lyrics', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyAction(null);
      leaveSelectionMode();
    }
  };

  const undoIgnoreSelected = async () => {
    if (actionsBusy || selectedIgnoredRows.length === 0) return;
    setBusyAction('undo-ignore-selected');
    setMessage('');
    try {
      for (const row of selectedIgnoredRows) await setSpicyLyricsIgnored(row.track.id, false);
      await loadRows(false);
      setMessage(`API lyrics enabled again for ${selectedIgnoredRows.length} track${selectedIgnoredRows.length === 1 ? '' : 's'}.`);
    } catch (error) {
      Alert.alert('Could not restore API lyrics', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyAction(null);
      leaveSelectionMode();
    }
  };

  const openCheckAllOptions = () => {
    setMenuOpen(false);
    if (!canCheckOnline) {
      showCheckUnavailable();
      return;
    }
    const tracksWithoutApiLyrics = rows.filter((row) => !hasCachedApiLyrics(row.entry)).map((row) => row.track);
    Alert.alert(
      'Check API lyrics',
      'Choose whether to refresh every track or only look up tracks without saved API lyrics.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Only tracks without API lyrics', onPress: () => void checkTracks(tracksWithoutApiLyrics) },
        { text: 'Recheck all tracks', onPress: () => void checkTracks(rows.map((row) => row.track)) },
      ],
    );
  };

  const listHeader = (
    <View>
      <Text style={{ color: 'white', fontSize: 28, fontWeight: '800', marginBottom: 6 }}>API lyrics</Text>
      <Text style={{ color: '#A1A1A6', fontSize: 14, lineHeight: 20, marginBottom: 13 }}>
        Check your library, keep API lyrics available offline for 30 days, or ignore them to use lyrics from your files.
      </Text>
      {!canCheckOnline ? (
        <View style={{ borderRadius: 14, backgroundColor: '#211A1C', paddingHorizontal: 13, paddingVertical: 11, marginBottom: 14 }}>
          <Text style={{ color: '#D8B5BA', fontSize: 12, lineHeight: 17 }}>
            {!spicyLyricsConfigured ? 'Add a Spicy Lyrics key in Profile to check tracks.' : 'Turn on Spicy Lyrics in Profile to check tracks.'}
          </Text>
        </View>
      ) : null}

      <View style={{ minHeight: 50, borderRadius: 16, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <Ionicons name="search" size={20} color="#A1A1A6" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library"
          placeholderTextColor="#77777D"
          returnKeyType="search"
          accessibilityLabel="Search library tracks"
          style={{ flex: 1, color: 'white', fontSize: 15, paddingVertical: 11, marginLeft: 10 }}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
            <Ionicons name="close-circle" size={19} color="#77777D" />
          </TouchableOpacity>
        ) : null}
      </View>

      {selectionMode ? (
        <View style={{ marginBottom: 16, padding: 11, borderRadius: 16, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: '#A1A1A6', fontSize: 13, fontWeight: '600', marginHorizontal: 4 }}>
              {selectedRows.length ? `${selectedRows.length} selected` : 'Select tracks to manage'}
            </Text>
            <TouchableOpacity onPress={leaveSelectionMode} disabled={actionsBusy} accessibilityRole="button" accessibilityLabel="Cancel selection" style={{ paddingHorizontal: 9, paddingVertical: 6 }}>
              <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={toggleSelectAllFiltered}
            disabled={actionsBusy || filteredRows.length === 0}
            accessibilityRole="checkbox"
            accessibilityLabel="Select all matching tracks"
            accessibilityState={{ checked: allFilteredRowsSelected, disabled: actionsBusy || filteredRows.length === 0 }}
            style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, opacity: filteredRows.length ? 1 : 0.5 }}
          >
            <Ionicons name={allFilteredRowsSelected ? 'checkbox' : 'square-outline'} size={20} color={allFilteredRowsSelected ? '#FA5265' : '#A1A1A6'} />
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600', marginLeft: 9 }}>
              Select all{query.trim() ? ' matching tracks' : ' tracks'} ({filteredRows.length})
            </Text>
          </TouchableOpacity>
          {selectedRows.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <TouchableOpacity onPress={() => void renewSelected()} disabled={actionsBusy || selectedLyricsRows.length === 0} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#2A171C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy || selectedLyricsRows.length === 0 ? 0.45 : 1 }}>
                {busyAction === 'renew-selected' ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="refresh-outline" size={17} color="#FA5265" />}
                <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Renew</Text>
              </TouchableOpacity>
              {selectedNotIgnoredRows.length > 0 ? (
                <TouchableOpacity onPress={() => void ignoreSelected()} disabled={actionsBusy} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#2A171C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.45 : 1 }}>
                  {busyAction === 'ignore-selected' ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="eye-off-outline" size={17} color="#FA5265" />}
                  <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Ignore</Text>
                </TouchableOpacity>
              ) : null}
              {selectedIgnoredRows.length > 0 ? (
                <TouchableOpacity onPress={() => void undoIgnoreSelected()} disabled={actionsBusy} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#202024', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.45 : 1 }}>
                  {busyAction === 'undo-ignore-selected' ? <ActivityIndicator size="small" color="#D1D1D6" /> : <Ionicons name="eye-outline" size={17} color="#D1D1D6" />}
                  <Text style={{ color: '#D1D1D6', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Undo ignore</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {message ? (
        <Text accessibilityLiveRegion="polite" style={{ color: '#A1A1A6', fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
          {message}
        </Text>
      ) : null}
      {checkProgress ? (
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <ActivityIndicator size="small" color="#FA5265" />
          <Text style={{ color: '#A1A1A6', fontSize: 13, marginLeft: 10 }}>
            Checking API lyrics · {checkProgress.completed} of {checkProgress.total}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderApiLyricsRow = ({ item: row }: { item: ApiLyricsRow }) => {
    const isBusy = busyTrackId === row.track.id;
    const isChecking = isBusy && busyTrackAction === 'check';
    const isRenewing = isBusy && busyTrackAction === 'renew';
    const selected = selectedTrackIds.has(row.track.id);
    const hasApiLyrics = hasCachedApiLyrics(row.entry);

    return (
      <View style={{ borderRadius: 20, backgroundColor: selected ? '#241A1D' : '#1C1C1E', borderWidth: 1, borderColor: selected ? '#71303A' : '#36363A', padding: 14, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {selectionMode ? (
            <TouchableOpacity
              onPress={() => toggleSelected(row.track.id)}
              accessibilityRole="checkbox"
              accessibilityLabel={`Select ${row.track.title}`}
              accessibilityState={{ checked: selected }}
              style={{ width: 32, height: 58, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
            >
              <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={selected ? '#FA5265' : '#77777D'} />
            </TouchableOpacity>
          ) : null}
          <View style={{ width: 58, height: 58, borderRadius: 13, overflow: 'hidden', backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
            {row.track.artwork ? (
              <Image
                source={{ uri: row.track.artwork, ...(row.track.artwork.startsWith('http') ? { headers: getMusicApiHeaders() } : {}) }}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : <Ionicons name="musical-notes" size={23} color="#FA5265" />}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>{row.track.title}</Text>
            <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 13, marginTop: 3 }}>{row.track.artist}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: hasApiLyrics ? '#30D158' : '#737378', marginRight: 6 }} />
              <Text numberOfLines={1} style={{ flex: 1, color: hasApiLyrics ? '#A1A1A6' : '#85858B', fontSize: 11 }}>{cacheStatus(row)}</Text>
            </View>
          </View>
        </View>

        {!selectionMode ? (
          <View style={{ marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#333337' }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => void checkLyrics(row)}
                disabled={actionsBusy || !canCheckOnline}
                accessibilityRole="button"
                accessibilityLabel={`Check API lyrics for ${row.track.title}`}
                style={{ flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: '#2A171C', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy || !canCheckOnline ? 0.48 : 1 }}
              >
                {isChecking ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="search-outline" size={17} color="#FA5265" />}
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700', marginLeft: 6 }}>Check</Text>
              </TouchableOpacity>
              {hasApiLyrics ? (
                <TouchableOpacity
                  onPress={() => void renewLyrics(row)}
                  disabled={actionsBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`Renew API lyrics for ${row.track.title}`}
                  style={{ flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: '#2A171C', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.48 : 1 }}
                >
                  {isRenewing ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="refresh-outline" size={17} color="#FA5265" />}
                  <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700', marginLeft: 6 }}>Renew</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={{ minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
              <Text style={{ color: row.ignored ? '#FA5265' : '#A1A1A6', fontSize: 13, fontWeight: '600' }}>
                {row.ignored ? 'Ignore API' : 'Use API lyrics'}
              </Text>
              <Switch
                value={row.ignored}
                onValueChange={(ignored) => void toggleIgnore(row, ignored)}
                disabled={actionsBusy}
                trackColor={{ false: '#48484A', true: '#FA5265' }}
                thumbColor="#FFFFFF"
                accessibilityLabel={row.ignored
                  ? `Use API lyrics for ${row.track.title}`
                  : `Ignore API lyrics for ${row.track.title}`}
              />
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top', 'bottom']}>
      <View style={{ height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={navigation.goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to profile"
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={23} color="white" />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: 'white', fontSize: 17, fontWeight: '700', textAlign: 'center' }}>
          Downloaded lyrics
        </Text>
        <TouchableOpacity
          onPress={() => setMenuOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Downloaded lyrics options"
          accessibilityState={{ expanded: menuOpen }}
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredRows}
        keyExtractor={(row) => row.track.id}
        renderItem={renderApiLyricsRow}
        extraData={{ selectedTrackIds, selectionMode, busyTrackId, busyTrackAction, rows }}
        ListHeaderComponent={listHeader}
        refreshing={loading}
        onRefresh={() => void loadRows()}
        ListEmptyComponent={loading ? (
          <View style={{ paddingVertical: 56, alignItems: 'center' }}>
            <ActivityIndicator color="#FA5265" size="large" />
            <Text style={{ color: '#8E8E93', fontSize: 14, marginTop: 14 }}>Loading your library…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={{ minHeight: 220, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#36363A', padding: 24, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 58, height: 58, borderRadius: 20, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Ionicons name="musical-notes-outline" size={27} color="#FA5265" />
            </View>
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Your library is empty</Text>
            <Text style={{ color: '#8E8E93', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7 }}>
              Tracks added to your library will appear here so you can check their API lyrics.
            </Text>
          </View>
        ) : query.trim() ? (
          <View style={{ paddingVertical: 44, alignItems: 'center' }}>
            <Ionicons name="search-outline" size={30} color="#77777D" />
            <Text style={{ color: '#A1A1A6', fontSize: 15, marginTop: 10 }}>No matching tracks</Text>
          </View>
        ) : undefined}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 170, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      {menuOpen ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
          <TouchableOpacity onPress={() => setMenuOpen(false)} activeOpacity={1} accessibilityLabel="Close options" style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', top: 62, right: 18, width: 240, borderRadius: 16, backgroundColor: '#252527', borderWidth: 1, borderColor: '#454549', padding: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
            <TouchableOpacity onPress={() => void renewAll()} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.5 : 1 }}>
              {busyAction === 'renew-all' ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="refresh-outline" size={19} color="#FA5265" />}
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '600', marginLeft: 10 }}>Renew all</Text>
            </TouchableOpacity>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: '#454549', marginHorizontal: 7 }} />
            <TouchableOpacity onPress={openCheckAllOptions} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.5 : 1 }}>
              {busyAction === 'check-all' ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="search-outline" size={19} color="#FA5265" />}
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '600', marginLeft: 10 }}>Check all</Text>
            </TouchableOpacity>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: '#454549', marginHorizontal: 7 }} />
            <TouchableOpacity onPress={() => { setMenuOpen(false); setSelectionMode(true); setSelectedTrackIds(new Set()); }} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.5 : 1 }}>
              <Ionicons name="checkbox-outline" size={19} color="#D1D1D6" />
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '600', marginLeft: 10 }}>Select</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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

const DownloaderRoute = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'Downloader'>) => {
  const { importAudioToLibrary, importLocalAudioFile } = usePlaybackActions();

  return (
    <DownloaderScreen
      onBack={() => navigation.goBack()}
      onImportAudioToLibrary={importAudioToLibrary}
      onImportLocalAudioFile={importLocalAudioFile}
    />
  );
};

const LrcCheckerRoute = ({
  navigation,
}: NativeStackScreenProps<LibraryStackParamList, 'LrcChecker'>) => {
  const {
    tracks,
    isLoadingTracks,
    loadAllTracks,
    checkTrackLyrics,
    saveTrackLyrics,
  } = usePlaybackActions();

  return (
    <LrcCheckerScreen
      onBack={() => navigation.goBack()}
      tracks={tracks}
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
    <Stack.Screen name="ApiLyrics" component={ApiLyricsScreen} />
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
    <Stack.Screen name="Downloader" component={DownloaderRoute} />
    <Stack.Screen name="LrcChecker" component={LrcCheckerRoute} />
    <Stack.Screen name="LrcSynchronizer" component={LrcSynchronizerRoute} />
  </Stack.Navigator>
);
