import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlbumGridItem } from '../components/library/AlbumGridItem';
import { AlbumCollectionControls } from '../components/library/AlbumCollectionControls';
import { AlphabetIndex } from '../components/songs/AlphabetIndex';
import { SongsHeader } from '../components/songs/SongsHeader';
import type { Track } from '../types';

type Album = {
  key: string;
  title: string;
  artist: string;
  artwork: string;
  tracks: Track[];
};

type AlbumGridRow = { key: string; albums: Album[] };
type AlbumSection = { title: string; data: AlbumGridRow[] };

const titleForTrack = (track: Track) => track.album.trim() || 'Unknown Album';
const artistForTrack = (track: Track) => track.artist.trim() || 'Unknown Artist';
const sectionFor = (value: string) => {
  const first = value.trim().charAt(0).toLocaleUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
};

export const AlbumsScreen = ({
  tracks,
  loading,
  onBack,
  onOpenAlbum,
  onPlayAll,
  onShuffle,
}: {
  tracks: Track[];
  loading: boolean;
  onBack: () => void;
  onOpenAlbum: (album: string, artist: string) => void;
  onPlayAll: (queue: Track[]) => void;
  onShuffle: (queue: Track[]) => void;
}) => {
  const listRef = useRef<SectionList<AlbumGridRow, AlbumSection>>(null);
  const insets = useSafeAreaInsets();
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const [search, setSearch] = useState('');
  const [ascending, setAscending] = useState(true);
  const [sortBy, setSortBy] = useState<'album' | 'artist'>('album');

  const allAlbums = useMemo(() => {
    const albumsByKey = new Map<string, Album>();
    tracks.forEach((track) => {
      const title = titleForTrack(track);
      const artist = artistForTrack(track);
      const key = `${artist.toLocaleLowerCase()}\u0000${title.toLocaleLowerCase()}`;
      const album = albumsByKey.get(key);
      if (album) {
        album.tracks.push(track);
        if (!album.artwork && track.artwork) album.artwork = track.artwork;
      } else {
        albumsByKey.set(key, { key, title, artist, artwork: track.artwork || '', tracks: [track] });
      }
    });
    return [...albumsByKey.values()];
  }, [tracks]);

  const { sections, visibleTracks } = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = allAlbums.filter((album) => `${album.title} ${album.artist}`.toLocaleLowerCase().includes(query));
    filtered.sort((first, second) => {
      const comparison = sortBy === 'album'
        ? first.title.localeCompare(second.title) || first.artist.localeCompare(second.artist)
        : first.artist.localeCompare(second.artist) || first.title.localeCompare(second.title);
      return ascending ? comparison : -comparison;
    });

    const groups = new Map<string, Album[]>();
    filtered.forEach((album) => {
      const sectionName = sectionFor(sortBy === 'album' ? album.title : album.artist);
      const group = groups.get(sectionName);
      if (group) group.push(album);
      else groups.set(sectionName, [album]);
    });

    const nextSections = [...groups].map(([title, albums]) => ({
      title,
      data: Array.from({ length: Math.ceil(albums.length / 2) }, (_, rowIndex) => {
        const rowAlbums = albums.slice(rowIndex * 2, rowIndex * 2 + 2);
        return { key: `${title}-${rowIndex}`, albums: rowAlbums };
      }),
    }));
    return {
      sections: nextSections,
      visibleTracks: filtered.flatMap((album) => album.tracks),
    };
  }, [allAlbums, ascending, search, sortBy]);

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
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 18, marginBottom: 5 }}>
            {item.albums.map((album) => (
              <AlbumGridItem
                key={album.key}
                title={album.title}
                artist={album.artist}
                artwork={album.artwork}
                onPress={() => onOpenAlbum(album.title, album.artist)}
              />
            ))}
            {item.albums.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <Text style={{ color: 'white', fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 23, paddingHorizontal: 20 }}>
            {section.title}
          </Text>
        )}
        ListHeaderComponent={(
          <AlbumCollectionControls
            search={search}
            onSearchChange={setSearch}
            onPlay={() => onPlayAll(visibleTracks)}
            onShuffle={() => onShuffle(visibleTracks)}
          />
        )}
        ListEmptyComponent={(
          <View style={{ paddingHorizontal: 20, paddingTop: 24, alignItems: loading ? 'center' : 'flex-start' }}>
            {loading ? <ActivityIndicator color="#FA243C" /> : (
              <Text style={{ color: '#8E8E93', fontSize: 16 }}>
                {search ? 'No albums match your search.' : 'Albums from your library will appear here.'}
              </Text>
            )}
          </View>
        )}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 84, paddingBottom: 190 }}
        initialNumToRender={8}
        windowSize={7}
        style={StyleSheet.absoluteFill}
      />

      <SongsHeader
        onBack={onBack}
        onToggleSort={() => setAscending((current) => !current)}
        sortAccessibilityLabel="Toggle album order"
        liquidGlass
        moreMenuItems={[
          { label: 'Sort by Album Title', icon: 'albums-outline', onPress: () => setSortBy('album') },
          { label: 'Sort by Artist', icon: 'person-outline', onPress: () => setSortBy('artist') },
        ]}
      />
      <AlphabetIndex onSelectLetter={jumpToLetter} />
      </View>
    </SafeAreaView>
  );
};
