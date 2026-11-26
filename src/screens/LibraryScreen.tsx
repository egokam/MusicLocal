import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, Image, Keyboard, Platform, StyleSheet, Switch, type ImageSourcePropType } from 'react-native';
import { ThemedSafeAreaView as SafeAreaView, ThemedPressable as Pressable, ThemedScrollView as ScrollView, ThemedTouchableOpacity as TouchableOpacity, ThemedIcon as ThemedIonicons, ThemedActivityIndicator as ActivityIndicator, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, useAppearanceTheme, type AppearanceMode } from '../contexts/AppearanceThemeContext';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Directory } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
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
import { authClient, getTwoFactorSettings, updateTwoFactorSettings, type TwoFactorSettings, type TwoFactorSettingsAction } from '../services/AuthClient';
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
  ProfileSettings: undefined;
  Account: undefined;
  EditPassword: undefined;
  ChangeEmail: undefined;
  TwoFactor: undefined;
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
        <TopBar onSettingsPress={() => navigation.navigate('ProfileSettings')} />
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

const SettingsContent = ({
  navigation,
}: {
  navigation: NativeStackScreenProps<LibraryStackParamList, 'ProfileSettings'>['navigation'];
}) => {
  const { colors, mode, setMode, isDark } = useAppearanceTheme();
  const { data: accountSession, isPending: isAccountSessionPending, refetch: refreshAccountSession } = authClient.useSession();
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
  useFocusEffect(useCallback(() => {
    void refreshAccountSession();
  }, [refreshAccountSession]));
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
          accessibilityLabel="Back to Library"
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }}
        >
          <ThemedIonicons name="chevron-back" size={23} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ position: 'absolute', left: 72, right: 72, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700', transform: [{ translateY: 45 }] }}>
          Settings
        </Text>
        <View style={{ width: 42, height: 42 }} />
      </View>

      <Animated.ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ paddingTop: 120, paddingHorizontal: 20, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        onScroll={profileScrollHandler}
        scrollEventThrottle={16}
      >
        <>
            <TouchableOpacity
              onPress={() => navigation.navigate('Account')}
              accessibilityRole="button"
              accessibilityLabel="Open your account"
              activeOpacity={0.76}
              style={{ minHeight: 70, borderRadius: 18, backgroundColor: settingSurface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: isDark ? '#3A3348' : '#EAE5F1', alignItems: 'center', justifyContent: 'center' }}>
                <ThemedIonicons name="person" size={27} color={isDark ? '#FFFFFF' : '#51436A'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                  {accountSession?.user.name || 'Your account'}
                </Text>
                <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                  {accountSession?.user.email
                    ?? (isAccountSessionPending ? 'Checking your account…' : 'Sign in or create an account for new features')}
                </Text>
              </View>
            </TouchableOpacity>

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

            <View style={{ alignItems: 'center', marginTop: 72, paddingHorizontal: 12 }}>
              <Text style={{ color: colors.secondaryText, fontSize: 14, fontWeight: '700', marginBottom: 17 }}>Developer</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginBottom: 30 }}>
                {[
                  { title: 'GitHub', icon: 'logo-github' as const, url: 'https://github.com/egokam' },
                  { title: 'Instagram', icon: 'logo-instagram' as const, url: 'https://instagram.com/kotmanii' },
                  { title: 'Portfolio', icon: 'briefcase-outline' as const, url: 'https://portfolio.egokam.site' },
                ].map((link) => (
                  <TouchableOpacity
                    key={link.title}
                    onPress={() => navigation.navigate('ProfileWeb', { title: link.title, url: link.url })}
                    accessibilityRole="link"
                    accessibilityLabel={`Open developer ${link.title}`}
                    activeOpacity={0.72}
                    style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ThemedIonicons name={link.icon} size={25} color={colors.text} />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>Musiqapp</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 }}>
                {'© 2026 Egokam. All rights reserved.\nEnjoy, don\'t try to make it commercial, contact admin for support.'}
              </Text>
              <Text style={{ color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                Version {Constants.expoConfig?.version ?? '3.0.1'}
              </Text>
            </View>
        </>
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

const ProfileSettingsScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'ProfileSettings'>) => (
  <SettingsContent navigation={navigation} />
);

const getAccountErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
};

const maskAccountEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  const [domainName = '', ...domainSuffix] = domain.split('.');
  const maskedLocal = local.length <= 3
    ? `${local.slice(0, 1)}***`
    : `${local.slice(0, 2)}****${local.slice(-1)}`;
  const maskedDomain = domainName ? `${domainName.slice(0, 1)}****` : '****';
  return `${maskedLocal}@${maskedDomain}${domainSuffix.length ? `.${domainSuffix.join('.')}` : ''}`;
};

const AccountSubpageFrame = ({
  onBack,
  title,
  children,
}: {
  onBack: () => void;
  title: string;
  children: ReactNode;
}) => {
  const { colors } = useAppearanceTheme();
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const fadeOpacity = scrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', zIndex: 20, elevation: 20 }}
      >
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to account"
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }}
        >
          <ThemedIonicons name="chevron-back" size={23} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ position: 'absolute', left: 72, right: 72, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700', transform: [{ translateY: 45 }] }}>
          {title}
        </Text>
      </View>

      <Animated.ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 130, paddingHorizontal: 24, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {children}
      </Animated.ScrollView>
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', top: -24, left: 0, right: 0, height: 170, zIndex: 15, elevation: 15, opacity: fadeOpacity }}
      >
        <LinearGradient colors={colors.scrollFade} locations={[0, 0.32, 0.68, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </SafeAreaView>
  );
};

const AccountScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'Account'>) => {
  const { colors, isDark } = useAppearanceTheme();
  const [accountMode, setAccountMode] = useState<'signIn' | 'signUp'>('signIn');
  const [accountStage, setAccountStage] = useState<'credentials' | 'verifyEmail' | 'resetPassword' | 'twoFactor'>('credentials');
  const [fullName, setFullName] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState<{ userId: string; value: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [twoFactorMethods, setTwoFactorMethods] = useState<string[]>([]);
  const [twoFactorMethod, setTwoFactorMethod] = useState<'otp' | 'totp' | 'backup-code'>('totp');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorCodeSent, setTwoFactorCodeSent] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: accountSession, isPending: isSessionPending, refetch: refreshSession } = authClient.useSession();
  const isSignUp = accountMode === 'signUp';
  const normalizedEmail = email.trim().toLowerCase();
  const inputSurface = isDark ? '#17171F' : '#F2F2F7';
  const inputBorder = isDark ? '#494953' : '#D1D1D6';
  const primarySurface = isDark ? '#F2F2F2' : colors.surface;
  const primaryText = isDark ? '#111111' : colors.text;
  const socialSurface = isDark ? '#D1D1D1' : '#F2F2F7';
  const socialText = '#17171B';
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const accountScrollY = useMemo(() => new Animated.Value(0), []);
  const accountTopFadeOpacity = accountScrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const accountScrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: accountScrollY } } }], { useNativeDriver: true }),
    [accountScrollY],
  );
  useFocusEffect(useCallback(() => {
    void refreshSession();
  }, [refreshSession]));

  const showAuthUnavailable = (provider = 'Google') => {
    Alert.alert(
      `${provider} sign-in is not set up yet`,
      `Email sign-in is ready. ${provider} sign-in will be available after its provider credentials are configured.`,
    );
  };

  const beginTwoFactorSignIn = (methods: string[]) => {
    setTwoFactorMethods(methods);
    setTwoFactorMethod(methods.includes('totp') ? 'totp' : 'otp');
    setTwoFactorCode('');
    setTwoFactorCodeSent(false);
    setAccountStage('twoFactor');
  };

  const submitAccountForm = async () => {
    if (isSubmitting) return;
    if (isSignUp && !fullName.trim()) {
      Alert.alert('Enter your name', 'Add your full name to continue.');
      return;
    }
    if (!emailIsValid) {
      Alert.alert('Check your email', 'Enter a valid email address to continue.');
      return;
    }
    if (!password) {
      Alert.alert('Enter your password', 'Add your password to continue.');
      return;
    }
    if (isSignUp && password.length < 8) {
      Alert.alert('Choose a stronger password', 'Your password must be at least 8 characters long.');
      return;
    }
    if (isSignUp && password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Check your password and confirmation.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: fullName.trim(), email: normalizedEmail, password })
        : await authClient.signIn.email({ email: normalizedEmail, password });

      if (result.error) {
        Alert.alert(isSignUp ? 'Could not create your account' : 'Could not sign in', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }

      if (isSignUp) {
        setVerificationCode('');
        setAccountStage('verifyEmail');
        return;
      }

      const signInData = result.data as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] } | null;
      if (signInData?.twoFactorRedirect) {
        beginTwoFactorSignIn(signInData.twoFactorMethods ?? []);
        return;
      }

      await refreshSession();
    } catch (error) {
      Alert.alert(isSignUp ? 'Could not create your account' : 'Could not sign in', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendVerificationCode = async () => {
    if (!emailIsValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: 'email-verification' });
      if (result.error) {
        Alert.alert('Could not send a new code', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      Alert.alert('Code sent', `A new verification code was sent to ${normalizedEmail}.`);
    } catch (error) {
      Alert.alert('Could not send a new code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyEmail = async () => {
    if (isSubmitting) return;
    if (!verificationCode.trim()) {
      Alert.alert('Enter your code', 'Enter the six-digit code sent to your email.');
      return;
    }
    setIsSubmitting(true);
    try {
      const verification = await authClient.emailOtp.verifyEmail({
        email: normalizedEmail,
        otp: verificationCode.trim(),
      });
      if (verification.error) {
        Alert.alert('Could not verify your email', getAccountErrorMessage(verification.error, 'Check the code and try again.'));
        return;
      }

      const signIn = await authClient.signIn.email({ email: normalizedEmail, password });
      if (signIn.error) {
        setAccountMode('signIn');
        setAccountStage('credentials');
        Alert.alert('Email verified', 'Your account is ready. Sign in with your password.');
        return;
      }

      const signInData = signIn.data as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] } | null;
      if (signInData?.twoFactorRedirect) {
        beginTwoFactorSignIn(signInData.twoFactorMethods ?? []);
        return;
      }

      await refreshSession();
      setAccountStage('credentials');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Could not verify your email', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitTwoFactorSignIn = async () => {
    if (isSubmitting) return;
    if (twoFactorMethod === 'otp' && !twoFactorCodeSent) {
      setIsSubmitting(true);
      try {
        const result = await authClient.twoFactor.sendOtp();
        if (result.error) {
          Alert.alert('Could not send a sign-in code', getAccountErrorMessage(result.error, 'Please try again.'));
          return;
        }
        setTwoFactorCodeSent(true);
      } catch (error) {
        Alert.alert('Could not send a sign-in code', getAccountErrorMessage(error, 'Check your connection and try again.'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    if (!twoFactorCode.trim()) {
      Alert.alert('Enter your code', 'Enter the code from your email or authenticator app.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = twoFactorMethod === 'otp'
        ? await authClient.twoFactor.verifyOtp({ code: twoFactorCode.trim() })
        : twoFactorMethod === 'totp'
          ? await authClient.twoFactor.verifyTotp({ code: twoFactorCode.trim() })
          : await authClient.twoFactor.verifyBackupCode({ code: twoFactorCode.trim() });
      if (result.error) {
        Alert.alert('Could not verify your code', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }

      await refreshSession();
      setAccountStage('credentials');
      setTwoFactorCode('');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Could not verify your code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestPasswordReset = async () => {
    if (!emailIsValid) {
      Alert.alert('Enter your email', 'Add a valid email address first, then try password recovery again.');
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.requestPasswordReset({ email: normalizedEmail });
      if (result.error) {
        Alert.alert('Could not send a reset code', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      setVerificationCode('');
      setPassword('');
      setConfirmPassword('');
      setAccountStage('resetPassword');
    } catch (error) {
      Alert.alert('Could not send a reset code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (isSubmitting) return;
    if (!verificationCode.trim()) {
      Alert.alert('Enter your code', 'Enter the six-digit code sent to your email.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Choose a stronger password', 'Your password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Check your new password and confirmation.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.resetPassword({
        email: normalizedEmail,
        otp: verificationCode.trim(),
        password,
      });
      if (result.error) {
        Alert.alert('Could not reset your password', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }
      setAccountStage('credentials');
      setAccountMode('signIn');
      setPassword('');
      setConfirmPassword('');
      setVerificationCode('');
      Alert.alert('Password updated', 'Sign in with your new password.');
    } catch (error) {
      Alert.alert('Could not reset your password', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        Alert.alert('Could not sign out', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      await refreshSession();
      setAccountStage('credentials');
      setAccountMode('signIn');
    } catch (error) {
      Alert.alert('Could not sign out', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmSignOut = () => {
    if (isSubmitting) return;
    Alert.alert('Sign out?', 'Are you sure you want to sign out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const saveProfileName = async () => {
    const name = (
      profileNameDraft?.userId === accountSession?.user.id
        ? profileNameDraft?.value ?? ''
        : accountSession?.user.name ?? ''
    ).trim();
    if (!name) {
      Alert.alert('Enter your name', 'Your full name cannot be empty.');
      return;
    }
    if (name.length > 80) {
      Alert.alert('Name is too long', 'Use 80 characters or fewer.');
      return;
    }
    if (name === accountSession?.user.name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await authClient.updateUser({ name });
      if (result.error) {
        Alert.alert('Could not update your name', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      if (accountSession?.user.id) setProfileNameDraft({ userId: accountSession.user.id, value: name });
      await refreshSession();
      Alert.alert('Name updated', 'Your account name has been saved.');
    } catch (error) {
      Alert.alert('Could not update your name', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const accountField = (
    label: string,
    placeholder: string,
    value: string,
    onChangeText: (value: string) => void,
    secure = false,
    isPasswordVisible = false,
    onTogglePasswordVisibility?: () => void,
  ) => (
    <View style={{ marginBottom: 19 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>{label}</Text>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedText}
          secureTextEntry={secure && !isPasswordVisible}
          autoCapitalize={secure ? 'none' : label === 'Full name' ? 'words' : 'none'}
          autoCorrect={false}
          keyboardType={label === 'Email' ? 'email-address' : label === 'Verification code' && twoFactorMethod !== 'backup-code' ? 'number-pad' : 'default'}
          maxLength={label === 'Verification code' ? (twoFactorMethod === 'backup-code' ? 32 : 6) : undefined}
          textContentType={label === 'Email' ? 'emailAddress' : label === 'Verification code' ? 'oneTimeCode' : secure ? (accountStage === 'resetPassword' || label === 'Confirm Password' || isSignUp ? 'newPassword' : 'password') : label === 'Full name' ? 'name' : 'none'}
          accessibilityLabel={label}
          style={{ minHeight: 54, borderRadius: 28, borderWidth: 1, borderColor: inputBorder, backgroundColor: inputSurface, color: colors.text, paddingHorizontal: 16, paddingRight: secure ? 52 : 16, fontSize: 14 }}
        />
        {secure ? (
          <TouchableOpacity
            onPress={onTogglePasswordVisibility}
            accessibilityRole="button"
            accessibilityLabel={`${isPasswordVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            accessibilityHint={isPasswordVisible ? 'Hides the password text' : 'Shows the password text'}
            activeOpacity={0.7}
            style={{ position: 'absolute', right: 8, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <ThemedIonicons name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.secondaryText} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const actionButton = (title: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={isSubmitting}
      accessibilityRole="button"
      accessibilityLabel={title}
      activeOpacity={0.78}
      style={{ minHeight: 54, borderRadius: 28, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: primarySurface, alignItems: 'center', justifyContent: 'center', opacity: isSubmitting ? 0.76 : 1 }}
    >
      {isSubmitting ? <ActivityIndicator color={primaryText} /> : <Text style={{ color: primaryText, fontSize: 15, fontWeight: '700' }}>{title}</Text>}
    </TouchableOpacity>
  );

  const resetAccountFlow = () => {
    setAccountStage('credentials');
    setAccountMode('signIn');
    setVerificationCode('');
    setPassword('');
    setConfirmPassword('');
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
          accessibilityLabel="Back to settings"
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 45 }] }}
        >
          <ThemedIonicons name="chevron-back" size={23} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ position: 'absolute', left: 72, right: 72, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700', transform: [{ translateY: 45 }] }}>
          Account
        </Text>
        <View style={{ width: 42, height: 42 }} />
      </View>

      <Animated.ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: 62, paddingHorizontal: 38, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={accountScrollHandler}
        scrollEventThrottle={16}
      >
        {isSessionPending ? (
          <View style={{ flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#FA5265" />
          </View>
        ) : accountSession?.user ? (
          <View style={{ flex: 1, alignItems: 'center', paddingTop: 22, marginHorizontal: -18 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: isDark ? '#3A3348' : '#EAE5F1', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <ThemedIonicons name="person" size={41} color={isDark ? '#FFFFFF' : '#51436A'} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 28 }}>
              {accountSession.user.name || 'Your account'}
            </Text>

            <View style={{ width: '100%', marginBottom: 24 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Personal information</Text>
              <View style={{ borderRadius: 16, backgroundColor: isDark ? '#0D0D0A' : colors.surface, padding: 12 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Full name</Text>
                <TextInput
                  value={profileNameDraft?.userId === accountSession.user.id ? profileNameDraft.value : accountSession.user.name ?? ''}
                  onChangeText={(value) => setProfileNameDraft({ userId: accountSession.user.id, value })}
                  placeholder="Your full name"
                  placeholderTextColor={colors.mutedText}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={80}
                  returnKeyType="done"
                  onSubmitEditing={() => void saveProfileName()}
                  accessibilityLabel="Full name"
                  style={{ minHeight: 48, borderRadius: 24, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: isDark ? '#777777' : '#FFFFFF', color: isDark ? '#FFFFFF' : colors.text, paddingHorizontal: 15, fontSize: 14 }}
                />
                <Text style={{ color: colors.secondaryText, fontSize: 11, marginTop: 8, marginBottom: 16 }}>What should we call you?</Text>

                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Email</Text>
                <View accessibilityRole="text" accessibilityLabel={`Email address ${maskAccountEmail(accountSession.user.email)}`} style={{ minHeight: 48, borderRadius: 24, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: isDark ? '#777777' : '#FFFFFF', justifyContent: 'center', paddingHorizontal: 15 }}>
                  <Text style={{ color: isDark ? '#FFFFFF' : colors.text, fontSize: 14 }} numberOfLines={1}>{maskAccountEmail(accountSession.user.email)}</Text>
                </View>
                <Text style={{ color: colors.secondaryText, fontSize: 11, marginTop: 8, marginBottom: 16 }}>Your email is used to sign in and for account security.</Text>
                {actionButton('Save name', () => void saveProfileName())}
              </View>
            </View>

            <View style={{ width: '100%', marginBottom: 24 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12, marginLeft: 4 }}>Security</Text>
              <View style={{ gap: 10 }}>
                {[
                  { title: 'Change password', onPress: () => navigation.navigate('EditPassword'), disabled: false },
                  { title: 'Change email address', onPress: () => navigation.navigate('ChangeEmail'), disabled: false },
                  { title: 'Two-factor authentication', onPress: () => navigation.navigate('TwoFactor'), disabled: false },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.title}
                    onPress={item.onPress}
                    disabled={item.disabled}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    accessibilityState={{ disabled: item.disabled }}
                    activeOpacity={0.75}
                    style={{ minHeight: 50, borderRadius: 14, backgroundColor: isDark ? '#0D0D0A' : colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, opacity: item.disabled ? 0.62 : 1 }}
                  >
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{item.title}</Text>
                    {item.disabled
                      ? <Text style={{ color: colors.secondaryText, fontSize: 11 }}>Coming soon</Text>
                      : <ThemedIonicons name="chevron-forward" size={19} color={colors.secondaryText} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={confirmSignOut}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              activeOpacity={0.75}
              style={{ width: '100%', minHeight: 50, borderRadius: 14, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: isDark ? '#0D0D0A' : colors.surface, justifyContent: 'center', paddingHorizontal: 13, marginBottom: 14, opacity: isSubmitting ? 0.65 : 1 }}
            >
              {isSubmitting ? <ActivityIndicator color="#FA5265" /> : <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>Sign out</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={{ alignItems: 'center', marginBottom: 26 }}>
              <Text style={{ color: colors.text, fontSize: 21, fontWeight: '800', textAlign: 'center' }}>
                {accountStage === 'verifyEmail' ? 'Verify your email' : accountStage === 'resetPassword' ? 'Reset your password' : accountStage === 'twoFactor' ? 'Two-factor verification' : isSignUp ? 'Sign up account' : 'Welcome back'}
              </Text>
              <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 19, textAlign: 'center', marginTop: 12, maxWidth: 300 }}>
                {accountStage === 'verifyEmail'
                  ? `Enter the six-digit code sent to ${normalizedEmail}.`
                  : accountStage === 'resetPassword'
                    ? `Enter the reset code sent to ${normalizedEmail} and choose a new password.`
                    : accountStage === 'twoFactor'
                      ? 'Enter a code to finish signing in to your account.'
                      : 'One step to full customized & enhanced experience'}
              </Text>
            </View>

            {accountStage === 'credentials' ? (
              <>
                {isSignUp ? accountField('Full name', 'What should we call you?', fullName, setFullName) : null}
                {accountField('Email', 'Enter your email', email, setEmail)}
                {accountField('Password', 'Enter your password', password, setPassword, true, passwordVisible, () => setPasswordVisible((visible) => !visible))}
                {isSignUp ? accountField('Confirm Password', 'Confirm your password', confirmPassword, setConfirmPassword, true, confirmPasswordVisible, () => setConfirmPasswordVisible((visible) => !visible)) : null}

                {!isSignUp ? (
                  <TouchableOpacity
                    onPress={() => void requestPasswordReset()}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                    activeOpacity={0.75}
                    disabled={isSubmitting}
                    style={{ alignSelf: 'flex-end', marginTop: -7, marginBottom: 30, paddingVertical: 5 }}
                  >
                    <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '600' }}>Forgot password?</Text>
                  </TouchableOpacity>
                ) : <View style={{ height: 10 }} />}

                {actionButton(isSignUp ? 'Sign up' : 'Sign in', () => void submitAccountForm())}

                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center', marginVertical: 19 }}>OR</Text>

                {[
                  { title: 'Continue with Google', icon: 'logo-google' as const, color: '#4285F4' },
                  { title: 'Continue with Apple', icon: 'logo-apple' as const, color: socialText },
                ].map((provider) => (
                  <TouchableOpacity
                    key={provider.title}
                    onPress={() => showAuthUnavailable(provider.title.replace('Continue with ', ''))}
                    accessibilityRole="button"
                    accessibilityLabel={provider.title}
                    activeOpacity={0.78}
                    style={{ minHeight: 52, borderRadius: 27, backgroundColor: socialSurface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}
                  >
                    <ThemedIonicons name={provider.icon} size={18} color={provider.color} />
                    <Text style={{ color: socialText, fontSize: 14, fontWeight: '600', marginLeft: 10 }}>{provider.title}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : accountStage === 'verifyEmail' ? (
              <>
                {accountField('Verification code', 'Enter 6-digit code', verificationCode, setVerificationCode)}
                {actionButton('Verify email', () => void verifyEmail())}
                <TouchableOpacity
                  onPress={() => void resendVerificationCode()}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  style={{ alignSelf: 'center', paddingVertical: 18 }}
                >
                  <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '600' }}>Resend code</Text>
                </TouchableOpacity>
              </>
            ) : accountStage === 'twoFactor' ? (
              <>
                {twoFactorMethods.includes('otp') || twoFactorMethods.includes('totp') ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
                    {twoFactorMethods.includes('otp') ? (
                      <TouchableOpacity
                        onPress={() => { setTwoFactorMethod('otp'); setTwoFactorCode(''); setTwoFactorCodeSent(false); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: twoFactorMethod === 'otp' }}
                        style={{ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: twoFactorMethod === 'otp' ? '#FA5265' : inputSurface }}
                      >
                        <Text style={{ color: twoFactorMethod === 'otp' ? '#FFFFFF' : colors.text, fontSize: 13, fontWeight: '700' }}>Email code</Text>
                      </TouchableOpacity>
                    ) : null}
                    {twoFactorMethods.includes('totp') ? (
                      <TouchableOpacity
                        onPress={() => { setTwoFactorMethod('totp'); setTwoFactorCode(''); setTwoFactorCodeSent(false); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: twoFactorMethod === 'totp' }}
                        style={{ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: twoFactorMethod === 'totp' ? '#FA5265' : inputSurface }}
                      >
                        <Text style={{ color: twoFactorMethod === 'totp' ? '#FFFFFF' : colors.text, fontSize: 13, fontWeight: '700' }}>Authenticator app</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
                    No active verification method was returned for this account. Go back and try signing in again, or contact support.
                  </Text>
                )}
                {twoFactorMethod === 'otp' && !twoFactorCodeSent ? (
                  actionButton('Send email code', () => void submitTwoFactorSignIn())
                ) : twoFactorMethods.length > 0 ? (
                  <>
                    {accountField('Verification code', twoFactorMethod === 'totp' ? 'Enter the code from your app' : twoFactorMethod === 'backup-code' ? 'Enter a recovery code' : 'Enter 6-digit email code', twoFactorCode, setTwoFactorCode)}
                    {actionButton('Verify and sign in', () => void submitTwoFactorSignIn())}
                  </>
                ) : null}
                {twoFactorMethods.includes('totp') ? (
                  <TouchableOpacity
                    onPress={() => { setTwoFactorMethod('backup-code'); setTwoFactorCode(''); setTwoFactorCodeSent(false); }}
                    accessibilityRole="button"
                    style={{ alignSelf: 'center', paddingVertical: 16 }}
                  >
                    <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700' }}>Use a recovery code</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <>
                {accountField('Verification code', 'Enter 6-digit code', verificationCode, setVerificationCode)}
                {accountField('New password', 'Enter your new password', password, setPassword, true, passwordVisible, () => setPasswordVisible((visible) => !visible))}
                {accountField('Confirm Password', 'Confirm your new password', confirmPassword, setConfirmPassword, true, confirmPasswordVisible, () => setConfirmPasswordVisible((visible) => !visible))}
                {actionButton('Reset password', () => void resetPassword())}
              </>
            )}

            <View style={{ flex: 1, minHeight: 84, alignItems: 'center', justifyContent: 'flex-end', marginTop: 20 }}>
              {accountStage === 'credentials' ? (
                <Text style={{ color: colors.text, fontSize: 13, textAlign: 'center' }}>
                  {isSignUp ? 'Already have an account? ' : 'Don\'t have an account yet? '}
                  <Text
                    onPress={() => {
                      setAccountMode(isSignUp ? 'signIn' : 'signUp');
                      setPassword('');
                      setConfirmPassword('');
                    }}
                    accessibilityRole="link"
                    style={{ color: '#FA5265', fontWeight: '700' }}
                  >
                    {isSignUp ? 'Sign in' : 'Sign up'}
                  </Text>
                </Text>
              ) : (
                <Text
                  onPress={resetAccountFlow}
                  accessibilityRole="link"
                  style={{ color: '#FA5265', fontSize: 13, fontWeight: '700', textAlign: 'center' }}
                >
                  Back to sign in
                </Text>
              )}
            </View>
          </>
        )}
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
          opacity: accountTopFadeOpacity,
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

const EditPasswordScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'EditPassword'>) => {
  const { colors, isDark } = useAppearanceTheme();
  const { data: accountSession, refetch: refreshSession } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visibleFields, setVisibleFields] = useState({ current: false, next: false, confirm: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [twoFactorSettings, setTwoFactorSettings] = useState<TwoFactorSettings | null>(null);
  const [proofMethod, setProofMethod] = useState<TwoFactorProofMethod>('otp');
  const [proofCode, setProofCode] = useState('');
  const [proofCodeSent, setProofCodeSent] = useState(false);
  const [isFactorVerified, setIsFactorVerified] = useState(false);
  const inputSurface = isDark ? '#17171F' : '#F2F2F7';
  const inputBorder = isDark ? '#494953' : '#D1D1D6';
  const buttonSurface = isDark ? '#F2F2F2' : colors.surface;
  const buttonText = isDark ? '#111111' : colors.text;

  useFocusEffect(useCallback(() => {
    let isActive = true;
    if (accountSession?.user.twoFactorEnabled) {
      void getTwoFactorSettings().then((result) => {
        if (isActive && !result.error && result.data) {
          setTwoFactorSettings(result.data);
          setProofMethod(result.data.emailOtpEnabled ? 'otp' : 'totp');
        }
      });
    } else {
      setTwoFactorSettings(null);
      setIsFactorVerified(false);
    }
    return () => { isActive = false; };
  }, [accountSession?.user.twoFactorEnabled]));

  const sendPasswordChangeOtp = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.twoFactor.sendOtp();
      if (result.error) {
        Alert.alert('Could not send a code', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      setProofCodeSent(true);
      Alert.alert('Check your email', 'If the request is within the sending limits, a verification code will arrive shortly.');
    } catch (error) {
      Alert.alert('Could not send a code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyPasswordChangeFactor = async () => {
    if (isSubmitting) return;
    if (proofMethod === 'otp' && !proofCodeSent) {
      Alert.alert('Send an email code first', 'Request a verification code before continuing.');
      return;
    }
    if (!proofCode.trim()) {
      Alert.alert('Enter your verification code', 'Enter the code from your email or authenticator app.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = proofMethod === 'otp'
        ? await authClient.twoFactor.verifyOtp({ code: proofCode.trim() })
        : proofMethod === 'totp'
          ? await authClient.twoFactor.verifyTotp({ code: proofCode.trim() })
          : await authClient.twoFactor.verifyBackupCode({ code: proofCode.trim() });
      if (result.error) {
        Alert.alert('Could not verify your code', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }
      setIsFactorVerified(true);
    } catch (error) {
      Alert.alert('Could not verify your code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitPasswordChange = async () => {
    if (isSubmitting) return;
    if (accountSession?.user.twoFactorEnabled && !isFactorVerified) {
      Alert.alert('Verify it is you', 'Confirm a second factor before changing your password.');
      return;
    }
    if (!currentPassword) {
      Alert.alert('Enter your current password', 'Your current password is needed to make this change.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Choose a stronger password', 'Your new password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Check your new password and confirmation.');
      return;
    }
    if (currentPassword === newPassword) {
      Alert.alert('Choose a new password', 'Your new password must differ from your current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setIsFactorVerified(false);
        Alert.alert('Could not update your password', getAccountErrorMessage(result.error, 'Check your current password and try again.'));
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshSession();
      Alert.alert('Password updated', 'Your password has been changed.', [{ text: 'OK', onPress: navigation.goBack }]);
    } catch (error) {
      Alert.alert('Could not update your password', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordField = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    key: keyof typeof visibleFields,
    textContentType: 'password' | 'newPassword',
  ) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={label === 'Confirm new password' ? 'Confirm your new password' : `Enter ${label.toLowerCase()}`}
          placeholderTextColor={colors.mutedText}
          secureTextEntry={!visibleFields[key]}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={textContentType}
          accessibilityLabel={label}
          style={{ minHeight: 54, borderRadius: 28, borderWidth: 1, borderColor: inputBorder, backgroundColor: inputSurface, color: colors.text, paddingHorizontal: 16, paddingRight: 52, fontSize: 14 }}
        />
        <TouchableOpacity
          onPress={() => setVisibleFields((fields) => ({ ...fields, [key]: !fields[key] }))}
          accessibilityRole="button"
          accessibilityLabel={`${visibleFields[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          activeOpacity={0.7}
          style={{ position: 'absolute', right: 8, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <ThemedIonicons name={visibleFields[key] ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.secondaryText} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <AccountSubpageFrame onBack={navigation.goBack} title="Edit Password">
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 }}>Update your password</Text>
      <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 34 }}>
        Enter your current password, then choose a new one.
      </Text>
      {accountSession?.user.twoFactorEnabled ? (
        <View style={{ borderRadius: 18, backgroundColor: isDark ? '#0D0D0A' : colors.surface, padding: 16, marginBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 7 }}>Confirm it is you</Text>
          <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
            A second factor is required before changing your password.
          </Text>
          {isFactorVerified ? (
            <Text style={{ color: '#36B66A', fontSize: 13, fontWeight: '700' }}>Verified. Finish this change now.</Text>
          ) : twoFactorSettings ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {twoFactorSettings.emailOtpEnabled ? (
                  <TouchableOpacity onPress={() => { setProofMethod('otp'); setProofCode(''); setProofCodeSent(false); }} accessibilityRole="button" accessibilityState={{ selected: proofMethod === 'otp' }} style={{ flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: proofMethod === 'otp' ? '#FA5265' : inputSurface }}>
                    <Text style={{ color: proofMethod === 'otp' ? '#FFFFFF' : colors.text, fontSize: 12, fontWeight: '700' }}>Email code</Text>
                  </TouchableOpacity>
                ) : null}
                {twoFactorSettings.authenticatorEnabled ? (
                  <TouchableOpacity onPress={() => { setProofMethod('totp'); setProofCode(''); setProofCodeSent(false); }} accessibilityRole="button" accessibilityState={{ selected: proofMethod === 'totp' }} style={{ flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: proofMethod === 'totp' ? '#FA5265' : inputSurface }}>
                    <Text style={{ color: proofMethod === 'totp' ? '#FFFFFF' : colors.text, fontSize: 12, fontWeight: '700' }}>Authenticator app</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {proofMethod === 'otp' && !proofCodeSent ? (
                <TouchableOpacity onPress={() => void sendPasswordChangeOtp()} disabled={isSubmitting} accessibilityRole="button" style={{ minHeight: 46, borderRadius: 23, backgroundColor: inputSurface, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Send email code</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TextInput value={proofCode} onChangeText={setProofCode} placeholder={proofMethod === 'totp' ? 'Code from authenticator app' : proofMethod === 'backup-code' ? 'Enter a recovery code' : 'Six-digit email code'} placeholderTextColor={colors.mutedText} keyboardType={proofMethod === 'backup-code' ? 'default' : 'number-pad'} maxLength={proofMethod === 'backup-code' ? 32 : 6} textContentType="oneTimeCode" accessibilityLabel="Two-factor verification code" style={{ minHeight: 50, borderRadius: 25, borderWidth: 1, borderColor: inputBorder, backgroundColor: inputSurface, color: colors.text, paddingHorizontal: 16, fontSize: 14, marginBottom: 10 }} />
                  <TouchableOpacity onPress={() => void verifyPasswordChangeFactor()} disabled={isSubmitting} accessibilityRole="button" style={{ minHeight: 46, borderRadius: 23, backgroundColor: inputSurface, alignItems: 'center', justifyContent: 'center' }}>
                    {isSubmitting ? <ActivityIndicator color="#FA5265" /> : <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Verify code</Text>}
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <ActivityIndicator color="#FA5265" />
          )}
        </View>
      ) : null}
      {passwordField('Current password', currentPassword, setCurrentPassword, 'current', 'password')}
      {passwordField('New password', newPassword, setNewPassword, 'next', 'newPassword')}
      {passwordField('Confirm new password', confirmPassword, setConfirmPassword, 'confirm', 'newPassword')}
      <TouchableOpacity
        onPress={() => void submitPasswordChange()}
        disabled={isSubmitting}
        accessibilityRole="button"
        accessibilityLabel="Save new password"
        activeOpacity={0.78}
        style={{ minHeight: 54, borderRadius: 28, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: buttonSurface, alignItems: 'center', justifyContent: 'center', opacity: isSubmitting ? 0.76 : 1, marginTop: 4 }}
      >
        {isSubmitting ? <ActivityIndicator color={buttonText} /> : <Text style={{ color: buttonText, fontSize: 15, fontWeight: '700' }}>Save password</Text>}
      </TouchableOpacity>
    </AccountSubpageFrame>
  );
};

type TwoFactorOperation =
  | { type: 'master'; enabled: boolean }
  | { type: 'email'; enabled: boolean }
  | { type: 'authenticator'; enabled: boolean }
  | { type: 'reset-authenticator' }
  | { type: 'enroll-authenticator' };

type TwoFactorProofMethod = 'otp' | 'totp' | 'backup-code';

const AuthenticatorQrCode = ({ value }: { value: string }) => {
  const qr = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrModule = require('qrcode/lib/core/qrcode') as {
        create: (text: string) => { modules: { size: number; data: Uint8Array } };
      };
      const matrix = qrModule.create(value).modules;
      let path = '';
      for (let index = 0; index < matrix.data.length; index += 1) {
        if (matrix.data[index]) {
          const x = index % matrix.size;
          const y = Math.floor(index / matrix.size);
          path += `M${x} ${y}h1v1h-1z`;
        }
      }
      return { size: matrix.size, path };
    } catch {
      return null;
    }
  }, [value]);

  if (!qr) return null;
  return (
    <View style={{ width: 232, height: 232, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, alignSelf: 'center' }}>
      <Svg width={216} height={216} viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`} accessibilityLabel="Authenticator setup QR code">
        <Rect x={-4} y={-4} width={qr.size + 8} height={qr.size + 8} fill="#FFFFFF" />
        <Path d={qr.path} fill="#111111" />
      </Svg>
    </View>
  );
};

const TwoFactorScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'TwoFactor'>) => {
  const { colors, isDark } = useAppearanceTheme();
  const [settings, setSettings] = useState<TwoFactorSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operation, setOperation] = useState<TwoFactorOperation | null>(null);
  const [confirmationProgress] = useState(() => new Animated.Value(0));
  const hasActiveOperation = operation !== null;
  const [proofMethod, setProofMethod] = useState<TwoFactorProofMethod>('otp');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const { refetch: refreshSession } = authClient.useSession();
  const surface = isDark ? '#0D0D0A' : colors.surface;
  const fieldSurface = isDark ? '#17171F' : '#F2F2F7';
  const fieldBorder = isDark ? '#494953' : '#D1D1D6';
  const buttonSurface = isDark ? '#F2F2F2' : colors.surface;
  const buttonText = isDark ? '#111111' : colors.text;

  useEffect(() => {
    if (!hasActiveOperation) {
      confirmationProgress.stopAnimation();
      confirmationProgress.setValue(0);
      return;
    }

    confirmationProgress.setValue(0);
    const animation = Animated.timing(confirmationProgress, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [confirmationProgress, hasActiveOperation]);

  const confirmationTranslateY = confirmationProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 0],
  });

  const reloadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getTwoFactorSettings();
      if (result.error) throw new Error(getAccountErrorMessage(result.error, 'Could not load two-factor settings.'));
      if (result.data) setSettings(result.data);
    } catch (error) {
      Alert.alert('Could not load two-factor settings', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void reloadSettings();
  }, [reloadSettings]));

  const clearOperation = () => {
    setOperation(null);
    setCode('');
    setCodeSent(false);
    setCurrentPassword('');
    setPasswordVisible(false);
  };

  const beginOperation = (next: TwoFactorOperation) => {
    setOperation(next);
    setCode('');
    setCodeSent(false);
    setCurrentPassword('');
    setProofMethod(settings?.emailOtpEnabled ? 'otp' : 'totp');
  };

  const requestEmailCode = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.twoFactor.sendOtp();
      if (result.error) {
        Alert.alert('Could not send a code', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      setCodeSent(true);
      Alert.alert('Check your email', 'If the request is within the sending limits, a verification code will arrive shortly.');
    } catch (error) {
      Alert.alert('Could not send a code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeOperation = async () => {
    if (!operation || isSubmitting || !settings) return;
    const needsCurrentPassword = !settings.twoFactorEnabled || operation.type === 'enroll-authenticator';
    if (needsCurrentPassword && !currentPassword) {
      Alert.alert('Enter your current password', 'Your current password is needed to make this security change.');
      return;
    }
    if (settings.twoFactorEnabled) {
      if (proofMethod === 'otp' && !codeSent) {
        Alert.alert('Send an email code first', 'Request a verification code before continuing.');
        return;
      }
      if (!code.trim()) {
        Alert.alert('Enter your verification code', 'Enter the code from your email or authenticator app.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (settings.twoFactorEnabled) {
        const verification = proofMethod === 'otp'
          ? await authClient.twoFactor.verifyOtp({ code: code.trim() })
          : proofMethod === 'totp'
            ? await authClient.twoFactor.verifyTotp({ code: code.trim() })
            : await authClient.twoFactor.verifyBackupCode({ code: code.trim() });
        if (verification.error) {
          Alert.alert('Could not verify your code', getAccountErrorMessage(verification.error, 'Check the code and try again.'));
          return;
        }
      }

      if (operation.type === 'enroll-authenticator') {
        const enrollment = await authClient.twoFactor.enable({
          password: currentPassword,
          method: 'totp',
          issuer: 'Musiqapp',
        });
        if (enrollment.error) {
          Alert.alert('Could not set up authenticator app', getAccountErrorMessage(enrollment.error, 'Check your password and try again.'));
          return;
        }
        if (enrollment.data?.method !== 'totp') {
          Alert.alert('Could not set up authenticator app', 'The server did not return authenticator setup details.');
          return;
        }
        setTotpUri(enrollment.data.totpURI);
        setBackupCodes(enrollment.data.backupCodes ?? []);
        setEnrollmentCode('');
        clearOperation();
        await reloadSettings();
        return;
      }

      const update: TwoFactorSettingsAction = operation.type === 'reset-authenticator'
        ? { action: operation.type, ...(needsCurrentPassword ? { password: currentPassword } : {}) }
        : { action: operation.type, enabled: operation.enabled, ...(needsCurrentPassword ? { password: currentPassword } : {}) };
      const result = await updateTwoFactorSettings(update);
      if (result.error) {
        Alert.alert('Could not update two-factor settings', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }

      clearOperation();
      await Promise.all([reloadSettings(), refreshSession()]);
    } catch (error) {
      Alert.alert('Could not update two-factor settings', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyAuthenticatorEnrollment = async () => {
    if (isSubmitting) return;
    if (!/^\d{6}$/.test(enrollmentCode.trim())) {
      Alert.alert('Enter a six-digit code', 'Use the current code shown by your authenticator app.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: enrollmentCode.trim() });
      if (result.error) {
        Alert.alert('Could not verify your authenticator', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }
      setTotpUri(null);
      setEnrollmentCode('');
      await Promise.all([reloadSettings(), refreshSession()]);
      Alert.alert('Authenticator app enabled', 'Keep the recovery codes shown on this page somewhere safe.');
    } catch (error) {
      Alert.alert('Could not verify your authenticator', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const proofOptions = [
    ...(settings?.emailOtpEnabled ? [{ value: 'otp' as const, label: 'Email code' }] : []),
    ...(settings?.authenticatorEnabled ? [{ value: 'totp' as const, label: 'Authenticator app' }] : []),
  ];
  const needsCurrentPassword = !!settings && (!settings.twoFactorEnabled || operation?.type === 'enroll-authenticator');

  const passwordInput = (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 9 }}>Current password</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Enter your current password"
          placeholderTextColor={colors.mutedText}
          secureTextEntry={!passwordVisible}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          accessibilityLabel="Current password"
          style={{ minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: fieldBorder, backgroundColor: fieldSurface, color: colors.text, paddingHorizontal: 16, paddingRight: 52, fontSize: 14 }}
        />
        <TouchableOpacity
          onPress={() => setPasswordVisible((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={`${passwordVisible ? 'Hide' : 'Show'} current password`}
          style={{ position: 'absolute', right: 8, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <ThemedIonicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.secondaryText} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const primaryButton = (title: string, onPress: () => void, disabled = false) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isSubmitting}
      accessibilityRole="button"
      accessibilityLabel={title}
      activeOpacity={0.78}
      style={{ minHeight: 52, borderRadius: 26, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: buttonSurface, alignItems: 'center', justifyContent: 'center', opacity: disabled || isSubmitting ? 0.65 : 1, marginTop: 4 }}
    >
      {isSubmitting ? <ActivityIndicator color={buttonText} /> : <Text style={{ color: buttonText, fontSize: 14, fontWeight: '700' }}>{title}</Text>}
    </TouchableOpacity>
  );

  const methodSwitch = (
    title: string,
    value: boolean,
    onValueChange: (next: boolean) => void,
    disabled = false,
    positionOffset: { x?: number; y?: number } = { y: 10 },
  ) => (
    <Switch
      value={value}
      onValueChange={onValueChange}
      style={positionOffset ? { transform: [
        { translateX: positionOffset.x ?? 0 },
        { translateY: positionOffset.y ?? 0 },
      ] } : undefined}
      disabled={disabled || isLoading || isSubmitting}
      accessibilityLabel={title}
      trackColor={{ false: isDark ? '#45454B' : '#D1D1D6', true: '#FA5265' }}
      thumbColor={value ? '#FFFFFF' : isDark ? '#B8B8BE' : '#F7F7F7'}
      ios_backgroundColor={isDark ? '#45454B' : '#D1D1D6'}
    />
  );

  const secretFromUri = totpUri?.match(/[?&]secret=([^&]+)/)?.[1];
  const manualSecret = secretFromUri ? decodeURIComponent(secretFromUri) : null;

  return (
    <AccountSubpageFrame onBack={navigation.goBack} title="Two-Factor Auth">
      {isLoading && !settings ? (
        <View style={{ minHeight: 230, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#FA5265" />
        </View>
      ) : !settings ? (
        <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 21 }}>Two-factor settings could not be loaded. Go back and try again.</Text>
      ) : (
        <>
          <View style={{ minHeight: 50, borderRadius: 18, backgroundColor: surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 22 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>2-Factor Auth</Text>
            {methodSwitch('Two-Factor Auth', settings.twoFactorEnabled, (enabled) => beginOperation({ type: 'master', enabled }))}
          </View>

          <View style={{ borderRadius: 20, backgroundColor: surface, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 14 }}>
            <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: isDark ? '#282824' : '#E5E5EA' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>Email OTP</Text>
                {!settings.emailVerified ? <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 4 }}>Verify your account email before using this method.</Text> : null}
              </View>
              {methodSwitch('Email OTP', settings.emailOtpEnabled, (enabled) => beginOperation({ type: 'email', enabled }), !settings.emailVerified || (settings.twoFactorEnabled && settings.emailOtpEnabled && !settings.authenticatorEnabled))}
            </View>

            <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity
                onPress={() => {
                  if (!settings.authenticatorConfigured) beginOperation({ type: 'enroll-authenticator' });
                }}
                disabled={isSubmitting || isLoading}
                accessibilityRole={settings.authenticatorConfigured ? undefined : 'button'}
                accessibilityLabel={settings.authenticatorConfigured ? 'Authenticator app configured' : 'Set up authenticator app'}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 62 }}
              >
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>Authentication app</Text>
                {!settings.authenticatorConfigured ? <ThemedIonicons name="chevron-forward" size={20} color={colors.secondaryText} style={{ marginLeft: 'auto' }} /> : null}
              </TouchableOpacity>
              {settings.authenticatorConfigured
                ? methodSwitch('Authentication app', settings.authenticatorEnabled, (enabled) => beginOperation({ type: 'authenticator', enabled }), settings.twoFactorEnabled && settings.authenticatorEnabled && !settings.emailOtpEnabled)
                : null}
            </View>

            {settings.authenticatorConfigured ? (
              <TouchableOpacity
                onPress={() => beginOperation({ type: 'reset-authenticator' })}
                accessibilityRole="button"
                accessibilityLabel="Reset authenticator app"
                style={{ minHeight: 42, borderTopWidth: 1, borderTopColor: isDark ? '#282824' : '#E5E5EA', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700' }}>Reset authenticator app</Text>
                <ThemedIonicons name="chevron-forward" size={18} color={colors.secondaryText} />
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 18, marginBottom: 20 }}>
            When two-factor auth is on, sign-in and password changes need a code from an enabled method. At least one method stays active while protection is on.
          </Text>

          {operation ? (
            <Animated.View style={{ borderRadius: 18, backgroundColor: surface, padding: 16, marginBottom: 20, opacity: confirmationProgress, transform: [{ translateY: confirmationTranslateY }] }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
                {operation.type === 'enroll-authenticator' ? 'Set up authenticator app' : 'Confirm this security change'}
              </Text>
              <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
                {settings.twoFactorEnabled
                  ? 'Verify with a currently enabled method to continue.'
                  : 'Enter your current password to continue.'}
              </Text>

              {needsCurrentPassword ? passwordInput : null}

              {settings.twoFactorEnabled ? (
                <>
                  {proofOptions.length ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                      {proofOptions.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          onPress={() => { setProofMethod(option.value); setCode(''); setCodeSent(false); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: proofMethod === option.value }}
                          style={{ flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, backgroundColor: proofMethod === option.value ? '#FA5265' : fieldSurface }}
                        >
                          <Text style={{ color: proofMethod === option.value ? '#FFFFFF' : colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{option.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
                      No enabled method is available. Turn on an active factor or disable two-factor auth from a verified session.
                    </Text>
                  )}
                  {proofMethod === 'otp' && !codeSent ? primaryButton('Send email code', () => void requestEmailCode(), !proofOptions.some((option) => option.value === 'otp')) : null}
                  {(proofMethod !== 'otp' || codeSent) && proofOptions.length ? (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Verification code</Text>
                      <TextInput
                        value={code}
                        onChangeText={setCode}
                        placeholder={proofMethod === 'totp' ? 'Code from authenticator app' : proofMethod === 'backup-code' ? 'Recovery code' : 'Six-digit email code'}
                        placeholderTextColor={colors.mutedText}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        keyboardType={proofMethod === 'backup-code' ? 'default' : 'number-pad'}
                        maxLength={proofMethod === 'backup-code' ? 32 : 6}
                        textContentType="oneTimeCode"
                        accessibilityLabel="Two-factor verification code"
                        style={{ minHeight: 50, borderRadius: 25, borderWidth: 1, borderColor: fieldBorder, backgroundColor: fieldSurface, color: colors.text, paddingHorizontal: 16, fontSize: 14 }}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              {primaryButton(operation.type === 'enroll-authenticator' ? 'Generate QR code' : 'Confirm', () => void completeOperation(), settings.twoFactorEnabled && (!proofOptions.length || (proofMethod === 'otp' && !codeSent)))}
              <TouchableOpacity
                onPress={clearOperation}
                accessibilityRole="button"
                style={{ minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
              >
                <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : null}

          {totpUri ? (
            <View style={{ borderRadius: 18, backgroundColor: surface, padding: 16, marginBottom: 20 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Scan with your authenticator app</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
                Scan this QR code, or enter the setup key manually. Then enter the six-digit code from the app.
              </Text>
              <AuthenticatorQrCode value={totpUri} />
              {manualSecret ? (
                <View style={{ marginTop: 16, marginBottom: 18 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 7 }}>Setup key</Text>
                  <Text selectable style={{ color: colors.text, backgroundColor: fieldSurface, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 19, letterSpacing: 1 }}>{manualSecret}</Text>
                </View>
              ) : null}
              <TextInput
                value={enrollmentCode}
                onChangeText={setEnrollmentCode}
                placeholder="Enter 6-digit code"
                placeholderTextColor={colors.mutedText}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
                autoCapitalize="none"
                accessibilityLabel="Authenticator app verification code"
                style={{ minHeight: 50, borderRadius: 25, borderWidth: 1, borderColor: fieldBorder, backgroundColor: fieldSurface, color: colors.text, paddingHorizontal: 16, fontSize: 14, marginTop: 18, marginBottom: 12 }}
              />
              {primaryButton('Verify and enable app', () => void verifyAuthenticatorEnrollment())}
            </View>
          ) : null}

          {backupCodes.length ? (
            <View style={{ borderRadius: 18, backgroundColor: surface, padding: 16, marginBottom: 20 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Save your recovery codes</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
                Each recovery code works once if you cannot use your authenticator app. Save these now; they will not be shown again.
              </Text>
              <Text selectable style={{ color: colors.text, backgroundColor: fieldSurface, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 23, letterSpacing: 1 }}>
                {backupCodes.join('\n')}
              </Text>
              <TouchableOpacity onPress={() => setBackupCodes([])} accessibilityRole="button" style={{ alignSelf: 'flex-end', paddingTop: 14 }}>
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
    </AccountSubpageFrame>
  );
};

type ChangeEmailStep = 'currentEmail' | 'currentOtp' | 'newEmail' | 'newOtp';

const ChangeEmailScreen = ({ navigation }: NativeStackScreenProps<LibraryStackParamList, 'ChangeEmail'>) => {
  const { colors, isDark } = useAppearanceTheme();
  const { data: accountSession, isPending: isSessionPending, refetch: refreshSession } = authClient.useSession();
  const [step, setStep] = useState<ChangeEmailStep>('currentEmail');
  const [currentEmail, setCurrentEmail] = useState('');
  const [currentOtp, setCurrentOtp] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmNewEmail, setConfirmNewEmail] = useState('');
  const [newOtp, setNewOtp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const stepProgress = useMemo(() => new Animated.Value(1), []);
  const inputSurface = isDark ? '#17171F' : '#F2F2F7';
  const inputBorder = isDark ? '#494953' : '#D1D1D6';
  const buttonSurface = isDark ? '#F2F2F2' : colors.surface;
  const buttonText = isDark ? '#111111' : colors.text;
  const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
  const normalizedNewEmail = newEmail.trim().toLowerCase();
  const normalizedConfirmEmail = confirmNewEmail.trim().toLowerCase();

  const transitionTo = (nextStep: ChangeEmailStep) => {
    stepProgress.stopAnimation();
    stepProgress.setValue(0);
    setStep(nextStep);
    Animated.timing(stepProgress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  };

  const sendCurrentEmailCode = async () => {
    if (isSubmitting || isSessionPending) return;
    const signedInEmail = accountSession?.user.email.trim().toLowerCase();
    if (!signedInEmail) {
      Alert.alert('Sign in required', 'Sign in again before changing your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCurrentEmail)) {
      Alert.alert('Check your email', 'Enter a valid current email address.');
      return;
    }
    if (normalizedCurrentEmail !== signedInEmail) {
      Alert.alert('Email does not match', 'Enter the email address currently linked to your account.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: signedInEmail, type: 'email-verification' });
      if (result.error) {
        Alert.alert('Could not send a code', getAccountErrorMessage(result.error, 'Please try again.'));
        return;
      }
      setCurrentOtp('');
      transitionTo('currentOtp');
    } catch (error) {
      Alert.alert('Could not send a code', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCurrentEmailCode = async () => {
    if (isSubmitting) return;
    if (!/^\d{6}$/.test(currentOtp.trim())) {
      Alert.alert('Enter your code', 'Enter the six-digit code sent to your current email.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.checkVerificationOtp({
        email: normalizedCurrentEmail,
        type: 'email-verification',
        otp: currentOtp.trim(),
      });
      if (result.error) {
        Alert.alert('Code not accepted', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }
      transitionTo('newEmail');
    } catch (error) {
      Alert.alert('Code not accepted', getAccountErrorMessage(error, 'Check the code and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendNewEmailCode = async () => {
    if (isSubmitting) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNewEmail)) {
      Alert.alert('Check your new email', 'Enter a valid email address.');
      return;
    }
    if (normalizedNewEmail !== normalizedConfirmEmail) {
      Alert.alert('Email addresses do not match', 'Enter the same new email address twice.');
      return;
    }
    if (normalizedNewEmail === normalizedCurrentEmail) {
      Alert.alert('Choose a different email', 'Your new email must differ from your current email.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.requestEmailChange({ newEmail: normalizedNewEmail, otp: currentOtp.trim() });
      if (result.error) {
        Alert.alert('Could not start email change', getAccountErrorMessage(result.error, 'Check your current email code and try again.'));
        return;
      }
      setNewOtp('');
      transitionTo('newOtp');
    } catch (error) {
      Alert.alert('Could not start email change', getAccountErrorMessage(error, 'Check your current email code and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitNewEmailCode = async () => {
    if (isSubmitting) return;
    if (!/^\d{6}$/.test(newOtp.trim())) {
      Alert.alert('Enter your code', 'Enter the six-digit code sent to your new email.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.emailOtp.changeEmail({ newEmail: normalizedNewEmail, otp: newOtp.trim() });
      if (result.error) {
        Alert.alert('Could not change your email', getAccountErrorMessage(result.error, 'Check the code and try again.'));
        return;
      }
      try {
        await refreshSession();
      } catch {
        // The email is already updated on the server; a later screen focus can refresh the session.
      }
      Alert.alert('Email changed successfully', 'Your account email address has been updated.', [
        { text: 'OK', onPress: navigation.goBack },
      ]);
    } catch (error) {
      Alert.alert('Could not change your email', getAccountErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = (
    label: string,
    placeholder: string,
    value: string,
    onChangeText: (value: string) => void,
    keyboardType: 'email-address' | 'number-pad',
  ) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={keyboardType === 'number-pad' ? 6 : 254}
        textContentType={keyboardType === 'number-pad' ? 'oneTimeCode' : 'emailAddress'}
        accessibilityLabel={label}
        style={{ minHeight: 54, borderRadius: 28, borderWidth: 1, borderColor: inputBorder, backgroundColor: inputSurface, color: colors.text, paddingHorizontal: 16, fontSize: 14 }}
      />
    </View>
  );

  const stepCopyByName: Record<ChangeEmailStep, { title: string; description: string; button: string; submit: () => Promise<void> }> = {
    currentEmail: {
      title: 'Verify your current email',
      description: 'Enter the email address linked to your account. We will send a code to confirm it is yours.',
      button: 'Send code',
      submit: sendCurrentEmailCode,
    },
    currentOtp: {
      title: 'Check your inbox',
      description: `Enter the six-digit code sent to ${maskAccountEmail(normalizedCurrentEmail)}.`,
      button: 'Verify current email',
      submit: verifyCurrentEmailCode,
    },
    newEmail: {
      title: 'Choose a new email',
      description: 'Enter your new email address twice. We will send a confirmation code to it.',
      button: 'Send confirmation code',
      submit: sendNewEmailCode,
    },
    newOtp: {
      title: 'Confirm your new email',
      description: `Enter the six-digit code sent to ${maskAccountEmail(normalizedNewEmail)}.`,
      button: 'Change email address',
      submit: submitNewEmailCode,
    },
  };
  const stepCopy = stepCopyByName[step];

  const stepFields = {
    currentEmail: field('Current email address', 'Enter your current email', currentEmail, setCurrentEmail, 'email-address'),
    currentOtp: field('Verification code', 'Enter the 6-digit code', currentOtp, setCurrentOtp, 'number-pad'),
    newEmail: (
      <>
        {field('New email address', 'Enter your new email', newEmail, setNewEmail, 'email-address')}
        {field('Confirm new email address', 'Enter your new email again', confirmNewEmail, setConfirmNewEmail, 'email-address')}
      </>
    ),
    newOtp: field('Verification code', 'Enter the 6-digit code', newOtp, setNewOtp, 'number-pad'),
  }[step];

  return (
    <AccountSubpageFrame onBack={navigation.goBack} title="Change Email Address">
      <Animated.View style={{ opacity: stepProgress, transform: [{ translateX: stepProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 }}>{stepCopy.title}</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 34 }}>{stepCopy.description}</Text>
        {stepFields}
        <TouchableOpacity
          onPress={() => void stepCopy.submit()}
          disabled={isSubmitting || isSessionPending}
          accessibilityRole="button"
          accessibilityLabel={stepCopy.button}
          activeOpacity={0.78}
          style={{ minHeight: 54, borderRadius: 28, borderWidth: isDark ? 0 : 1, borderColor: isDark ? 'transparent' : '#D1D1D6', backgroundColor: buttonSurface, alignItems: 'center', justifyContent: 'center', opacity: isSubmitting || isSessionPending ? 0.76 : 1, marginTop: 4 }}
        >
          {isSubmitting ? <ActivityIndicator color={buttonText} /> : <Text style={{ color: buttonText, fontSize: 15, fontWeight: '700' }}>{stepCopy.button}</Text>}
        </TouchableOpacity>
      </Animated.View>
    </AccountSubpageFrame>
  );
};

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
          accessibilityLabel="Back to settings"
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
          accessibilityLabel={canGoBack ? 'Back in page' : 'Back to settings'}
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
    <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
    <Stack.Screen name="Account" component={AccountScreen} />
    <Stack.Screen name="EditPassword" component={EditPasswordScreen} />
    <Stack.Screen name="ChangeEmail" component={ChangeEmailScreen} />
    <Stack.Screen name="TwoFactor" component={TwoFactorScreen} options={{ animation: 'slide_from_right', animationDuration: 280 }} />
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
