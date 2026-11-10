/* Reanimated scroll handlers update a shared value on the UI thread by design. */
/* eslint-disable react-hooks/immutability */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';
import type { Track } from '../../types';

type RepeatMode = 'off' | 'all' | 'one';

const QUEUE_ROW_HEIGHT = 62;
const QUEUE_REMOVE_ACTION_WIDTH = 78;

const QueueRemoveAction = ({
  progress,
  track,
  onRemoveTrack,
}: {
  progress: SharedValue<number>;
  track: Track;
  onRemoveTrack: (track: Track) => void;
}) => {
  const actionStyle = useAnimatedStyle(() => {
    const reveal = Math.min(Math.max(progress.value, 0), 1);

    return {
      opacity: interpolate(reveal, [0, 0.35, 1], [0, 0.7, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(reveal, [0, 1], [14, 0], Extrapolation.CLAMP) },
        { scale: interpolate(reveal, [0, 1], [0.88, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <View style={{ width: QUEUE_REMOVE_ACTION_WIDTH, height: QUEUE_ROW_HEIGHT, alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 8 }}>
      <Animated.View
        style={[
          {
            width: 70,
            height: 56,
            borderRadius: 17,
            overflow: 'hidden',
            backgroundColor: '#FF453A',
          },
          actionStyle,
        ]}
      >
        <TouchableOpacity
          onPress={() => onRemoveTrack(track)}
          activeOpacity={0.76}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from queue`}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="trash-outline" size={19} color="white" />
          <Text style={{ marginTop: 2, color: 'white', fontSize: 9, fontWeight: '700', letterSpacing: 0.1 }}>
            Remove
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

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
  highlighted,
  disabled,
  emphasized,
  muted,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
  emphasized?: boolean;
  muted?: boolean;
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
      height: 40,
      marginRight: 6,
      borderRadius: 22,
      backgroundColor: selected || highlighted || emphasized ? 'rgba(235,238,236,0.78)' : 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.42 : 1,
    }}
  >
    <Ionicons
      name={icon}
      size={24}
      color={selected || highlighted || emphasized ? '#303433' : muted ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.9)'}
    />
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
  const exitProgress = useSharedValue(0);
  const [isRemoving, setIsRemoving] = useState(false);
  const artworkSource = useMemo(() => track.artwork
    ? { uri: track.artwork, headers: track.provider === 'local' ? getMusicApiHeaders() : undefined }
    : null,
  [track.artwork, track.provider]);
  const finishRemove = useCallback(() => onRemoveTrack(track), [onRemoveTrack, track]);
  const removeTrack = useCallback(() => {
    if (isRemoving) return;
    setIsRemoving(true);
    exitProgress.value = withTiming(1, { duration: 210 }, (finished) => {
      if (finished) runOnJS(finishRemove)();
    });
  }, [exitProgress, finishRemove, isRemoving]);
  const rowExitStyle = useAnimatedStyle(() => ({
    height: Math.max(0, QUEUE_ROW_HEIGHT * (1 - exitProgress.value)),
    opacity: 1 - exitProgress.value,
    transform: [{ translateX: -20 * exitProgress.value }],
  }));
  const renderRightActions = useCallback((progress: SharedValue<number>) => (
    <QueueRemoveAction progress={progress} track={track} onRemoveTrack={removeTrack} />
  ), [removeTrack, track]);

  return (
    <Animated.View style={[{ overflow: 'hidden' }, rowExitStyle]}>
      <ReanimatedSwipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        onSwipeableOpen={() => onSwipeableOpen(swipeableRef.current)}
        onSwipeableClose={() => onSwipeableClose(swipeableRef.current)}
        simultaneousWithExternalGesture={scrollGesture}
        friction={1}
        rightThreshold={QUEUE_REMOVE_ACTION_WIDTH / 2}
        overshootRight
        overshootFriction={8}
        containerStyle={{ height: QUEUE_ROW_HEIGHT }}
        childrenContainerStyle={{ backgroundColor: 'transparent' }}
      >
        <TouchableOpacity
          onPress={() => onPlayTrack(track)}
          activeOpacity={0.72}
          disabled={isRemoving}
          accessibilityRole="button"
          accessibilityLabel={`Play ${track.title} by ${track.artist}`}
          accessibilityHint="Swipe left to reveal the remove action."
          style={{
            height: QUEUE_ROW_HEIGHT,
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
    </Animated.View>
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
  length: QUEUE_ROW_HEIGHT,
  offset: QUEUE_ROW_HEIGHT * index,
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
        <QueueOption
          icon="shuffle"
          label="Shuffle"
          selected={shuffleEnabled}
          highlighted
          onPress={onToggleShuffle}
        />
        <QueueOption
          icon="repeat"
          label={repeatMode === 'off' ? 'Repeat' : repeatMode === 'all' ? 'Repeat All' : 'Repeat 1'}
          selected={repeatMode !== 'off'}
          onPress={onToggleRepeat}
        />
        <QueueOption
          icon="infinite"
          label="Autoplay"
          selected={autoplayEnabled}
          muted={!autoplayEnabled}
          onPress={onToggleAutoplay}
        />
        <QueueOption
          icon="close"
          label="Clear"
          emphasized
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
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={3}
          updateCellsBatchingPeriod={32}
          bounces={false}
          overScrollMode="never"
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
