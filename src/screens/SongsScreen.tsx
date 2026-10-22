import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlphabetIndex } from '../components/songs/AlphabetIndex';
import { SongListItem, type SongMenuAnchor } from '../components/songs/SongListItem';
import { SongsControls } from '../components/songs/SongsControls';
import { SongsHeader } from '../components/songs/SongsHeader';
import { TrackActionsSheet } from '../components/songs/TrackActionsSheet';
import type { PlaylistSummary, Track } from '../types';
import type { TrackEditChanges } from '../services/MusicCatalogService';
import { LibrarySelectionBarContext } from '../contexts/PlaybackContext';

type SongSection = { title: string; data: Track[] };
type SongSortMode = 'name' | 'dateAdded' | 'artist';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const normalizeSearchText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();

const getSectionTitle = (value: string) => {
  const firstVisibleCharacter = Array.from(value.normalize('NFKC').trim())
    .find((character) => !/[\p{M}\p{Cf}]/u.test(character));
  return firstVisibleCharacter && /\p{L}/u.test(firstVisibleCharacter)
    ? firstVisibleCharacter.toLocaleUpperCase()
    : '#';
};

const getDateAddedTimestamp = (track: Track) => {
  if (typeof track.dateAdded === 'number') return Number.isFinite(track.dateAdded) ? track.dateAdded : null;
  if (typeof track.dateAdded === 'string') {
    const timestamp = Date.parse(track.dateAdded);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
};

export const SongsScreen = ({
  title = 'Songs',
  onBack,
  onSelectTrack,
  onPlayAll,
  onShuffle,
  tracks,
  apiConnected,
  apiInitializing,
  isLoadingTracks,
  loadError,
  downloadedTrackIds,
  downloadingTrackIds,
  onSearch,
  onConnect,
  onDownload,
  onPlayNext,
  onToggleFavorite,
  onAddToPlaylist,
  onCreatePlaylist,
  onSaveTrack,
  onDeleteTrack,
  onDeleteDownloadedTracks,
  onOpenAddSongs,
  addToPlaylistMode = false,
  addedPlaylistTrackIds = [],
  addingPlaylistTrackIds = [],
  onAddPlaylistTrack,
  playlists = [],
  hasActiveTrack = false,
  offlineMode = false,
  showTrackActions = true,
  playlistMode = false,
  onRemoveFromPlaylist,
  emptyMessage = 'No songs found',
}: {
  title?: string;
  onBack: () => void;
  onSelectTrack: (track: Track, queue?: Track[]) => void;
  onPlayAll: (queue?: Track[]) => void;
  onShuffle: (queue?: Track[]) => void;
  tracks: Track[];
  apiConnected: boolean;
  apiInitializing: boolean;
  isLoadingTracks: boolean;
  loadError: string | null;
  downloadedTrackIds: string[];
  downloadingTrackIds: string[];
  onSearch: (query?: string) => Promise<void>;
  onConnect: (token: string) => Promise<void>;
  onDownload: (track: Track) => Promise<Track>;
  onPlayNext: (track: Track) => void;
  onToggleFavorite: (track: Track) => Promise<Track>;
  onAddToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<PlaylistSummary>;
  onSaveTrack: (track: Track, changes: TrackEditChanges) => Promise<void>;
  onDeleteTrack: (track: Track) => Promise<void>;
  onDeleteDownloadedTracks?: (trackIds: string[]) => Promise<number>;
  onOpenAddSongs?: () => void;
  addToPlaylistMode?: boolean;
  addedPlaylistTrackIds?: string[];
  addingPlaylistTrackIds?: string[];
  onAddPlaylistTrack?: (track: Track) => Promise<void>;
  playlists?: PlaylistSummary[];
  hasActiveTrack?: boolean;
  offlineMode?: boolean;
  showTrackActions?: boolean;
  playlistMode?: boolean;
  onRemoveFromPlaylist?: (track: Track) => Promise<void>;
  emptyMessage?: string;
}) => {
  const listRef = useRef<Animated.SectionList<Track, SongSection>>(null);
  const pendingLetterSection = useRef<number | null>(null);
  const letterScrollRetries = useRef(0);
  const letterScrollRetryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const insets = useSafeAreaInsets();
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const [search, setSearch] = useState('');
  const [ascending, setAscending] = useState(true);
  const [sortMode, setSortMode] = useState<SongSortMode>('name');
  const [pairingCode, setPairingCode] = useState('');
  const [showPairingForm, setShowPairingForm] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionType, setSelectionType] = useState<'songs' | 'downloads' | null>(null);
  const [selectedDownloadIds, setSelectedDownloadIds] = useState<Set<string>>(() => new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [freedStorageMessage, setFreedStorageMessage] = useState<string | null>(null);
  const freedMessageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionToolbarActive = selectionMode && selectionType !== null;
  const selectionBarContext = useContext(LibrarySelectionBarContext);
  const setSelectionBar = selectionBarContext?.setBar;

  useEffect(() => () => {
    if (freedMessageTimeout.current) clearTimeout(freedMessageTimeout.current);
    if (letterScrollRetryTimeout.current) clearTimeout(letterScrollRetryTimeout.current);
  }, []);

  useEffect(() => {
    if (!apiConnected) return;
    const timeout = setTimeout(() => void onSearch(search), 250);
    return () => clearTimeout(timeout);
  }, [apiConnected, onSearch, search]);

  const sections = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search.trim());
    const filteredTracks = tracks.filter((track) =>
      normalizeSearchText(`${track.title} ${track.artist} ${track.album}`).includes(normalizedSearch),
    );

    const catalogOrder = new Map(tracks.map((track, index) => [track.id, index]));
    if (sortMode === 'dateAdded') {
      const allTracksHaveDates = filteredTracks.every((track) => getDateAddedTimestamp(track) !== null);
      filteredTracks.sort((first, second) => {
        const firstDate = getDateAddedTimestamp(first);
        const secondDate = getDateAddedTimestamp(second);
        const order = allTracksHaveDates && firstDate !== null && secondDate !== null
          ? firstDate - secondDate
          : (catalogOrder.get(first.id) ?? 0) - (catalogOrder.get(second.id) ?? 0);
        return ascending ? order : -order;
      });
    } else {
      const sortValue = (track: Track) => sortMode === 'artist' ? track.artist : track.title;
      filteredTracks.sort((first, second) => {
        const firstValue = sortValue(first);
        const secondValue = sortValue(second);
        const firstSection = getSectionTitle(firstValue);
        const secondSection = getSectionTitle(secondValue);
        let order = 0;

        if (firstSection === '#' && secondSection !== '#') order = 1;
        else if (firstSection !== '#' && secondSection === '#') order = -1;
        else order = collator.compare(firstSection, secondSection);

        if (order === 0) order = collator.compare(firstValue, secondValue);
        if (order === 0 && sortMode === 'artist') order = collator.compare(first.title, second.title);
        return ascending ? order : -order;
      });
    }

    const groups = new Map<string, Track[]>();
    filteredTracks.forEach((track) => {
      const sectionTitle = sortMode === 'dateAdded'
        ? 'Recently Added'
        : getSectionTitle(sortMode === 'artist' ? track.artist : track.title);
      const currentSongs = groups.get(sectionTitle) ?? [];
      currentSongs.push(track);
      groups.set(sectionTitle, currentSongs);
    });

    return Array.from(groups, ([title, data]) => ({ title, data }));
  }, [ascending, search, sortMode, tracks]);
  const playQueue = useMemo(() => sections.flatMap((section) => section.data), [sections]);

  const downloadIds = useMemo(() => new Set(downloadedTrackIds), [downloadedTrackIds]);
  const downloadingIds = useMemo(() => new Set(downloadingTrackIds), [downloadingTrackIds]);
  const addedPlaylistIds = useMemo(() => new Set(addedPlaylistTrackIds), [addedPlaylistTrackIds]);
  const addingPlaylistIds = useMemo(() => new Set(addingPlaylistTrackIds), [addingPlaylistTrackIds]);
  const allTracksSelected = tracks.length > 0 && selectedDownloadIds.size === tracks.length;
  const canReplacePairingCode = Boolean(loadError && /valid.*musiqapp.*api.*token|api token.*required|\b401\b/i.test(loadError));

  const toggleSelectAllTracks = useCallback(() => {
    if (allTracksSelected) {
      setSelectedDownloadIds(new Set());
      return;
    }
    setSelectedDownloadIds(new Set(tracks.map((track) => track.id)));
  }, [allTracksSelected, tracks]);

  const deleteSelectedDownloads = useCallback(async () => {
    if (!onDeleteDownloadedTracks || selectedDownloadIds.size === 0 || deletingSelected) return;
    setDeletingSelected(true);
    try {
      const freedBytes = await onDeleteDownloadedTracks([...selectedDownloadIds]);
      setSelectionMode(false);
      setSelectionType(null);
      setSelectedDownloadIds(new Set());
      setFreedStorageMessage(`${(freedBytes / (1024 * 1024)).toFixed(2)} MB has been freed`);
      if (freedMessageTimeout.current) clearTimeout(freedMessageTimeout.current);
      freedMessageTimeout.current = setTimeout(() => setFreedStorageMessage(null), 1000);
    } catch (error) {
      Alert.alert('Could not delete downloads', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setDeletingSelected(false);
    }
  }, [deletingSelected, onDeleteDownloadedTracks, selectedDownloadIds]);

  const cancelDownloadSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectionType(null);
    setSelectedDownloadIds(new Set());
  }, []);

  const deleteSelectedSongs = useCallback(async () => {
    if (selectedDownloadIds.size === 0 || deletingSelected) return;
    setDeletingSelected(true);
    const failedIds = new Set<string>();
    const errors: string[] = [];
    try {
      for (const trackId of selectedDownloadIds) {
        const track = tracks.find((item) => item.id === trackId);
        if (!track) continue;
        try {
          await onDeleteTrack(track);
        } catch (error) {
          failedIds.add(trackId);
          errors.push(`${track.title}: ${error instanceof Error ? error.message : 'Please try again.'}`);
        }
      }

      setSelectedDownloadIds(failedIds);
      if (failedIds.size === 0) {
        setSelectionMode(false);
        setSelectionType(null);
      } else {
        Alert.alert(
          'Some songs could not be deleted',
          `${selectedDownloadIds.size - failedIds.size} deleted.\n${errors.join('\n')}`,
        );
      }
    } finally {
      setDeletingSelected(false);
    }
  }, [deletingSelected, onDeleteTrack, selectedDownloadIds, tracks]);

  const confirmDeleteSelectedSongs = useCallback(() => {
    if (selectedDownloadIds.size === 0 || deletingSelected) return;
    Alert.alert(
      'Delete selected songs?',
      `${selectedDownloadIds.size} ${selectedDownloadIds.size === 1 ? 'song' : 'songs'} will be deleted from your library. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteSelectedSongs() },
      ],
    );
  }, [deleteSelectedSongs, deletingSelected, selectedDownloadIds]);

  useEffect(() => {
    if (!setSelectionBar) return;
    if (!selectionToolbarActive || !selectionType) {
      setSelectionBar(null);
      return;
    }

    setSelectionBar({
      selectionType,
      selectedCount: selectedDownloadIds.size,
      allSelected: allTracksSelected,
      canSelectAll: tracks.length > 0,
      deleting: deletingSelected,
      onToggleSelectAll: toggleSelectAllTracks,
      onCancel: cancelDownloadSelection,
      onDelete: selectionType === 'songs' ? confirmDeleteSelectedSongs : () => { void deleteSelectedDownloads(); },
    });
  }, [
    allTracksSelected,
    cancelDownloadSelection,
    confirmDeleteSelectedSongs,
    deleteSelectedDownloads,
    deletingSelected,
    selectedDownloadIds.size,
    selectionToolbarActive,
    selectionType,
    setSelectionBar,
    toggleSelectAllTracks,
    tracks.length,
  ]);

  useFocusEffect(useCallback(() => () => {
    setSelectionBar?.(null);
    setSelectionMode(false);
    setSelectionType(null);
    setSelectedDownloadIds(new Set());
  }, [setSelectionBar]));

  const download = async (track: Track) => {
    try {
      await onDownload(track);
    } catch (error) {
      Alert.alert('Download failed', error instanceof Error ? error.message : 'Could not save this track.');
    }
  };

  const connect = async () => {
    setConnecting(true);
    setConnectionError(null);
    try {
      await onConnect(pairingCode);
      setPairingCode('');
      setShowPairingForm(false);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not connect to your VPS library.');
    } finally {
      setConnecting(false);
    }
  };

  const jumpToLetter = (letter: string) => {
    if (sections.length === 0) return;

    const exactSection = sections.findIndex((section) => section.title === letter);
    const nextSection = sections.findIndex((section) =>
      ascending ? section.title >= letter : section.title <= letter,
    );
    const sectionIndex = exactSection >= 0 ? exactSection : nextSection >= 0 ? nextSection : sections.length - 1;

    pendingLetterSection.current = sectionIndex;
    letterScrollRetries.current = 0;
    if (letterScrollRetryTimeout.current) clearTimeout(letterScrollRetryTimeout.current);
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, animated: true, viewPosition: 0 });
  };

  const recoverLetterScroll = ({ index, averageItemLength }: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    const list = listRef.current;
    const sectionIndex = pendingLetterSection.current;
    if (!list || sectionIndex === null) return;

    // First move near the unmeasured row, then retry once it has entered the render window.
    if (averageItemLength > 0) {
      list.getScrollResponder()?.scrollTo({ y: Math.max(0, index * averageItemLength), animated: false });
    }
    if (letterScrollRetries.current >= 2) {
      pendingLetterSection.current = null;
      return;
    }

    letterScrollRetries.current += 1;
    letterScrollRetryTimeout.current = setTimeout(() => {
      listRef.current?.scrollToLocation({
        sectionIndex,
        itemIndex: 0,
        animated: false,
        viewPosition: 0,
      });
    }, 80);
  };

  const scrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const songsBannerOffset = scrollY.interpolate({
    inputRange: [0, 22, 72, 204],
    outputRange: [22, 0, 0, -132],
    extrapolate: 'clamp',
  });
  const topFadeOpacity = scrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });

  if (apiInitializing) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#FA243C" />
      </SafeAreaView>
    );
  }

  if ((!apiConnected || showPairingForm) && !offlineMode) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
        <SongsHeader onBack={onBack} onToggleSort={() => undefined} liquidGlass />
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 90 }}>
          <Text style={{ color: 'white', fontSize: 34, fontWeight: '800', marginBottom: 12 }}>{title}</Text>
          <Text style={{ color: '#A1A1A6', fontSize: 16, lineHeight: 23, marginBottom: 22 }}>
            Your local music folder is still loading. No pairing code is needed.
          </Text>
          <TextInput
            value={pairingCode}
            onChangeText={setPairingCode}
            placeholder="No pairing code needed"
            placeholderTextColor="#8E8E93"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={{
              height: 52,
              borderRadius: 16,
              paddingHorizontal: 16,
              color: 'white',
              backgroundColor: '#1C1C1E',
              fontSize: 16,
              marginBottom: 14,
            }}
          />
          <TouchableOpacity
            onPress={() => void connect()}
            disabled={connecting || !pairingCode.trim()}
            style={{
              height: 52,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FA243C',
              opacity: connecting || !pairingCode.trim() ? 0.55 : 1,
            }}
          >
            {connecting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>Connect</Text>}
          </TouchableOpacity>
          {connectionError ? (
            <Text style={{ color: '#FA5265', fontSize: 14, marginTop: 14 }}>{connectionError}</Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index, section }) => (
            <SongListItem
              track={item}
              onPress={() => onSelectTrack(item, playQueue)}
              onDownload={() => void download(item)}
              addMode={addToPlaylistMode}
              alreadyAdded={addedPlaylistIds.has(item.id)}
              adding={addingPlaylistIds.has(item.id)}
              onAddToPlaylist={() => onAddPlaylistTrack?.(item)}
              selectionMode={selectionMode}
              selected={selectedDownloadIds.has(item.id)}
              onToggleSelected={() => setSelectedDownloadIds((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })}
              onMore={showTrackActions ? (anchor) => setSelectedTrack({ track: item, anchor }) : undefined}
              showMore={showTrackActions}
              downloaded={downloadIds.has(item.id)}
              downloading={downloadingIds.has(item.id)}
              isLast={index === section.data.length - 1}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text
              style={{
                color: 'white',
                fontSize: 20,
                lineHeight: 26,
                fontWeight: '700',
                marginTop: 20,
                marginBottom: 1,
                paddingHorizontal: 20,
              }}
            >
              {section.title}
            </Text>
          )}
          ListHeaderComponent={
            <View>
              <SongsControls
                search={search}
                onSearchChange={setSearch}
                onPlay={() => onPlayAll(playQueue)}
                onShuffle={() => onShuffle(playQueue)}
                selectionMode={selectionMode}
              />
            </View>
          }
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
              {isLoadingTracks ? (
                <Text style={{ color: '#8E8E93', fontSize: 16 }}>Loading your music…</Text>
              ) : canReplacePairingCode ? (
                <TouchableOpacity
                  onPress={() => {
                    setConnectionError(null);
                    setShowPairingForm(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Enter a new Musiqapp API pairing code"
                >
                  <Text style={{ color: '#8E8E93', fontSize: 16, textDecorationLine: 'underline' }}>
                    {loadError} Tap to enter a new code.
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ color: '#8E8E93', fontSize: 16 }}>{loadError ?? emptyMessage}</Text>
              )}
            </View>
          }
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          onScrollToIndexFailed={recoverLetterScroll}
          scrollEventThrottle={16}
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ paddingTop: 58, paddingBottom: 190 }}
          initialNumToRender={12}
          windowSize={7}
        />

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
            opacity: topFadeOpacity,
          }}
        >
          <LinearGradient
            colors={['#000000', '#000000', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
            locations={[0, 0.32, 0.68, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 58,
            left: 0,
            right: 0,
            height: 46,
            zIndex: 16,
            elevation: 16,
            transform: [{ translateY: songsBannerOffset }],
          }}
        >
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: 20,
              backgroundColor: '#000000',
            }}
          >
            <Text style={{ color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800' }}>
              {title}
            </Text>
          </View>
        </Animated.View>

        <SongsHeader
          onBack={onBack}
          onToggleSort={() => setAscending((value) => !value)}
          sortAccessibilityLabel="Reverse song order"
          liquidGlass
          moreMenuItems={[
            ...(title === 'Songs' ? [
              {
                label: selectionMode && selectionType === 'songs' ? 'Cancel Selection' : 'Select',
                icon: selectionMode && selectionType === 'songs' ? 'close' as const : 'checkbox-outline' as const,
                onPress: selectionMode && selectionType === 'songs' ? cancelDownloadSelection : () => {
                  setSelectedDownloadIds(new Set());
                  setSelectionType('songs');
                  setSelectionMode(true);
                },
              },
              {
                label: 'Name A–Z–#',
                icon: sortMode === 'name' && ascending ? 'checkmark' as const : 'radio-button-off' as const,
                onPress: () => { setSortMode('name'); setAscending(true); },
              },
              {
                label: 'Name #–A–Z',
                icon: sortMode === 'name' && !ascending ? 'checkmark' as const : 'radio-button-off' as const,
                onPress: () => { setSortMode('name'); setAscending(false); },
              },
              {
                label: 'Date Added',
                icon: sortMode === 'dateAdded' ? 'checkmark' as const : 'radio-button-off' as const,
                onPress: () => { setSortMode('dateAdded'); setAscending(false); },
              },
              {
                label: 'Artist',
                icon: sortMode === 'artist' ? 'checkmark' as const : 'radio-button-off' as const,
                onPress: () => { setSortMode('artist'); setAscending(true); },
              },
            ] : []),
            ...(onOpenAddSongs ? [{ label: 'Add a Song', icon: 'add-circle-outline' as const, onPress: onOpenAddSongs }] : []),
            ...(onDeleteDownloadedTracks ? [{
              label: selectionMode && selectionType === 'downloads' ? 'Cancel Selection' : 'Clear Storage',
              icon: selectionMode && selectionType === 'downloads' ? 'close' as const : 'trash-outline' as const,
              onPress: selectionMode && selectionType === 'downloads' ? cancelDownloadSelection : () => {
                setSelectedDownloadIds(new Set());
                setSelectionType('downloads');
                setSelectionMode(true);
              },
              destructive: !(selectionMode && selectionType === 'downloads'),
            }] : []),
          ]}
        />
        <AlphabetIndex onSelectLetter={jumpToLetter} />

        {freedStorageMessage ? (
          <View
            pointerEvents="none"
            accessibilityRole="alert"
            style={{
              position: 'absolute',
              alignSelf: 'center',
              bottom: 174,
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 24,
              backgroundColor: '#303034',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
              zIndex: 35,
              elevation: 35,
            }}
          >
            <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>{freedStorageMessage}</Text>
          </View>
        ) : null}
      </View>
      {selectedTrack ? (
        <TrackActionsSheet
          key={selectedTrack.track.id}
          track={selectedTrack.track}
          anchor={selectedTrack.anchor}
          playlistMode={playlistMode}
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
          onRemoveFromPlaylist={onRemoveFromPlaylist}
        />
      ) : null}
    </SafeAreaView>
  );
};
