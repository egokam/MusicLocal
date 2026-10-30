import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { usePlaybackActions } from '../contexts/PlaybackContext';
import { TrackActionsSheet } from '../components/songs/TrackActionsSheet';
import { TrackListSkeleton } from '../components/Skeleton';
import { getMusicApiHeaders, MusicCatalogService, type TrackEditChanges } from '../services/MusicCatalogService';
import { AudiusCatalogService } from '../services/AudiusCatalogService';
import type { PlaylistSummary, Track } from '../types';
import type { SongMenuAnchor } from '../components/songs/SongListItem';

type SearchScope = 'universal' | 'library';
type RecentEntry =
  | { kind: 'track'; id: string; track: Track }
  | { kind: 'artist'; id: string; title: string; artwork: string; source: string }
  | { kind: 'query'; id: string; title: string; scope: SearchScope };
type ArtistResult = { name: string; artwork: string; sourceTrack: Track };

const RECENTS_KEY = 'musiqapp_recent_searches_v1';
const MAX_RECENTS = 6;

const normalizeSearchText = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
  .toLocaleLowerCase();

const trackSearchText = (track: Track) => [
  track.title,
  track.artist,
  track.album,
  track.plainLyrics,
  track.syncedLyrics,
  ...(track.lyrics?.map((line) => line.text) ?? []),
].filter(Boolean).join(' ');

const isLibraryTrack = (track: Track) => track.provider === 'local';

const compactTrack = (track: Track): Track => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  duration: track.duration,
  ...(track.durationSeconds === undefined ? {} : { durationSeconds: track.durationSeconds }),
  artwork: track.artwork,
  ...(track.provider ? { provider: track.provider } : {}),
  ...(track.providerId ? { providerId: track.providerId } : {}),
  ...(track.streamUrl ? { streamUrl: track.streamUrl } : {}),
  ...(track.downloadUrl ? { downloadUrl: track.downloadUrl } : {}),
  ...(track.downloadAllowed === undefined ? {} : { downloadAllowed: track.downloadAllowed }),
  ...(track.isFavorite === undefined ? {} : { isFavorite: track.isFavorite }),
});

const SearchTrackRow = ({
  track,
  sourceLabel,
  downloaded,
  downloading,
  onPress,
  onDownload,
  onMore,
  isLast,
}: {
  track: Track;
  sourceLabel: string;
  downloaded: boolean;
  downloading: boolean;
  onPress: () => void;
  onDownload: () => void;
  onMore: (anchor: SongMenuAnchor) => void;
  isLast: boolean;
}) => {
  const isLocal = isLibraryTrack(track);

  return (
    <View style={{ minHeight: 82, paddingLeft: 20, flexDirection: 'row', alignItems: 'center' }}>
      {track.artwork ? (
        <Image
          source={{ uri: track.artwork, ...(isLocal ? { headers: getMusicApiHeaders() } : {}) }}
          resizeMode="cover"
          style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#2C2C2E' }}
        />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#202023', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="musical-note" size={22} color="#FA5265" />
        </View>
      )}
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${track.title} by ${track.artist}${track.isFavorite ? ', favorited' : ''}`}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 82,
          marginLeft: 12,
          paddingVertical: 12,
          paddingRight: 4,
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: '#2C2C2E',
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: '#F5F5F7', fontSize: 16, fontWeight: '600' }}>
            {track.title}
          </Text>
          {track.isFavorite ? <Ionicons name="heart" size={13} color="#FA243C" style={{ marginLeft: 5 }} /> : null}
        </View>
        <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 14, fontWeight: '500', marginTop: 3 }}>
          Song · {track.artist}
        </Text>
        <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, fontWeight: '500', marginTop: 3 }}>
          {sourceLabel}
        </Text>
      </TouchableOpacity>
      <View style={{ minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#2C2C2E' }}>
        <TouchableOpacity
          onPress={onDownload}
          disabled={!isLocal || !track.downloadAllowed || downloaded || downloading}
          accessibilityRole="button"
          accessibilityLabel={downloaded ? `${track.title} is downloaded` : `Download ${track.title}`}
          style={{ width: 28, height: 40, alignItems: 'center', justifyContent: 'center', opacity: isLocal && track.downloadAllowed ? 1 : 0.35 }}
        >
          {downloading ? <ActivityIndicator size="small" color="#8E8E93" /> : (
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={downloaded ? 'checkmark' : 'arrow-down'} size={14} color="#A1A1A6" />
            </View>
          )}
        </TouchableOpacity>
        {isLocal ? (
          <TouchableOpacity
            onPress={(event) => {
              const { pageX, pageY, locationX, locationY } = event.nativeEvent;
              onMore({ x: pageX - locationX, y: pageY - locationY, width: 30, height: 40 });
            }}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${track.title}`}
            hitSlop={8}
            style={{ width: 30, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="white" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export const SearchScreen = () => {
  const actions = usePlaybackActions();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const recentLoaded = useRef(false);
  const [scope, setScope] = useState<SearchScope>('universal');
  const [query, setQuery] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchNotice, setSearchNotice] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);

  const localTracks = useMemo(() => {
    const byId = new Map<string, Track>();
    [...actions.tracks, ...actions.downloadedTracks].forEach((track) => {
      if (isLibraryTrack(track)) byId.set(track.id, track);
    });
    return [...byId.values()];
  }, [actions.downloadedTracks, actions.tracks]);
  const cachedMatches = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query.trim());
    if (!normalizedQuery) return [];
    return localTracks.filter((track) => (
      normalizeSearchText(trackSearchText(track)).includes(normalizedQuery)
    ));
  }, [localTracks, query]);
  const visibleResults = useMemo(
    () => query.trim() ? (loading ? cachedMatches : results) : [],
    [cachedMatches, loading, query, results],
  );
  const favoriteIds = useMemo(() => new Set(actions.favoriteTracks.map((track) => track.id)), [actions.favoriteTracks]);
  const downloadedIds = useMemo(() => new Set(actions.downloadedTrackIds), [actions.downloadedTrackIds]);
  const downloadingIds = useMemo(() => new Set(actions.downloadingTrackIds), [actions.downloadingTrackIds]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(RECENTS_KEY).then((value) => {
      if (!mounted || !value) return;
      try {
        const saved = JSON.parse(value) as RecentEntry[];
        if (Array.isArray(saved)) setRecents(saved.slice(0, MAX_RECENTS));
      } catch {
        // Ignore old or malformed recent-search data.
      }
    }).catch(() => undefined).finally(() => {
      if (mounted) recentLoaded.current = true;
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!recentLoaded.current) return;
    const compactRecents = recents.slice(0, 4).map((entry): RecentEntry =>
      entry.kind === 'track' ? { ...entry, track: compactTrack(entry.track) } : entry,
    );
    void SecureStore.setItemAsync(RECENTS_KEY, JSON.stringify(compactRecents)).catch(() => undefined);
  }, [recents]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    let cancelled = false;

    const timeout = setTimeout(() => {
      void (async () => {
        let libraryMatches = cachedMatches;
        let libraryFailed = false;

        if (actions.apiConnected) {
          try {
            const libraryTracks = await MusicCatalogService.searchTracks(trimmedQuery);
            const cachedById = new Map(localTracks.map((track) => [track.id, track]));
            const mergedLibraryTracks = libraryTracks
              .filter((track) => track.provider === 'local')
              .map((track) => {
                const cached = cachedById.get(track.id);
                return {
                  ...track,
                  ...(cached?.localUri ? { localUri: cached.localUri } : {}),
                  ...(cached?.syncedLyrics && !track.syncedLyrics ? { syncedLyrics: cached.syncedLyrics } : {}),
                  ...(cached?.plainLyrics && !track.plainLyrics ? { plainLyrics: cached.plainLyrics } : {}),
                  isFavorite: Boolean(track.isFavorite || favoriteIds.has(track.id)),
                };
              });
            const libraryIds = new Set(mergedLibraryTracks.map((track) => track.id));
            libraryMatches = [...mergedLibraryTracks, ...cachedMatches.filter((track) => !libraryIds.has(track.id))];
          } catch {
            libraryFailed = true;
          }
        }

        let nextResults = libraryMatches;
        let audiusFailed = false;
        if (scope === 'universal') {
          try {
            const audiusTracks = await AudiusCatalogService.searchTracks(trimmedQuery);
            nextResults = [...libraryMatches, ...audiusTracks];
          } catch {
            audiusFailed = true;
          }
        }

        if (cancelled) return;
        const uniqueResults = [...new Map(nextResults.map((track) => [track.id, track])).values()];
        setResults(uniqueResults);
        setSearchNotice(
          libraryFailed && audiusFailed ? 'Some sources could not be reached. Showing available results.'
            : libraryFailed ? 'Your local library could not be read. Showing cached tracks.'
              : !actions.apiConnected && scope === 'library' ? 'Your local library is still loading.'
                : audiusFailed && scope === 'universal' ? 'Audius search is temporarily unavailable.' : '',
        );
        setLoading(false);
      })();
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [actions.apiConnected, cachedMatches, favoriteIds, localTracks, query, scope]);

  const artists = useMemo<ArtistResult[]>(() => {
    const seen = new Set<string>();
    const found: ArtistResult[] = [];
    visibleResults.forEach((track) => {
      const name = track.artist.trim();
      const key = normalizeSearchText(name);
      if (!name || seen.has(key)) return;
      seen.add(key);
      found.push({ name, artwork: track.artwork, sourceTrack: track });
    });
    return found.slice(0, 4);
  }, [visibleResults]);

  const addRecent = (entry: RecentEntry) => {
    setRecents((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENTS));
  };

  const searchThis = (nextQuery: string, nextScope: SearchScope = scope) => {
    if (nextQuery === query && nextScope === scope) return;
    setScope(nextScope);
    setQuery(nextQuery);
    setLoading(Boolean(nextQuery.trim()));
    setSearchNotice('');
  };

  const updateScope = (nextScope: SearchScope) => {
    if (nextScope === scope) return;
    setScope(nextScope);
    setLoading(Boolean(query.trim()));
    setSearchNotice('');
  };

  const updateQuery = (nextQuery: string) => {
    if (nextQuery === query) return;
    setQuery(nextQuery);
    setLoading(Boolean(nextQuery.trim()));
    setSearchNotice('');
  };

  const selectTrack = (track: Track, queue: Track[] = results) => {
    addRecent({ kind: 'track', id: `track:${track.id}`, track: compactTrack(track) });
    actions.playTrack(track, queue.length > 0 ? queue : [track]);
  };

  const selectArtist = (artist: ArtistResult) => {
    addRecent({
      kind: 'artist',
      id: `artist:${normalizeSearchText(artist.name)}`,
      title: artist.name,
      artwork: artist.artwork,
      source: isLibraryTrack(artist.sourceTrack) ? 'Your Library' : 'Audius',
    });
    searchThis(artist.name);
    Keyboard.dismiss();
  };

  const submitQuery = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    addRecent({ kind: 'query', id: `query:${scope}:${normalizeSearchText(trimmed)}`, title: trimmed, scope });
    Keyboard.dismiss();
  };

  const clearRecentSearches = () => {
    setRecents([]);
    void SecureStore.deleteItemAsync(RECENTS_KEY).catch(() => undefined);
  };

  const download = async (track: Track) => {
    try {
      await actions.downloadTrack(track);
    } catch (error) {
      Alert.alert('Download failed', error instanceof Error ? error.message : 'Could not save this track.');
    }
  };

  const sourceLabel = (track: Track) => isLibraryTrack(track) ? 'From Your Library' : 'From Audius';
  const searchBottomGap = keyboardVisible ? 8 : actions.hasActiveTrack ? 170 + insets.bottom : 96 + insets.bottom;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={{ marginHorizontal: 20, marginTop: 8, height: 52, borderRadius: 28, padding: 4, flexDirection: 'row', backgroundColor: '#171719', borderWidth: 1, borderColor: '#2C2C2E' }}>
          {(['universal', 'library'] as const).map((item) => {
            const selected = scope === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => updateScope(item)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={item === 'universal' ? 'Universal search' : 'Library search'}
                style={{ flex: 1, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? '#37373A' : 'transparent' }}
              >
                <Text style={{ color: '#F5F5F7', fontSize: 16, fontWeight: selected ? '700' : '600' }}>
                  {item === 'universal' ? 'Universal' : 'Library'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 28, paddingBottom: keyboardVisible ? 16 : actions.hasActiveTrack ? 240 : 170 }}
        >
          {!query.trim() ? (
            <View>
              <View style={{ paddingHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#F5F5F7', fontSize: 19, fontWeight: '700' }}>Recently Searched</Text>
                {recents.length > 0 ? (
                  <TouchableOpacity onPress={clearRecentSearches} accessibilityRole="button" accessibilityLabel="Clear recent searches" hitSlop={8}>
                    <Text style={{ color: '#FA5265', fontSize: 16, fontWeight: '600' }}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {recents.length > 0 ? recents.map((entry, index) => {
                if (entry.kind === 'track') {
                  const track = entry.track;
                  const resolvedTrack = localTracks.find((item) => item.id === track.id) ?? track;
                  return (
                    <SearchTrackRow
                      key={entry.id}
                      track={{ ...resolvedTrack, isFavorite: Boolean(resolvedTrack.isFavorite || favoriteIds.has(resolvedTrack.id)) }}
                      sourceLabel={sourceLabel(resolvedTrack)}
                      downloaded={downloadedIds.has(resolvedTrack.id)}
                      downloading={downloadingIds.has(resolvedTrack.id)}
                      onPress={() => selectTrack(resolvedTrack, [resolvedTrack])}
                      onDownload={() => void download(resolvedTrack)}
                      onMore={(anchor) => setSelectedTrack({ track: resolvedTrack, anchor })}
                      isLast={index === recents.length - 1}
                    />
                  );
                }

                if (entry.kind === 'artist') {
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      onPress={() => searchThis(entry.title)}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for artist ${entry.title}`}
                      style={{ minHeight: 82, paddingLeft: 20, flexDirection: 'row', alignItems: 'center' }}
                    >
                      {entry.artwork ? (
                        <Image
                          source={{ uri: entry.artwork, ...(entry.source === 'Your Library' ? { headers: getMusicApiHeaders() } : {}) }}
                          resizeMode="cover"
                          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#2C2C2E' }}
                        />
                      ) : (
                        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#202023', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="person" size={22} color="#A1A1A6" />
                        </View>
                      )}
                      <View style={{ flex: 1, minHeight: 82, marginLeft: 12, justifyContent: 'center', borderBottomWidth: index === recents.length - 1 ? 0 : 1, borderBottomColor: '#2C2C2E' }}>
                        <Text numberOfLines={1} style={{ color: '#F5F5F7', fontSize: 16, fontWeight: '600' }}>{entry.title}</Text>
                        <Text style={{ color: '#A1A1A6', fontSize: 14, marginTop: 3 }}>Artist</Text>
                        <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 3 }}>From {entry.source}</Text>
                      </View>
                      <View style={{ width: 48, alignItems: 'center' }}><Ionicons name="chevron-forward" size={20} color="#8E8E93" /></View>
                    </TouchableOpacity>
                  );
                }

                return (
                  <TouchableOpacity
                    key={entry.id}
                    onPress={() => searchThis(entry.title, entry.scope)}
                    accessibilityRole="button"
                    style={{ minHeight: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', borderBottomWidth: index === recents.length - 1 ? 0 : 1, borderBottomColor: '#2C2C2E' }}
                  >
                    <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#202023', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="search" size={22} color="#A1A1A6" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text numberOfLines={1} style={{ color: '#F5F5F7', fontSize: 16, fontWeight: '600' }}>{entry.title}</Text>
                      <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 3 }}>{entry.scope === 'universal' ? 'Universal search' : 'Library search'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#8E8E93" />
                  </TouchableOpacity>
                );
              }) : (
                <View style={{ marginHorizontal: 20, minHeight: 94, justifyContent: 'center', borderTopWidth: 1, borderTopColor: '#2C2C2E' }}>
                  <Text style={{ color: '#8E8E93', fontSize: 15 }}>Your recent searches will appear here.</Text>
                </View>
              )}
            </View>
          ) : (
            <View>
              {loading && visibleResults.length === 0 ? <TrackListSkeleton count={5} /> : null}
              {searchNotice ? <Text style={{ color: '#A1A1A6', fontSize: 13, marginHorizontal: 20, marginBottom: 14 }}>{searchNotice}</Text> : null}
              {artists.length > 0 ? (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ color: '#F5F5F7', fontSize: 19, fontWeight: '700', marginHorizontal: 20, marginBottom: 8 }}>Artists</Text>
                  {artists.map((artist) => (
                    <TouchableOpacity
                      key={normalizeSearchText(artist.name)}
                      onPress={() => selectArtist(artist)}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for artist ${artist.name}`}
                      style={{ minHeight: 68, paddingLeft: 20, flexDirection: 'row', alignItems: 'center' }}
                    >
                      {artist.artwork ? (
                        <Image
                          source={{ uri: artist.artwork, ...(isLibraryTrack(artist.sourceTrack) ? { headers: getMusicApiHeaders() } : {}) }}
                          resizeMode="cover"
                          style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#2C2C2E' }}
                        />
                      ) : (
                        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#202023', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="person" size={22} color="#A1A1A6" />
                        </View>
                      )}
                      <View style={{ flex: 1, minHeight: 68, marginLeft: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#2C2C2E' }}>
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ color: '#F5F5F7', fontSize: 16, fontWeight: '600' }}>{artist.name}</Text>
                          <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 3 }}>Artist · {sourceLabel(artist.sourceTrack).replace('From ', '')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#8E8E93" style={{ marginRight: 16 }} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <Text style={{ color: '#F5F5F7', fontSize: 19, fontWeight: '700', marginHorizontal: 20, marginBottom: 8 }}>Songs</Text>
              {visibleResults.map((track, index) => (
                <SearchTrackRow
                  key={track.id}
                  track={{ ...track, isFavorite: Boolean(track.isFavorite || favoriteIds.has(track.id)) }}
                  sourceLabel={sourceLabel(track)}
                  downloaded={downloadedIds.has(track.id)}
                  downloading={downloadingIds.has(track.id)}
                  onPress={() => selectTrack(track, visibleResults)}
                  onDownload={() => void download(track)}
                  onMore={(anchor) => setSelectedTrack({ track, anchor })}
                  isLast={index === visibleResults.length - 1}
                />
              ))}
              {!loading && visibleResults.length === 0 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
                  <Text style={{ color: '#8E8E93', fontSize: 15 }}>No matches found.</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        <View style={{ marginHorizontal: 16, marginBottom: searchBottomGap, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, height: 52, borderRadius: 28, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#29292C' }}>
            <Ionicons name="search" size={22} color="#F5F5F7" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={updateQuery}
              onSubmitEditing={submitQuery}
              placeholder={scope === 'universal' ? 'Artists, Songs, Lyrics, and More' : 'Search your library'}
              placeholderTextColor="#8E8E93"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              enterKeyHint="search"
              selectionColor="#FA5265"
              keyboardAppearance="dark"
              accessibilityLabel={scope === 'universal' ? 'Search all sources' : 'Search your library'}
              style={{ flex: 1, minWidth: 0, height: '100%', marginLeft: 10, paddingVertical: 0, color: 'white', fontSize: 16, fontWeight: '500' }}
            />
            <View accessible={false} style={{ width: 28, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="mic-outline" size={22} color="#F5F5F7" />
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              updateQuery('');
              inputRef.current?.blur();
              Keyboard.dismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search and close keyboard"
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#2C2C2E' }}
          >
            <Ionicons name="close" size={29} color="white" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <TrackActionsSheet
        track={selectedTrack?.track ?? null}
        anchor={selectedTrack?.anchor ?? { x: 0, y: 0, width: 0, height: 0 }}
        visible={selectedTrack !== null}
        playlists={actions.playlists}
        hasActiveTrack={actions.hasActiveTrack}
        onClose={() => setSelectedTrack(null)}
        onPlayNext={actions.playNext}
        onToggleFavorite={actions.toggleFavorite}
        onAddToPlaylist={actions.addTrackToPlaylist}
        onCreatePlaylist={async (name: string): Promise<PlaylistSummary> => actions.createPlaylist(name)}
        onSaveTrack={async (track: Track, changes: TrackEditChanges) => { await actions.updateTrack(track, changes); }}
        onDeleteTrack={actions.deleteTrack}
      />
    </SafeAreaView>
  );
};
