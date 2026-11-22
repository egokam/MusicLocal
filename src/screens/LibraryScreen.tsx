import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Keyboard, Platform, StyleSheet, Switch, type ImageSourcePropType } from 'react-native';
import { ThemedSafeAreaView as SafeAreaView, ThemedPressable as Pressable, ThemedScrollView as ScrollView, ThemedTouchableOpacity as TouchableOpacity, ThemedIcon as ThemedIonicons, ThemedActivityIndicator as ActivityIndicator, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, useAppearanceTheme, type AppearanceMode } from '../contexts/AppearanceThemeContext';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Directory } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import { GlassSurface } from '../../glass';
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
  ProfileSettings: undefined;
  AppIconPicker: undefined;
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

const APP_ICON_GROUPS: { title: string; choices: { key: string | null; title: string; image: ImageSourcePropType }[] }[] = [
  { title: 'Classic', choices: [{ key: null, title: 'Original', image: require('../../assets/icon.png') }] },
  {
    title: 'Modern',
    choices: [
      { key: 'amber', title: 'Amber', image: require('../../assets/icons/amber.png') },
      { key: 'forest', title: 'Forest', image: require('../../assets/icons/forest.png') },
      { key: 'midnight', title: 'Midnight', image: require('../../assets/icons/midnight.png') },
      { key: 'ocean', title: 'Ocean', image: require('../../assets/icons/ocean.png') },
      { key: 'violet', title: 'Violet', image: require('../../assets/icons/violet.png') },
      { key: 'ios27', title: 'ios27', image: require('../../assets/icons/ios27.png') },
    ],
  },
];

type AppIconNativeModule = {
  supportsAlternateIcons: () => boolean;
  getAppIconState: () => { selected: string | null; isPending: boolean };
  setAppIconAsync: (iconName: string | null, options?: { deferUntilBackground?: boolean }) => Promise<void>;
};

const getAppIconNativeModule = () =>
  requireOptionalNativeModule<AppIconNativeModule>('AwesomeAppIcon');

const useAppIconSelection = () => {
  const [appIconSupported, setAppIconSupported] = useState<boolean | null>(null);
  const [selectedAppIcon, setSelectedAppIcon] = useState<string | null>(null);
  const [appIconChangePending, setAppIconChangePending] = useState(false);
  const [isChangingAppIcon, setIsChangingAppIcon] = useState(false);

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

  const selectAppIcon = useCallback(async (iconName: string | null) => {
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
  }, [appIconSupported, isChangingAppIcon]);

  return { appIconSupported, selectedAppIcon, appIconChangePending, isChangingAppIcon, selectAppIcon };
};

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
  const { colors } = useAppearanceTheme();
  const [selectedTrackMenu, setSelectedTrackMenu] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);
  const libraryScrollY = useMemo(() => new Animated.Value(0), []);
  const libraryTopFadeOpacity = libraryScrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const libraryScrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: libraryScrollY } } }], { useNativeDriver: true }),
    [libraryScrollY],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 190 }}
        onScroll={libraryScrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
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
      </Animated.ScrollView>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -24,
          left: 0,
          right: 0,
          height: 170,
          zIndex: 15,
          elevation: 15,
          opacity: libraryTopFadeOpacity,
        }}
      >
        <LinearGradient
          colors={colors.scrollFade}
          locations={[0, 0.32, 0.68, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
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

const DeveloperProfileContent = ({
  navigation,
  settingsOnly,
}: {
  navigation: NativeStackScreenProps<LibraryStackParamList, 'DeveloperProfile' | 'ProfileSettings'>['navigation'];
  settingsOnly: boolean;
}) => {
  const { colors, mode, setMode, isDark } = useAppearanceTheme();
  const {
    importMusicFolder,
    downloadedTracks,
    deleteDownloadedTracks,
    spicyLyricsEnabled,
    spicyLyricsConfigured,
    spicyLyricsAutoDownloadOverCellular,
    apiInitializing,
    setSpicyLyricsEnabled,
    setSpicyLyricsAutoDownloadOverCellular,
    setSpicyLyricsApiKey,
    lineSyncedWordWaveEnabled,
    setLineSyncedWordWaveEnabled,
  } = usePlaybackActions();
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [isExportingLibrary, setIsExportingLibrary] = useState(false);
  const [isEmptyingLibrary, setIsEmptyingLibrary] = useState(false);
  const [spicyLyricsKeyDraft, setSpicyLyricsKeyDraft] = useState('');
  const [isSavingSpicyLyricsKey, setIsSavingSpicyLyricsKey] = useState(false);
  const showSpicyLyricsKeyEntry = spicyLyricsEnabled || spicyLyricsConfigured;
  // Seed from persisted state so returning to Settings does not replay the reveal.
  const [spicyLyricsKeyEntryProgress] = useState(() => new Animated.Value(showSpicyLyricsKeyEntry ? 1 : 0));
  const [lyricsExtrasProgress] = useState(() => new Animated.Value(spicyLyricsConfigured ? 1 : 0));
  const [lyricsExtrasOpacity] = useState(() => new Animated.Value(
    !spicyLyricsConfigured ? 0 : spicyLyricsEnabled ? 1 : 0.45,
  ));
  const lyricsSettingsAnimationReady = useRef(!apiInitializing);
  const settingSurface = isDark ? '#0D0D0A' : colors.surface;
  const settingBorder = isDark ? '#191916' : colors.separator;
  const settingInset = isDark ? '#171714' : '#FFFFFF';
  const lyricAccentSurface = isDark ? '#261317' : '#FCE9EC';
  const profileScrollY = useMemo(() => new Animated.Value(0), []);
  const profileTopFadeOpacity = profileScrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const profileScrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: profileScrollY } } }], { useNativeDriver: true }),
    [profileScrollY],
  );
  useLayoutEffect(() => {
    if (apiInitializing || lyricsSettingsAnimationReady.current) return;

    // SecureStore restores the verified key asynchronously. Snap to that saved
    // state before the first paint; only later user changes should animate.
    lyricsSettingsAnimationReady.current = true;
    spicyLyricsKeyEntryProgress.setValue(showSpicyLyricsKeyEntry ? 1 : 0);
    lyricsExtrasProgress.setValue(spicyLyricsConfigured ? 1 : 0);
    lyricsExtrasOpacity.setValue(!spicyLyricsConfigured ? 0 : spicyLyricsEnabled ? 1 : 0.45);
  }, [
    apiInitializing,
    lyricsExtrasOpacity,
    lyricsExtrasProgress,
    spicyLyricsConfigured,
    spicyLyricsEnabled,
    spicyLyricsKeyEntryProgress,
    showSpicyLyricsKeyEntry,
  ]);
  useEffect(() => {
    if (apiInitializing || !lyricsSettingsAnimationReady.current) return;
    if (!spicyLyricsConfigured) {
      lyricsExtrasProgress.setValue(0);
      return;
    }

    const entrance = Animated.parallel([
      Animated.timing(lyricsExtrasProgress, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
        isInteraction: false,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [apiInitializing, lyricsExtrasProgress, spicyLyricsConfigured]);
  useEffect(() => {
    if (apiInitializing || !lyricsSettingsAnimationReady.current) return;
    const entrance = Animated.timing(spicyLyricsKeyEntryProgress, {
      toValue: showSpicyLyricsKeyEntry ? 1 : 0,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
      isInteraction: false,
    });
    entrance.start();
    return () => entrance.stop();
  }, [apiInitializing, showSpicyLyricsKeyEntry, spicyLyricsKeyEntryProgress]);
  useEffect(() => {
    if (apiInitializing || !lyricsSettingsAnimationReady.current) return;
    const targetOpacity = !spicyLyricsConfigured ? 0 : spicyLyricsEnabled ? 1 : 0.45;
    const animation = Animated.timing(lyricsExtrasOpacity, {
      toValue: targetOpacity,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [apiInitializing, lyricsExtrasOpacity, spicyLyricsConfigured, spicyLyricsEnabled]);
  const links = [
    { title: 'GitHub', icon: 'logo-github' as const, url: 'https://github.com/egokam' },
    { title: 'Instagram', icon: 'logo-instagram' as const, url: 'https://instagram.com/kotmanii' },
    { title: 'Portfolio', icon: 'briefcase-outline' as const, url: 'https://portfolio.egokam.site' },
  ];
  const appearanceOptions: { mode: AppearanceMode; title: string; icon: 'contrast-outline' | 'sunny-outline' | 'moon-outline' }[] = [
    { mode: 'automatic', title: 'Automatic', icon: 'contrast-outline' },
    { mode: 'light', title: 'Light', icon: 'sunny-outline' },
    { mode: 'dark', title: 'Dark', icon: 'moon-outline' },
  ];

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
      try {
        await MusicCatalogService.validateSpicyLyricsClientKey(spicyLyricsKeyDraft);
      } catch (error) {
        Alert.alert('Could not verify API key', error instanceof Error ? error.message : 'Please check the key and try again.');
        return;
      }
      await setSpicyLyricsApiKey(spicyLyricsKeyDraft);
      setSpicyLyricsKeyDraft('');
      Keyboard.dismiss();
    } catch (error) {
      Alert.alert('Could not save API key', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSavingSpicyLyricsKey(false);
    }
  };

  const removeSpicyLyricsKey = async () => {
    if (isSavingSpicyLyricsKey) return;
    setIsSavingSpicyLyricsKey(true);
    try {
      await setSpicyLyricsApiKey('');
      setSpicyLyricsKeyDraft('');
      Keyboard.dismiss();
    } catch (error) {
      Alert.alert('Could not delete API key', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSavingSpicyLyricsKey(false);
    }
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 20, elevation: 20 }}
      >
        <TouchableOpacity
          onPress={navigation.goBack}
          accessibilityRole="button"
          accessibilityLabel={settingsOnly ? 'Back to profile' : 'Back to Library'}
          style={settingsOnly
            ? { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }
            : { position: 'relative', overflow: 'hidden', width: 42, height: 42, borderRadius: 21, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }}
        >
          {!settingsOnly ? <GlassSurface style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }} /> : null}
          <ThemedIonicons name="chevron-back" size={23} color={settingsOnly ? colors.text : 'white'} />
        </TouchableOpacity>
        {settingsOnly ? (
          <Text style={{ position: 'absolute', left: 72, right: 72, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700', transform: [{ translateY: 45 }] }}>
            Settings
          </Text>
        ) : <View style={{ flex: 1 }} />}
        {settingsOnly ? <View style={{ width: 42, height: 42 }} /> : (
          <TouchableOpacity
            onPress={() => navigation.navigate('ProfileSettings')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            activeOpacity={0.72}
            style={{ position: 'relative', overflow: 'hidden', width: 42, height: 42, borderRadius: 21, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }}
          >
            <GlassSurface style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }} />
            <ThemedIonicons name="settings-outline" size={21} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <Animated.ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ paddingTop: settingsOnly ? 80 : 56, paddingHorizontal: 20, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        onScroll={profileScrollHandler}
        scrollEventThrottle={16}
      >
        {!settingsOnly ? (
          <>
        <View style={{ alignItems: 'center', marginTop: 30, marginBottom: 18 }}>
          <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: isDark ? '#2A171C' : '#FCE9EC', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? '#4A222A' : '#F4C5CC' }}>
            <ThemedIonicons name="person" size={52} color="#FA5265" />
          </View>
          <Text style={{ color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 18 }}>Kamal</Text>
          <Text style={{ color: colors.secondaryText, fontSize: 16, marginTop: 5 }}>Developer</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginBottom: 34 }}>
          {links.map((link) => (
            <TouchableOpacity
              key={link.title}
              onPress={() => navigation.navigate('ProfileWeb', { title: link.title, url: link.url })}
              accessibilityRole="link"
              accessibilityLabel={`Open Kamal’s ${link.title} profile`}
              activeOpacity={0.72}
              style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center' }}
            >
              <ThemedIonicons name={link.icon} size={25} color={colors.text} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ alignItems: 'center', marginTop: 4, paddingHorizontal: 12 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>Musiqapp</Text>
          <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 }}>
            {'© 2026 Egokam. All rights reserved.\nEnjoy, don\'t try to make it commercial, contact admin for support.'}
          </Text>
          <Text style={{ color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            Version {Constants.expoConfig?.version ?? '3.0.1'}
          </Text>
        </View>
          </>
        ) : null}

        {settingsOnly ? (
          <>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 26, marginBottom: 16 }}>
              Theme
            </Text>
            <View style={{ borderRadius: 15, overflow: 'hidden', backgroundColor: settingSurface, marginBottom: 12 }}>
              {appearanceOptions.map((option, index) => {
                const selected = mode === option.mode;
                return (
                  <TouchableOpacity
                    key={option.mode}
                    onPress={() => setMode(option.mode)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${option.title} theme`}
                    activeOpacity={0.72}
                    style={{ minHeight: 57, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center' }}
                  >
                    <ThemedIonicons name={option.icon} size={20} color={colors.text} style={{ width: 30 }} />
                    <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' }}>{option.title}</Text>
                    {selected ? (
                      <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A84FF' }}>
                        <ThemedIonicons name="checkmark" size={14} color="#FFFFFF" />
                      </View>
                    ) : (
                      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.7, borderColor: colors.mutedText }} />
                    )}
                    {index < appearanceOptions.length - 1 ? (
                      <View style={{ position: 'absolute', left: 19, right: 19, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 18, marginBottom: 20 }}>
              Automatic follows your device&apos;s system appearance.
            </Text>

            <TouchableOpacity
              onPress={() => navigation.navigate('AppIconPicker')}
              accessibilityRole="button"
              accessibilityLabel="Change app icon"
              activeOpacity={0.74}
              style={{ minHeight: 50, borderRadius: 15, paddingHorizontal: 14, backgroundColor: settingSurface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>Change App Icon</Text>
              <ThemedIonicons name="chevron-forward" size={20} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 16, marginTop: 8, marginBottom: 19 }}>
              Personalize your experience by choosing an alternate app icon.
            </Text>

            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 8, marginBottom: 13 }}>
              Lyrics
            </Text>
            <View style={{ borderRadius: 17, backgroundColor: settingSurface, padding: 8, marginBottom: 8 }}>
              <View style={{ minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity
                  onPress={showSpicyLyricsKeyHelp}
                  accessibilityRole="button"
                  accessibilityLabel="Spicy Lyrics key information and options"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>Spicy lyrics</Text>
                </TouchableOpacity>
                <Switch
                  value={spicyLyricsEnabled}
                  onValueChange={(enabled) => {
                    if (!enabled && !spicyLyricsConfigured) setSpicyLyricsKeyDraft('');
                    setSpicyLyricsEnabled(enabled);
                  }}
                  trackColor={{ false: isDark ? '#454545' : '#D1D1D6', true: '#FA5265' }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Enable Spicy Lyrics lookup and the 30-day offline lyrics cache"
                />
              </View>
              <Animated.View
                pointerEvents={showSpicyLyricsKeyEntry ? 'auto' : 'none'}
                style={{
                  height: spicyLyricsKeyEntryProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 33] }),
                  opacity: spicyLyricsKeyEntryProgress,
                  marginTop: spicyLyricsKeyEntryProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }),
                  transform: [{ translateY: spicyLyricsKeyEntryProgress.interpolate({ inputRange: [0, 1], outputRange: [-7, 0] }) }],
                  overflow: 'hidden',
                }}
              >
                <View style={{ height: 33, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <TextInput
                    value={spicyLyricsKeyDraft}
                    onChangeText={setSpicyLyricsKeyDraft}
                    placeholder={spicyLyricsConfigured ? 'API key saved' : 'Sl_pk...'}
                    placeholderTextColor={isDark ? '#D1D1D1' : '#C7C7CC'}
                    secureTextEntry={!spicyLyricsConfigured}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!isSavingSpicyLyricsKey && !spicyLyricsConfigured}
                    accessibilityLabel="Spicy Lyrics publishable client key"
                    style={{ flex: 1, minHeight: 31, borderRadius: 13, backgroundColor: isDark ? '#646464' : '#FFFFFF', color: colors.text, paddingHorizontal: 11, fontSize: 13 }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      if (spicyLyricsConfigured) void removeSpicyLyricsKey();
                    else if (spicyLyricsKeyDraft.trim()) void saveSpicyLyricsKey();
                    else Alert.alert('Enter an API key', 'Paste your Spicy Lyrics publishable key, then tap Done.');
                    }}
                  disabled={isSavingSpicyLyricsKey}
                    accessibilityRole="button"
                    accessibilityLabel={spicyLyricsConfigured ? 'Delete saved Spicy Lyrics API key' : 'Check and save Spicy Lyrics API key'}
                    activeOpacity={0.78}
                  style={{ width: spicyLyricsConfigured ? 58 : 43, minHeight: 31, borderRadius: 12, backgroundColor: '#FA5265', alignItems: 'center', justifyContent: 'center', opacity: isSavingSpicyLyricsKey ? 0.7 : 1 }}
                  >
                    {isSavingSpicyLyricsKey
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>{spicyLyricsConfigured ? 'Delete' : 'Done'}</Text>}
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </View>

            {spicyLyricsConfigured ? (
              <Animated.View
                pointerEvents={spicyLyricsEnabled ? 'auto' : 'none'}
                style={{
                  opacity: lyricsExtrasOpacity,
                  transform: [
                    { translateY: lyricsExtrasProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                    { scale: lyricsExtrasProgress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
                  ],
                }}
              >
                <View style={{ borderRadius: 17, backgroundColor: settingSurface, padding: 13, marginBottom: 9 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Automatic lyrics downloads</Text>
                  <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                    Choose whether API lyrics can be saved over cellular data.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
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
                          style={{ flex: 1, minHeight: 41, borderRadius: 13, borderWidth: 1, borderColor: isSelected ? '#FA5265' : settingBorder, backgroundColor: isSelected ? lyricAccentSurface : settingInset, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isEnabled ? 1 : 0.55 }}
                        >
                          <ThemedIonicons name={option.icon} size={15} color={isSelected ? '#FA5265' : colors.secondaryText} />
                          <Text style={{ color: colors.text, fontSize: 12, fontWeight: isSelected ? '700' : '600' }}>{option.title}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('ApiLyrics')}
                  disabled={!spicyLyricsEnabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !spicyLyricsEnabled }}
                  accessibilityLabel="Manage downloaded API lyrics"
                  activeOpacity={0.78}
                  style={{ minHeight: 55, borderRadius: 15, backgroundColor: settingSurface, paddingHorizontal: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}
                >
                  <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' }}>Manage downloaded lyrics</Text>
                  <ThemedIonicons name="chevron-forward" size={19} color={colors.secondaryText} />
                </TouchableOpacity>
              </Animated.View>
            ) : null}

            <View style={{ minHeight: 50, borderRadius: 15, backgroundColor: settingSurface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Line synced word wave</Text>
              <Switch
                value={lineSyncedWordWaveEnabled}
                onValueChange={setLineSyncedWordWaveEnabled}
                trackColor={{ false: isDark ? '#454545' : '#D1D1D6', true: '#FA5265' }}
                thumbColor="#FFFFFF"
                style={{ marginRight: -6, transform: [{ translateY: 11 }] }}
                accessibilityLabel="Animate line-synced lyrics with the word wave"
              />
            </View>
            <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 8 }}>
              Animate line-synced lyrics with a moving word highlight. Word-timed lyrics stay animated.
            </Text>

            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 27, marginBottom: 13 }}>
              Library
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
              activeOpacity={0.75}
              style={{ minHeight: 50, borderRadius: 15, backgroundColor: settingSurface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: isImportingFolder ? 0.72 : 1 }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Import music folder</Text>
              {isImportingFolder ? <ActivityIndicator color="#FA5265" size="small" /> : <ThemedIonicons name="chevron-forward" size={19} color={colors.text} />}
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 7, marginBottom: 14 }}>
              Import tracks with embedded lyrics and artwork. LRC, TTML, and TXT sidecars are supported as a fallback.
            </Text>

            <TouchableOpacity
              onPress={() => void exportLibrary()}
              disabled={isExportingLibrary}
              accessibilityRole="button"
              accessibilityLabel="Export audio tracks as Music.zip"
              activeOpacity={0.75}
              style={{ minHeight: 50, borderRadius: 15, backgroundColor: settingSurface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: isExportingLibrary ? 0.72 : 1 }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Export Music.zip</Text>
              {isExportingLibrary ? <ActivityIndicator color="#FA5265" size="small" /> : <ThemedIonicons name="chevron-forward" size={19} color={colors.text} />}
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 7, marginBottom: 14 }}>
              Export audio files only, with lyrics and artwork embedded in MP3 copies.
            </Text>

            <TouchableOpacity
              onPress={() => void emptyLibrary()}
              disabled={isEmptyingLibrary}
              accessibilityRole="button"
              accessibilityLabel="Empty library. Permanently delete all saved music from this device."
              activeOpacity={0.75}
              style={{ minHeight: 50, borderRadius: 15, backgroundColor: settingSurface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: isEmptyingLibrary ? 0.72 : 1 }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Empty library</Text>
              {isEmptyingLibrary ? <ActivityIndicator color="#FA5265" size="small" /> : <ThemedIonicons name="chevron-forward" size={19} color={colors.text} />}
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 7 }}>
              Warning: permanently remove all music saved on this device.
            </Text>
          </>
        ) : null}
      </Animated.ScrollView>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -24,
          left: 0,
          right: 0,
          height: 170,
          zIndex: 15,
          elevation: 15,
          opacity: profileTopFadeOpacity,
        }}
      >
        <LinearGradient
          colors={colors.scrollFade}
          locations={[0, 0.32, 0.68, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </SafeAreaView>
  );
};

const DeveloperProfileScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'DeveloperProfile'>) => (
  <DeveloperProfileContent navigation={navigation} settingsOnly={false} />
);

const ProfileSettingsScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'ProfileSettings'>) => (
  <DeveloperProfileContent navigation={navigation} settingsOnly />
);

const AppIconPickerScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'AppIconPicker'>) => {
  const { colors, isDark } = useAppearanceTheme();
  const { appIconSupported, selectedAppIcon, appIconChangePending, isChangingAppIcon, selectAppIcon } = useAppIconSelection();
  const pickerSurface = isDark ? '#0D0D0A' : colors.surface;
  const dividerColor = isDark ? '#191916' : colors.separator;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 5, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          onPress={navigation.goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          activeOpacity={0.7}
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: -8 }}
        >
          <ThemedIonicons name="chevron-back" size={25} color={colors.text} />
        </TouchableOpacity>

        <Text style={{ color: colors.text, fontSize: 29, fontWeight: '800', marginTop: 17, marginBottom: 22 }}>
          Change App Icon
        </Text>

        {appIconSupported === false ? (
          <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 17, marginBottom: 4 }}>
            Icon switching needs an installed build; it is not available in Expo Go.
          </Text>
        ) : appIconChangePending ? (
          <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 17, marginBottom: 4 }}>
            Your selected icon will appear after you close Musiqapp.
          </Text>
        ) : null}

        {APP_ICON_GROUPS.map((group) => (
          <View key={group.title}>
            <Text style={{ color: colors.secondaryText, fontSize: 14, fontWeight: '700', marginLeft: 16, marginBottom: 11, marginTop: group.title === 'Classic' ? 0 : 28 }}>
              {group.title}
            </Text>
            <View style={{ borderRadius: 22, overflow: 'hidden', backgroundColor: pickerSurface, paddingHorizontal: 13 }}>
              {group.choices.map((choice, index) => {
                const isSelected = selectedAppIcon === choice.key;
                return (
                  <TouchableOpacity
                    key={choice.title}
                    onPress={() => void selectAppIcon(choice.key)}
                    disabled={!appIconSupported || isChangingAppIcon}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice.title} app icon${isSelected ? ', selected' : ''}`}
                    accessibilityState={{ selected: isSelected, disabled: !appIconSupported || isChangingAppIcon }}
                    activeOpacity={0.76}
                    style={{ minHeight: 67, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 1, opacity: appIconSupported === false ? 0.52 : isChangingAppIcon && !isSelected ? 0.58 : 1 }}
                  >
                    <Image source={choice.image} resizeMode="cover" style={{ width: 42, height: 42, borderRadius: 11 }} />
                    <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '600', marginLeft: 14 }}>
                      {choice.title}
                    </Text>
                    {isChangingAppIcon && isSelected ? (
                      <ActivityIndicator color="#FA5265" size="small" />
                    ) : isSelected ? (
                      <ThemedIonicons name="checkmark-circle" size={21} color="#0A84FF" />
                    ) : null}
                    {index < group.choices.length - 1 ? (
                      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: dividerColor }} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
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
  const { colors, isDark } = useAppearanceTheme();
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
  const [menuOpacity] = useState(() => new Animated.Value(0));
  const [menuScale] = useState(() => new Animated.Value(0.001));
  const [menuTranslateY] = useState(() => new Animated.Value(-25));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const lyricsScrollY = useMemo(() => new Animated.Value(0), []);
  const lyricsTopFadeOpacity = lyricsScrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const lyricsScrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: lyricsScrollY } } }], { useNativeDriver: true }),
    [lyricsScrollY],
  );
  const canCheckOnline = spicyLyricsConfigured && spicyLyricsEnabled;
  const actionsBusy = Boolean(busyAction || busyTrackId);

  const openMenu = () => {
    setMenuOpen(true);
    menuOpacity.setValue(0);
    menuScale.setValue(0.001);
    menuTranslateY.setValue(-25);
    Animated.parallel([
      Animated.timing(menuOpacity, { toValue: 1, duration: 170, useNativeDriver: true }),
      Animated.spring(menuScale, { toValue: 1, damping: 19, stiffness: 260, mass: 0.7, useNativeDriver: true }),
      Animated.spring(menuTranslateY, { toValue: 0, damping: 19, stiffness: 260, mass: 0.7, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = (afterClose?: () => void) => {
    if (!menuOpen) {
      afterClose?.();
      return;
    }
    Animated.parallel([
      Animated.timing(menuOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.spring(menuScale, { toValue: 0.001, damping: 20, stiffness: 300, mass: 0.65, useNativeDriver: true }),
      Animated.spring(menuTranslateY, { toValue: -25, damping: 20, stiffness: 300, mass: 0.65, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setMenuOpen(false);
      afterClose?.();
    });
  };

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
        <ThemedIonicons name="search" size={20} color="#A1A1A6" />
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
            <ThemedIonicons name="close-circle" size={19} color="#77777D" />
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
            <ThemedIonicons name={allFilteredRowsSelected ? 'checkbox' : 'square-outline'} size={20} color={allFilteredRowsSelected ? '#FA5265' : '#A1A1A6'} />
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600', marginLeft: 9 }}>
              Select all{query.trim() ? ' matching tracks' : ' tracks'} ({filteredRows.length})
            </Text>
          </TouchableOpacity>
          {selectedRows.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <TouchableOpacity onPress={() => void renewSelected()} disabled={actionsBusy || selectedLyricsRows.length === 0} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#2A171C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy || selectedLyricsRows.length === 0 ? 0.45 : 1 }}>
                {busyAction === 'renew-selected' ? <ActivityIndicator size="small" color="#FA5265" /> : <ThemedIonicons name="refresh-outline" size={17} color="#FA5265" />}
                <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Renew</Text>
              </TouchableOpacity>
              {selectedNotIgnoredRows.length > 0 ? (
                <TouchableOpacity onPress={() => void ignoreSelected()} disabled={actionsBusy} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#2A171C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.45 : 1 }}>
                  {busyAction === 'ignore-selected' ? <ActivityIndicator size="small" color="#FA5265" /> : <ThemedIonicons name="eye-off-outline" size={17} color="#FA5265" />}
                  <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Ignore</Text>
                </TouchableOpacity>
              ) : null}
              {selectedIgnoredRows.length > 0 ? (
                <TouchableOpacity onPress={() => void undoIgnoreSelected()} disabled={actionsBusy} accessibilityRole="button" style={{ flexGrow: 1, flexBasis: '30%', minHeight: 42, borderRadius: 13, backgroundColor: '#202024', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.45 : 1 }}>
                  {busyAction === 'undo-ignore-selected' ? <ActivityIndicator size="small" color="#D1D1D6" /> : <ThemedIonicons name="eye-outline" size={17} color="#D1D1D6" />}
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
    const actionButtonBackground = isDark ? '#2A171C' : '#FCE9EC';

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
              <ThemedIonicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={selected ? '#FA5265' : '#77777D'} />
            </TouchableOpacity>
          ) : null}
          <View style={{ width: 58, height: 58, borderRadius: 13, overflow: 'hidden', backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
            {row.track.artwork ? (
              <Image
                source={{ uri: row.track.artwork, ...(row.track.artwork.startsWith('http') ? { headers: getMusicApiHeaders() } : {}) }}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : <ThemedIonicons name="musical-notes" size={23} color="#FA5265" />}
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
                style={{ flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: actionButtonBackground, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy || !canCheckOnline ? 0.48 : 1 }}
              >
                {isChecking ? <ActivityIndicator size="small" color="#FA5265" /> : <ThemedIonicons name="search-outline" size={17} color="#FA5265" />}
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700', marginLeft: 6 }}>Check</Text>
              </TouchableOpacity>
              {hasApiLyrics ? (
                <TouchableOpacity
                  onPress={() => void renewLyrics(row)}
                  disabled={actionsBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`Renew API lyrics for ${row.track.title}`}
                  style={{ flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: actionButtonBackground, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: actionsBusy ? 0.48 : 1 }}
                >
                  {isRenewing ? <ActivityIndicator size="small" color="#FA5265" /> : <ThemedIonicons name="refresh-outline" size={17} color="#FA5265" />}
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
      <View style={{ position: 'absolute', top: 40, left: 0, right: 0, height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', zIndex: 40, elevation: 40 }}>
        <TouchableOpacity
          onPress={navigation.goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to profile"
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <ThemedIonicons name="chevron-back" size={23} color="white" />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: 'white', fontSize: 17, fontWeight: '700', textAlign: 'center' }}>
          Downloaded lyrics
        </Text>
        <TouchableOpacity
          onPress={() => menuOpen ? closeMenu() : openMenu()}
          accessibilityRole="button"
          accessibilityLabel="Downloaded lyrics options"
          accessibilityState={{ expanded: menuOpen }}
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <ThemedIonicons name="ellipsis-horizontal" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <Animated.FlatList<ApiLyricsRow>
        style={StyleSheet.absoluteFill}
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
              <ThemedIonicons name="musical-notes-outline" size={27} color="#FA5265" />
            </View>
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Your library is empty</Text>
            <Text style={{ color: '#8E8E93', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7 }}>
              Tracks added to your library will appear here so you can check their API lyrics.
            </Text>
          </View>
        ) : query.trim() ? (
          <View style={{ paddingVertical: 44, alignItems: 'center' }}>
            <ThemedIonicons name="search-outline" size={30} color="#77777D" />
            <Text style={{ color: '#A1A1A6', fontSize: 15, marginTop: 10 }}>No matching tracks</Text>
          </View>
        ) : undefined}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 116, paddingBottom: 170, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={lyricsScrollHandler}
        scrollEventThrottle={16}
      />

      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -24,
          left: 0,
          right: 0,
          height: 170,
          zIndex: 30,
          elevation: 30,
          opacity: lyricsTopFadeOpacity,
        }}
      >
        <LinearGradient
          colors={colors.scrollFade}
          locations={[0, 0.32, 0.68, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {menuOpen ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
          <Pressable onPress={() => closeMenu()} accessibilityLabel="Close options" style={StyleSheet.absoluteFill} />
          <Animated.View
            style={{
              position: 'absolute',
              top: 62,
              right: 18,
              width: 240,
              padding: 4,
              borderRadius: 16,
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderColor: colors.separator,
              shadowColor: '#000000',
              shadowOpacity: 0.34,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              zIndex: 2,
              elevation: 22,
              transformOrigin: ['100%', 0, 0],
              transform: [{ scale: menuScale }, { translateY: menuTranslateY }],
            }}
          >
            <GlassSurface
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 }}
              colorScheme={isDark ? 'dark' : 'light'}
              fallbackColor={isDark ? 'rgba(37,37,39,0.98)' : 'rgba(242,242,247,0.98)'}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 1,
                left: 1,
                right: 1,
                bottom: 1,
                borderRadius: 15,
                backgroundColor: isDark ? 'rgba(37,37,39,0.90)' : 'rgba(248,248,250,0.92)',
              }}
            />
            <Animated.View style={{ opacity: menuOpacity }}>
              <TouchableOpacity onPress={() => closeMenu(() => { void renewAll(); })} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 42, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.4 : 1 }}>
                {busyAction === 'renew-all' ? <ActivityIndicator size="small" color={colors.accent} /> : <ThemedIonicons name="refresh-outline" size={19} color={colors.accent} />}
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 9 }}>Renew all</Text>
              </TouchableOpacity>
              <View style={{ height: StyleSheet.hairlineWidth, marginHorizontal: 11, backgroundColor: colors.separator }} />
              <TouchableOpacity onPress={() => closeMenu(openCheckAllOptions)} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 42, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.4 : 1 }}>
                {busyAction === 'check-all' ? <ActivityIndicator size="small" color={colors.accent} /> : <ThemedIonicons name="search-outline" size={19} color={colors.accent} />}
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 9 }}>Check all</Text>
              </TouchableOpacity>
              <View style={{ height: StyleSheet.hairlineWidth, marginHorizontal: 11, backgroundColor: colors.separator }} />
              <TouchableOpacity onPress={() => closeMenu(() => { setSelectionMode(true); setSelectedTrackIds(new Set()); })} disabled={actionsBusy} accessibilityRole="button" style={{ minHeight: 42, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', opacity: actionsBusy ? 0.4 : 1 }}>
                <ThemedIonicons name="checkbox-outline" size={19} color={colors.text} />
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 9 }}>Select</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
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
          <ThemedIonicons name="chevron-back" size={23} color="white" />
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
      contentStyle: { backgroundColor: 'transparent' },
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
    <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
    <Stack.Screen
      name="AppIconPicker"
      component={AppIconPickerScreen}
      options={{ animation: 'slide_from_right', animationDuration: 280 }}
    />
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
