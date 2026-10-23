/* Reanimated scroll handlers update a shared value on the UI thread by design. */
/* eslint-disable react-hooks/immutability */

import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, { useAnimatedReaction, useAnimatedScrollHandler, type SharedValue } from 'react-native-reanimated';
import { useAudioPlayerStatus } from 'expo-audio';
import type { LyricLine } from '../../types';

type PlayerLyricsProps = {
  player: Parameters<typeof useAudioPlayerStatus>[0];
  trackId: string;
  lyrics: LyricLine[];
  pauseAutoScroll: SharedValue<boolean>;
  viewportHeight: number;
  scrollGesture: NativeGesture;
  scrollOffset: SharedValue<number>;
  onSeek: (seconds: number) => void;
};

type PlayerLyricsListProps = PlayerLyricsProps & { activeLineIndex: number };

const PlayerLyricsView = ({
  trackId,
  lyrics,
  activeLineIndex,
  pauseAutoScroll,
  viewportHeight,
  scrollGesture,
  scrollOffset,
  onSeek,
}: PlayerLyricsListProps) => {
  const scrollRef = useRef<ScrollView>(null);
  const lineLayouts = useRef(new Map<number, { y: number; height: number }>());
  const activeLineRef = useRef(activeLineIndex);
  const viewportHeightRef = useRef(viewportHeight);
  const isManuallyScrolling = useRef(false);
  const pauseAutoScrollRef = useRef(false);
  const autoScrollFrame = useRef<number | null>(null);
  const recenterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  useEffect(() => {
    activeLineRef.current = activeLineIndex;
    viewportHeightRef.current = viewportHeight;
  }, [activeLineIndex, viewportHeight]);

  const clearRecenterTimer = useCallback(() => {
    if (recenterTimer.current) {
      clearTimeout(recenterTimer.current);
      recenterTimer.current = null;
    }
  }, []);

  const centerLine = useCallback((lineIndex: number, animated: boolean) => {
    const layout = lineLayouts.current.get(lineIndex);
    const visibleHeight = viewportHeightRef.current;
    if (!layout || lineIndex < 0 || visibleHeight <= 0) return;

    scrollRef.current?.scrollTo({
      y: Math.max(0, layout.y + layout.height / 2 - visibleHeight / 2),
      animated,
    });
  }, []);

  const scheduleCenterLine = useCallback((lineIndex = activeLineRef.current) => {
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = requestAnimationFrame(() => {
      autoScrollFrame.current = null;
      if (!pauseAutoScrollRef.current && !isManuallyScrolling.current) {
        centerLine(lineIndex, true);
      }
    });
  }, [centerLine]);

  const handlePauseAutoScrollChange = useCallback((paused: boolean) => {
    pauseAutoScrollRef.current = paused;
    if (paused) {
      clearRecenterTimer();
      isManuallyScrolling.current = false;
      if (autoScrollFrame.current !== null) {
        cancelAnimationFrame(autoScrollFrame.current);
        autoScrollFrame.current = null;
      }
      return;
    }

    if (activeLineRef.current >= 0) scheduleCenterLine();
  }, [clearRecenterTimer, scheduleCenterLine]);

  useAnimatedReaction(
    () => pauseAutoScroll.value,
    (paused, previous) => {
      if (paused !== previous) scheduleOnRN(handlePauseAutoScrollChange, paused);
    },
    [handlePauseAutoScrollChange, pauseAutoScroll],
  );

  const recenterAfterManualScroll = useCallback(() => {
    clearRecenterTimer();
    recenterTimer.current = setTimeout(() => {
      if (pauseAutoScrollRef.current) return;
      isManuallyScrolling.current = false;
      centerLine(activeLineRef.current, true);
    }, 2000);
  }, [centerLine, clearRecenterTimer]);

  useEffect(() => {
    if (!pauseAutoScrollRef.current && !isManuallyScrolling.current && activeLineIndex >= 0) {
      scheduleCenterLine(activeLineIndex);
    }
  }, [activeLineIndex, scheduleCenterLine, viewportHeight]);

  useEffect(() => () => {
    clearRecenterTimer();
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
  }, [clearRecenterTimer, trackId]);

  return (
    <GestureDetector gesture={scrollGesture}>
      <Animated.ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: Math.max(0, viewportHeight / 2) }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={animatedScrollHandler}
        onScrollBeginDrag={() => {
          if (pauseAutoScrollRef.current) return;
          clearRecenterTimer();
          isManuallyScrolling.current = true;
        }}
        onScrollEndDrag={recenterAfterManualScroll}
        onMomentumScrollBegin={clearRecenterTimer}
        onMomentumScrollEnd={recenterAfterManualScroll}
      >
        {lyrics.map((line, index) =>
          line.text.trim().length === 0 ? (
            <View
              key={`${trackId}-lyric-gap-${index}`}
              onLayout={(event) => lineLayouts.current.set(index, event.nativeEvent.layout)}
              style={{ height: 40 }}
            />
          ) : (
            <View
              key={`${trackId}-lyric-${index}`}
              onLayout={(event) => {
                lineLayouts.current.set(index, event.nativeEvent.layout);
                if (
                  index === activeLineRef.current &&
                  !isManuallyScrolling.current &&
                  !pauseAutoScrollRef.current
                ) {
                  centerLine(index, false);
                }
              }}
              style={{ marginBottom: 12 }}
            >
              <TouchableOpacity
                disabled={line.timeMs === null}
                onPress={() => {
                  if (line.timeMs !== null) onSeek(line.timeMs / 1000);
                }}
                activeOpacity={0.72}
                accessibilityRole={line.timeMs === null ? undefined : 'button'}
                accessibilityLabel={line.timeMs === null ? line.text : `Seek to ${line.text}`}
                style={{ alignSelf: 'stretch' }}
              >
                <Text
                  style={{
                    color: index === activeLineIndex ? '#FFFFFF' : 'rgba(255,255,255,0.52)',
                    fontSize: 22,
                    lineHeight: 32,
                    fontWeight: '700',
                  }}
                >
                  {line.text}
                </Text>
              </TouchableOpacity>
            </View>
          ),
        )}
      </Animated.ScrollView>
    </GestureDetector>
  );
};

const areLyricsListPropsEqual = (previous: PlayerLyricsListProps, next: PlayerLyricsListProps) =>
  previous.trackId === next.trackId &&
  previous.lyrics === next.lyrics &&
  previous.activeLineIndex === next.activeLineIndex &&
  previous.pauseAutoScroll === next.pauseAutoScroll &&
  previous.viewportHeight === next.viewportHeight &&
  previous.scrollGesture === next.scrollGesture &&
  previous.scrollOffset === next.scrollOffset &&
  previous.onSeek === next.onSeek;

const PlayerLyricsList = React.memo(PlayerLyricsView, areLyricsListPropsEqual);

const PlayerLyricsStatusView = (props: PlayerLyricsProps) => {
  const { currentTime } = useAudioPlayerStatus(props.player);
  const activeLineIndex = props.lyrics.reduce((activeIndex, line, index) =>
    line.text.trim().length > 0 && line.timeMs !== null && line.timeMs <= currentTime * 1000
      ? index
      : activeIndex,
  -1);

  return <PlayerLyricsList {...props} activeLineIndex={activeLineIndex} />;
};

export const PlayerLyrics = React.memo(PlayerLyricsStatusView, (previous, next) =>
  previous.trackId === next.trackId &&
  previous.lyrics === next.lyrics &&
  previous.pauseAutoScroll === next.pauseAutoScroll &&
  previous.viewportHeight === next.viewportHeight &&
  previous.scrollGesture === next.scrollGesture &&
  previous.scrollOffset === next.scrollOffset &&
  previous.onSeek === next.onSeek,
);
