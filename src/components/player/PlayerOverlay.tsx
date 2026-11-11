// Reanimated shared-value writes and worklet callbacks are intentional in this component.
/* eslint-disable react-hooks/immutability, react-hooks/refs */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import ReanimatedAnimated, { cancelAnimation, Easing, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';
import { PlayerLyrics } from './PlayerLyrics';
import { PlayerOutputRouteButton } from './PlayerOutputRouteButton';
import { PlayerQueuePanel } from './PlayerQueuePanel';
import { PlayerSlider } from './PlayerSlider';
import { TrackActionsSheet } from '../songs/TrackActionsSheet';
import type { SongMenuAnchor } from '../songs/SongListItem';
import type { PlaylistSummary, Track } from '../../types';
import type { TrackEditChanges } from '../../services/MusicCatalogService';
import { usePlayerPlaybackStatus } from '../../services/PlayerStatusStore';

const HAS_LIQUID_GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
const TRACK_DETAILS_FADE_DURATION = 290;
const TRACK_DETAILS_OVERLAP_GAP = 100;
const TRACK_DETAILS_HANDOFF_FALLBACK = 1200;
const TRACK_DETAILS_FADE_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const ReanimatedExpoImage = ReanimatedAnimated.createAnimatedComponent(ExpoImage);
const getArtworkSource = (track: Track) => track.artwork
  ? {
      uri: track.artwork,
      headers: track.provider === 'local' ? getMusicApiHeaders() : undefined,
    }
  : undefined;

type LandscapePlayerLayoutProps = {
  track: Track;
  incomingTrack: Track;
  trackTransitioning: boolean;
  transitionProgress: SharedValue<number>;
  onDisplayedArtworkLoaded: (trackId: string) => void;
  lyrics: NonNullable<Track['lyrics']>;
  lyricsAttribution?: Track['lyricsAttribution'];
  hasLyrics: boolean;
  isLyricsLoading: boolean;
  lineSyncedWordWaveEnabled: boolean;
  isFavorite: boolean;
  canFavoriteTrack: boolean;
  isLiveRadio: boolean;
  isPlaying: boolean;
  durationSeconds: number;
  volume: number;
  lyricsExpanded: boolean;
  queueExpanded: boolean;
  tracks: Track[];
  scrollGesture: unknown;
  scrollOffset: SharedValue<number>;
  pauseAutoScroll: SharedValue<boolean>;
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  autoplayEnabled: boolean;
  onToggleFavorite: () => void;
  onOpenTrackActions: (anchor: SongMenuAnchor) => void;
  onTogglePlayback: () => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
  onHoldPreviousStart: () => void;
  onHoldPreviousEnd: () => void;
  onHoldNextStart: () => void;
  onHoldNextEnd: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleLyrics: () => void;
  onToggleQueue: () => void;
  onPlayQueueTrack: (track: Track) => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleAutoplay: () => void;
  onClearQueue: () => void;
  onRemoveQueueTrack: (track: Track) => void;
};

const LandscapePlayerLayout = ({
  track,
  incomingTrack,
  trackTransitioning,
  transitionProgress,
  onDisplayedArtworkLoaded,
  lyrics,
  lyricsAttribution,
  hasLyrics,
  isLyricsLoading,
  lineSyncedWordWaveEnabled,
  isFavorite,
  canFavoriteTrack,
  isLiveRadio,
  isPlaying,
  durationSeconds,
  volume,
  lyricsExpanded,
  queueExpanded,
  tracks,
  scrollGesture,
  scrollOffset,
  pauseAutoScroll,
  shuffleEnabled,
  repeatMode,
  autoplayEnabled,
  onToggleFavorite,
  onOpenTrackActions,
  onTogglePlayback,
  onSkipPrevious,
  onSkipNext,
  onHoldPreviousStart,
  onHoldPreviousEnd,
  onHoldNextStart,
  onHoldNextEnd,
  onSeek,
  onVolumeChange,
  onToggleLyrics,
  onToggleQueue,
  onPlayQueueTrack,
  onToggleShuffle,
  onToggleRepeat,
  onToggleAutoplay,
  onClearQueue,
  onRemoveQueueTrack,
}: LandscapePlayerLayoutProps) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [detailsHeight, setDetailsHeight] = useState(0);
  const entrance = useSharedValue(0);
  const previousLongPressTriggered = useRef(false);
  const nextLongPressTriggered = useRef(false);
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: interpolate(entrance.value, [0, 1], [8, 0]) }],
  }));
  const contentWidth = width - insets.left - insets.right - 48;
  const artworkSize = Math.max(0, Math.min(
    height - insets.top - insets.bottom - 48,
    contentWidth * 0.45 - 12,
    420,
  ));
  const detailsViewportHeight = Math.max(0, detailsHeight);
  const incomingArtworkSource = useMemo(() => getArtworkSource(incomingTrack), [incomingTrack]);
  const outgoingTrackStyle = useAnimatedStyle(() => ({
    opacity: trackTransitioning ? 1 - transitionProgress.value : 1,
  }));
  const incomingTrackStyle = useAnimatedStyle(() => ({
    opacity: trackTransitioning ? transitionProgress.value : 0,
  }));
  const outgoingArtworkBlurStyle = useAnimatedStyle(() => {
    const value = transitionProgress.value;
    const blurEnvelope = 4 * value * (1 - value);
    return { opacity: trackTransitioning ? 0.72 * blurEnvelope * (1 - value) : 0 };
  });
  const incomingArtworkBlurStyle = useAnimatedStyle(() => {
    const value = transitionProgress.value;
    const blurEnvelope = 4 * value * (1 - value);
    return { opacity: trackTransitioning ? 0.72 * blurEnvelope * value : 0 };
  });

  useEffect(() => {
    entrance.value = withTiming(1, { duration: 260, easing: TRACK_DETAILS_FADE_EASING });
    return () => cancelAnimation(entrance);
  }, [entrance]);

  return (
    <ReanimatedAnimated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 20, backgroundColor: '#090A0C' }, entranceStyle]}
    >
      <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingTrackStyle]}>
        <ExpoImage
          source={getArtworkSource(track)}
          contentFit="cover"
          blurRadius={30}
          onDisplay={() => onDisplayedArtworkLoaded(track.id)}
          onError={() => onDisplayedArtworkLoaded(track.id)}
          style={StyleSheet.absoluteFill}
        />
      </ReanimatedAnimated.View>
      {trackTransitioning ? (
        <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingTrackStyle]}>
          <ExpoImage
            source={incomingArtworkSource}
            contentFit="cover"
            blurRadius={30}
            style={StyleSheet.absoluteFill}
          />
        </ReanimatedAnimated.View>
      ) : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,13,15,0.58)' }]} />
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          paddingLeft: insets.left + 22,
          paddingRight: insets.right + 26,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 10,
        }}
      >
        <View style={{ width: '45%', alignItems: 'center', justifyContent: 'center', paddingRight: 12 }}>
          <TouchableOpacity
            onPress={onToggleLyrics}
            disabled={!hasLyrics && !isLyricsLoading}
            activeOpacity={0.92}
            accessibilityRole="button"
            accessibilityLabel={lyricsExpanded ? 'Hide lyrics' : 'Show lyrics'}
            accessibilityState={{ disabled: !hasLyrics && !isLyricsLoading, selected: lyricsExpanded }}
            style={{
              width: artworkSize,
              height: artworkSize,
              maxWidth: '100%',
              maxHeight: '100%',
              borderRadius: Math.min(24, artworkSize * 0.07),
              overflow: 'hidden',
              backgroundColor: 'rgba(255,255,255,0.08)',
              opacity: hasLyrics || isLyricsLoading ? 1 : 0.94,
            }}
          >
            <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingTrackStyle]}>
              <ExpoImage
                source={getArtworkSource(track)}
                contentFit="cover"
                accessibilityLabel={`${track.album} album artwork`}
                style={{ width: '100%', height: '100%' }}
              />
            </ReanimatedAnimated.View>
            {trackTransitioning ? (
              <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingTrackStyle]}>
                <ExpoImage
                  source={incomingArtworkSource}
                  contentFit="cover"
                  accessibilityLabel={`${incomingTrack.album} album artwork`}
                  style={{ width: '100%', height: '100%' }}
                />
              </ReanimatedAnimated.View>
            ) : null}
            {trackTransitioning ? (
              <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingArtworkBlurStyle]}>
                <ExpoImage
                  source={getArtworkSource(track)}
                  contentFit="cover"
                  blurRadius={18}
                  style={{ width: '100%', height: '100%' }}
                />
              </ReanimatedAnimated.View>
            ) : null}
            {trackTransitioning ? (
              <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingArtworkBlurStyle]}>
                <ExpoImage
                  source={incomingArtworkSource}
                  contentFit="cover"
                  blurRadius={18}
                  style={{ width: '100%', height: '100%' }}
                />
              </ReanimatedAnimated.View>
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, minWidth: 0, paddingLeft: 22, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 54 }}>
            <View style={{ flex: 1, minWidth: 0, minHeight: 54, paddingRight: 12, justifyContent: 'center' }}>
              <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingTrackStyle, { justifyContent: 'center' }]}>
                <Text numberOfLines={1} style={{ color: 'white', fontSize: 23, fontWeight: '800' }}>
                  {track.title}
                </Text>
                <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.68)', fontSize: 17, marginTop: 3 }}>
                  {track.artist}
                </Text>
              </ReanimatedAnimated.View>
              {trackTransitioning ? (
                <ReanimatedAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingTrackStyle, { justifyContent: 'center' }]}>
                  <Text numberOfLines={1} style={{ color: 'white', fontSize: 23, fontWeight: '800' }}>
                    {incomingTrack.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.68)', fontSize: 17, marginTop: 3 }}>
                    {incomingTrack.artist}
                  </Text>
                </ReanimatedAnimated.View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={(event) => {
                  const { pageX, pageY, locationX, locationY } = event.nativeEvent;
                  onOpenTrackActions({ x: pageX - locationX, y: pageY - locationY, width: 44, height: 44 });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="More track options"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={24} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onToggleFavorite}
                disabled={!canFavoriteTrack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                accessibilityState={{ selected: isFavorite, disabled: !canFavoriteTrack }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  opacity: canFavoriteTrack ? 1 : 0.4,
                }}
              >
                <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={24} color={isFavorite ? '#FA5265' : 'white'} />
              </TouchableOpacity>
            </View>
          </View>

          <View
            onLayout={(event) => {
              const nextHeight = event.nativeEvent.layout.height;
              setDetailsHeight((currentHeight) => Math.abs(currentHeight - nextHeight) > 1 ? nextHeight : currentHeight);
            }}
            style={{ flex: 1, minHeight: 0, marginTop: 12, marginBottom: 10 }}
          >
            {lyricsExpanded && (hasLyrics || isLyricsLoading) ? (
              hasLyrics ? (
                <PlayerLyrics
                  trackId={track.id}
                  lyrics={lyrics}
                  lyricsAttribution={lyricsAttribution}
                  lineSyncedWordWaveEnabled={lineSyncedWordWaveEnabled}
                  pauseAutoScroll={pauseAutoScroll}
                  viewportHeight={detailsViewportHeight}
                  scrollGesture={scrollGesture as React.ComponentProps<typeof PlayerLyrics>['scrollGesture']}
                  scrollOffset={scrollOffset}
                  onSeek={onSeek}
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.58)', fontSize: 15 }}>Checking for lyrics…</Text>
                </View>
              )
            ) : queueExpanded ? (
              <PlayerQueuePanel
                tracks={tracks}
                height={detailsViewportHeight}
                scrollGesture={scrollGesture as React.ComponentProps<typeof PlayerQueuePanel>['scrollGesture']}
                scrollOffset={scrollOffset}
                shuffleEnabled={shuffleEnabled}
                repeatMode={repeatMode}
                autoplayEnabled={autoplayEnabled}
                onPlayTrack={onPlayQueueTrack}
                onToggleShuffle={onToggleShuffle}
                onToggleRepeat={onToggleRepeat}
                onToggleAutoplay={onToggleAutoplay}
                onClearQueue={onClearQueue}
                onRemoveTrack={onRemoveQueueTrack}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
                <PlayerProgress
                  isLiveRadio={isLiveRadio}
                  fallbackDurationSeconds={durationSeconds}
                  onSeek={onSeek}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 }}>
                  <Pressable
                    onPress={() => {
                      if (previousLongPressTriggered.current) {
                        previousLongPressTriggered.current = false;
                        return;
                      }
                      onSkipPrevious();
                    }}
                    onPressIn={() => { previousLongPressTriggered.current = false; }}
                    onLongPress={() => {
                      if (isLiveRadio) return;
                      previousLongPressTriggered.current = true;
                      onHoldPreviousStart();
                    }}
                    onPressOut={onHoldPreviousEnd}
                    delayLongPress={350}
                    accessibilityRole="button"
                    accessibilityLabel="Previous track. Hold to rewind at double speed."
                    hitSlop={12}
                  >
                    <Ionicons name="play-skip-back" size={44} color="white" />
                  </Pressable>
                  <Pressable
                    onPress={onTogglePlayback}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                    hitSlop={12}
                  >
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={52} color="white" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (nextLongPressTriggered.current) {
                        nextLongPressTriggered.current = false;
                        return;
                      }
                      onSkipNext();
                    }}
                    onPressIn={() => { nextLongPressTriggered.current = false; }}
                    onLongPress={() => {
                      if (isLiveRadio) return;
                      nextLongPressTriggered.current = true;
                      onHoldNextStart();
                    }}
                    onPressOut={onHoldNextEnd}
                    delayLongPress={350}
                    accessibilityRole="button"
                    accessibilityLabel="Next track. Hold to fast-forward at double speed."
                    hitSlop={12}
                  >
                    <Ionicons name="play-skip-forward" size={44} color="white" />
                  </Pressable>
                </View>
                <View style={{ height: 28, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="volume-low" size={19} color="rgba(255,255,255,0.62)" />
                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <PlayerSlider
                      value={volume}
                      accessibilityLabel="Playback volume"
                      activeColor="rgba(255,255,255,0.78)"
                      thumbAlwaysVisible
                      onValueChange={onVolumeChange}
                    />
                  </View>
                  <Ionicons name="volume-high" size={19} color="rgba(255,255,255,0.78)" />
                </View>
              </View>
            )}
          </View>

          <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
            <TouchableOpacity
              onPress={onToggleLyrics}
              disabled={!hasLyrics && !isLyricsLoading}
              accessibilityRole="button"
              accessibilityLabel={lyricsExpanded ? 'Hide lyrics' : 'Show lyrics'}
              accessibilityState={{ selected: lyricsExpanded, disabled: !hasLyrics && !isLyricsLoading }}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: lyricsExpanded ? 'rgba(255,255,255,0.18)' : 'transparent', opacity: hasLyrics || isLyricsLoading ? 1 : 0.38 }}
            >
              <Ionicons name="chatbox-ellipses-outline" size={25} color="rgba(255,255,255,0.86)" />
            </TouchableOpacity>
            <PlayerOutputRouteButton />
            <TouchableOpacity
              onPress={onToggleQueue}
              accessibilityRole="button"
              accessibilityLabel={queueExpanded ? 'Hide queue' : 'Show queue'}
              accessibilityState={{ selected: queueExpanded }}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: queueExpanded ? 'rgba(255,255,255,0.18)' : 'transparent' }}
            >
              <Ionicons name="list" size={28} color="rgba(255,255,255,0.86)" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ReanimatedAnimated.View>
  );
};

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const PlayerProgress = ({
  isLiveRadio,
  fallbackDurationSeconds,
  onSeek,
}: {
  isLiveRadio: boolean;
  fallbackDurationSeconds: number;
  onSeek: (seconds: number) => void;
}) => {
  const status = usePlayerPlaybackStatus();
  const elapsedSeconds = Math.max(0, status.currentTime);
  const totalSeconds = Math.max(0, status.duration || fallbackDurationSeconds);
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

  if (isLiveRadio) {
    return (
      <View style={{ minHeight: 55, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ minHeight: 32, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(250,82,101,0.14)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FA5265' }} />
          <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 }}>LIVE STREAM</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <PlayerSlider
        value={totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0}
        accessibilityLabel="Playback position"
        activeColor="rgba(255,255,255,0.88)"
        disabled={totalSeconds <= 0}
        onSlidingComplete={(value) => onSeek(value * totalSeconds)}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }}>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' }}>
          {formatTime(elapsedSeconds)}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' }}>
          -{formatTime(remainingSeconds)}
        </Text>
      </View>
    </>
  );
};

const PlayerOverlayView = ({
  visible,
  track,
  lyricsLoadingTrackId,
  lineSyncedWordWaveEnabled,
  isFavorite,
  isPlaying,
  durationSeconds,
  volume,
  queue,
  shuffleEnabled,
  repeatMode,
  autoplayEnabled,
  onOpen,
  onClose,
  onTogglePlayback,
  onSkipPrevious,
  onSkipNext,
  onHoldPreviousStart,
  onHoldPreviousEnd,
  onHoldNextStart,
  onHoldNextEnd,
  onSeek,
  onVolumeChange,
  onToggleFavorite,
  playlists,
  hasActiveTrack,
  onPlayNext,
  onToggleTrackFavorite,
  onAddToPlaylist,
  onCreatePlaylist,
  onSaveTrack,
  onDeleteTrack,
  onPlayQueueTrack,
  onToggleShuffle,
  onToggleRepeat,
  onToggleAutoplay,
  onClearQueue,
  onRemoveQueueTrack,
}: {
  visible: boolean;
  track: Track;
  lyricsLoadingTrackId: string | null;
  lineSyncedWordWaveEnabled: boolean;
  isFavorite: boolean;
  isPlaying: boolean;
  durationSeconds: number;
  volume: number;
  queue: Track[];
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  autoplayEnabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  onTogglePlayback: () => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
  onHoldPreviousStart: () => void;
  onHoldPreviousEnd: () => void;
  onHoldNextStart: () => void;
  onHoldNextEnd: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleFavorite: () => void;
  playlists: PlaylistSummary[];
  hasActiveTrack: boolean;
  onPlayNext: (track: Track) => void;
  onToggleTrackFavorite: (track: Track) => Promise<Track>;
  onAddToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<PlaylistSummary>;
  onSaveTrack: (track: Track, changes: TrackEditChanges) => Promise<void>;
  onDeleteTrack: (track: Track) => Promise<void>;
  onPlayQueueTrack: (track: Track) => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleAutoplay: () => void;
  onClearQueue: () => void;
  onRemoveQueueTrack: (track: Track) => void;
}) => {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const isLandscape = windowWidth > windowHeight;
  const progress = useSharedValue(0);
  const gestureStartProgress = useSharedValue(1);
  const gestureChanged = useSharedValue(false);
  const gestureStartedOnMiniPlaybackControl = useSharedValue(false);
  const lyricsProgress = useSharedValue(0);
  const queueContentProgress = useSharedValue(0);
  const detailsScrollOffset = useSharedValue(0);
  const pauseLyricsAutoScroll = useSharedValue(false);
  const sheetPanAllowed = useSharedValue(true);
  const trackTransition = useSharedValue(1);
  const trackTransitionGeneration = useRef(0);
  const trackTransitionCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackTransitionHandoffTrackId = useRef<string | null>(null);
  const previousLongPressTriggered = useRef(false);
  const nextLongPressTriggered = useRef(false);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const skipNextOpenAnimation = useRef(false);
  const [displayTrack, setDisplayTrack] = useState(track);
  const [trackActions, setTrackActions] = useState<{ track: Track; anchor: SongMenuAnchor } | null>(null);
  const [trackTransitionSettling, setTrackTransitionSettling] = useState(false);
  const trackTransitionSettlingRef = useRef(false);
  const updateTrackTransitionSettling = useCallback((settling: boolean) => {
    trackTransitionSettlingRef.current = settling;
    setTrackTransitionSettling(settling);
  }, []);
  const finishTrackTransitionHandoff = useCallback((trackId: string) => {
    if (
      !trackTransitionSettlingRef.current ||
      trackTransitionHandoffTrackId.current !== trackId
    ) return;
    if (trackTransitionCommitTimer.current) {
      clearTimeout(trackTransitionCommitTimer.current);
      trackTransitionCommitTimer.current = null;
    }
    trackTransitionHandoffTrackId.current = null;
    updateTrackTransitionSettling(false);
  }, [updateTrackTransitionSettling]);
  const renderedTrack = displayTrack.id === track.id ? track : displayTrack;
  const isTrackTransitioning = displayTrack.id !== track.id || trackTransitionSettling;
  const [lyricsView, setLyricsView] = useState({ trackId: track.id, expanded: false });
  const lyricsViewRef = useRef(lyricsView);
  const setTrackedLyricsView = useCallback((nextView: typeof lyricsView) => {
    lyricsViewRef.current = nextView;
    setLyricsView(nextView);
  }, []);
  const [queueView, setQueueView] = useState({ trackId: track.id, expanded: false });
  const queueViewRef = useRef(queueView);
  const setTrackedQueueView = useCallback((nextView: typeof queueView) => {
    queueViewRef.current = nextView;
    setQueueView(nextView);
  }, []);
  const queueExpanded = queueView.trackId === renderedTrack.id && queueView.expanded;
  const openTrackActions = useCallback((anchor: SongMenuAnchor) => {
    setTrackActions({ track: { ...renderedTrack, isFavorite }, anchor });
  }, [isFavorite, renderedTrack]);
  const trackActionsSheet = trackActions ? (
    <TrackActionsSheet
      key={trackActions.track.id}
      track={trackActions.track}
      anchor={trackActions.anchor}
      playerMenu
      visible
      playlists={playlists}
      hasActiveTrack={hasActiveTrack}
      onClose={() => setTrackActions(null)}
      onPlayNext={onPlayNext}
      onToggleFavorite={onToggleTrackFavorite}
      onAddToPlaylist={onAddToPlaylist}
      onCreatePlaylist={onCreatePlaylist}
      onSaveTrack={onSaveTrack}
      onDeleteTrack={onDeleteTrack}
    />
  ) : null;
  const queuePageActiveRef = useRef(queueExpanded);
  const lyrics = useMemo(() => renderedTrack.lyrics ?? [], [renderedTrack.lyrics]);
  const hasLyrics = useMemo(() => lyrics.some((line) => line.text.trim().length > 0), [lyrics]);
  const isLyricsLoading = lyricsLoadingTrackId === renderedTrack.id;
  const canShowLyrics = hasLyrics || isLyricsLoading;
  const lyricsExpanded = lyricsView.trackId === renderedTrack.id && lyricsView.expanded && canShowLyrics;
  const incomingLyrics = useMemo(() => track.lyrics ?? [], [track.lyrics]);
  const incomingHasLyrics = useMemo(
    () => incomingLyrics.some((line) => line.text.trim().length > 0),
    [incomingLyrics],
  );
  const incomingIsLyricsLoading = lyricsLoadingTrackId === track.id;
  const canShowIncomingLyrics = incomingHasLyrics || incomingIsLyricsLoading;
  const incomingLyricsExpanded = canShowIncomingLyrics && (
    (isTrackTransitioning && lyricsExpanded) ||
    (lyricsView.trackId === track.id && lyricsView.expanded)
  );
  const lyricsPageActiveRef = useRef(lyricsExpanded);
  const isLiveRadio = renderedTrack.provider === 'radio';
  const canFavoriteTrack = renderedTrack.provider === 'local';
  const detailsExpanded = (lyricsExpanded && canShowLyrics) || queueExpanded;
  const activeQueueIndex = useMemo(
    () => queue.findIndex((item) => item.id === renderedTrack.id),
    [queue, renderedTrack.id],
  );
  const upcomingTracks = useMemo(() => activeQueueIndex >= 0
    ? queue.slice(activeQueueIndex + 1)
    : queue.filter((item) => item.id !== renderedTrack.id),
  [activeQueueIndex, queue, renderedTrack.id]);
  const incomingQueueIndex = useMemo(
    () => queue.findIndex((item) => item.id === track.id),
    [queue, track.id],
  );
  const incomingUpcomingTracks = useMemo(() => incomingQueueIndex >= 0
    ? queue.slice(incomingQueueIndex + 1)
    : queue.filter((item) => item.id !== track.id),
  [incomingQueueIndex, queue, track.id]);
  const displayArtworkSource = useMemo(() => getArtworkSource(displayTrack), [displayTrack]);
  const incomingArtworkSource = useMemo(() => getArtworkSource(track), [track]);
  const lyricsLoadingTrackIdRef = useRef(lyricsLoadingTrackId);

  useEffect(() => {
    lyricsLoadingTrackIdRef.current = lyricsLoadingTrackId;
  }, [lyricsLoadingTrackId]);

  useEffect(() => {
    lyricsPageActiveRef.current = lyricsExpanded;
  }, [lyricsExpanded]);

  useEffect(() => {
    queuePageActiveRef.current = queueExpanded;
  }, [queueExpanded]);

  const miniTop = Math.max(0, windowHeight - 160);
  const miniBottom = Math.max(0, windowHeight - miniTop - 58);
  const collapseDistance = Math.max(miniTop, 1);
  const artworkSize = Math.min(windowWidth * 0.64, 300);
  const artworkTop = 114 + Math.min(windowHeight * 0.03, 26);
  const titleTop = artworkTop + artworkSize + 106;
  const controlsCenter = titleTop + 172;
  const lyricsArtworkTop = 110;
  const lyricsTitleTop = lyricsArtworkTop + 12;
  const lyricsTextTop = lyricsArtworkTop + 72 + 28;
  const lyricsProgressTop = Math.max(lyricsTextTop + 44 + 24, windowHeight - 260);
  const lyricsViewportHeight = Math.max(0, lyricsProgressTop - lyricsTextTop - 24);
  const lyricsControlsCenter = lyricsProgressTop + 32 + 28 + 24;

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const commitTrackChange = useCallback((
    nextTrack: Track,
    generation: number,
    previousTrackId: string,
    previousArtwork: string | undefined,
  ) => {
    if (generation !== trackTransitionGeneration.current) return;
    const currentLyricsView = lyricsViewRef.current;
    if (
      lyricsPageActiveRef.current &&
      currentLyricsView.trackId === previousTrackId &&
      currentLyricsView.expanded
    ) {
      const nextTrackHasLyrics = Boolean(nextTrack.lyrics?.some((line) => line.text.trim()));
      const nextTrackIsLoadingLyrics = lyricsLoadingTrackIdRef.current === nextTrack.id;
      setTrackedLyricsView({
        trackId: nextTrack.id,
        expanded: nextTrackHasLyrics || nextTrackIsLoadingLyrics,
      });
    }
    const currentQueueView = queueViewRef.current;
    if (
      queuePageActiveRef.current &&
      currentQueueView.trackId === previousTrackId &&
      currentQueueView.expanded
    ) {
      setTrackedQueueView({ trackId: nextTrack.id, expanded: true });
    }
    setDisplayTrack(nextTrack);
    trackTransitionHandoffTrackId.current = nextTrack.id;
    updateTrackTransitionSettling(true);
    trackTransitionCommitTimer.current = setTimeout(() => {
      trackTransitionCommitTimer.current = null;
      finishTrackTransitionHandoff(nextTrack.id);
    }, nextTrack.artwork && nextTrack.artwork !== previousArtwork
      ? TRACK_DETAILS_HANDOFF_FALLBACK
      : TRACK_DETAILS_OVERLAP_GAP);
  }, [finishTrackTransitionHandoff, setTrackedLyricsView, setTrackedQueueView, updateTrackTransitionSettling]);

  useLayoutEffect(() => {
    if (displayTrack.id === track.id) {
      if (trackTransitionSettlingRef.current) return;
      if (trackTransitionCommitTimer.current) {
        clearTimeout(trackTransitionCommitTimer.current);
        trackTransitionCommitTimer.current = null;
      }
      trackTransitionGeneration.current += 1;
      cancelAnimation(trackTransition);
      trackTransition.value = 1;
      return;
    }

    const generation = ++trackTransitionGeneration.current;
    if (trackTransitionCommitTimer.current) {
      clearTimeout(trackTransitionCommitTimer.current);
      trackTransitionCommitTimer.current = null;
    }
    trackTransitionHandoffTrackId.current = null;
    if (trackTransitionSettlingRef.current) updateTrackTransitionSettling(false);
    cancelAnimation(trackTransition);
    trackTransition.value = 0;
    trackTransition.value = withDelay(
      TRACK_DETAILS_OVERLAP_GAP,
      withTiming(1, { duration: TRACK_DETAILS_FADE_DURATION * 2, easing: TRACK_DETAILS_FADE_EASING }, (finished) => {
        if (finished) scheduleOnRN(commitTrackChange, track, generation, displayTrack.id, displayTrack.artwork);
      }),
    );
  }, [commitTrackChange, displayTrack.artwork, displayTrack.id, track, trackTransition, updateTrackTransitionSettling]);

  useEffect(() => () => {
    if (trackTransitionCommitTimer.current) clearTimeout(trackTransitionCommitTimer.current);
  }, []);

  useEffect(() => {
    if (!visible) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }

    if (skipNextOpenAnimation.current) {
      skipNextOpenAnimation.current = false;
      return;
    }

    progress.value = withSpring(1, {
      stiffness: 210,
      damping: 29,
      mass: 0.9,
    });
  }, [visible, progress]);

  useEffect(() => {
    lyricsProgress.value = withTiming(detailsExpanded ? 1 : 0, {
      duration: 220,
    });
  }, [detailsExpanded, lyricsProgress]);

  useEffect(() => {
    queueContentProgress.value = withTiming(queueExpanded ? 1 : 0, { duration: 180 });
  }, [queueContentProgress, queueExpanded]);

  useEffect(() => {
    detailsScrollOffset.value = 0;
  }, [detailsScrollOffset, lyricsExpanded, queueExpanded, renderedTrack.id]);

  const closeOnJS = useCallback(() => {
    setTrackActions(null);
    onCloseRef.current();
  }, []);

  const openAfterGesture = useCallback(() => {
    skipNextOpenAnimation.current = true;
    onOpenRef.current();
  }, []);

  const handleMiniSurfacePress = useCallback((event: GestureResponderEvent) => {
    if (visible) return;

    const { locationX, locationY } = event.nativeEvent;
    const isMiniControlRow = locationY >= -4 && locationY <= 58;
    const playLeft = windowWidth - 144;
    const nextLeft = windowWidth - 88;
    if (isMiniControlRow && locationX >= playLeft - 8 && locationX <= playLeft + 56) {
      onTogglePlayback();
      return;
    }
    if (isMiniControlRow && locationX >= nextLeft - 8 && locationX <= nextLeft + 52) {
      onSkipNext();
      return;
    }

    onOpenRef.current();
  }, [onSkipNext, onTogglePlayback, visible, windowWidth]);

  const closeWithAnimation = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(
        0,
        {
          stiffness: 210,
          damping: 29,
          mass: 0.9,
          velocity: -velocityY / collapseDistance,
        },
        (finished) => {
          if (finished) {
            pauseLyricsAutoScroll.value = false;
            scheduleOnRN(closeOnJS);
          }
        },
      );
    },
    [closeOnJS, collapseDistance, pauseLyricsAutoScroll, progress],
  );

  useEffect(() => {
    if (!visible) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isLandscape) return true;
      closeWithAnimation();
      return true;
    });

    return () => subscription.remove();
  }, [closeWithAnimation, isLandscape, visible]);

  const restoreExpandedPlayer = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(1, {
        stiffness: 210,
        damping: 29,
        mass: 0.9,
        velocity: -velocityY / collapseDistance,
      }, (finished) => {
        if (finished) pauseLyricsAutoScroll.value = false;
      });
    },
    [collapseDistance, pauseLyricsAutoScroll, progress],
  );

  const restoreMiniPlayer = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(0, {
        stiffness: 210,
        damping: 29,
        mass: 0.9,
        velocity: -velocityY / collapseDistance,
      }, (finished) => {
        if (finished) pauseLyricsAutoScroll.value = false;
      });
    },
    [collapseDistance, pauseLyricsAutoScroll, progress],
  );

  const openWithAnimation = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(
        1,
        {
          stiffness: 210,
          damping: 29,
          mass: 0.9,
          velocity: -velocityY / collapseDistance,
        },
        (finished) => {
          if (finished) {
            pauseLyricsAutoScroll.value = false;
            scheduleOnRN(openAfterGesture);
          }
        },
      );
    },
    [collapseDistance, openAfterGesture, pauseLyricsAutoScroll, progress],
  );

  const detailsScrollGesture = useMemo(
    () => Gesture.Native().enabled(visible && detailsExpanded),
    [detailsExpanded, visible],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!(visible && isLandscape))
        .activeOffsetY(8)
        .failOffsetX([-12, 12])
        .simultaneousWithExternalGesture(detailsScrollGesture)
        .onBegin((event) => {
          gestureStartedOnMiniPlaybackControl.value = !visible && event.y <= 60 &&
            event.x >= windowWidth - 152 && event.x <= windowWidth - 36;
          const scrollRegionTop = isLandscape
            ? safeAreaInsets.top + 80
            : queueExpanded ? lyricsTextTop + 112 : lyricsTextTop;
          const scrollRegionBottom = isLandscape
            ? windowHeight - safeAreaInsets.bottom - 54
            : lyricsTextTop + lyricsViewportHeight;
          const startedInsideScrollableDetails = visible && detailsExpanded &&
            event.y >= scrollRegionTop && event.y <= scrollRegionBottom;
          sheetPanAllowed.value = !startedInsideScrollableDetails || detailsScrollOffset.value <= 1;
        })
        .onStart(() => {
          if (gestureStartedOnMiniPlaybackControl.value || !sheetPanAllowed.value) return;
          cancelAnimation(progress);
          gestureChanged.value = false;
          gestureStartProgress.value = progress.value;
          pauseLyricsAutoScroll.value = true;
        })
        .onUpdate((event) => {
          if (gestureStartedOnMiniPlaybackControl.value || !sheetPanAllowed.value) return;
          if (Math.abs(event.translationY) > 0) {
            gestureChanged.value = true;
            progress.value = Math.max(
              0,
              Math.min(1, gestureStartProgress.value - event.translationY / collapseDistance),
            );
          }
        })
        .onEnd((event) => {
          if (gestureStartedOnMiniPlaybackControl.value || !sheetPanAllowed.value) return;
          const translationY = event.translationY;
          const startProgress = gestureStartProgress.value;

          if (translationY > 0) {
            if (translationY > 110 || (translationY > 40 && event.velocityY > 950)) {
              closeWithAnimation(event.velocityY);
            } else if (startProgress >= 0.5) {
              restoreExpandedPlayer(event.velocityY);
            } else {
              restoreMiniPlayer(event.velocityY);
            }
          } else if (translationY < 0) {
            if (translationY < -110 || (translationY < -40 && event.velocityY < -950)) {
              openWithAnimation(event.velocityY);
            } else if (startProgress >= 0.5) {
              restoreExpandedPlayer(event.velocityY);
            } else {
              restoreMiniPlayer(event.velocityY);
            }
          } else if (startProgress >= 0.5) {
            restoreExpandedPlayer();
          } else {
            restoreMiniPlayer();
          }
        })
        .onFinalize((_event, success) => {
          if (gestureStartedOnMiniPlaybackControl.value) {
            gestureStartedOnMiniPlaybackControl.value = false;
            sheetPanAllowed.value = true;
            return;
          }
          if (sheetPanAllowed.value && !success && gestureChanged.value) {
            if (gestureStartProgress.value >= 0.5) {
              restoreExpandedPlayer();
            } else {
              restoreMiniPlayer();
            }
          } else if (sheetPanAllowed.value && !success) {
            pauseLyricsAutoScroll.value = false;
          }
          sheetPanAllowed.value = true;
        }),
    [
      closeWithAnimation,
      collapseDistance,
      gestureChanged,
      gestureStartedOnMiniPlaybackControl,
      gestureStartProgress,
      detailsExpanded,
      detailsScrollOffset,
      detailsScrollGesture,
      lyricsTextTop,
      lyricsViewportHeight,
      openWithAnimation,
      progress,
      queueExpanded,
      restoreExpandedPlayer,
      restoreMiniPlayer,
      pauseLyricsAutoScroll,
      sheetPanAllowed,
      safeAreaInsets.bottom,
      safeAreaInsets.top,
      isLandscape,
      visible,
      windowHeight,
      windowWidth,
    ],
  );

  const frameStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [windowWidth - 32, windowWidth]),
    height: interpolate(progress.value, [0, 1], [windowHeight - miniTop - miniBottom, windowHeight]),
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.06, 1],
      ['rgba(9,10,12,0)', 'rgba(9,10,12,1)', 'rgba(9,10,12,1)'],
    ),
    borderWidth: interpolate(progress.value, [0, 1], [1, 0]),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)'],
    ),
    borderTopLeftRadius: interpolate(progress.value, [0, 1], [32, 40]),
    borderTopRightRadius: interpolate(progress.value, [0, 1], [32, 40]),
    borderBottomLeftRadius: interpolate(progress.value, [0, 1], [32, 0]),
    borderBottomRightRadius: interpolate(progress.value, [0, 1], [32, 0]),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [16, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [miniTop, 0]) },
    ],
  }));
  const backgroundArtworkPositionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-16, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [-miniTop, 0]) },
    ],
  }));
  const expandedSurfaceStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.42]),
  }));
  const oldArtworkBackgroundStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (isTrackTransitioning ? 1 - trackTransition.value : 1),
  }));
  const incomingArtworkBackgroundStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (isTrackTransitioning ? trackTransition.value : 0),
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const expandedContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.62, 1], [0, 0, 1]),
  }));
  const artworkStyle = useAnimatedStyle(() => {
    const expandedLeft = interpolate(
      lyricsProgress.value,
      [0, 1],
      [(windowWidth - artworkSize) / 2, 30],
    );
    const expandedTop = interpolate(lyricsProgress.value, [0, 1], [artworkTop, lyricsArtworkTop]);
    const expandedSize = interpolate(lyricsProgress.value, [0, 1], [artworkSize, 72]);

    return {
      left: expandedLeft,
      top: expandedTop,
      width: interpolate(progress.value, [0, 1], [40, expandedSize]),
      height: interpolate(progress.value, [0, 1], [40, expandedSize]),
      borderRadius: interpolate(progress.value, [0, 1], [8, 18]),
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [12 - expandedLeft, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [9 - expandedTop, 0]) },
      ],
    };
  });
  const artworkImageFrameStyle = useAnimatedStyle(() => {
    const expandedSize = interpolate(lyricsProgress.value, [0, 1], [artworkSize, 72]);
    const frameSize = interpolate(progress.value, [0, 1], [40, expandedSize]);

    return {
      position: 'absolute' as const,
      left: (frameSize - artworkSize) / 2,
      top: (frameSize - artworkSize) / 2,
      width: artworkSize,
      height: artworkSize,
      transform: [{ scale: frameSize / artworkSize }],
    };
  });
  const titleStyle = useAnimatedStyle(() => {
    const expandedLeft = interpolate(lyricsProgress.value, [0, 1], [30, 122]);
    const expandedTop = interpolate(lyricsProgress.value, [0, 1], [titleTop, lyricsTitleTop]);
    const expandedRight = interpolate(lyricsProgress.value, [0, 1], [138, 138]);

    return {
      left: expandedLeft,
      top: expandedTop,
      right: expandedRight,
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [60 - expandedLeft, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [12 - expandedTop, 0]) },
      ],
    };
  });
  const oldTrackDetailsStyle = useAnimatedStyle(() => ({
    opacity: isTrackTransitioning ? 1 - trackTransition.value : 1,
  }));
  const incomingTrackDetailsStyle = useAnimatedStyle(() => ({
    opacity: isTrackTransitioning ? trackTransition.value : 0,
  }));
  const blurredArtworkStyle = useAnimatedStyle(() => {
    const value = trackTransition.value;
    const blurEnvelope = 4 * value * (1 - value);
    return { opacity: isTrackTransitioning ? 0.72 * blurEnvelope * (1 - value) : 0 };
  });
  const incomingBlurredArtworkStyle = useAnimatedStyle(() => {
    const value = trackTransition.value;
    const blurEnvelope = 4 * value * (1 - value);
    return { opacity: isTrackTransitioning ? 0.72 * blurEnvelope * value : 0 };
  });
  const titleTextStyle = useAnimatedStyle(() => ({
    fontSize: interpolate(
      progress.value,
      [0, 1],
      [14, interpolate(lyricsProgress.value, [0, 1], [23, 21])],
    ),
  }));
  const artistTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['#A1A1A6', '#D0CFCC']),
    fontSize: interpolate(
      progress.value,
      [0, 1],
      [12, interpolate(lyricsProgress.value, [0, 1], [18, 16])],
    ),
  }));
  const playStyle = useAnimatedStyle(() => {
    const fullCenter = interpolate(
      lyricsProgress.value,
      [0, 1],
      [controlsCenter, lyricsControlsCenter],
    );

    return {
      left: windowWidth / 2 - 26,
      top: fullCenter - 26,
      width: interpolate(progress.value, [0, 1], [48, 52]),
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [windowWidth - 144 - (windowWidth / 2 - 26), 0]) },
        { translateY: interpolate(progress.value, [0, 1], [3 - (fullCenter - 26), 0]) },
      ],
    };
  });
  const nextStyle = useAnimatedStyle(() => {
    const fullCenter = interpolate(
      lyricsProgress.value,
      [0, 1],
      [controlsCenter, lyricsControlsCenter],
    );

    return {
      left: windowWidth - 88,
      top: fullCenter - 22,
      transform: [
        { translateY: interpolate(progress.value, [0, 1], [7 - (fullCenter - 22), 0]) },
      ],
    };
  });
  const playIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [23 / 52, 1]) }],
  }));
  const nextIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.5, 1]) }],
  }));
  const actionsStyle = useAnimatedStyle(() => ({
    top:
      interpolate(lyricsProgress.value, [0, 1], [titleTop + 4, lyricsTitleTop + 4]),
    opacity: interpolate(progress.value, [0, 0.72, 1], [0, 0, 1]),
  }));

  const expandedProgressStyle = useAnimatedStyle(() => ({
    top: interpolate(lyricsProgress.value, [0, 1], [titleTop + 88, lyricsProgressTop]),
  }));
  const expandedTransportStyle = useAnimatedStyle(() => {
    const center = interpolate(lyricsProgress.value, [0, 1], [controlsCenter, lyricsControlsCenter]);
    return { top: center - 26 };
  });
  const expandedVolumeStyle = useAnimatedStyle(() => {
    const center = interpolate(lyricsProgress.value, [0, 1], [controlsCenter, lyricsControlsCenter]);
    return { top: center + 54 };
  });
  const expandedActionsStyle = useAnimatedStyle(() => {
    const center = interpolate(lyricsProgress.value, [0, 1], [controlsCenter, lyricsControlsCenter]);
    return { top: center + 100 };
  });
  const lyricsPanelStyle = useAnimatedStyle(() => ({
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
      [0, lyricsViewportHeight],
    ),
    opacity: interpolate(progress.value, [0, 0.62, 1], [0, 0, 1]) *
      lyricsProgress.value * (1 - queueContentProgress.value) * (isTrackTransitioning
        ? 1 - interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
        : 0),
    transform: [
      { scaleX: interpolate(progress.value, [0, 1], [Math.max(windowWidth - 92, 1) / Math.max(windowWidth - 60, 1), 1]) },
      { translateY: interpolate(progress.value, [0, 1], [miniTop, 0]) },
    ],
  }));
  const incomingLyricsPanelStyle = useAnimatedStyle(() => ({
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
      [0, lyricsViewportHeight],
    ),
    opacity: interpolate(progress.value, [0, 0.62, 1], [0, 0, 1]) *
      lyricsProgress.value * (1 - queueContentProgress.value) * (isTrackTransitioning
        ? interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
        : 1),
    transform: [
      { scaleX: interpolate(progress.value, [0, 1], [Math.max(windowWidth - 92, 1) / Math.max(windowWidth - 60, 1), 1]) },
      { translateY: interpolate(progress.value, [0, 1], [miniTop, 0]) },
    ],
  }));
  const queuePanelStyle = useAnimatedStyle(() => ({
    top: lyricsTextTop,
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
      [0, lyricsViewportHeight],
    ),
    opacity: lyricsProgress.value * queueContentProgress.value * (isTrackTransitioning
      ? 1 - interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
      : 0),
  }));
  const incomingQueuePanelStyle = useAnimatedStyle(() => ({
    top: lyricsTextTop,
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
      [0, lyricsViewportHeight],
    ),
    opacity: lyricsProgress.value * queueContentProgress.value * (isTrackTransitioning
      ? interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
      : 1),
  }));

  const toggleLyrics = () => {
    if (!canShowLyrics) return;
    const nextExpanded = !lyricsExpanded;
    setTrackedQueueView({ trackId: renderedTrack.id, expanded: false });
    setTrackedLyricsView({ trackId: renderedTrack.id, expanded: nextExpanded });
  };

  const toggleQueue = () => {
    setTrackedLyricsView({ trackId: renderedTrack.id, expanded: false });
    setTrackedQueueView({ trackId: renderedTrack.id, expanded: !queueExpanded });
  };

  if (visible && isLandscape) {
    return (
      <>
        <GestureDetector gesture={panGesture}>
          <ReanimatedAnimated.View
            pointerEvents="auto"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#090A0C' }]}
          >
            <LandscapePlayerLayout
              track={renderedTrack}
              incomingTrack={track}
              trackTransitioning={isTrackTransitioning}
              transitionProgress={trackTransition}
              onDisplayedArtworkLoaded={finishTrackTransitionHandoff}
              lyrics={lyrics}
              lyricsAttribution={renderedTrack.lyricsAttribution}
              hasLyrics={hasLyrics}
              isLyricsLoading={isLyricsLoading}
              lineSyncedWordWaveEnabled={lineSyncedWordWaveEnabled}
              isFavorite={isFavorite}
              canFavoriteTrack={canFavoriteTrack}
              isLiveRadio={isLiveRadio}
              isPlaying={isPlaying}
              durationSeconds={durationSeconds}
              volume={volume}
              lyricsExpanded={lyricsExpanded}
              queueExpanded={queueExpanded}
              tracks={upcomingTracks}
              scrollGesture={detailsScrollGesture}
              scrollOffset={detailsScrollOffset}
              pauseAutoScroll={pauseLyricsAutoScroll}
              shuffleEnabled={shuffleEnabled}
              repeatMode={repeatMode}
              autoplayEnabled={autoplayEnabled}
              onToggleFavorite={onToggleFavorite}
              onOpenTrackActions={openTrackActions}
              onTogglePlayback={onTogglePlayback}
              onSkipPrevious={onSkipPrevious}
              onSkipNext={onSkipNext}
              onHoldPreviousStart={onHoldPreviousStart}
              onHoldPreviousEnd={onHoldPreviousEnd}
              onHoldNextStart={onHoldNextStart}
              onHoldNextEnd={onHoldNextEnd}
              onSeek={onSeek}
              onVolumeChange={onVolumeChange}
              onToggleLyrics={toggleLyrics}
              onToggleQueue={toggleQueue}
              onPlayQueueTrack={onPlayQueueTrack}
              onToggleShuffle={onToggleShuffle}
              onToggleRepeat={onToggleRepeat}
              onToggleAutoplay={onToggleAutoplay}
              onClearQueue={onClearQueue}
              onRemoveQueueTrack={onRemoveQueueTrack}
            />
          </ReanimatedAnimated.View>
        </GestureDetector>
        {trackActionsSheet}
      </>
    );
  }

  return (
    <ReanimatedAnimated.View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}
    >
      <ReanimatedAnimated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000000',
          },
          backdropStyle,
        ]}
      />
      <GestureDetector gesture={panGesture}>
        <ReanimatedAnimated.View
          pointerEvents="auto"
          style={[
            {
              position: 'absolute',
              overflow: 'hidden',
              top: 0,
              left: 0,
              width: windowWidth,
              height: windowHeight,
              shadowColor: '#000000',
              shadowOpacity: 0.28,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
              backgroundColor: 'transparent',
            },
            frameStyle,
          ]}
        >
          {HAS_LIQUID_GLASS ? (
            <GlassView
              pointerEvents="none"
              glassEffectStyle="regular"
              colorScheme="dark"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          ) : (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(32,32,36,0.92)' }}
            />
          )}
          <ReanimatedAnimated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,28,30,0.96)' },
              expandedSurfaceStyle,
            ]}
          />
          <ReanimatedExpoImage
            source={displayArtworkSource}
            contentFit="cover"
            blurRadius={20}
            onDisplay={() => finishTrackTransitionHandoff(displayTrack.id)}
            onError={() => finishTrackTransitionHandoff(displayTrack.id)}
            style={[
              { position: 'absolute', top: 0, left: 0, width: windowWidth, height: windowHeight },
              backgroundArtworkPositionStyle,
              oldArtworkBackgroundStyle,
            ]}
          />
          {isTrackTransitioning ? (
            <ReanimatedExpoImage
              source={incomingArtworkSource}
              contentFit="cover"
              blurRadius={20}
              style={[
                { position: 'absolute', top: 0, left: 0, width: windowWidth, height: windowHeight },
                backgroundArtworkPositionStyle,
                incomingArtworkBackgroundStyle,
              ]}
            />
          ) : null}
          <ReanimatedAnimated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(14, 12, 11, 0.46)',
              },
              dimStyle,
            ]}
          />

          <ReanimatedAnimated.View
            pointerEvents={visible ? 'none' : 'auto'}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleMiniSurfacePress}
              accessibilityRole="button"
              accessibilityLabel={visible ? 'Full music player' : 'Open music player'}
              style={{ flex: 1 }}
            />
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents={visible ? 'auto' : 'none'}
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              },
              expandedContentStyle,
            ]}
          >
            {visible && queueExpanded && isTrackTransitioning ? (
              <ReanimatedAnimated.View
                pointerEvents="none"
                style={[
                  { position: 'absolute', left: 30, right: 30, overflow: 'hidden' },
                  queuePanelStyle,
                ]}
              >
                <PlayerQueuePanel
                  tracks={upcomingTracks}
                  height={lyricsViewportHeight}
                  scrollGesture={detailsScrollGesture}
                  scrollOffset={detailsScrollOffset}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  autoplayEnabled={autoplayEnabled}
                  onPlayTrack={onPlayQueueTrack}
                  onToggleShuffle={onToggleShuffle}
                  onToggleRepeat={onToggleRepeat}
                  onToggleAutoplay={onToggleAutoplay}
                  onClearQueue={onClearQueue}
                  onRemoveTrack={onRemoveQueueTrack}
                />
              </ReanimatedAnimated.View>
            ) : null}
            {/* Keep this panel mounted as the active list after handoff to avoid a frame swap. */}
            {visible && queueExpanded ? (
              <ReanimatedAnimated.View
                pointerEvents="auto"
                style={[
                  { position: 'absolute', left: 30, right: 30, overflow: 'hidden' },
                  incomingQueuePanelStyle,
                ]}
              >
                <PlayerQueuePanel
                  tracks={incomingUpcomingTracks}
                  height={lyricsViewportHeight}
                  scrollGesture={detailsScrollGesture}
                  scrollOffset={detailsScrollOffset}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  autoplayEnabled={autoplayEnabled}
                  onPlayTrack={onPlayQueueTrack}
                  onToggleShuffle={onToggleShuffle}
                  onToggleRepeat={onToggleRepeat}
                  onToggleAutoplay={onToggleAutoplay}
                  onClearQueue={onClearQueue}
                  onRemoveTrack={onRemoveQueueTrack}
                />
              </ReanimatedAnimated.View>
            ) : null}

            <ReanimatedAnimated.View
              style={[
                { position: 'absolute', left: 30, right: 30 },
                expandedProgressStyle,
              ]}
            >
              {visible ? (
                <PlayerProgress
                  isLiveRadio={isLiveRadio}
                  fallbackDurationSeconds={durationSeconds}
                  onSeek={onSeek}
                />
              ) : null}
            </ReanimatedAnimated.View>

            <ReanimatedAnimated.View
              style={[
                {
                  position: 'absolute',
                  left: 30,
                  right: 30,
                  height: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 12,
                },
                expandedTransportStyle,
              ]}
            >
                <Pressable
                  onPress={() => {
                    if (previousLongPressTriggered.current) {
                      previousLongPressTriggered.current = false;
                      return;
                    }
                    onSkipPrevious();
                  }}
                  onPressIn={() => {
                    previousLongPressTriggered.current = false;
                  }}
                  onLongPress={() => {
                    if (isLiveRadio) return;
                    previousLongPressTriggered.current = true;
                    onHoldPreviousStart();
                  }}
                  onPressOut={onHoldPreviousEnd}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityLabel="Previous track. Hold to rewind at double speed."
                  hitSlop={12}
                >
                  <Ionicons name="play-skip-back" size={44} color="white" />
                </Pressable>
                <View style={{ width: 52, height: 52 }} />
                <View style={{ width: 44, height: 44 }} />
            </ReanimatedAnimated.View>

            <ReanimatedAnimated.View
              style={[
                {
                  position: 'absolute',
                  left: 30,
                  right: 30,
                  height: 24,
                  flexDirection: 'row',
                  alignItems: 'center',
                },
                expandedVolumeStyle,
              ]}
            >
                <Ionicons name="volume-low" size={20} color="rgba(255,255,255,0.6)" />
                <View
                  style={{
                    flex: 1,
                    marginHorizontal: 10,
                  }}
                >
                  <PlayerSlider
                    value={volume}
                    accessibilityLabel="Playback volume"
                    activeColor="rgba(255,255,255,0.72)"
                    thumbAlwaysVisible
                    onValueChange={onVolumeChange}
                  />
                </View>
                <Ionicons name="volume-high" size={20} color="rgba(255,255,255,0.72)" />
            </ReanimatedAnimated.View>

            <ReanimatedAnimated.View
              style={[
                {
                  position: 'absolute',
                  left: 30,
                  right: 30,
                  height: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-around',
                },
                expandedActionsStyle,
              ]}
            >
                <TouchableOpacity
                  onPress={toggleLyrics}
                  disabled={!canShowLyrics}
                  accessibilityRole="button"
                  accessibilityLabel={lyricsExpanded ? 'Hide lyrics' : 'Show lyrics'}
                  accessibilityState={{ disabled: !canShowLyrics, selected: lyricsExpanded }}
                  hitSlop={10}
                  style={{
                    padding: 8,
                    borderRadius: 28,
                    backgroundColor: lyricsExpanded ? 'rgba(255,255,255,0.78)' : 'transparent',
                    opacity: canShowLyrics ? 1 : 0.34,
                  }}
                >
                  <Ionicons
                    name="chatbox-ellipses-outline"
                    size={25}
                    color={lyricsExpanded ? '#34291C' : 'rgba(255,255,255,0.68)'}
                  />
                </TouchableOpacity>
                <PlayerOutputRouteButton />
                <TouchableOpacity
                  onPress={toggleQueue}
                  accessibilityRole="button"
                  accessibilityLabel={queueExpanded ? 'Hide queue' : 'Show queue'}
                  accessibilityState={{ selected: queueExpanded }}
                  hitSlop={10}
                  style={{
                    padding: 8,
                    borderRadius: 28,
                    backgroundColor: queueExpanded ? 'rgba(255,255,255,0.78)' : 'transparent',
                  }}
                >
                  <Ionicons
                    name="list"
                    size={28}
                    color={queueExpanded ? '#34291C' : 'rgba(255,255,255,0.68)'}
                  />
                </TouchableOpacity>
            </ReanimatedAnimated.View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => closeWithAnimation()}
              accessibilityRole="button"
              accessibilityLabel="Drag down or tap to collapse player"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 114,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
              }}
            >
              <View
                style={{
                  width: 66,
                  height: 6,
                  borderRadius: 6,
                  backgroundColor: 'rgba(255, 255, 255, 0.36)',
                }}
              />
            </TouchableOpacity>
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents={visible && canShowLyrics ? 'auto' : 'none'}
            style={[
              {
                position: 'absolute',
                overflow: 'hidden',
                backgroundColor: '#343438',
              },
              artworkStyle,
            ]}
          >
            <TouchableOpacity
              onPress={toggleLyrics}
              disabled={!visible || !canShowLyrics}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel={lyricsExpanded ? 'Hide lyrics' : 'Show lyrics'}
              accessibilityState={{ disabled: !visible || !canShowLyrics, selected: lyricsExpanded }}
              style={{ width: '100%', height: '100%' }}
            >
              <ReanimatedAnimated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, oldTrackDetailsStyle]}
              >
                <ReanimatedAnimated.View style={artworkImageFrameStyle}>
                  <ReanimatedExpoImage
                    source={displayArtworkSource}
                    contentFit="cover"
                    accessibilityLabel={displayTrack.album + ' album artwork'}
                    style={{ width: artworkSize, height: artworkSize }}
                  />
                </ReanimatedAnimated.View>
              </ReanimatedAnimated.View>
              <ReanimatedAnimated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, blurredArtworkStyle]}
              >
                <ReanimatedAnimated.View style={artworkImageFrameStyle}>
                  <ReanimatedExpoImage
                    source={displayArtworkSource}
                    contentFit="cover"
                    blurRadius={18}
                    accessibilityLabel={displayTrack.album + ' album artwork'}
                    style={{ width: artworkSize, height: artworkSize }}
                  />
                </ReanimatedAnimated.View>
              </ReanimatedAnimated.View>
              {isTrackTransitioning ? (
                <ReanimatedAnimated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, incomingTrackDetailsStyle]}
                >
                  <ReanimatedAnimated.View style={artworkImageFrameStyle}>
                    <ReanimatedExpoImage
                      source={incomingArtworkSource}
                      contentFit="cover"
                      accessibilityLabel={track.album + ' album artwork'}
                      style={{ width: artworkSize, height: artworkSize }}
                    />
                  </ReanimatedAnimated.View>
                </ReanimatedAnimated.View>
              ) : null}
              {isTrackTransitioning ? (
                <ReanimatedAnimated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, incomingBlurredArtworkStyle]}
                >
                  <ReanimatedAnimated.View style={artworkImageFrameStyle}>
                    <ReanimatedExpoImage
                      source={incomingArtworkSource}
                      contentFit="cover"
                      blurRadius={18}
                      accessibilityLabel={track.album + ' album artwork'}
                      style={{ width: artworkSize, height: artworkSize }}
                    />
                  </ReanimatedAnimated.View>
                </ReanimatedAnimated.View>
              ) : null}
            </TouchableOpacity>
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents="none"
            style={[
              { position: 'absolute' },
              titleStyle,
            ]}
          >
            <ReanimatedAnimated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, oldTrackDetailsStyle]}>
              <ReanimatedAnimated.Text
                numberOfLines={1}
                style={[{ color: 'white', fontWeight: '700' }, titleTextStyle]}
              >
                {displayTrack.title}
              </ReanimatedAnimated.Text>
              <ReanimatedAnimated.Text
                numberOfLines={1}
                style={[{ marginTop: 3 }, artistTextStyle]}
              >
                {displayTrack.artist}
              </ReanimatedAnimated.Text>
            </ReanimatedAnimated.View>
            {isTrackTransitioning ? (
              <ReanimatedAnimated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, incomingTrackDetailsStyle]}>
                <ReanimatedAnimated.Text
                  numberOfLines={1}
                  style={[{ color: 'white', fontWeight: '700' }, titleTextStyle]}
                >
                  {track.title}
                </ReanimatedAnimated.Text>
                <ReanimatedAnimated.Text
                  numberOfLines={1}
                  style={[{ marginTop: 3 }, artistTextStyle]}
                >
                  {track.artist}
                </ReanimatedAnimated.Text>
              </ReanimatedAnimated.View>
            ) : null}
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents={visible ? 'auto' : 'none'}
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                height: 44,
                opacity: 0,
              },
              actionsStyle,
            ]}
          >
            <View style={{ position: 'absolute', right: 30, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={(event) => {
                  const { pageX, pageY, locationX, locationY } = event.nativeEvent;
                  openTrackActions({ x: pageX - locationX, y: pageY - locationY, width: 44, height: 44 });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="More track options"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255, 255, 255, 0.13)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={24} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onToggleFavorite}
                disabled={!canFavoriteTrack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                accessibilityState={{ selected: isFavorite }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255, 255, 255, 0.13)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: canFavoriteTrack ? 1 : 0.35,
                }}
              >
                <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={24} color={isFavorite ? '#FA5265' : 'white'} />
              </TouchableOpacity>
            </View>
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents="box-none"
            style={[
              {
                position: 'absolute',
                width: 52,
                height: 52,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                elevation: 20,
              },
              playStyle,
            ]}
          >
            <Pressable
              onPress={onTogglePlayback}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              hitSlop={4}
              style={({ pressed }) => [
                { width: '100%', height: 52, alignItems: 'center', justifyContent: 'center' },
                pressed ? {
                  transform: [{ scale: 0.96 }],
                  shadowColor: '#FFFFFF',
                  shadowOpacity: 0.18,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 5,
                } : null,
              ]}
            >
              <ReanimatedAnimated.View style={playIconStyle}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={52} color="white" />
              </ReanimatedAnimated.View>
            </Pressable>
          </ReanimatedAnimated.View>

          <ReanimatedAnimated.View
            pointerEvents="box-none"
            style={[
              {
                position: 'absolute',
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                elevation: 20,
              },
              nextStyle,
            ]}
          >
            <Pressable
              onPress={() => {
                if (nextLongPressTriggered.current) {
                  nextLongPressTriggered.current = false;
                  return;
                }
                onSkipNext();
              }}
              onPressIn={() => {
                nextLongPressTriggered.current = false;
              }}
              onLongPress={() => {
                if (isLiveRadio) return;
                nextLongPressTriggered.current = true;
                onHoldNextStart();
              }}
              onPressOut={onHoldNextEnd}
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel="Next track. Hold to fast-forward at double speed."
              hitSlop={4}
              style={({ pressed }) => [
                { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
                pressed ? {
                  transform: [{ scale: 0.96 }],
                  shadowColor: '#FFFFFF',
                  shadowOpacity: 0.18,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 5,
                } : null,
              ]}
            >
              <ReanimatedAnimated.View style={nextIconStyle}>
                <Ionicons name="play-skip-forward" size={44} color="white" />
              </ReanimatedAnimated.View>
            </Pressable>
          </ReanimatedAnimated.View>

          {visible && ((lyricsExpanded && canShowLyrics) || queueExpanded) ? (
            <TouchableOpacity
              onPress={queueExpanded ? toggleQueue : toggleLyrics}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel={queueExpanded ? 'Hide queue' : 'Hide lyrics'}
              accessibilityState={{ selected: true }}
              hitSlop={8}
              style={{
                position: 'absolute',
                left: 20,
                top: lyricsArtworkTop - 8,
                width: 92,
                height: 92,
                zIndex: 50,
              }}
            />
          ) : null}
        </ReanimatedAnimated.View>
      </GestureDetector>
      {visible && lyricsExpanded && isTrackTransitioning ? (
        <ReanimatedAnimated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: 30, right: 30, top: lyricsTextTop, overflow: 'hidden', zIndex: 21 },
            lyricsPanelStyle,
          ]}
        >
          {hasLyrics ? (
            <ReanimatedAnimated.View pointerEvents="auto" style={{ flex: 1 }}>
              <PlayerLyrics
                key={renderedTrack.id}
                trackId={renderedTrack.id}
                lyrics={lyrics}
                lyricsAttribution={renderedTrack.lyricsAttribution}
                lineSyncedWordWaveEnabled={lineSyncedWordWaveEnabled}
                pauseAutoScroll={pauseLyricsAutoScroll}
                viewportHeight={lyricsViewportHeight}
                scrollGesture={detailsScrollGesture}
                scrollOffset={detailsScrollOffset}
                onSeek={onSeek}
              />
            </ReanimatedAnimated.View>
          ) : isLyricsLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.58)', fontSize: 15 }}>Checking for lyrics…</Text>
            </View>
          ) : null}
        </ReanimatedAnimated.View>
      ) : null}
      {/* Keep the incoming lyrics mounted as the active panel after handoff. */}
      {visible && incomingLyricsExpanded ? (
        <ReanimatedAnimated.View
          pointerEvents="auto"
          style={[
            { position: 'absolute', left: 30, right: 30, top: lyricsTextTop, overflow: 'hidden', zIndex: 21 },
            incomingLyricsPanelStyle,
          ]}
        >
          {incomingHasLyrics ? (
            <ReanimatedAnimated.View pointerEvents="auto" style={{ flex: 1 }}>
              <PlayerLyrics
                key={track.id}
                trackId={track.id}
                lyrics={incomingLyrics}
                lyricsAttribution={track.lyricsAttribution}
                lineSyncedWordWaveEnabled={lineSyncedWordWaveEnabled}
                pauseAutoScroll={pauseLyricsAutoScroll}
                viewportHeight={lyricsViewportHeight}
                scrollGesture={detailsScrollGesture}
                scrollOffset={detailsScrollOffset}
                onSeek={onSeek}
              />
            </ReanimatedAnimated.View>
          ) : incomingIsLyricsLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.58)', fontSize: 15 }}>Checking for lyrics…</Text>
            </View>
          ) : null}
        </ReanimatedAnimated.View>
      ) : null}
      {trackActionsSheet}
    </ReanimatedAnimated.View>
  );
};

type PlayerOverlayViewProps = React.ComponentProps<typeof PlayerOverlayView>;

const playerOverlayViewPropsAreEqual = (previous: PlayerOverlayViewProps, next: PlayerOverlayViewProps) => {
  if (
    previous.visible !== next.visible ||
    previous.track !== next.track ||
    previous.lyricsLoadingTrackId !== next.lyricsLoadingTrackId ||
    previous.lineSyncedWordWaveEnabled !== next.lineSyncedWordWaveEnabled ||
    previous.isFavorite !== next.isFavorite ||
    previous.isPlaying !== next.isPlaying ||
    previous.onOpen !== next.onOpen ||
    previous.onClose !== next.onClose ||
    previous.onTogglePlayback !== next.onTogglePlayback ||
    previous.onSkipPrevious !== next.onSkipPrevious ||
    previous.onSkipNext !== next.onSkipNext ||
    previous.onHoldPreviousStart !== next.onHoldPreviousStart ||
    previous.onHoldPreviousEnd !== next.onHoldPreviousEnd ||
    previous.onHoldNextStart !== next.onHoldNextStart ||
    previous.onHoldNextEnd !== next.onHoldNextEnd ||
    previous.onSeek !== next.onSeek ||
    previous.onVolumeChange !== next.onVolumeChange ||
    previous.onToggleFavorite !== next.onToggleFavorite ||
    previous.playlists !== next.playlists ||
    previous.hasActiveTrack !== next.hasActiveTrack ||
    previous.onPlayNext !== next.onPlayNext ||
    previous.onToggleTrackFavorite !== next.onToggleTrackFavorite ||
    previous.onAddToPlaylist !== next.onAddToPlaylist ||
    previous.onCreatePlaylist !== next.onCreatePlaylist ||
    previous.onSaveTrack !== next.onSaveTrack ||
    previous.onDeleteTrack !== next.onDeleteTrack ||
    previous.onPlayQueueTrack !== next.onPlayQueueTrack ||
    previous.onToggleShuffle !== next.onToggleShuffle ||
    previous.onToggleRepeat !== next.onToggleRepeat ||
    previous.onToggleAutoplay !== next.onToggleAutoplay ||
    previous.onClearQueue !== next.onClearQueue ||
    previous.onRemoveQueueTrack !== next.onRemoveQueueTrack
  ) return false;

  if (!next.visible) return true;

  return (
    previous.durationSeconds === next.durationSeconds &&
    previous.volume === next.volume &&
    previous.queue === next.queue &&
    previous.shuffleEnabled === next.shuffleEnabled &&
    previous.repeatMode === next.repeatMode &&
    previous.autoplayEnabled === next.autoplayEnabled
  );
};

export const PlayerOverlay = React.memo(PlayerOverlayView, playerOverlayViewPropsAreEqual);
