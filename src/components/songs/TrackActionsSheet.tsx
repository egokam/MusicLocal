import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PlaylistSummary, Track } from '../../types';
import type { TrackEditChanges } from '../../services/MusicCatalogService';
import { MusicCatalogService } from '../../services/MusicCatalogService';
import type { SongMenuAnchor } from './SongListItem';

type TrackActionsSheetProps = {
  track: Track | null;
  anchor: SongMenuAnchor;
  playlistMode?: boolean;
  visible: boolean;
  playlists: PlaylistSummary[];
  hasActiveTrack: boolean;
  onClose: () => void;
  onPlayNext: (track: Track) => void;
  onToggleFavorite: (track: Track) => Promise<Track>;
  onAddToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<PlaylistSummary>;
  onSaveTrack: (track: Track, changes: TrackEditChanges) => Promise<void>;
  onDeleteTrack: (track: Track) => Promise<void>;
  onRemoveFromPlaylist?: (track: Track) => Promise<void>;
};

type SheetPage = 'actions' | 'edit' | 'playlist';

const ActionRow = ({
  icon,
  title,
  onPress,
  disabled = false,
  destructive = false,
  showChevron = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  showChevron?: boolean;
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    style={{
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      opacity: disabled ? 0.4 : 1,
    }}
  >
    <Ionicons name={icon} size={19} color={destructive ? '#FA5265' : '#F5F5F7'} />
    <Text style={{ flex: 1, color: destructive ? '#FA5265' : '#F5F5F7', fontSize: 15, fontWeight: '500', marginLeft: 12 }} numberOfLines={1}>
      {title}
    </Text>
    {showChevron ? <Ionicons name="chevron-forward" size={15} color="#8E8E93" /> : null}
  </TouchableOpacity>
);

const Field = ({
  label,
  value,
  onChangeText,
  multiline = false,
  placeholder,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) => (
  <View style={{ marginTop: 15 }}>
    <Text style={{ color: '#A1A1A6', fontSize: 13, fontWeight: '700', marginBottom: 7 }}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#77777D"
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      style={{
        minHeight: multiline ? 150 : 50,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: multiline ? 12 : 0,
        color: 'white',
        backgroundColor: '#242427',
        fontSize: 15,
      }}
    />
  </View>
);

export const TrackActionsSheet = ({
  track,
  anchor,
  playlistMode = false,
  visible,
  playlists,
  hasActiveTrack,
  onClose,
  onPlayNext,
  onToggleFavorite,
  onAddToPlaylist,
  onCreatePlaylist,
  onSaveTrack,
  onDeleteTrack,
  onRemoveFromPlaylist,
}: TrackActionsSheetProps) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [page, setPage] = useState<SheetPage>('actions');
  const [title, setTitle] = useState(track?.title ?? '');
  const [artist, setArtist] = useState(track?.artist ?? '');
  const [album, setAlbum] = useState(track?.album ?? '');
  const [artworkUrl, setArtworkUrl] = useState(track?.artwork ?? '');
  const [lyrics, setLyrics] = useState(track?.syncedLyrics ?? track?.plainLyrics ?? '');
  const [lyricsDirty, setLyricsDirty] = useState(false);
  const lyricsTouched = useRef(false);
  const [playlistName, setPlaylistName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cardOpacity] = useState(() => new Animated.Value(0));
  const [cardScale] = useState(() => new Animated.Value(0.95));
  const [cardTranslateY] = useState(() => new Animated.Value(-7));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [backdropDimOpacity] = useState(() => Animated.multiply(backdropOpacity, 0.32));
  const [pageOpacity] = useState(() => new Animated.Value(1));
  const dismissing = useRef(false);
  const actionCardWidth = Math.min(windowWidth - 32, 300);
  const actionMenuHeight = playlistMode ? 208 : 296;
  const expandedMenuHeight = Math.round(windowHeight * 0.76);
  const preferredTop = anchor.y + anchor.height + 8;
  const actionMenuTop = Math.max(54, Math.min(
    preferredTop + actionMenuHeight <= windowHeight - 24 ? preferredTop : anchor.y - actionMenuHeight - 8,
    windowHeight - actionMenuHeight - 24,
  ));
  const actionMenuLeft = Math.max(16, Math.min(anchor.x + anchor.width - actionCardWidth, windowWidth - actionCardWidth - 16));
  const [animatedTop] = useState(() => new Animated.Value(actionMenuTop));
  const [animatedLeft] = useState(() => new Animated.Value(actionMenuLeft));
  const [animatedWidth] = useState(() => new Animated.Value(actionCardWidth));
  const [animatedHeight] = useState(() => new Animated.Value(actionMenuHeight));
  const transitioningPage = useRef(false);

  useEffect(() => {
    if (!visible) return;
    dismissing.current = false;
    cardOpacity.setValue(0);
    cardScale.setValue(0.95);
    cardTranslateY.setValue(-7);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, damping: 18, stiffness: 250, mass: 0.75, useNativeDriver: true }),
      Animated.spring(cardTranslateY, { toValue: 0, damping: 18, stiffness: 250, mass: 0.75, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 170, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, cardOpacity, cardScale, cardTranslateY, visible]);

  const dismiss = () => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 0.97, damping: 20, stiffness: 260, mass: 0.75, useNativeDriver: true }),
      Animated.timing(cardTranslateY, { toValue: -4, duration: 150, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      onClose();
    });
  };

  const transitionToPage = (nextPage: SheetPage) => {
    if (transitioningPage.current || dismissing.current) return;
    transitioningPage.current = true;
    Animated.timing(pageOpacity, { toValue: 0, duration: 80, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) {
        transitioningPage.current = false;
        return;
      }
      setPage(nextPage);
      const isActions = nextPage === 'actions';
      const nextHeight = isActions ? actionMenuHeight : expandedMenuHeight;
      const nextWidth = isActions ? actionCardWidth : windowWidth - 32;
      const nextTop = isActions ? actionMenuTop : Math.max(54, (windowHeight - expandedMenuHeight) / 2);
      const nextLeft = isActions ? actionMenuLeft : 16;
      Animated.parallel([
        Animated.spring(animatedTop, { toValue: nextTop, damping: 22, stiffness: 210, mass: 0.9, useNativeDriver: false }),
        Animated.spring(animatedLeft, { toValue: nextLeft, damping: 22, stiffness: 210, mass: 0.9, useNativeDriver: false }),
        Animated.spring(animatedWidth, { toValue: nextWidth, damping: 22, stiffness: 210, mass: 0.9, useNativeDriver: false }),
        Animated.spring(animatedHeight, { toValue: nextHeight, damping: 22, stiffness: 210, mass: 0.9, useNativeDriver: false }),
      ]).start(({ finished: layoutFinished }) => {
        if (!layoutFinished) {
          transitioningPage.current = false;
          return;
        }
        Animated.timing(pageOpacity, { toValue: 1, duration: 130, useNativeDriver: true }).start(({ finished: fadeFinished }) => {
          if (fadeFinished) transitioningPage.current = false;
        });
      });
    });
  };

  useEffect(() => {
    if (!visible || page !== 'edit' || !track || track.provider !== 'local') return;
    let mounted = true;
    void MusicCatalogService.getLyrics(track).then((result) => {
      if (mounted && !lyricsTouched.current) setLyrics(result.syncedLyrics ?? result.plainLyrics ?? '');
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [page, track, visible]);

  if (!track) return null;

  const showError = (error: unknown, titleText: string) => {
    Alert.alert(titleText, error instanceof Error ? error.message : 'Please try again.');
  };

  const runAction = async (action: () => Promise<unknown>, titleText: string) => {
    setBusy(true);
    try {
      await action();
      dismiss();
    } catch (error) {
      showError(error, titleText);
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = () => {
    const changes: TrackEditChanges = { title: title.trim(), artist: artist.trim(), album: album.trim(), artworkUrl: artworkUrl.trim() };
    if (lyricsDirty) changes.lyrics = lyrics;
    void runAction(() => onSaveTrack(track, changes), 'Could not save track');
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete from this device?',
      `“${track.title}” and its local audio file will be removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void runAction(() => onDeleteTrack(track), 'Could not delete track'),
        },
      ],
    );
  };

  const addToPlaylist = (playlistId: string) => {
    void runAction(() => onAddToPlaylist(playlistId, track), 'Could not add to playlist');
  };

  const createAndAddPlaylist = () => {
    void runAction(async () => {
      const created = await onCreatePlaylist(playlistName.trim());
      await onAddToPlaylist(created.id, track);
    }, 'Could not create playlist');
  };

  const heading = page === 'edit' ? 'Edit track' : page === 'playlist' ? 'Add to playlist' : track.title;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: backdropDimOpacity }]}
        />
        <Pressable
          accessibilityLabel="Close track options"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={{
            position: 'absolute',
            left: animatedLeft,
            top: animatedTop,
            width: animatedWidth,
            height: animatedHeight,
            maxHeight: windowHeight * 0.82,
          }}
        >
          <Animated.View
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              borderRadius: 22,
              overflow: 'hidden',
              backgroundColor: 'rgba(31,31,34,0.98)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.13)',
              shadowColor: '#000000',
              shadowOpacity: 0.4,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 28,
              opacity: cardOpacity,
              transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
            }}
          >
          <View style={{ minHeight: 56, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
            {page === 'actions' ? (
              track.artwork ? (
                <Image source={{ uri: track.artwork }} style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#29292D' }} />
              ) : (
                <View style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3A2027' }}>
                  <Ionicons name="musical-note" size={17} color="#FA5265" />
                </View>
              )
            ) : (
              <TouchableOpacity onPress={() => transitionToPage('actions')} accessibilityLabel="Back to track options" style={{ width: 34, height: 40, justifyContent: 'center' }}>
                <Ionicons name="chevron-back" size={22} color="white" />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
              <Text numberOfLines={1} style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>{heading}</Text>
              <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 12, marginTop: 2 }}>
                {page === 'actions' ? track.artist : `${track.title} · ${track.artist}`}
              </Text>
            </View>
            <TouchableOpacity onPress={dismiss} hitSlop={9} accessibilityLabel="Close track options" style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={21} color="#A1A1A6" />
            </TouchableOpacity>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 10 }} />

          <Animated.View style={{ flex: 1, opacity: pageOpacity }}>
            {page === 'actions' ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 5 }}>
                {playlistMode ? (
                  <>
                    <ActionRow
                      icon="remove-circle-outline"
                      title="Remove from Playlist"
                      onPress={() => onRemoveFromPlaylist && void runAction(
                        () => onRemoveFromPlaylist(track),
                        'Could not remove song from playlist',
                      )}
                      destructive
                      disabled={busy || !onRemoveFromPlaylist}
                    />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow
                      icon={track.isFavorite ? 'star' : 'star-outline'}
                      title={track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      onPress={() => void runAction(() => onToggleFavorite(track), 'Could not update favorite')}
                      disabled={busy}
                    />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow
                      icon="play-skip-forward-outline"
                      title="Play Next"
                      disabled={!hasActiveTrack || busy}
                      onPress={() => {
                        onPlayNext(track);
                        dismiss();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <ActionRow icon="create-outline" title="Edit track details" onPress={() => transitionToPage('edit')} />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow
                      icon={track.isFavorite ? 'star' : 'star-outline'}
                      title={track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      onPress={() => void runAction(() => onToggleFavorite(track), 'Could not update favorite')}
                      disabled={busy}
                    />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow
                      icon="play-skip-forward-outline"
                      title="Play next"
                      disabled={!hasActiveTrack || busy}
                      onPress={() => {
                        onPlayNext(track);
                        dismiss();
                      }}
                    />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow icon="list-outline" title="Add to playlist" onPress={() => transitionToPage('playlist')} showChevron />
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                    <ActionRow icon="trash-outline" title="Delete from this device" onPress={confirmDelete} destructive disabled={busy} />
                  </>
                )}
              </View>
            ) : null}

            {page === 'edit' ? (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {track.artwork ? (
                  <Image source={{ uri: artworkUrl || track.artwork }} style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: '#29292D', marginTop: 12 }} />
                ) : null}
                <Field label="Title" value={title} onChangeText={setTitle} />
                <Field label="Artist" value={artist} onChangeText={setArtist} />
                <Field label="Album" value={album} onChangeText={setAlbum} />
                <Field label="Artwork HTTPS URL" value={artworkUrl} onChangeText={setArtworkUrl} autoCapitalize="none" placeholder="https://…" />
                <Field
                  label="Lyrics · synced LRC or plain text"
                  value={lyrics}
                  onChangeText={(value) => {
                    lyricsTouched.current = true;
                    setLyrics(value);
                    setLyricsDirty(true);
                  }}
                  multiline
                  placeholder="Paste [mm:ss.xx] lyric lines or plain lyrics"
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  <TouchableOpacity onPress={dismiss} style={{ flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#303034' }}>
                    <Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveChanges}
                    disabled={busy || !title.trim() || !artist.trim()}
                    style={{ flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FA243C', opacity: busy || !title.trim() || !artist.trim() ? 0.5 : 1 }}
                  >
                    {busy ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}

            {page === 'playlist' ? (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 5 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {playlists.map((playlist, index) => (
                  <View key={playlist.id}>
                    {index > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} /> : null}
                    <ActionRow
                      icon="musical-notes-outline"
                      title={`${playlist.name} · ${playlist.trackCount}`}
                      onPress={() => addToPlaylist(playlist.id)}
                      disabled={busy}
                    />
                  </View>
                ))}
                {playlists.length === 0 ? (
                  <Text style={{ color: '#A1A1A6', fontSize: 14, lineHeight: 21, margin: 12 }}>
                    You don’t have any playlists yet. Create one to add this track.
                  </Text>
                ) : null}
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
                <View style={{ flexDirection: 'row', gap: 9, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 5 }}>
                  <TextInput
                    value={playlistName}
                    onChangeText={setPlaylistName}
                    placeholder="New playlist"
                    placeholderTextColor="#77777D"
                    style={{ flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 14, color: 'white', backgroundColor: '#29292D', fontSize: 14 }}
                  />
                  <TouchableOpacity
                    onPress={createAndAddPlaylist}
                    disabled={busy || !playlistName.trim()}
                    accessibilityLabel="Create playlist and add track"
                    style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#FA243C', alignItems: 'center', justifyContent: 'center', opacity: busy || !playlistName.trim() ? 0.5 : 1 }}
                  >
                    {busy ? <ActivityIndicator color="white" /> : <Ionicons name="add" size={24} color="white" />}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </Animated.View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
