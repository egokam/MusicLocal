/* Reanimated scroll handlers update a shared value on the UI thread by design. */
/* eslint-disable react-hooks/immutability */

import React, { useCallback, useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, type SharedValue } from 'react-native-reanimated';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';
import type { Track } from '../../types';

type RepeatMode = 'off' | 'all' | 'one';

type PlayerQueuePanelProps = {
  tracks: Track[];
  height: number;
  scrollGesture: NativeGesture;
  scrollOffset: SharedValue<number>;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayEnabled: boolean;
  onPlayTrack: (track: Track) => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleAutoplay: () => void;
  onClearQueue: () => void;
  onRemoveTrack: (track: Track) => void;
};

const QueueOption = ({
  icon,
  label,
  selected,
  disabled,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.72}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ selected, disabled }}
    style={{
      flex: 1,
      minWidth: 0,
      height: 62,
      marginRight: 6,
      borderRadius: 14,
      backgroundColor: selected ? 'rgba(250, 55, 85, 0.18)' : 'rgba(255,255,255,0.09)',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.42 : 1,
    }}
  >
    <Ionicons name={icon} size={18} color={selected ? '#FA5265' : 'rgba(255,255,255,0.78)'} />
    <Text
      numberOfLines={1}
      style={{
        marginTop: 4,
        color: selected ? '#FA5265' : 'rgba(255,255,255,0.78)',
        fontSize: 10,
        fontWeight: '700',
      }}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const QueueTrackRowView = ({
  track,
  scrollGesture,
  onPlayTrack,
  onRemoveTrack,
  onSwipeableOpen,
  onSwipeableClose,
}: {
  track: Track;
  scrollGesture: NativeGesture;
  onPlayTrack: (track: Track) => void;
  onRemoveTrack: (track: Track) => void;
  onSwipeableOpen: (swipeable: SwipeableMethods | null) => void;
  onSwipeableClose: (swipeable: SwipeableMethods | null) => void;
}) => {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const artworkSource = useMemo(() => track.artwork
    ? { uri: track.artwork, headers: track.provider === 'local' ? getMusicApiHeaders() : undefined }
    : null,
  [track.artwork, track.provider]);
  const renderRightActions = useCallback(() => (
    <View style={{ width: 72, height: 62, alignItems: 'center', justifyContent: 'center' }}>
      <TouchableOpacity
        onPress={() => onRemoveTrack(track)}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${track.title} from queue`}
        style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="trash" size={21} color="white" />
      </TouchableOpacity>
    </View>
  ), [onRemoveTrack, track]);

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => onSwipeableOpen(swipeableRef.current)}
      onSwipeableClose={() => onSwipeableClose(swipeableRef.current)}
      simultaneousWithExternalGesture={scrollGesture}
      friction={1.15}
      rightThreshold={36}
      overshootRight={false}
      containerStyle={{ height: 62 }}
      childrenContainerStyle={{ backgroundColor: 'transparent' }}
    >
      <TouchableOpacity
        onPress={() => onPlayTrack(track)}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`Play ${track.title} by ${track.artist}`}
        accessibilityHint="Swipe left to reveal the remove action."
        style={{
          height: 62,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
        }}
      >
        {artworkSource ? (
          <Image
            source={artworkSource}
            contentFit="cover"
            style={{ width: 46, height: 46, borderRadius: 8, backgroundColor: '#303034' }}
          />
        ) : (
          <View style={{ width: 46, height: 46, borderRadius: 8, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="musical-note" size={20} color="rgba(255,255,255,0.6)" />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, marginLeft: 12, marginRight: 12 }}>
          <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 3 }}>
            {track.artist}
          </Text>
        </View>
        <Ionicons name="play" size={18} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    </ReanimatedSwipeable>
  );
};

const QueueTrackRow = React.memo(QueueTrackRowView);
QueueTrackRow.displayName = 'QueueTrackRow';

const QueueEmptyState = () => (
  <View style={{ flex: 1, minHeight: 100, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: 'rgba(255,255,255,0.52)', fontSize: 14, textAlign: 'center' }}>
      Nothing queued. Choose a song from your library to play next.
    </Text>
  </View>
);

const queueKeyExtractor = (track: Track) => track.id;
const getQueueItemLayout = (_: ArrayLike<Track> | null | undefined, index: number) => ({
  length: 62,
  offset: 62 * index,
  index,
});

const PlayerQueuePanelView = ({
  tracks,
  height,
  scrollGesture,
  scrollOffset,
  shuffleEnabled,
  repeatMode,
  autoplayEnabled,
  onPlayTrack,
  onToggleShuffle,
  onToggleRepeat,
  onToggleAutoplay,
  onClearQueue,
  onRemoveTrack,
}: PlayerQueuePanelProps) => {
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const handleSwipeableOpen = useCallback((swipeable: SwipeableMethods | null) => {
    if (!swipeable) return;
    if (openSwipeableRef.current && openSwipeableRef.current !== swipeable) {
      openSwipeableRef.current.close();
    }
    openSwipeableRef.current = swipeable;
  }, []);
  const handleSwipeableClose = useCallback((swipeable: SwipeableMethods | null) => {
    if (openSwipeableRef.current === swipeable) openSwipeableRef.current = null;
  }, []);
  const handleRemoveTrack = useCallback((track: Track) => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
    onRemoveTrack(track);
  }, [onRemoveTrack]);
  const renderTrack = useCallback(({ item }: { item: Track }) => (
    <QueueTrackRow
      track={item}
      scrollGesture={scrollGesture}
      onPlayTrack={onPlayTrack}
      onRemoveTrack={handleRemoveTrack}
      onSwipeableOpen={handleSwipeableOpen}
      onSwipeableClose={handleSwipeableClose}
    />
  ), [handleRemoveTrack, handleSwipeableClose, handleSwipeableOpen, onPlayTrack, scrollGesture]);

  return (
    <View style={{ flex: 1, height }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '800', flex: 1 }}>Up Next</Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' }}>
          {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <QueueOption icon="shuffle" label="Shuffle" selected={shuffleEnabled} onPress={onToggleShuffle} />
        <QueueOption
          icon="repeat"
          label={repeatMode === 'off' ? 'Repeat' : repeatMode === 'all' ? 'Repeat All' : 'Repeat 1'}
          selected={repeatMode !== 'off'}
          onPress={onToggleRepeat}
        />
        <QueueOption icon="infinite" label="Autoplay" selected={autoplayEnabled} onPress={onToggleAutoplay} />
        <QueueOption
          icon="trash-outline"
          label="Clear"
          accessibilityLabel="Clear queue"
          disabled={tracks.length === 0}
          onPress={onClearQueue}
        />
      </View>

      <GestureDetector gesture={scrollGesture}>
        <Animated.FlatList
          data={tracks}
          renderItem={renderTrack}
          keyExtractor={queueKeyExtractor}
          getItemLayout={getQueueItemLayout}
          ListEmptyComponent={QueueEmptyState}
          style={{ flex: 1 }}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          updateCellsBatchingPeriod={32}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={scrollHandler}
          contentContainerStyle={{ paddingBottom: 12, flexGrow: tracks.length === 0 ? 1 : 0 }}
          keyboardShouldPersistTaps="handled"
        />
      </GestureDetector>
    </View>
  );
};

export const PlayerQueuePanel = React.memo(PlayerQueuePanelView);
