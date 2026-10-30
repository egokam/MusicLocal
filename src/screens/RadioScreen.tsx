import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { usePlaybackActions, useRadioPlaybackStatus } from '../contexts/PlaybackContext';
import type { Track } from '../types';

/* eslint-disable react-hooks/refs */

type RadioStation = {
  stationuuid: string;
  name: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  country?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  lastcheckok?: number | boolean;
};

type CategoryId = 'popular' | 'morocco' | 'arabic' | 'pop' | 'jazz' | 'news' | 'favorites';

const FAVORITES_KEY = 'musiqapp_radio_favorites';
const DIRECTORY_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
const RADIO_CATEGORIES: { id: CategoryId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'popular', label: 'Popular', icon: 'sparkles-outline' },
  { id: 'morocco', label: 'Morocco', icon: 'location-outline' },
  { id: 'arabic', label: 'Arabic', icon: 'language-outline' },
  { id: 'pop', label: 'Pop', icon: 'musical-notes-outline' },
  { id: 'jazz', label: 'Jazz', icon: 'disc-outline' },
  { id: 'news', label: 'News', icon: 'newspaper-outline' },
  { id: 'favorites', label: 'Favorites', icon: 'heart-outline' },
];

const fetchRadioDirectory = async (path: string): Promise<RadioStation[]> => {
  let lastError: unknown;

  for (const mirror of DIRECTORY_MIRRORS) {
    try {
      const response = await fetch(`${mirror}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Musiqapp/1.0',
        },
      });
      if (!response.ok) {
        lastError = new Error(`Radio directory returned ${response.status}.`);
        continue;
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('The radio directory returned an invalid response.');
      return payload as RadioStation[];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('The radio directory is unavailable.');
};

const countStationClick = async (stationId: string) => {
  for (const mirror of DIRECTORY_MIRRORS) {
    try {
      const response = await fetch(`${mirror}/json/url/${encodeURIComponent(stationId)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Musiqapp/1.0' },
      });
      if (response.ok) return;
    } catch {
      // Counting is best-effort and should never delay playback.
    }
  }
};

const stationStreamUrl = (station: RadioStation) => {
  const url = station.url_resolved?.trim() || station.url?.trim() || '';
  return url.startsWith('https://') ? url : '';
};

const cleanStations = (stations: RadioStation[]) => {
  const seen = new Set<string>();
  return stations.filter((station) => {
    if (!station.stationuuid || !station.name?.trim() || !stationStreamUrl(station)) return false;
    if (station.lastcheckok === 0 || station.lastcheckok === false || seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const asTrack = (station: RadioStation): Track => ({
  id: `radio:${station.stationuuid}`,
  title: station.name.trim(),
  artist: station.country?.trim() || station.language?.split(',')[0]?.trim() || 'Live Radio',
  album: 'Live Radio',
  duration: 'LIVE',
  durationSeconds: 0,
  artwork: station.favicon?.startsWith('https://') ? station.favicon : '',
  provider: 'radio',
  providerId: station.stationuuid,
  streamUrl: stationStreamUrl(station),
  downloadUrl: null,
  downloadAllowed: false,
});

const directoryPath = (category: CategoryId, query: string, favoriteIds: string[]) => {
  if (category === 'favorites') {
    if (favoriteIds.length === 0) return null;
    return `/json/stations/byuuid?uuids=${encodeURIComponent(favoriteIds.slice(0, 40).join(','))}`;
  }

  if (!query.trim() && category === 'popular') {
    return '/json/stations/topclick/90?hidebroken=true';
  }

  const params = [
    'hidebroken=true',
    'is_https=true',
    'order=clickcount',
    'reverse=true',
    'limit=90',
  ];
  if (query.trim()) params.push(`name=${encodeURIComponent(query.trim())}`);
  if (category === 'morocco') params.push('countrycode=MA');
  if (category === 'arabic') params.push('language=arabic');
  if (category === 'pop') params.push('tag=pop');
  if (category === 'jazz') params.push('tag=jazz');
  if (category === 'news') params.push('tag=news');
  return `/json/stations/search?${params.join('&')}`;
};

const RadioVisualizer = memo(({ active }: { active: boolean }) => {
  const bars = useRef([new Animated.Value(0.24), new Animated.Value(0.24), new Animated.Value(0.24)]).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((bar) => {
        bar.stopAnimation();
        bar.setValue(0.24);
      });
      return undefined;
    }

    const loops = bars.map((bar, index) => Animated.loop(
      Animated.sequence([
        Animated.timing(bar, {
          toValue: 0.55 + index * 0.12,
          duration: 230 + index * 55,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(bar, {
          toValue: 0.2 + index * 0.04,
          duration: 270 + index * 45,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    ));
    loops.forEach((loop) => loop.start());

    return () => loops.forEach((loop) => loop.stop());
  }, [active, bars]);

  return (
    <View style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={active ? 'Radio playing' : 'Radio paused'}>
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={{
            width: 4,
            height: 26,
            borderRadius: 4,
            backgroundColor: '#FA5265',
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  );
});
RadioVisualizer.displayName = 'RadioVisualizer';

const RadioHeroCard = memo(({
  activeTrack,
  suggestedStation,
  onPlayStation,
  onTogglePlayback,
}: {
  activeTrack: Track | null;
  suggestedStation?: RadioStation;
  onPlayStation: (station: RadioStation) => void;
  onTogglePlayback: () => void;
}) => {
  const isPlaying = useRadioPlaybackStatus();
  const isRadioActive = activeTrack?.provider === 'radio';

  return (
    <LinearGradient
      colors={['#30131B', '#191216', '#141416']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ minHeight: 188, borderRadius: 26, overflow: 'hidden', padding: 20, marginTop: 20 }}
    >
      <View style={{ position: 'absolute', right: -28, top: -35, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(250,36,60,0.08)' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FA5265', marginRight: 7 }} />
            <Text style={{ color: '#FA5265', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>LIVE RADIO</Text>
          </View>
          <Text numberOfLines={2} style={{ color: 'white', fontSize: 23, lineHeight: 28, fontWeight: '800', maxWidth: 230 }}>
            {isRadioActive ? activeTrack?.title : 'Find your frequency'}
          </Text>
          <Text numberOfLines={1} style={{ color: '#AAA2A5', fontSize: 14, fontWeight: '500', marginTop: 6, maxWidth: 235 }}>
            {isRadioActive ? `${activeTrack?.artist} · streaming now` : 'Music, news and voices from everywhere'}
          </Text>
        </View>
        <View style={{ width: 74, height: 74, borderRadius: 24, backgroundColor: 'rgba(250,36,60,0.13)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(250,82,101,0.22)' }}>
          <RadioVisualizer active={isRadioActive && isPlaying} />
        </View>
      </View>

      <TouchableOpacity
        onPress={() => {
          if (isRadioActive) onTogglePlayback();
          else if (suggestedStation) onPlayStation(suggestedStation);
        }}
        disabled={!isRadioActive && !suggestedStation}
        activeOpacity={0.76}
        accessibilityRole="button"
        accessibilityLabel={isRadioActive ? (isPlaying ? 'Pause live radio' : 'Resume live radio') : 'Play a featured radio station'}
        style={{ alignSelf: 'flex-start', marginTop: 19, height: 40, paddingHorizontal: 16, borderRadius: 22, backgroundColor: '#FA243C', flexDirection: 'row', alignItems: 'center', gap: 8, opacity: !isRadioActive && !suggestedStation ? 0.5 : 1 }}
      >
        <Ionicons name={isRadioActive && isPlaying ? 'pause' : 'play'} size={17} color="white" />
        <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>
          {isRadioActive ? (isPlaying ? 'Pause' : 'Resume') : 'Play a station'}
        </Text>
      </TouchableOpacity>
    </LinearGradient>
  );
});
RadioHeroCard.displayName = 'RadioHeroCard';

const StationArtwork = memo(({ station }: { station: RadioStation }) => {
  const [failed, setFailed] = useState(!station.favicon?.startsWith('https://'));

  return (
    <View style={{ width: 58, height: 58, borderRadius: 17, backgroundColor: '#2A171C', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {!failed && station.favicon ? (
        <Image source={{ uri: station.favicon }} onError={() => setFailed(true)} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      ) : (
        <LinearGradient colors={['#57202C', '#211419']} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="radio" size={25} color="#FA5265" />
        </LinearGradient>
      )}
    </View>
  );
});
StationArtwork.displayName = 'StationArtwork';

const RadioStationRow = memo(({
  station,
  active,
  favorite,
  onPress,
  onToggleFavorite,
}: {
  station: RadioStation;
  active: boolean;
  favorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) => {
  const isPlaying = useRadioPlaybackStatus();
  const scale = useRef(new Animated.Value(1)).current;
  const metadata = [station.country, station.language?.split(',')[0], station.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ') || station.tags?.split(',').slice(0, 2).join(' · ') || 'Internet radio';

  useEffect(() => {
    Animated.spring(scale, {
      toValue: active ? 1.012 : 1,
      damping: 18,
      stiffness: 240,
      mass: 0.7,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  }, [active, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }], marginBottom: 10 }}>
      <View style={{ minHeight: 82, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 21, backgroundColor: active ? '#241419' : '#111113', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: active ? 'rgba(250,82,101,0.28)' : '#1B1B1E' }}>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={`${active ? (isPlaying ? 'Pause' : 'Resume') : 'Play'} ${station.name}`}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}
        >
          <StationArtwork key={station.favicon || station.stationuuid} station={station} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: 13, marginRight: 8 }}>
            <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>{station.name.trim()}</Text>
            <Text numberOfLines={1} style={{ color: '#929197', fontSize: 12, fontWeight: '500', marginTop: 5 }}>{metadata}</Text>
            {active ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 5 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isPlaying ? '#FA5265' : '#77777D' }} />
                <Text style={{ color: isPlaying ? '#FA5265' : '#929197', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>
                  {isPlaying ? 'ON AIR' : 'PAUSED'}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onToggleFavorite}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={favorite ? `Remove ${station.name} from radio favorites` : `Add ${station.name} to radio favorites`}
          accessibilityState={{ selected: favorite }}
          hitSlop={8}
          style={{ width: 38, height: 42, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={20} color={favorite ? '#FA5265' : '#77777D'} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={active && isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
          style={{ width: 40, height: 42, borderRadius: 21, backgroundColor: active ? 'rgba(250,82,101,0.15)' : '#202024', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
        >
          <Ionicons name={active && isPlaying ? 'pause' : 'play'} size={18} color={active ? '#FA5265' : 'white'} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
});
RadioStationRow.displayName = 'RadioStationRow';

export const RadioScreen = () => {
  const insets = useSafeAreaInsets();
  const { activeTrack, playTrack, togglePlayback } = usePlaybackActions();
  const [category, setCategory] = useState<CategoryId>('popular');
  const [search, setSearch] = useState('');
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const scrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const topFadeOpacity = scrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const intro = Animated.parallel([
      Animated.timing(introOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(introY, { toValue: 0, damping: 19, stiffness: 170, mass: 0.82, useNativeDriver: true }),
    ]);
    intro.start();
    return () => intro.stop();
  }, [introOpacity, introY]);

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(FAVORITES_KEY)
      .then((saved) => {
        if (!mounted) return;
        try {
          const parsed: unknown = saved ? JSON.parse(saved) : [];
          setFavoriteIds(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
        } catch {
          setFavoriteIds([]);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setFavoritesReady(true);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (category === 'favorites' && !favoritesReady) return undefined;
    let cancelled = false;
    const path = directoryPath(category, search, favoriteIds);

    const load = async () => {
      setLoading(true);
      setError(false);
      if (!path) {
        setStations([]);
        setLoading(false);
        return;
      }

      try {
        const response = cleanStations(await fetchRadioDirectory(path));
        if (cancelled) return;
        const query = search.trim().toLocaleLowerCase();
        setStations(category === 'favorites' && query
          ? response.filter((station) => `${station.name} ${station.country ?? ''} ${station.language ?? ''} ${station.tags ?? ''}`.toLocaleLowerCase().includes(query))
          : response.slice(0, 36));
      } catch {
        if (!cancelled) {
          setStations([]);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(() => { void load(); }, search.trim() ? 280 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, favoritesReady, favoriteIds, refreshKey, search]);

  const stationTracks = useMemo(() => stations.map(asTrack), [stations]);
  const firstStation = stations[0];

  const toggleStationPlayback = useCallback((station: RadioStation) => {
    const track = asTrack(station);
    if (activeTrack?.id === track.id) {
      togglePlayback();
      return;
    }

    playTrack(track, stationTracks.length > 0 ? stationTracks : [track]);
    if (station.stationuuid) {
      void countStationClick(station.stationuuid);
    }
  }, [activeTrack?.id, playTrack, stationTracks, togglePlayback]);

  const toggleFavorite = useCallback((stationId: string) => {
    if (!favoritesReady) return;
    setFavoriteIds((current) => {
      const next = current.includes(stationId)
        ? current.filter((id) => id !== stationId)
        : [...current, stationId].slice(-40);
      void SecureStore.setItemAsync(FAVORITES_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, [favoritesReady]);

  const renderStation = useCallback(({ item }: { item: RadioStation }) => {
    const trackId = `radio:${item.stationuuid}`;
    return (
      <RadioStationRow
        station={item}
        active={activeTrack?.id === trackId}
        favorite={favoriteIds.includes(item.stationuuid)}
        onPress={() => toggleStationPlayback(item)}
        onToggleFavorite={() => toggleFavorite(item.stationuuid)}
      />
    );
  }, [activeTrack?.id, favoriteIds, toggleFavorite, toggleStationPlayback]);

  const listHeader = (
    <Animated.View style={{ opacity: introOpacity, transform: [{ translateY: introY }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800', letterSpacing: -0.8 }}>Radio</Text>
          <Text style={{ color: '#8E8E93', fontSize: 14, fontWeight: '500', marginTop: 2 }}>Listen live, wherever the signal takes you.</Text>
        </View>
        <TouchableOpacity
          onPress={() => setRefreshKey((key) => key + 1)}
          accessibilityRole="button"
          accessibilityLabel="Refresh radio stations"
          hitSlop={8}
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="refresh" size={19} color="white" />
        </TouchableOpacity>
      </View>

      <RadioHeroCard
        activeTrack={activeTrack}
        suggestedStation={firstStation}
        onPlayStation={toggleStationPlayback}
        onTogglePlayback={togglePlayback}
      />

      <View style={{ height: 48, borderRadius: 24, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginTop: 20 }}>
        <Ionicons name="search" size={21} color="#A1A1A6" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search stations, places, genres"
          placeholderTextColor="#85858B"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          underlineColorAndroid="transparent"
          accessibilityLabel="Search radio stations"
          style={{ flex: 1, minWidth: 0, height: '100%', marginLeft: 10, padding: 0, color: 'white', fontSize: 15 }}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingTop: 18, paddingBottom: 21 }}>
        {RADIO_CATEGORIES.map((item) => {
          const selected = category === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => setCategory(item.id)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={{ height: 37, paddingHorizontal: 13, borderRadius: 20, backgroundColor: selected ? '#FA243C' : '#1C1C1E', flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons name={item.icon} size={15} color={selected ? 'white' : '#A1A1A6'} />
              <Text style={{ color: selected ? 'white' : '#A1A1A6', fontSize: 13, fontWeight: '700' }}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '800', flex: 1 }}>
          {RADIO_CATEGORIES.find((item) => item.id === category)?.label ?? 'Stations'}
        </Text>
        {!loading && !error ? <Text style={{ color: '#77777D', fontSize: 12, fontWeight: '600' }}>{stations.length} stations</Text> : null}
      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.FlatList<RadioStation>
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          data={stations}
          keyExtractor={(item) => item.stationuuid}
          renderItem={renderStation}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={(
            <View style={{ minHeight: 156, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 20 }}>
              {loading ? (
                <>
                  <ActivityIndicator color="#FA5265" size="small" />
                  <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 12 }}>Finding stations for you…</Text>
                </>
              ) : error ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={28} color="#77777D" />
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '700', marginTop: 12 }}>Couldn’t reach the radio directory</Text>
                  <Text style={{ color: '#8E8E93', fontSize: 13, textAlign: 'center', marginTop: 6 }}>Check your connection, then try again.</Text>
                  <TouchableOpacity onPress={() => setRefreshKey((key) => key + 1)} activeOpacity={0.75} style={{ marginTop: 16, paddingHorizontal: 17, height: 38, borderRadius: 20, backgroundColor: '#2A171C', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>Try again</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Ionicons name={category === 'favorites' ? 'heart-outline' : 'radio-outline'} size={28} color="#77777D" />
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '700', marginTop: 12 }}>
                    {category === 'favorites' ? 'No favorite stations yet' : search.trim() ? 'No matching stations' : 'No stations found'}
                  </Text>
                  <Text style={{ color: '#8E8E93', fontSize: 13, textAlign: 'center', marginTop: 6 }}>
                    {category === 'favorites' ? 'Tap the heart beside a station to keep it here.' : 'Try another search or choose a different category.'}
                  </Text>
                </>
              )}
            </View>
          )}
          refreshControl={<RefreshControl refreshing={loading && stations.length > 0} onRefresh={() => setRefreshKey((key) => key + 1)} tintColor="#FA5265" colors={['#FA5265']} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 15 + topInsetCompensation, paddingBottom: 190, flexGrow: 1 }}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
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
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};
