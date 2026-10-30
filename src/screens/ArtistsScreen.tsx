import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArtistListItem } from '../components/library/ArtistListItem';
import { AlphabetIndex } from '../components/songs/AlphabetIndex';
import { SongsHeader } from '../components/songs/SongsHeader';
import type { Track } from '../types';

type Artist = { key: string; name: string; artwork: string; tracks: Track[] };
type ArtistSection = { title: string; data: Artist[] };

const sectionFor = (value: string) => {
  const first = value.trim().charAt(0).toLocaleUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
};

export const ArtistsScreen = ({
  tracks,
  loading,
  onBack,
  onOpenArtist,
}: {
  tracks: Track[];
  loading: boolean;
  onBack: () => void;
  onOpenArtist: (artist: string) => void;
}) => {
  const listRef = useRef<Animated.SectionList<Artist, ArtistSection>>(null);
  const insets = useSafeAreaInsets();
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const [ascending, setAscending] = useState(true);
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

  const sections = useMemo(() => {
    const artistsByName = new Map<string, Artist>();
    tracks.forEach((track) => {
      const name = track.artist.trim() || 'Unknown Artist';
      const key = name.toLocaleLowerCase();
      const artist = artistsByName.get(key);
      if (artist) {
        artist.tracks.push(track);
        if (!artist.artwork && track.artwork) artist.artwork = track.artwork;
      } else {
        artistsByName.set(key, { key, name, artwork: track.artwork || '', tracks: [track] });
      }
    });

    const sortedArtists = [...artistsByName.values()].sort((first, second) => {
      const comparison = first.name.localeCompare(second.name);
      return ascending ? comparison : -comparison;
    });
    const groups = new Map<string, Artist[]>();
    sortedArtists.forEach((artist) => {
      const title = sectionFor(artist.name);
      const group = groups.get(title);
      if (group) group.push(artist);
      else groups.set(title, [artist]);
    });
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [ascending, tracks]);

  const jumpToLetter = (letter: string) => {
    if (sections.length === 0) return;
    const exact = sections.findIndex((section) => section.title === letter);
    const next = sections.findIndex((section) => ascending ? section.title >= letter : section.title <= letter);
    const sectionIndex = exact >= 0 ? exact : next >= 0 ? next : sections.length - 1;
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, animated: true, viewPosition: 0 });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.SectionList<Artist, ArtistSection>
          ref={listRef}
          sections={sections}
          keyExtractor={(artist) => artist.key}
          renderItem={({ item, index, section }) => (
            <ArtistListItem
              name={item.name}
              artwork={item.artwork}
              isLast={index === section.data.length - 1}
              onPress={() => onOpenArtist(item.name)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={{ color: 'white', fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 14, marginBottom: 8, paddingHorizontal: 20 }}>
              {section.title}
            </Text>
          )}
          ListHeaderComponent={(
            <Text style={{ color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800', paddingHorizontal: 20, marginBottom: 4 }}>
              Artists
            </Text>
          )}
          ListEmptyComponent={(
            <View style={{ paddingHorizontal: 20, paddingTop: 24, alignItems: loading ? 'center' : 'flex-start' }}>
              {loading ? <ActivityIndicator color="#FA243C" /> : (
                <Text style={{ color: '#8E8E93', fontSize: 16 }}>Artists from your library will appear here.</Text>
              )}
            </View>
          )}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 84, paddingBottom: 190 }}
          initialNumToRender={14}
          windowSize={7}
          style={StyleSheet.absoluteFill}
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

        <SongsHeader
          onBack={onBack}
          onToggleSort={() => setAscending((current) => !current)}
          showMoreButton={false}
          sortAccessibilityLabel="Toggle artist order"
        />
        <AlphabetIndex onSelectLetter={jumpToLetter} />
      </View>
    </SafeAreaView>
  );
};
