// Reanimated shared-value writes and worklet callbacks are intentional in this component.
/* eslint-disable react-hooks/immutability, react-hooks/refs */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import ReanimatedAnimated, { cancelAnimation, Easing, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';
import { PlayerLyrics } from './PlayerLyrics';
import { PlayerOutputRouteButton } from './PlayerOutputRouteButton';
import { PlayerQueuePanel } from './PlayerQueuePanel';
import { PlayerSlider } from './PlayerSlider';
import type { Track } from '../../types';

const HAS_LIQUID_GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
const TRACK_DETAILS_FADE_DURATION = 290;
const TRACK_DETAILS_OVERLAP_GAP = 100;
const TRACK_DETAILS_FADE_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const getArtworkSource = (track: Track) => track.artwork
  ? {
      uri: track.artwork,
      headers: track.provider === 'local' ? getMusicApiHeaders() : undefined,
    }
  : undefined;

const PlayerOverlayView = ({
  visible,
  track,
  lyricsLoadingTrackId,
  isFavorite,
  isPlaying,
  currentTime,
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
  onSeek,
  onVolumeChange,
  onToggleFavorite,
  onPlayQueueTrack,
  onToggleShuffle,
  onToggleRepeat,
  onToggleAutoplay,
  onClearQueue,
}: {
  visible: boolean;
  track: Track;
  lyricsLoadingTrackId: string | null;
  isFavorite: boolean;
  isPlaying: boolean;
  currentTime: number;
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
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleFavorite: () => void;
  onPlayQueueTrack: (track: Track) => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleAutoplay: () => void;
  onClearQueue: () => void;
}) => {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const progress = useSharedValue(0);
  const gestureStartProgress = useSharedValue(1);
  const gestureChanged = useSharedValue(false);
  const gestureStartedOnMiniPlaybackControl = useSharedValue(false);
  const lyricsProgress = useSharedValue(0);
  const queueContentProgress = useSharedValue(0);
  const detailsScrollOffset = useSharedValue(0);
  const sheetPanAllowed = useSharedValue(true);
  const trackTransition = useSharedValue(1);
  const trackTransitionGeneration = useRef(0);
  const trackTransitionCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const skipNextOpenAnimation = useRef(false);
  const [displayTrack, setDisplayTrack] = useState(track);
  const [trackTransitionSettling, setTrackTransitionSettling] = useState(false);
  const trackTransitionSettlingRef = useRef(false);
  const updateTrackTransitionSettling = useCallback((settling: boolean) => {
    trackTransitionSettlingRef.current = settling;
    setTrackTransitionSettling(settling);
  }, []);
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
  const elapsedSeconds = Math.max(0, currentTime);
  const totalSeconds = Math.max(0, durationSeconds);
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const activeLyricIndex = useMemo(() => {
    if (!lyricsExpanded || !hasLyrics) return -1;
    return lyrics.reduce((activeIndex, line, index) =>
      line.text.trim().length > 0 && line.timeMs !== null && line.timeMs <= elapsedSeconds * 1000
        ? index
        : activeIndex,
    -1);
  }, [elapsedSeconds, hasLyrics, lyrics, lyricsExpanded]);
  const incomingActiveLyricIndex = useMemo(() => {
    if (!incomingHasLyrics) return -1;
    return incomingLyrics.reduce((activeIndex, line, index) =>
      line.text.trim().length > 0 && line.timeMs !== null && line.timeMs <= elapsedSeconds * 1000
        ? index
        : activeIndex,
    -1);
  }, [elapsedSeconds, incomingHasLyrics, incomingLyrics]);
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
  const lyricsArtworkTop = 154;
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

  const commitTrackChange = useCallback((nextTrack: Track, generation: number, previousTrackId: string) => {
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
    updateTrackTransitionSettling(true);
    trackTransitionCommitTimer.current = setTimeout(() => {
      trackTransitionCommitTimer.current = null;
      updateTrackTransitionSettling(false);
    }, TRACK_DETAILS_OVERLAP_GAP);
  }, [setTrackedLyricsView, setTrackedQueueView, updateTrackTransitionSettling]);

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
    cancelAnimation(trackTransition);
    trackTransition.value = 0;
    trackTransition.value = withDelay(
      TRACK_DETAILS_OVERLAP_GAP,
      withTiming(1, { duration: TRACK_DETAILS_FADE_DURATION * 2, easing: TRACK_DETAILS_FADE_EASING }, (finished) => {
        if (finished) scheduleOnRN(commitTrackChange, track, generation, displayTrack.id);
      }),
    );
  }, [commitTrackChange, displayTrack.id, track, trackTransition, updateTrackTransitionSettling]);

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
          if (finished) scheduleOnRN(closeOnJS);
        },
      );
    },
    [closeOnJS, collapseDistance, progress],
  );

  useEffect(() => {
    if (!visible) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeWithAnimation();
      return true;
    });

    return () => subscription.remove();
  }, [closeWithAnimation, visible]);

  const restoreExpandedPlayer = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(1, {
        stiffness: 210,
        damping: 29,
        mass: 0.9,
        velocity: -velocityY / collapseDistance,
      });
    },
    [collapseDistance, progress],
  );

  const restoreMiniPlayer = useCallback(
    (velocityY = 0) => {
      'worklet';
      progress.value = withSpring(0, {
        stiffness: 210,
        damping: 29,
        mass: 0.9,
        velocity: -velocityY / collapseDistance,
      });
    },
    [collapseDistance, progress],
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
          if (finished) scheduleOnRN(openAfterGesture);
        },
      );
    },
    [collapseDistance, openAfterGesture, progress],
  );

  const detailsScrollGesture = useMemo(
    () => Gesture.Native().enabled(visible && detailsExpanded),
    [detailsExpanded, visible],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-12, 12])
        .simultaneousWithExternalGesture(detailsScrollGesture)
        .onBegin((event) => {
          gestureStartedOnMiniPlaybackControl.value = !visible && event.y <= 60 &&
            event.x >= windowWidth - 152 && event.x <= windowWidth - 36;
          const scrollRegionTop = queueExpanded ? lyricsTextTop + 112 : lyricsTextTop;
          const startedInsideScrollableDetails = visible && detailsExpanded &&
            event.y >= scrollRegionTop && event.y <= lyricsTextTop + lyricsViewportHeight;
          sheetPanAllowed.value = !startedInsideScrollableDetails || detailsScrollOffset.value <= 1;
        })
        .onStart(() => {
          if (gestureStartedOnMiniPlaybackControl.value || !sheetPanAllowed.value) return;
          cancelAnimation(progress);
          gestureChanged.value = false;
          gestureStartProgress.value = progress.value;
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
      sheetPanAllowed,
      visible,
      windowWidth,
    ],
  );

  const frameStyle = useAnimatedStyle(() => ({
    left: interpolate(progress.value, [0, 1], [16, 0]),
    right: interpolate(progress.value, [0, 1], [16, 0]),
    top: interpolate(progress.value, [0, 1], [miniTop, 0]),
    bottom: interpolate(progress.value, [0, 1], [miniBottom, 0]),
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
      left: interpolate(progress.value, [0, 1], [12, expandedLeft]),
      top: interpolate(progress.value, [0, 1], [9, expandedTop]),
      width: interpolate(progress.value, [0, 1], [40, expandedSize]),
      height: interpolate(progress.value, [0, 1], [40, expandedSize]),
      borderRadius: interpolate(progress.value, [0, 1], [8, 18]),
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
      left: interpolate(progress.value, [0, 1], [60, expandedLeft]),
      top: interpolate(progress.value, [0, 1], [12, expandedTop]),
      right: interpolate(progress.value, [0, 1], [112, expandedRight]),
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
      left: interpolate(progress.value, [0, 1], [windowWidth - 144, windowWidth / 2 - 26]),
      top: interpolate(progress.value, [0, 1], [3, fullCenter - 26]),
      width: interpolate(progress.value, [0, 1], [48, 52]),
    };
  });
  const nextStyle = useAnimatedStyle(() => {
    const fullCenter = interpolate(
      lyricsProgress.value,
      [0, 1],
      [controlsCenter, lyricsControlsCenter],
    );

    return {
      left: interpolate(progress.value, [0, 1], [windowWidth - 88, windowWidth - 88]),
      top: interpolate(progress.value, [0, 1], [7, fullCenter - 22]),
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
    top: lyricsTextTop,
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
                  [0, lyricsViewportHeight],
    ),
    opacity: lyricsProgress.value * (1 - queueContentProgress.value) * (isTrackTransitioning
      ? 1 - interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
      : 0),
  }));
  const incomingLyricsPanelStyle = useAnimatedStyle(() => ({
    top: lyricsTextTop,
    height: interpolate(
      lyricsProgress.value,
      [0, 1],
      [0, lyricsViewportHeight],
    ),
    opacity: lyricsProgress.value * (1 - queueContentProgress.value) * (isTrackTransitioning
      ? interpolate(trackTransition.value, [0, 0.8, 1], [0, 0, 1])
      : 1),
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
              backgroundColor: 'transparent',
              shadowColor: '#000000',
              shadowOpacity: 0.28,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
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
          <ReanimatedAnimated.Image
            source={displayArtworkSource}
            resizeMode="cover"
            blurRadius={20}
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              },
              oldArtworkBackgroundStyle,
            ]}
          />
          {isTrackTransitioning ? (
            <ReanimatedAnimated.Image
              source={incomingArtworkSource}
              resizeMode="cover"
              blurRadius={20}
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                },
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
            {visible && lyricsExpanded && isTrackTransitioning ? (
              <ReanimatedAnimated.View
                pointerEvents="none"
                style={[
                  { position: 'absolute', left: 30, right: 30, overflow: 'hidden' },
                  lyricsPanelStyle,
                ]}
              >
                {hasLyrics ? (
                  <ReanimatedAnimated.View pointerEvents="auto" style={{ flex: 1 }}>
                    <PlayerLyrics
                      key={renderedTrack.id}
                      trackId={renderedTrack.id}
                      lyrics={lyrics}
                      activeLineIndex={activeLyricIndex}
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
            {incomingLyricsExpanded ? (
              <ReanimatedAnimated.View
                pointerEvents="auto"
                style={[
                  { position: 'absolute', left: 30, right: 30, overflow: 'hidden' },
                  incomingLyricsPanelStyle,
                ]}
              >
                {incomingHasLyrics ? (
                  <ReanimatedAnimated.View pointerEvents="auto" style={{ flex: 1 }}>
                    <PlayerLyrics
                      key={track.id}
                      trackId={track.id}
                      lyrics={incomingLyrics}
                      activeLineIndex={incomingActiveLyricIndex}
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
                />
              </ReanimatedAnimated.View>
            ) : null}

            <ReanimatedAnimated.View
              style={[
                { position: 'absolute', left: 30, right: 30 },
                expandedProgressStyle,
              ]}
            >
                {isLiveRadio ? (
                  <View style={{ minHeight: 55, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ minHeight: 32, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(250,82,101,0.14)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FA5265' }} />
                      <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 }}>LIVE STREAM</Text>
                    </View>
                  </View>
                ) : (
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
                )}
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
                <TouchableOpacity
                  onPress={onSkipPrevious}
                  accessibilityRole="button"
                  accessibilityLabel="Previous track"
                  hitSlop={12}
                >
                  <Ionicons name="play-skip-back" size={44} color="white" />
                </TouchableOpacity>
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
                  <ReanimatedAnimated.Image
                    source={displayArtworkSource}
                    resizeMode="cover"
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
                  <ReanimatedAnimated.Image
                    source={displayArtworkSource}
                    resizeMode="cover"
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
                    <ReanimatedAnimated.Image
                      source={incomingArtworkSource}
                      resizeMode="cover"
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
                    <ReanimatedAnimated.Image
                      source={incomingArtworkSource}
                      resizeMode="cover"
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
            <View style={{ position: 'absolute', right: 30, flexDirection: 'row' }}>
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
              onPress={onSkipNext}
              accessibilityRole="button"
              accessibilityLabel="Next track"
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
    </ReanimatedAnimated.View>
  );
};

type PlayerOverlayProps = React.ComponentProps<typeof PlayerOverlayView>;

const playerOverlayPropsAreEqual = (previous: PlayerOverlayProps, next: PlayerOverlayProps) => {
  if (
    previous.visible !== next.visible ||
    previous.track !== next.track ||
    previous.lyricsLoadingTrackId !== next.lyricsLoadingTrackId ||
    previous.isFavorite !== next.isFavorite ||
    previous.isPlaying !== next.isPlaying ||
    previous.onOpen !== next.onOpen ||
    previous.onClose !== next.onClose ||
    previous.onTogglePlayback !== next.onTogglePlayback ||
    previous.onSkipPrevious !== next.onSkipPrevious ||
    previous.onSkipNext !== next.onSkipNext ||
    previous.onSeek !== next.onSeek ||
    previous.onVolumeChange !== next.onVolumeChange ||
    previous.onToggleFavorite !== next.onToggleFavorite ||
    previous.onPlayQueueTrack !== next.onPlayQueueTrack ||
    previous.onToggleShuffle !== next.onToggleShuffle ||
    previous.onToggleRepeat !== next.onToggleRepeat ||
    previous.onToggleAutoplay !== next.onToggleAutoplay ||
    previous.onClearQueue !== next.onClearQueue
  ) return false;

  if (!next.visible) return true;

  return (
    previous.currentTime === next.currentTime &&
    previous.durationSeconds === next.durationSeconds &&
    previous.volume === next.volume &&
    previous.queue === next.queue &&
    previous.shuffleEnabled === next.shuffleEnabled &&
    previous.repeatMode === next.repeatMode &&
    previous.autoplayEnabled === next.autoplayEnabled
  );
};

export const PlayerOverlay = React.memo(PlayerOverlayView, playerOverlayPropsAreEqual);
