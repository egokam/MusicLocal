/* Reanimated scroll handlers update a shared value on the UI thread by design. */
/* eslint-disable react-hooks/immutability */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View, type TextLayoutEvent } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  scrollTo,
  useAnimatedRef,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { LyricsAttribution, LyricLine, LyricVoice, LyricWord } from '../../types';
import { usePlayerPlaybackStatus } from '../../services/PlayerStatusStore';

type PlayerLyricsProps = {
  trackId: string;
  lyrics: LyricLine[];
  pauseAutoScroll: SharedValue<boolean>;
  viewportHeight: number;
  scrollGesture: NativeGesture;
  scrollOffset: SharedValue<number>;
  onSeek: (seconds: number) => void;
  lyricsAttribution?: LyricsAttribution;
  lineSyncedWordWaveEnabled: boolean;
};

type PlayerLyricsListProps = PlayerLyricsProps & {
  activeLineIndex: number;
  currentTimeMs: number;
  durationMs: number;
};

type LyricLineItemProps = {
  line: LyricLine;
  index: number;
  active: boolean;
  currentTimeMs: number;
  lineEndTimeMs: number | null;
  lineSyncedWordWaveEnabled: boolean;
  onSeek: (seconds: number) => void;
  onLineLayout: (index: number, y: number, height: number) => void;
};

const LYRIC_FONT_SIZE = 22;
const LYRIC_ACTIVE_COLOR = '#FA5265';
const LYRIC_WAVE_LEAD_MS = 70;
const isRightToLeftText = (text: string) => {
  const firstStrongCharacter = text.match(/[\u0590-\u08FF]|[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/)?.[0];
  return Boolean(firstStrongCharacter && /[\u0590-\u08FF]/.test(firstStrongCharacter));
};

const wordEndTime = (words: LyricWord[], index: number, fallbackEndTimeMs: number | null) =>
  words[index].endTimeMs ?? words[index + 1]?.startTimeMs ?? fallbackEndTimeMs;

type LyricWordSpan = { start: number; end: number };

const getLyricWordSpans = (words: LyricWord[]): LyricWordSpan[] => {
  const gap = 0.8;
  const widths = words.map((word) => Math.max(1, Array.from(word.text.trim()).length));
  const totalWidth = widths.reduce((total, width) => total + width, 0) + gap * Math.max(0, words.length - 1);
  let cursor = 0;

  return widths.map((width) => {
    const span = { start: cursor / totalWidth, end: (cursor + width) / totalWidth };
    cursor += width + gap;
    return span;
  });
};

const createLineWaveWords = (text: string, lineStartTimeMs: number, lineEndTimeMs: number | null) => {
  const wordTexts = text.trim().split(/\s+/u).filter(Boolean);
  if (!wordTexts.length || lineEndTimeMs === null || lineEndTimeMs <= lineStartTimeMs) return [];

  const untimedWords = wordTexts.map((word) => ({
    text: word,
    startTimeMs: null,
    endTimeMs: null,
  }));
  const spans = getLyricWordSpans(untimedWords);
  const durationMs = lineEndTimeMs - lineStartTimeMs;

  return untimedWords.map((word, index) => ({
    ...word,
    startTimeMs: lineStartTimeMs + durationMs * spans[index].start,
    endTimeMs: lineStartTimeMs + durationMs * spans[index].end,
  }));
};

const lineWavePositionAt = (
  words: LyricWord[],
  spans: LyricWordSpan[],
  currentTimeMs: number,
  fallbackEndTimeMs: number | null,
) => {
  const timingPoints: { time: number; position: number }[] = [];

  words.forEach((word, index) => {
    if (word.startTimeMs === null) return;
    const endTimeMs = wordEndTime(words, index, fallbackEndTimeMs);
    const span = spans[index];

    timingPoints.push({ time: word.startTimeMs, position: span.start });
    if (endTimeMs !== null && endTimeMs > word.startTimeMs) {
      timingPoints.push({ time: endTimeMs, position: span.end });
    }
  });

  if (!timingPoints.length || currentTimeMs < timingPoints[0].time) return 0;

  for (let index = 1; index < timingPoints.length; index += 1) {
    const previous = timingPoints[index - 1];
    const next = timingPoints[index];
    if (currentTimeMs > next.time) continue;

    const timeRange = next.time - previous.time;
    if (timeRange <= 0) return next.position;
    const progress = Math.max(0, Math.min(1, (currentTimeMs - previous.time) / timeRange));
    return previous.position + (next.position - previous.position) * progress;
  }

  const lastPoint = timingPoints[timingPoints.length - 1];
  return lastPoint.position;
};

const WaveLyricWord = ({
  children,
  span,
  wavePosition,
  color,
  fontSize,
  rightToLeft,
  gapAfter,
}: {
  children: React.ReactNode;
  span: LyricWordSpan;
  wavePosition: SharedValue<number>;
  color: string;
  fontSize: number;
  rightToLeft: boolean;
  gapAfter: number;
}) => {
  const waveTextStyle = useAnimatedStyle(() => {
    const edge = wavePosition.value;
    const width = Math.max(0.001, span.end - span.start);
    const fade = Math.max(0.008, Math.min(0.045, width * 0.7));
    const fillPosition = Math.max(0, Math.min(1, (edge - span.start + fade) / (width + fade * 2)));
    const fill = fillPosition * fillPosition * (3 - 2 * fillPosition);
    const center = (span.start + span.end) / 2;
    const glowDistance = Math.abs(edge - center);
    const glowPosition = Math.max(0, Math.min(1, 1 - glowDistance / (width / 2 + fade)));
    const glow = glowPosition * glowPosition * (3 - 2 * glowPosition);

    return {
      color: interpolateColor(fill, [0, 1], ['rgba(255,255,255,0.34)', '#FFFFFF']),
      textShadowColor: interpolateColor(
        glow,
        [0, 1],
        ['rgba(250,82,101,0)', 'rgba(250,82,101,0.62)'],
      ),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: interpolate(glow, [0, 1], [0, 10]),
    };
  });

  const lineWaveStyle = useAnimatedStyle(() => {
    const distanceFromPeak = Math.abs(wavePosition.value - (span.start + span.end) / 2);
    // Keep the crest broad so nearby words follow it as one continuous line wave.
    const waveBody = Math.exp(-0.5 * Math.pow(distanceFromPeak / 0.38, 2));

    return {
      transform: [
        { translateY: interpolate(waveBody, [0, 1], [0, -3.5]) },
        { scale: interpolate(waveBody, [0, 1], [1, 1.06]) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        { flexShrink: 0, marginRight: rightToLeft ? 0 : gapAfter, marginLeft: rightToLeft ? gapAfter : 0 },
        lineWaveStyle,
      ]}
    >
      <Animated.Text
        style={[{ color, fontSize, lineHeight: 32, fontWeight: '700' }, waveTextStyle]}
      >
        {children}
      </Animated.Text>
    </Animated.View>
  );
};

type NativeLyricLineLayout = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PositionedLyricWord = {
  word: LyricWord;
  index: number;
};

type PositionedLyricRow = NativeLyricLineLayout & {
  words: PositionedLyricWord[];
  gap: number;
};

const getPositionedLyricRows = (
  lines: NativeLyricLineLayout[],
  words: LyricWord[],
  measuredWordWidths: { text: string; width: number }[],
): PositionedLyricRow[] | null => {
  if (!lines.length || !words.length) return null;

  let nextWordIndex = 0;
  const rows: PositionedLyricRow[] = [];

  for (const line of lines) {
    const wordCount = line.text.trim().match(/\S+/gu)?.length ?? 0;
    if (!wordCount) continue;

    const rowWords = words.slice(nextWordIndex, nextWordIndex + wordCount);
    if (rowWords.length !== wordCount) return null;

    const measuredWidths = rowWords.map((word, offset) => {
      const measurement = measuredWordWidths[nextWordIndex + offset];
      return measurement?.text === word.text ? measurement.width : null;
    });
    if (measuredWidths.some((width) => width === null)) return null;

    const totalWordWidth = measuredWidths.reduce<number>((total, width) => total + (width ?? 0), 0);
    const gap = wordCount > 1
      ? Math.max(0, (line.width - totalWordWidth) / (wordCount - 1))
      : 0;

    rows.push({
      ...line,
      words: rowWords.map((word, offset) => ({ word, index: nextWordIndex + offset })),
      gap,
    });
    nextWordIndex += wordCount;
  }

  return nextWordIndex === words.length ? rows : null;
};

const lyricWordColor = (
  word: LyricWord,
  currentTimeMs: number,
  active: boolean,
  quiet: boolean,
  endTimeMs: number | null,
) => {
  if (!active) return quiet ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.52)';
  if (word.startTimeMs === null) return '#FFFFFF';
  if (currentTimeMs < word.startTimeMs) return quiet ? 'rgba(255,255,255,0.36)' : 'rgba(255,255,255,0.34)';
  if (endTimeMs !== null && currentTimeMs >= endTimeMs) return quiet ? 'rgba(255,255,255,0.82)' : '#FFFFFF';
  return quiet ? 'rgba(255,255,255,0.88)' : LYRIC_ACTIVE_COLOR;
};

const renderVoiceWords = (
  words: LyricWord[],
  text: string,
  currentTimeMs: number,
  active: boolean,
  quiet: boolean,
  fallbackEndTimeMs: number | null = null,
  wavePosition?: SharedValue<number>,
  fontSize = LYRIC_FONT_SIZE,
  rightToLeft = false,
) => {
  if (!words.length) return text;
  if (!words.some((word) => word.startTimeMs !== null)) return text;

  const wordSpans = wavePosition ? getLyricWordSpans(words) : null;

  return words.map((word, wordIndex) => {
    const hasSyllableTiming = word.syllables?.some((syllable) => syllable.startTimeMs !== null);
    const endTimeMs = wordEndTime(words, wordIndex, fallbackEndTimeMs);
    const wordColor = lyricWordColor(word, currentTimeMs, active, quiet, endTimeMs);
    const activeSyllableIndex = hasSyllableTiming && active
      ? word.syllables!.findIndex((syllable, syllableIndex) => {
          if (syllable.startTimeMs === null || currentTimeMs < syllable.startTimeMs) return false;
          const syllableEnd = syllable.endTimeMs
            ?? word.syllables![syllableIndex + 1]?.startTimeMs
            ?? endTimeMs;
          return syllableEnd === null || currentTimeMs < syllableEnd;
        })
      : -1;
    const contents = hasSyllableTiming
      ? word.syllables!.map((syllable, syllableIndex) => {
          const color = !active
            ? wordColor
            : syllableIndex === activeSyllableIndex
              ? (quiet ? 'rgba(255,255,255,0.92)' : LYRIC_ACTIVE_COLOR)
              : activeSyllableIndex >= 0 && syllableIndex < activeSyllableIndex
                ? '#FFFFFF'
                : activeSyllableIndex < 0 && syllable.startTimeMs !== null && currentTimeMs >= syllable.startTimeMs
                  ? '#FFFFFF'
              : quiet
                ? 'rgba(255,255,255,0.36)'
                : 'rgba(255,255,255,0.34)';
          return (
            <Text
              key={`syllable-${wordIndex}-${syllableIndex}`}
              style={wavePosition ? undefined : { color }}
            >
              {syllable.text}
            </Text>
          );
        })
      : wavePosition
        ? word.text
        : <Text style={{ color: wordColor }}>{word.text}</Text>;
    const nextStartsWithPunctuation = wordIndex < words.length - 1
      && /^[,.;!?…%)\]}،؛؟]/.test(words[wordIndex + 1].text);
    const wordContents = (
      <>
        {wavePosition ? null : wordIndex > 0 && !/^[,.;!?…%)\]}،؛؟]/.test(word.text) ? ' ' : ''}
        {contents}
      </>
    );
    const wordStyle = { color: wordColor, fontSize };
    return wavePosition && wordSpans
      ? (
        <WaveLyricWord
          key={`word-${wordIndex}`}
          span={wordSpans[wordIndex]}
          wavePosition={wavePosition}
          color={wordColor}
          fontSize={fontSize}
          rightToLeft={rightToLeft}
          gapAfter={wordIndex < words.length - 1 && !nextStartsWithPunctuation ? fontSize * 0.28 : 0}
        >
          {wordContents}
        </WaveLyricWord>
      )
      : <Text key={`word-${wordIndex}`} style={wordStyle}>{wordContents}</Text>;
  });
};

const ActiveLeadLyrics = ({
  words,
  text,
  currentTimeMs,
  lineEndTimeMs,
}: {
  words: LyricWord[];
  text: string;
  currentTimeMs: number;
  lineEndTimeMs: number | null;
}) => {
  const wordSpans = useMemo(() => getLyricWordSpans(words), [words]);
  const rightToLeft = isRightToLeftText(text);
  const [nativeLines, setNativeLines] = React.useState<NativeLyricLineLayout[]>([]);
  const [measuredWordWidths, setMeasuredWordWidths] = React.useState<{ text: string; width: number }[]>([]);
  const wavePosition = useSharedValue(0);
  const previousPlaybackTime = useRef<number | null>(null);
  const targetWavePosition = lineWavePositionAt(
    words,
    wordSpans,
    currentTimeMs + LYRIC_WAVE_LEAD_MS,
    lineEndTimeMs,
  );

  useEffect(() => {
    const previousTime = previousPlaybackTime.current;
    const playbackDelta = previousTime === null ? 0 : Math.abs(currentTimeMs - previousTime);
    const playbackJumped = previousTime !== null && playbackDelta > 350;
    cancelAnimation(wavePosition);

    if (previousTime === null || playbackJumped) {
      wavePosition.value = targetWavePosition;
    } else {
      wavePosition.value = withTiming(targetWavePosition, {
        duration: Math.max(40, Math.min(240, playbackDelta)),
        easing: Easing.linear,
      });
    }

    previousPlaybackTime.current = currentTimeMs;
  }, [currentTimeMs, targetWavePosition, wavePosition]);

  useEffect(() => () => cancelAnimation(wavePosition), [wavePosition]);

  const positionedRows = useMemo(
    () => getPositionedLyricRows(nativeLines, words, measuredWordWidths),
    [measuredWordWidths, nativeLines, words],
  );
  const handleTextLayout = useCallback((event: TextLayoutEvent) => {
    const nextLines = event.nativeEvent.lines.map(({ text: lineText, x, y, width, height }) => ({
      text: lineText,
      x,
      y,
      width,
      height,
    }));
    setNativeLines((previous) => {
      if (previous.length === nextLines.length && previous.every((line, index) => {
        const nextLine = nextLines[index];
        return line.text === nextLine.text
          && line.x === nextLine.x
          && line.y === nextLine.y
          && line.width === nextLine.width
          && line.height === nextLine.height;
      })) return previous;
      return nextLines;
    });
  }, []);
  const handleWordLayout = useCallback((index: number, wordText: string, width: number) => {
    setMeasuredWordWidths((previous) => {
      const measured = previous[index];
      if (measured?.text === wordText && Math.abs(measured.width - width) < 0.1) return previous;
      const next = previous.slice();
      next[index] = { text: wordText, width };
      return next;
    });
  }, []);

  return (
    <View style={{ width: '100%', position: 'relative' }}>
      {/* This native text remains the source of truth for wrapping and line height. */}
      <Text
        onTextLayout={handleTextLayout}
        style={{
          color: positionedRows ? 'transparent' : '#FFFFFF',
          fontSize: LYRIC_FONT_SIZE,
          lineHeight: 32,
          fontWeight: '700',
        }}
      >
        {text}
      </Text>

      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        {positionedRows?.map((row, rowIndex) => (
          <View
            key={`wave-row-${rowIndex}`}
            style={{
              position: 'absolute',
              left: row.x,
              top: row.y,
              width: row.width,
              height: row.height,
              flexDirection: rightToLeft ? 'row-reverse' : 'row',
              alignItems: 'flex-start',
            }}
          >
            {row.words.map(({ word, index }, wordIndex) => (
              <WaveLyricWord
                key={`word-${index}`}
                span={wordSpans[index]}
                wavePosition={wavePosition}
                color={lyricWordColor(word, currentTimeMs, true, false, wordEndTime(words, index, lineEndTimeMs))}
                fontSize={LYRIC_FONT_SIZE}
                rightToLeft={rightToLeft}
                gapAfter={wordIndex < row.words.length - 1 ? row.gap : 0}
              >
                {word.syllables?.some((syllable) => syllable.startTimeMs !== null)
                  ? word.syllables.map((syllable, syllableIndex) => (
                      <Text key={`syllable-${index}-${syllableIndex}`}>{syllable.text}</Text>
                    ))
                  : word.text}
              </WaveLyricWord>
            ))}
          </View>
        ))}

        <View style={{ position: 'absolute', left: 0, top: 0, opacity: 0, flexDirection: 'row', alignItems: 'flex-start' }}>
          {words.map((word, index) => (
            <Text
              key={`measure-${index}-${word.text}`}
              onLayout={(event) => handleWordLayout(index, word.text, event.nativeEvent.layout.width)}
              numberOfLines={1}
              style={{ flexShrink: 0, fontSize: LYRIC_FONT_SIZE, lineHeight: 32, fontWeight: '700' }}
            >
              {word.text}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
};

const BackgroundVoice = ({ voice, currentTimeMs, active }: {
  voice: LyricVoice;
  currentTimeMs: number;
  active: boolean;
}) => (
  <Text
    style={{
      marginTop: 3,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      letterSpacing: 0.1,
      color: active ? 'rgba(255,255,255,0.66)' : 'rgba(255,255,255,0.35)',
    }}
  >
    {renderVoiceWords(voice.words ?? [], voice.text, currentTimeMs, active, true, null, undefined, 14)}
  </Text>
);

const LyricLineItem = React.memo(({
  line,
  index,
  active,
  currentTimeMs,
  lineEndTimeMs,
  lineSyncedWordWaveEnabled,
  onSeek,
  onLineLayout,
}: LyricLineItemProps) => {
  const hasWordTiming = Boolean(line.words?.some((word) => word.startTimeMs !== null));
  const lineWaveWords = useMemo(() => (
    active && lineSyncedWordWaveEnabled && !hasWordTiming && line.timeMs !== null
      ? createLineWaveWords(line.text, line.timeMs, lineEndTimeMs)
      : []
  ), [active, hasWordTiming, line.text, line.timeMs, lineEndTimeMs, lineSyncedWordWaveEnabled]);
  const activeWaveWords = hasWordTiming ? line.words! : lineWaveWords;
  const mainText = hasWordTiming && !active
    ? renderVoiceWords(line.words!, line.text, currentTimeMs, false, false, lineEndTimeMs)
    : line.text;

  return (
    <View
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        onLineLayout(index, y, height);
      }}
      style={{ marginBottom: line.background?.length ? 16 : 12 }}
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
        {active && activeWaveWords.length > 0 ? (
          <ActiveLeadLyrics
            words={activeWaveWords}
            text={line.text}
            currentTimeMs={currentTimeMs}
            lineEndTimeMs={lineEndTimeMs}
          />
        ) : (
          <Text
            style={{
              color: active ? '#FFFFFF' : 'rgba(255,255,255,0.52)',
              fontSize: LYRIC_FONT_SIZE,
              lineHeight: 32,
              fontWeight: '700',
            }}
          >
            {mainText}
          </Text>
        )}
        {line.background?.map((voice, voiceIndex) => (
          <BackgroundVoice
            key={`background-${voiceIndex}`}
            voice={voice}
            currentTimeMs={currentTimeMs}
            active={active}
          />
        ))}
      </TouchableOpacity>
    </View>
  );
}, (previous, next) => (
  previous.line === next.line
  && previous.index === next.index
  && previous.active === next.active
  && previous.lineEndTimeMs === next.lineEndTimeMs
  && previous.lineSyncedWordWaveEnabled === next.lineSyncedWordWaveEnabled
  && (!next.active || previous.currentTimeMs === next.currentTimeMs)
  && previous.onSeek === next.onSeek
  && previous.onLineLayout === next.onLineLayout
));
LyricLineItem.displayName = 'LyricLineItem';

const PlayerLyricsView = ({
  trackId,
  lyrics,
  activeLineIndex,
  currentTimeMs,
  pauseAutoScroll,
  viewportHeight,
  scrollGesture,
  scrollOffset,
  onSeek,
  lyricsAttribution,
  durationMs,
  lineSyncedWordWaveEnabled,
}: PlayerLyricsListProps) => {
  const scrollRef = useAnimatedRef<ScrollView>();
  const lineLayouts = useRef(new Map<number, { y: number; height: number }>());
  const activeLineRef = useRef(activeLineIndex);
  const viewportHeightRef = useRef(viewportHeight);
  const hasCenteredInitialLine = useRef(false);
  const layoutTrackId = useRef(trackId);
  const isManuallyScrolling = useRef(false);
  const pauseAutoScrollRef = useRef(false);
  const autoScrollFrame = useRef<number | null>(null);
  const scrollAnimationFrame = useRef<number | null>(null);
  const recenterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnimationProgress = useSharedValue(1);
  const scrollAnimationStartY = useSharedValue(0);
  const scrollAnimationTargetY = useSharedValue(0);
  const scrollAnimationEnabled = useSharedValue(false);
  const lineEndTimesByIndex = useMemo(() => {
    const timedStarts = [...new Set(
      lyrics.flatMap((line) => line.timeMs === null ? [] : [line.timeMs]),
    )].sort((first, second) => first - second);
    const endTimeByStart = new Map<number, number | null>();

    timedStarts.forEach((startTime, index) => {
      const nextStartTime = timedStarts[index + 1];
      endTimeByStart.set(
        startTime,
        nextStartTime ?? (durationMs > startTime ? durationMs : null),
      );
    });

    return lyrics.map((line) => line.timeMs === null ? null : endTimeByStart.get(line.timeMs) ?? null);
  }, [durationMs, lyrics]);
  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });
  useDerivedValue(() => {
    if (!scrollAnimationEnabled.value) return;

    const progress = scrollAnimationProgress.value;
    const y = scrollAnimationStartY.value
      + (scrollAnimationTargetY.value - scrollAnimationStartY.value) * progress;
    scrollTo(scrollRef, 0, y, false);
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

  const stopScrollAnimation = useCallback(() => {
    cancelAnimation(scrollAnimationProgress);
    scrollAnimationEnabled.value = false;
    if (scrollAnimationFrame.current !== null) {
      cancelAnimationFrame(scrollAnimationFrame.current);
      scrollAnimationFrame.current = null;
    }
  }, [scrollAnimationEnabled, scrollAnimationProgress]);

  const centerLine = useCallback((lineIndex: number, animated: boolean) => {
    const layout = lineLayouts.current.get(lineIndex);
    const visibleHeight = viewportHeightRef.current;
    if (!layout || lineIndex < 0 || visibleHeight <= 0) return;

    const targetY = Math.max(0, layout.y + layout.height / 2 - visibleHeight / 2);
    stopScrollAnimation();

    if (!animated) {
      scrollAnimationStartY.value = targetY;
      scrollAnimationTargetY.value = targetY;
      scrollAnimationProgress.value = 1;
      scrollAnimationEnabled.value = true;
      return;
    }

    scrollAnimationStartY.value = scrollOffset.value;
    scrollAnimationTargetY.value = targetY;
    scrollAnimationProgress.value = 0;
    scrollAnimationEnabled.value = true;
    scrollAnimationFrame.current = requestAnimationFrame(() => {
      scrollAnimationFrame.current = null;
      scrollAnimationProgress.value = withTiming(1, {
        duration: 520,
        easing: Easing.inOut(Easing.cubic),
      });
    });
  }, [
    scrollAnimationEnabled,
    scrollAnimationProgress,
    scrollAnimationStartY,
    scrollAnimationTargetY,
    scrollOffset,
    stopScrollAnimation,
  ]);

  const scheduleCenterLine = useCallback((lineIndex = activeLineRef.current) => {
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = requestAnimationFrame(() => {
      autoScrollFrame.current = null;
      if (!pauseAutoScrollRef.current && !isManuallyScrolling.current) {
        centerLine(lineIndex, true);
      }
    });
  }, [centerLine]);

  const handleLineLayout = useCallback((lineIndex: number, y: number, height: number) => {
    lineLayouts.current.set(lineIndex, { y, height });
    if (
      lineIndex === activeLineRef.current
      && !isManuallyScrolling.current
      && !pauseAutoScrollRef.current
    ) {
      if (!hasCenteredInitialLine.current) {
        hasCenteredInitialLine.current = true;
        centerLine(lineIndex, false);
      } else {
        scheduleCenterLine(lineIndex);
      }
    }
  }, [centerLine, scheduleCenterLine]);

  const handlePauseAutoScrollChange = useCallback((paused: boolean) => {
    pauseAutoScrollRef.current = paused;
    if (paused) {
      stopScrollAnimation();
      clearRecenterTimer();
      isManuallyScrolling.current = false;
      if (autoScrollFrame.current !== null) {
        cancelAnimationFrame(autoScrollFrame.current);
        autoScrollFrame.current = null;
      }
      return;
    }

    if (activeLineRef.current >= 0) scheduleCenterLine();
  }, [clearRecenterTimer, scheduleCenterLine, stopScrollAnimation]);

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

  useEffect(() => {
    if (layoutTrackId.current !== trackId) {
      layoutTrackId.current = trackId;
      lineLayouts.current.clear();
      hasCenteredInitialLine.current = false;
    }

    return () => {
      clearRecenterTimer();
      stopScrollAnimation();
      if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    };
  }, [clearRecenterTimer, stopScrollAnimation, trackId]);

  return (
    <MaskedView
      style={{ flex: 1 }}
      maskElement={(
        <LinearGradient
          colors={[
            'transparent',
            'rgba(0,0,0,0.08)',
            'rgba(0,0,0,0.55)',
            '#000000',
            '#000000',
            'rgba(0,0,0,0.55)',
            'rgba(0,0,0,0.08)',
            'transparent',
          ]}
          locations={[0, 0.05, 0.13, 0.25, 0.75, 0.87, 0.95, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ flex: 1 }}
        />
      )}
    >
      <GestureDetector gesture={scrollGesture}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingVertical: Math.max(0, viewportHeight / 2),
            paddingHorizontal: 12,
          }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={animatedScrollHandler}
          onScrollBeginDrag={() => {
            if (pauseAutoScrollRef.current) return;
            stopScrollAnimation();
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
              <LyricLineItem
                key={`${trackId}-lyric-${index}`}
                line={line}
                index={index}
                active={index === activeLineIndex}
                currentTimeMs={currentTimeMs}
                lineEndTimeMs={lineEndTimesByIndex[index]}
                lineSyncedWordWaveEnabled={lineSyncedWordWaveEnabled}
                onSeek={onSeek}
                onLineLayout={handleLineLayout}
              />
            ),
          )}
          {lyricsAttribution ? (
            <View style={{ alignItems: 'flex-start', marginTop: 18, paddingBottom: 10 }}>
              <Text style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 18 }}>
                Lyrics from {lyricsAttribution.provider || 'unknown source'}
              </Text>
              {lyricsAttribution.uploader ? (
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel={`Open lyrics contributor ${lyricsAttribution.uploader.username}`}
                  onPress={() => {
                    if (lyricsAttribution.uploader?.url.startsWith('https://')) {
                      void Linking.openURL(lyricsAttribution.uploader.url).catch(() => undefined);
                    }
                  }}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                    Uploaded by {lyricsAttribution.uploader.username}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {lyricsAttribution.maker ? (
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel={`Open lyrics maker ${lyricsAttribution.maker.username}`}
                  onPress={() => {
                    if (lyricsAttribution.maker?.url.startsWith('https://')) {
                      void Linking.openURL(lyricsAttribution.maker.url).catch(() => undefined);
                    }
                  }}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                    Made by {lyricsAttribution.maker.username}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </Animated.ScrollView>
      </GestureDetector>
    </MaskedView>
  );
};

const areLyricsListPropsEqual = (previous: PlayerLyricsListProps, next: PlayerLyricsListProps) =>
  previous.trackId === next.trackId &&
  previous.lyrics === next.lyrics &&
  previous.activeLineIndex === next.activeLineIndex &&
  previous.currentTimeMs === next.currentTimeMs &&
  previous.durationMs === next.durationMs &&
  previous.lineSyncedWordWaveEnabled === next.lineSyncedWordWaveEnabled &&
  previous.pauseAutoScroll === next.pauseAutoScroll &&
  previous.viewportHeight === next.viewportHeight &&
  previous.scrollGesture === next.scrollGesture &&
  previous.scrollOffset === next.scrollOffset &&
  previous.lyricsAttribution === next.lyricsAttribution &&
  previous.onSeek === next.onSeek;

const PlayerLyricsList = React.memo(PlayerLyricsView, areLyricsListPropsEqual);

const PlayerLyricsStatusView = (props: PlayerLyricsProps) => {
  const { currentTime, duration } = usePlayerPlaybackStatus();
  const currentTimeMs = currentTime * 1000;
  const activeLineIndex = props.lyrics.reduce((activeIndex, line, index) =>
    line.text.trim().length > 0 && line.timeMs !== null && line.timeMs <= currentTimeMs
      ? index
      : activeIndex,
  -1);

  return (
    <PlayerLyricsList
      {...props}
      activeLineIndex={activeLineIndex}
      currentTimeMs={currentTimeMs}
      durationMs={duration * 1000}
    />
  );
};

export const PlayerLyrics = React.memo(PlayerLyricsStatusView, (previous, next) =>
  previous.trackId === next.trackId &&
  previous.lyrics === next.lyrics &&
  previous.pauseAutoScroll === next.pauseAutoScroll &&
  previous.viewportHeight === next.viewportHeight &&
  previous.scrollGesture === next.scrollGesture &&
  previous.scrollOffset === next.scrollOffset &&
  previous.lyricsAttribution === next.lyricsAttribution &&
  previous.lineSyncedWordWaveEnabled === next.lineSyncedWordWaveEnabled &&
  previous.onSeek === next.onSeek,
);
