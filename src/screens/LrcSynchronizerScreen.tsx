import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  Image,
  LayoutAnimation,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ScrollViewInstance,
  type ViewInstance,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { parseBuffer } from 'music-metadata';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../../glass';
import { usePlaybackActions } from '../contexts/PlaybackContext';
import { SongsHeader } from '../components/songs/SongsHeader';
import { TrackListSkeleton } from '../components/Skeleton';
import { Id3SynchronizedLyricsService } from '../services/Id3SynchronizedLyricsService';
import { OfflineMusicService } from '../services/OfflineMusicService';
import type { Track } from '../types';

type ImportedMp3 = {
  libraryTrack: Track;
  uri: string;
  fileName: string;
  title: string;
  artist: string;
  lyrics: string | null;
  lyricsSource: 'embedded' | 'sidecar' | 'pasted';
  hadSyncedLyrics: boolean;
  duration: number;
};

type LyricSidecar = { file: File; text: string };

type TimedLyricLine = {
  id: string;
  text: string;
  timeMs: number | null;
};

type LyricsLineLayout = { y: number; height: number };
type LyricsLineDrag = {
  lineId: string;
  initialCenterY: number;
  initialScrollOffset: number;
  dy: number;
  moveY: number;
};

const splitLyricText = (lyrics: string) => lyrics
  .replace(/^\uFEFF/, '')
  .split(/\r\n|[\n\r\u0085\u2028\u2029]/);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const lrcTimestampPattern = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
const lrcTimestampPrefixPattern = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const lrcMetadataPattern = /^\[(?:ar|al|ti|au|by|re|ve|offset|length|la|kana|id):/i;
const hasLrcTimestamps = (lyrics: string) => splitLyricText(lyrics).some((line) => lrcTimestampPrefixPattern.test(line));

const clearEmbeddedTimestamps = (lyrics: string) => splitLyricText(lyrics)
  .flatMap((line) => {
    if (lrcMetadataPattern.test(line.trim())) return [];
    const timestampPrefix = line.match(lrcTimestampPrefixPattern)?.[0];
    if (!timestampPrefix) return [line];

    const text = line.slice(timestampPrefix.length).trimStart();
    if (!text.trim()) return [];
    // LRC can put multiple timestamps on one line for repeated choruses.
    // Keep each occurrence as a separate untimed lyric line for resyncing.
    const occurrenceCount = [...timestampPrefix.matchAll(lrcTimestampPattern)].length;
    return Array.from({ length: Math.max(occurrenceCount, 1) }, () => text);
  })
  .join('\n');

const getEmbeddedLyrics = (metadata: Awaited<ReturnType<typeof parseBuffer>>) => {
  const frames = Object.values(metadata.native).flat();
  const usltLyrics = frames
    .filter((frame) => frame.id === 'USLT')
    .map((frame) => {
      if (!isRecord(frame.value) || typeof frame.value.text !== 'string') return '';
      return frame.value.text.trim();
    })
    .filter(Boolean);
  const formatTimestamp = (timestamp: number, format: number) => {
    const timestampMs = format === 1
      ? timestamp * 1152 / (metadata.format.sampleRate || 44100) * 1000
      : timestamp;
    const totalCentiseconds = Math.max(0, Math.floor(timestampMs / 10));
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor(totalCentiseconds / 100) % 60;
    const centiseconds = totalCentiseconds % 100;
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
  };
  const syltLyrics = frames.flatMap((frame) => {
    if (frame.id !== 'SYLT' || !isRecord(frame.value) || !Array.isArray(frame.value.syncText)) return [];
    const format = typeof frame.value.timeStampFormat === 'number' ? frame.value.timeStampFormat : 2;
    return frame.value.syncText.flatMap((entry) => (
      isRecord(entry) && typeof entry.text === 'string' && entry.text.trim()
        ? [`${formatTimestamp(typeof entry.timestamp === 'number' ? entry.timestamp : 0, format)} ${entry.text.trim()}`]
        : []
    ));
  });
  const commonLyrics = (metadata.common.lyrics ?? []).flatMap((entry) => {
    if (entry.syncText?.length) {
      const format = entry.timeStampFormat ?? 2;
      return [entry.syncText.map((line) => (
        `${formatTimestamp(line.timestamp ?? 0, format)} ${line.text}`
      )).join('\n')];
    }
    return entry.text?.trim() ? [entry.text.trim()] : [];
  });

  const timestampedUslt = usltLyrics.find(hasLrcTimestamps);
  const sourceLyrics = timestampedUslt
    ?? (syltLyrics.length > 0 ? syltLyrics.join('\n') : null)
    ?? (usltLyrics.length > 0 ? usltLyrics.join('\n\n') : commonLyrics.join('\n\n'));
  const hadSyncedLyrics = Boolean(timestampedUslt || syltLyrics.length > 0 || commonLyrics.some(hasLrcTimestamps));
  const lyrics = sourceLyrics
    ? (hadSyncedLyrics ? clearEmbeddedTimestamps(sourceLyrics) : sourceLyrics)
    : null;

  return { lyrics, sourceLyrics, hadSyncedLyrics };
};

const readLyricsSidecars = async (track: Track, audioFile: File): Promise<LyricSidecar[]> => {
  const candidates = new Map<string, File>();
  const add = (uri: string | undefined) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      const extension = file.extension.toLowerCase();
      if (extension === '.lrc' || extension === '.txt') candidates.set(file.uri, file);
    } catch {
      // Ignore stale references and keep checking the sibling file.
    }
  };

  add(track.lyricsFileUri);
  const audioBaseName = audioFile.name.replace(/\.[^.]+$/, '');
  add(new File(audioFile.parentDirectory, `${audioBaseName}.lrc`).uri);
  add(new File(audioFile.parentDirectory, `${audioBaseName}.txt`).uri);

  const sidecars: LyricSidecar[] = [];
  for (const file of candidates.values()) {
    if (!file.exists) continue;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '').trim();
      if (text) sidecars.push({ file, text });
    } catch {
      // An unreadable sidecar is not offered as a lyric source.
    }
  }
  return sidecars.sort((first, second) => Number(second.file.extension.toLowerCase() === '.lrc')
    - Number(first.file.extension.toLowerCase() === '.lrc'));
};

const parseLyrics = (lyrics: string): TimedLyricLine[] => splitLyricText(lyrics)
  .map((text, index) => ({ id: `${index}-${text}`, text, timeMs: null }));

export const LrcSynchronizerScreen = ({ onBack }: { onBack: () => void }) => {
  const { downloadedTracks, isLoadingTracks, apiInitializing, saveSynchronizedTrack, updateTrack } = usePlaybackActions();
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const playerStatus = useAudioPlayerStatus(player);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const playerStatusRef = useRef(playerStatus);
  const pickerWindowHeight = useRef(windowHeight);
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const [selectedMp3, setSelectedMp3] = useState<ImportedMp3 | null>(null);
  const [trackPickerVisible, setTrackPickerVisible] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [lyricLines, setLyricLines] = useState<TimedLyricLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [pauseToastVisible, setPauseToastVisible] = useState(false);
  const [seekBarWidth, setSeekBarWidth] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pasteModalVisible, setPasteModalVisible] = useState(false);
  const [pastedLyrics, setPastedLyrics] = useState('');
  const [lineEditor, setLineEditor] = useState<{ lineId: string | null; text: string } | null>(null);
  const [draggingLineId, setDraggingLineId] = useState<string | null>(null);
  const [lyricDragResponders, setLyricDragResponders] = useState(
    () => new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
  const trackPickerTranslateY = useMemo(() => new Animated.Value(0), []);
  const pauseToastOpacity = useMemo(() => new Animated.Value(0), []);
  const lyricDragTranslationY = useMemo(() => new Animated.Value(0), []);
  const saveChoiceDialogOpen = useRef(false);
  const syncScrollRef = useRef<ScrollViewInstance | null>(null);
  const syncViewportRef = useRef<ViewInstance | null>(null);
  const lyricLinesContainerRef = useRef<ViewInstance | null>(null);
  const selectedLineRowRef = useRef<ViewInstance | null>(null);
  const syncScrollOffset = useRef(0);
  const syncScrollContentHeight = useRef(0);
  const isManuallyScrollingLyrics = useRef(false);
  const recenterLyricsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recenterLyricsFrame = useRef<number | null>(null);
  const lyricLinesRef = useRef(lyricLines);
  const lyricRowLayouts = useRef(new Map<string, LyricsLineLayout>());
  const lyricDragRef = useRef<LyricsLineDrag | null>(null);
  const lyricDragViewport = useRef<{ top: number; bottom: number; height: number } | null>(null);
  const lyricListContentOrigin = useRef(0);
  const lyricDragAutoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lyricDragAutoScrollDirection = useRef<-1 | 0 | 1>(0);
  const preparedMp3Ref = useRef<{
    sourceUri: string;
    syncedLyrics: string;
    durationMs: number;
    uri: string;
  } | null>(null);
  const isDismissingTrackPicker = useRef(false);
  const trackPickerListScrollOffset = useRef(0);
  const availableMp3Tracks = useMemo(() => downloadedTracks.filter((track) => {
    if (!track.localUri) return false;
    const path = track.localUri.toLowerCase().split(/[?#]/, 1)[0];
    const extensionFromUri = path.match(/\.([^.\\/]+)$/)?.[1];
    const extension = extensionFromUri ?? track.fileExtension?.toLowerCase().replace(/^\./, '');
    return extension === 'mp3';
  }), [downloadedTracks]);
  const filteredMp3Tracks = useMemo(() => {
    const query = librarySearch.trim().toLocaleLowerCase();
    if (!query) return availableMp3Tracks;
    return availableMp3Tracks.filter((track) => (
      `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query)
    ));
  }, [availableMp3Tracks, librarySearch]);
  const dismissTrackPicker = useCallback(() => {
    if (isDismissingTrackPicker.current) return;
    isDismissingTrackPicker.current = true;
    Animated.timing(trackPickerTranslateY, {
      toValue: pickerWindowHeight.current,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setTrackPickerVisible(false);
      isDismissingTrackPicker.current = false;
    });
  }, [trackPickerTranslateY]);
  // The responder is created once per callback set; its ref access runs only after a gesture begins.
  // eslint-disable-next-line react-hooks/refs
  const trackPickerPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      trackPickerListScrollOffset.current <= 0.5
      && gesture.dy > 5
      && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2
    ),
    onMoveShouldSetPanResponder: (_event, gesture) => (
      trackPickerListScrollOffset.current <= 0.5
      && gesture.dy > 5
      && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2
    ),
    onPanResponderMove: (_event, gesture) => {
      if (gesture.dy > 0) trackPickerTranslateY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 110 || (gesture.dy > 45 && gesture.vy > 0.85)) {
        dismissTrackPicker();
      } else {
        Animated.spring(trackPickerTranslateY, {
          toValue: 0,
          damping: 28,
          stiffness: 260,
          mass: 0.8,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(trackPickerTranslateY, {
        toValue: 0,
        damping: 28,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
  }), [dismissTrackPicker, trackPickerTranslateY]);
  // The responder callbacks read refs only after a gesture starts.
  // eslint-disable-next-line react-hooks/refs
  const trackPickerHeaderPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      gesture.dy > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2
    ),
    onPanResponderMove: (_event, gesture) => {
      if (gesture.dy > 0) trackPickerTranslateY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 110 || (gesture.dy > 45 && gesture.vy > 0.85)) {
        dismissTrackPicker();
      } else {
        Animated.spring(trackPickerTranslateY, {
          toValue: 0,
          damping: 28,
          stiffness: 260,
          mass: 0.8,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(trackPickerTranslateY, {
        toValue: 0,
        damping: 28,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
  }), [dismissTrackPicker, trackPickerTranslateY]);
  const titleOffset = scrollY.interpolate({
    inputRange: [0, 22, 72, 204],
    outputRange: [22, 0, 0, -132],
    extrapolate: 'clamp',
  });
  const topFadeOpacity = scrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    pickerWindowHeight.current = windowHeight;
  }, [windowHeight]);

  useEffect(() => {
    const scrollListener = scrollY.addListener(({ value }) => {
      syncScrollOffset.current = value;
    });
    return () => scrollY.removeListener(scrollListener);
  }, [scrollY]);

  useEffect(() => {
    if (!trackPickerVisible) return;
    isDismissingTrackPicker.current = false;
    trackPickerTranslateY.setValue(pickerWindowHeight.current);
    Animated.spring(trackPickerTranslateY, {
      toValue: 0,
      damping: 30,
      stiffness: 250,
      mass: 0.85,
      useNativeDriver: true,
    }).start();
  }, [trackPickerTranslateY, trackPickerVisible]);

  useEffect(() => {
    playerStatusRef.current = playerStatus;
  }, [playerStatus]);

  useEffect(() => {
    lyricLinesRef.current = lyricLines;
    const viewport = syncViewportRef.current;
    const listContainer = lyricLinesContainerRef.current;
    if (!viewport || !listContainer) return;
    viewport.measureInWindow((_viewportX, viewportY) => {
      listContainer.measureInWindow((_listX, listY) => {
        lyricListContentOrigin.current = listY - viewportY + syncScrollOffset.current;
      });
    });
  }, [lyricLines]);

  useEffect(() => () => {
    pauseToastOpacity.stopAnimation();
  }, [pauseToastOpacity]);

  const loadLyrics = useCallback((lyrics: string | null) => {
    const lines = lyrics === null ? [] : parseLyrics(lyrics);
    lyricRowLayouts.current.clear();
    setLyricLines(lines);
    setSelectedLineId(lines.find((line) => line.text.trim())?.id ?? null);
  }, []);

  const chooseLibraryTrack = async (track: Track) => {
    setImportError(null);
    setIsImporting(true);
    try {
      if (!track.localUri) throw new Error('This track is not stored on this device.');
      let file = new File(track.localUri);
      if (!file.exists || (file.size ?? 0) === 0) {
        const restored = await Id3SynchronizedLyricsService.restoreLatestSynchronizedMp3(file.name, file.uri);
        if (!restored) throw new Error('This library MP3 is empty or no longer available.');
        file = restored;
      }
      if (!file.name.toLocaleLowerCase().endsWith('.mp3')) throw new Error('Only local MP3 tracks can be synchronized.');

      const metadata = await parseBuffer(await file.bytes(), 'audio/mpeg');
      const { lyrics: embeddedLyrics, sourceLyrics: embeddedSourceLyrics, hadSyncedLyrics: embeddedHadSyncedLyrics } = getEmbeddedLyrics(metadata);
      const sidecars = await readLyricsSidecars(track, file);
      const sidecar = sidecars[0];
      const hasEmbeddedLyrics = Boolean(embeddedSourceLyrics?.trim());
      const hasSidecarLyrics = Boolean(sidecar?.text.trim());
      let source: 'embedded' | 'sidecar' | null = hasEmbeddedLyrics
        ? 'embedded'
        : hasSidecarLyrics
          ? 'sidecar'
          : null;

      if (hasEmbeddedLyrics && hasSidecarLyrics) {
        source = await new Promise<'embedded' | 'sidecar' | null>((resolve) => {
          Alert.alert(
            'Two lyric sources found',
            `Choose which lyrics to resynchronize. The unused source will be deleted from “${track.title}”.`,
            [
              { text: 'Use MP3 lyrics', onPress: () => resolve('embedded') },
              { text: `Use ${sidecar?.file.extension.toLowerCase() === '.txt' ? 'text' : 'LRC'} file`, onPress: () => resolve('sidecar') },
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
            ],
            { cancelable: false },
          );
        });
        if (!source) return;
      }

      let libraryTrack = track;
      if (source && hasEmbeddedLyrics && hasSidecarLyrics) {
        if (source === 'embedded') {
          libraryTrack = await OfflineMusicService.removeLyricsSidecars(track);
        } else if (sidecar) {
          const lyricsRemovedMp3 = await Id3SynchronizedLyricsService.createVerifiedMp3WithoutLyrics(file.uri, file.name);
          try {
            await OfflineMusicService.replaceTrackAudio(track, lyricsRemovedMp3.uri);
          } finally {
            if (lyricsRemovedMp3.exists) lyricsRemovedMp3.delete();
          }
          libraryTrack = await OfflineMusicService.removeLyricsSidecars(track, sidecar.file.uri);
        }
      }

      const libraryLyrics = source === 'embedded' ? embeddedSourceLyrics : source === 'sidecar' ? sidecar?.text ?? null : null;
      if (source && !libraryLyrics) throw new Error('The selected lyrics source is empty.');
      if (libraryLyrics) {
        libraryTrack = await updateTrack(libraryTrack, {
          title: metadata.common.title?.trim() || track.title,
          artist: metadata.common.artist?.trim() || metadata.common.albumartist?.trim() || track.artist || 'Unknown artist',
          album: metadata.common.album?.trim() || track.album,
          lyrics: libraryLyrics,
        });
      }
      const editorLyrics = source === 'embedded'
        ? embeddedLyrics
        : source === 'sidecar' && libraryLyrics ? clearEmbeddedTimestamps(libraryLyrics) : null;
      const hadSyncedLyrics = source === 'embedded'
        ? embeddedHadSyncedLyrics
        : source === 'sidecar' && libraryLyrics ? hasLrcTimestamps(libraryLyrics) : false;
      const imported: ImportedMp3 = {
        libraryTrack,
        uri: file.uri,
        fileName: file.name,
        title: metadata.common.title?.trim() || track.title,
        artist: metadata.common.artist?.trim() || metadata.common.albumartist?.trim() || track.artist || 'Unknown artist',
        lyrics: editorLyrics,
        lyricsSource: source ?? 'embedded',
        hadSyncedLyrics,
        duration: metadata.format.duration ?? track.durationSeconds ?? 0,
      };
      player.pause();
      player.replace({ uri: imported.uri });
      await player.seekTo(0);
      setSelectedMp3(imported);
      loadLyrics(editorLyrics);
      dismissTrackPicker();
      setPlaybackError(null);
      setSaveError(null);
      setPastedLyrics('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read this library MP3.');
    } finally {
      setIsImporting(false);
    }
  };

  const applyPastedLyrics = () => {
    if (!selectedMp3 || !pastedLyrics.trim()) return;
    setSelectedMp3({ ...selectedMp3, lyrics: pastedLyrics, lyricsSource: 'pasted', hadSyncedLyrics: false });
    loadLyrics(pastedLyrics);
    setPasteModalVisible(false);
  };

  const saveEditedLine = () => {
    if (!lineEditor || !lineEditor.text.trim()) return;
    const editedText = lineEditor.text.trim();
    if (lineEditor.lineId) {
      setLyricLines((currentLines) => currentLines.map((line) => (
        line.id === lineEditor.lineId ? { ...line, text: editedText } : line
      )));
      setSelectedLineId(lineEditor.lineId);
    } else {
      const newLine: TimedLyricLine = {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: editedText,
        timeMs: null,
      };
      setLyricLines((currentLines) => {
        const selectedIndex = currentLines.findIndex((line) => line.id === selectedLineId);
        const insertIndex = selectedIndex < 0 ? currentLines.length : selectedIndex + 1;
        return [...currentLines.slice(0, insertIndex), newLine, ...currentLines.slice(insertIndex)];
      });
      setSelectedLineId(newLine.id);
    }
    setLineEditor(null);
  };

  const confirmDeleteLine = (line: TimedLyricLine) => {
    Alert.alert(
      'Delete lyric line?',
      'This removes the line and its timestamp from the synchronized lyrics.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const lineIndex = lyricLines.findIndex((currentLine) => currentLine.id === line.id);
            const remainingLines = lyricLines.filter((currentLine) => currentLine.id !== line.id);
            setLyricLines(remainingLines);
            if (selectedLineId === line.id) {
              const nextUnassignedLine = remainingLines
                .slice(Math.max(lineIndex, 0))
                .find((currentLine) => currentLine.text.trim() && currentLine.timeMs === null)
                ?? remainingLines.find((currentLine) => currentLine.text.trim() && currentLine.timeMs === null);
              setSelectedLineId(nextUnassignedLine?.id ?? null);
            }
            if (lineEditor?.lineId === line.id) setLineEditor(null);
          },
        },
      ],
    );
  };

  const confirmDeleteAllLines = () => {
    const lineCount = lyricLines.filter((line) => line.text.trim()).length;
    if (lineCount === 0) return;
    Alert.alert(
      'Delete all lyric lines?',
      `This clears all ${lineCount} line${lineCount === 1 ? '' : 's'} and timestamps from this sync session. The library track changes only if you save afterward.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            setLyricLines([]);
            setSelectedLineId(null);
            setLineEditor(null);
            setPlaybackError(null);
            setSaveError(null);
            preparedMp3Ref.current = null;
          },
        },
      ],
    );
  };

  const assignTimestampToSelectedLine = useCallback(() => {
    if (!player.playing) {
      setPlaybackError('Start playback before assigning a timestamp.');
      return;
    }
    if (!selectedLineId) return;

    const timestampMs = Math.max(0, Math.round(player.currentTime * 1000));
    const selectedIndex = lyricLines.findIndex((line) => line.id === selectedLineId);
    if (selectedIndex < 0) return;
    const updatedLines = lyricLines.map((line) => (
      line.id === selectedLineId ? { ...line, timeMs: timestampMs } : line
    ));
    const nextLine = updatedLines.slice(selectedIndex + 1).find((line) => line.text.trim() && line.timeMs === null)
      ?? updatedLines.find((line) => line.text.trim() && line.timeMs === null);
    setLyricLines(updatedLines);
    setSelectedLineId(nextLine?.id ?? null);
    setPlaybackError(null);
  }, [lyricLines, player, selectedLineId]);

  const showPausePlayerToast = useCallback(() => {
    pauseToastOpacity.stopAnimation();
    pauseToastOpacity.setValue(0);
    setPauseToastVisible(true);
    Animated.sequence([
      Animated.timing(pauseToastOpacity, {
        toValue: 0.64,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.delay(1230),
      Animated.timing(pauseToastOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setPauseToastVisible(false);
    });
  }, [pauseToastOpacity]);

  const retimeLine = useCallback((line: TimedLyricLine) => {
    if (player.playing) {
      showPausePlayerToast();
      return;
    }

    setSelectedLineId(line.id);
    setLyricLines((currentLines) => {
      const lineIndex = currentLines.findIndex((currentLine) => currentLine.id === line.id);
      if (lineIndex < 0) return currentLines;
      return currentLines.map((currentLine, index) => (
        index >= lineIndex ? { ...currentLine, timeMs: null } : currentLine
      ));
    });
    setPlaybackError(null);
  }, [player, showPausePlayerToast]);

  const restartSynchronization = () => {
    Alert.alert(
      'Restart synchronization?',
      'This will clear all timestamps and return to the first lyric line.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: () => {
            setLyricLines((currentLines) => currentLines.map((line) => ({ ...line, timeMs: null })));
            setSelectedLineId(lyricLines.find((line) => line.text.trim())?.id ?? null);
            setPlaybackError(null);
            void player.seekTo(0).catch((error: unknown) => {
              setPlaybackError(error instanceof Error ? error.message : 'Could not seek to the start of the track.');
            });
          },
        },
      ],
    );
  };

  const formatTime = (seconds: number) => {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const formatLyricTime = (timeMs: number) => {
    const minutes = Math.floor(timeMs / 60_000);
    const seconds = Math.floor((timeMs % 60_000) / 1000);
    const centiseconds = Math.floor((timeMs % 1000) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  };

  const seekTo = useCallback(async (seconds: number) => {
    const duration = playerStatus.duration || selectedMp3?.duration || 0;
    const targetTime = Math.max(0, Math.min(duration, seconds));
    try {
      await player.seekTo(targetTime);
      setPlaybackError(null);
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : 'Could not seek within the track.');
    }
  }, [player, playerStatus.duration, selectedMp3?.duration]);
  const seekPosition = seekPreview ?? playerStatus.currentTime;
  const trackDuration = playerStatus.duration || selectedMp3?.duration || 0;
  const persistentPanelBottom = Math.max(insets.bottom, 12);
  const exportableLines = lyricLines
    .filter((line) => line.text.trim())
    .map((line) => line.timeMs === null ? null : { text: line.text.trim(), timestampMs: line.timeMs });
  const hasAllTimestamps = exportableLines.length > 0 && exportableLines.every((line) => line !== null);
  const hasChronologicalTimestamps = hasAllTimestamps && exportableLines.every((line, index) => (
    line !== null
    && (index === 0 || exportableLines[index - 1] !== null && line.timestampMs >= exportableLines[index - 1].timestampMs)
    && (trackDuration <= 0 || line.timestampMs <= trackDuration * 1000)
  ));
  const canSave = Boolean(selectedMp3 && hasChronologicalTimestamps && !isSaving);
  const visiblePlaybackError = playbackError ?? playerStatus.error ?? null;
  const playingLineId = lyricLines.reduce<string | null>((currentId, line) => (
    line.text.trim() && line.timeMs !== null && line.timeMs <= playerStatus.currentTime * 1000
      ? line.id
      : currentId
  ), null);

  const clearLyricsRecenterTimer = useCallback(() => {
    if (recenterLyricsTimer.current) {
      clearTimeout(recenterLyricsTimer.current);
      recenterLyricsTimer.current = null;
    }
  }, []);

  const stopLyricsLineAutoScroll = useCallback(() => {
    if (lyricDragAutoScrollTimer.current) {
      clearInterval(lyricDragAutoScrollTimer.current);
      lyricDragAutoScrollTimer.current = null;
    }
    lyricDragAutoScrollDirection.current = 0;
  }, []);

  const animateLyricsLineDrop = useCallback(() => {
    Animated.spring(lyricDragTranslationY, {
      toValue: 0,
      damping: 22,
      stiffness: 280,
      mass: 0.78,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setDraggingLineId(null);
    });
  }, [lyricDragTranslationY]);

  const cancelLyricsLineDrag = useCallback(() => {
    const wasDragging = Boolean(lyricDragRef.current);
    stopLyricsLineAutoScroll();
    lyricDragRef.current = null;
    lyricDragViewport.current = null;
    if (wasDragging) animateLyricsLineDrop();
  }, [animateLyricsLineDrop, stopLyricsLineAutoScroll]);

  const startLyricsLineDrag = useCallback((lineId: string) => {
    if (playerStatusRef.current.playing) return;
    const rowLayout = lyricRowLayouts.current.get(lineId);
    if (!rowLayout) return;
    const lineIndex = lyricLinesRef.current.findIndex((line) => line.id === lineId);
    if (lineIndex < 0) return;

    clearLyricsRecenterTimer();
    lyricDragTranslationY.stopAnimation();
    lyricDragTranslationY.setValue(0);
    lyricDragRef.current = {
      lineId,
      initialCenterY: lyricListContentOrigin.current + rowLayout.y + rowLayout.height / 2,
      initialScrollOffset: syncScrollOffset.current,
      dy: 0,
      moveY: 0,
    };
    setDraggingLineId(lineId);
    syncViewportRef.current?.measureInWindow((_x, y, _width, height) => {
      if (lyricDragRef.current?.lineId === lineId) {
        lyricDragViewport.current = { top: y, bottom: y + height, height };
      }
    });
  }, [clearLyricsRecenterTimer, lyricDragTranslationY]);

  const updateLyricsLineDrag = useCallback((dy: number, moveY: number) => {
    const drag = lyricDragRef.current;
    if (!drag) return;
    if (playerStatusRef.current.playing) {
      cancelLyricsLineDrag();
      return;
    }

    drag.dy = dy;
    drag.moveY = moveY;
    const viewport = lyricDragViewport.current;
    const currentOffset = syncScrollOffset.current;
    const draggedCenter = viewport
      ? moveY - viewport.top + currentOffset
      : drag.initialCenterY + dy + currentOffset - drag.initialScrollOffset;
    lyricDragTranslationY.setValue(draggedCenter - drag.initialCenterY);

    if (!viewport) return;
    const edgeSize = Math.min(82, viewport.height * 0.16);
    const direction = moveY < viewport.top + edgeSize
      ? -1
      : moveY > viewport.bottom - edgeSize ? 1 : 0;
    if (direction === 0) {
      stopLyricsLineAutoScroll();
      return;
    }
    if (lyricDragAutoScrollTimer.current && lyricDragAutoScrollDirection.current === direction) return;
    stopLyricsLineAutoScroll();
    lyricDragAutoScrollDirection.current = direction;

    lyricDragAutoScrollTimer.current = setInterval(() => {
      const activeDrag = lyricDragRef.current;
      const activeViewport = lyricDragViewport.current;
      if (!activeDrag || !activeViewport || playerStatusRef.current.playing) {
        stopLyricsLineAutoScroll();
        return;
      }
      const maxOffset = Math.max(0, syncScrollContentHeight.current - activeViewport.height);
      const nextOffset = Math.max(
        0,
        Math.min(maxOffset, syncScrollOffset.current + direction * 11),
      );
      if (nextOffset === syncScrollOffset.current) {
        stopLyricsLineAutoScroll();
        return;
      }
      syncScrollOffset.current = nextOffset;
      syncScrollRef.current?.scrollTo({ y: nextOffset, animated: false });
      const activeCenter = activeDrag.moveY - activeViewport.top + nextOffset;
      lyricDragTranslationY.setValue(activeCenter - activeDrag.initialCenterY);
    }, 16);
  }, [cancelLyricsLineDrag, lyricDragTranslationY, stopLyricsLineAutoScroll]);

  const finishLyricsLineDrag = useCallback((lineId: string, dy: number, moveY: number) => {
    const drag = lyricDragRef.current;
    if (!drag || drag.lineId !== lineId) return;
    stopLyricsLineAutoScroll();
    lyricDragRef.current = null;

    if (!playerStatusRef.current.playing) {
      const currentLines = lyricLinesRef.current;
      const fromIndex = currentLines.findIndex((line) => line.id === lineId);
      const rowLayout = lyricRowLayouts.current.get(lineId);
      const viewport = lyricDragViewport.current;
      if (fromIndex >= 0 && rowLayout && Math.abs(dy) > 12) {
        const projectedCenter = viewport
          ? moveY - viewport.top + syncScrollOffset.current
          : drag.initialCenterY + dy + syncScrollOffset.current - drag.initialScrollOffset;
        const remainingLines = currentLines.filter((line) => line.id !== lineId);
        const toIndex = remainingLines.reduce((insertIndex, line) => {
          const layout = lyricRowLayouts.current.get(line.id);
          const lineCenter = layout
            ? lyricListContentOrigin.current + layout.y + layout.height / 2
            : Number.POSITIVE_INFINITY;
          const crossedLineCenter = dy >= 0 ? projectedCenter >= lineCenter : projectedCenter > lineCenter;
          return layout && crossedLineCenter
            ? insertIndex + 1
            : insertIndex;
        }, 0);

        if (toIndex !== fromIndex) {
          const reordered = [
            ...remainingLines.slice(0, toIndex),
            currentLines[fromIndex],
            ...remainingLines.slice(toIndex),
          ];
          const linesWithValidTimings = reordered.map((line) => (
            line.id === lineId && line.timeMs !== null
              ? { ...line, timeMs: null }
              : line
          ));
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          lyricLinesRef.current = linesWithValidTimings;
          setLyricLines(linesWithValidTimings);
          setSelectedLineId(lineId);
          preparedMp3Ref.current = null;
          setPlaybackError(null);
          setSaveError(null);
        }
      }
    }

    lyricDragViewport.current = null;
    animateLyricsLineDrop();
  }, [animateLyricsLineDrop, stopLyricsLineAutoScroll]);

  useEffect(() => {
    const responders = new Map<string, ReturnType<typeof PanResponder.create>>();
    if (!playerStatus.playing) {
      lyricLines.forEach((line) => {
        if (!line.text.trim()) return;
        responders.set(line.id, PanResponder.create({
          onStartShouldSetPanResponder: () => !playerStatusRef.current.playing,
          onMoveShouldSetPanResponder: () => !playerStatusRef.current.playing,
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: () => startLyricsLineDrag(line.id),
          onPanResponderMove: (_event, gestureState) => (
            updateLyricsLineDrag(gestureState.dy, gestureState.moveY)
          ),
          onPanResponderRelease: (_event, gestureState) => (
            finishLyricsLineDrag(line.id, gestureState.dy, gestureState.moveY)
          ),
          onPanResponderTerminate: () => cancelLyricsLineDrag(),
        }));
      });
    }
    setLyricDragResponders(responders);
  }, [cancelLyricsLineDrag, finishLyricsLineDrag, lyricLines, playerStatus.playing, startLyricsLineDrag, updateLyricsLineDrag]);

  useEffect(() => {
    if (playerStatus.playing && lyricDragRef.current) cancelLyricsLineDrag();
  }, [cancelLyricsLineDrag, playerStatus.playing]);

  const centerSelectedLyricsLine = useCallback((animated = true) => {
    const selectedRow = selectedLineRowRef.current;
    const viewport = syncViewportRef.current;
    const scrollView = syncScrollRef.current;
    if (!selectedRow || !viewport || !scrollView) return;

    viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
      selectedRow.measureInWindow((_rowX, rowY, _rowWidth, rowHeight) => {
        const maxOffset = Math.max(0, syncScrollContentHeight.current - viewportHeight);
        const targetOffset = syncScrollOffset.current
          + rowY + rowHeight / 2
          - (viewportY + viewportHeight / 2);
        scrollView.scrollTo({
          y: Math.max(0, Math.min(maxOffset, targetOffset)),
          animated,
        });
      });
    });
  }, []);

  const scheduleLyricsRecentering = useCallback(() => {
    clearLyricsRecenterTimer();
    if (!playerStatus.playing) {
      isManuallyScrollingLyrics.current = false;
      return;
    }
    recenterLyricsTimer.current = setTimeout(() => {
      recenterLyricsTimer.current = null;
      if (!playerStatusRef.current.playing) {
        isManuallyScrollingLyrics.current = false;
        return;
      }
      isManuallyScrollingLyrics.current = false;
      centerSelectedLyricsLine(true);
    }, 1000);
  }, [centerSelectedLyricsLine, clearLyricsRecenterTimer, playerStatus.playing]);

  const handleLyricsScrollBeginDrag = useCallback(() => {
    isManuallyScrollingLyrics.current = true;
    clearLyricsRecenterTimer();
  }, [clearLyricsRecenterTimer]);

  useEffect(() => {
    if (!selectedLineId) return;
    clearLyricsRecenterTimer();
    isManuallyScrollingLyrics.current = false;
    if (recenterLyricsFrame.current !== null) cancelAnimationFrame(recenterLyricsFrame.current);
    recenterLyricsFrame.current = requestAnimationFrame(() => {
      recenterLyricsFrame.current = null;
      centerSelectedLyricsLine(true);
    });

    return () => {
      if (recenterLyricsFrame.current !== null) {
        cancelAnimationFrame(recenterLyricsFrame.current);
        recenterLyricsFrame.current = null;
      }
    };
  }, [centerSelectedLyricsLine, clearLyricsRecenterTimer, selectedLineId]);

  useEffect(() => {
    if (playerStatus.playing) return;
    clearLyricsRecenterTimer();
    isManuallyScrollingLyrics.current = false;
  }, [clearLyricsRecenterTimer, playerStatus.playing]);

  useEffect(() => () => {
    clearLyricsRecenterTimer();
    stopLyricsLineAutoScroll();
    if (recenterLyricsFrame.current !== null) cancelAnimationFrame(recenterLyricsFrame.current);
  }, [clearLyricsRecenterTimer, stopLyricsLineAutoScroll]);

  const saveSynchronizedMp3 = async (mode: 'overwrite' | 'new') => {
    if (!selectedMp3 || !canSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (Platform.OS === 'web') {
        throw new Error('Saving synchronized tracks to your library is available on iOS and Android.');
      }
      const entries = exportableLines.filter((line): line is NonNullable<typeof line> => line !== null);
      const syncedLyrics = entries
        .map((entry) => `[${formatLyricTime(entry.timestampMs)}] ${entry.text}`)
        .join('\n');
      const durationMs = trackDuration * 1000;
      const preparedCopy = preparedMp3Ref.current;
      const reusableCopy = preparedCopy
        && preparedCopy.sourceUri === selectedMp3.uri
        && preparedCopy.syncedLyrics === syncedLyrics
        && preparedCopy.durationMs === durationMs
        && new File(preparedCopy.uri).exists
        ? new File(preparedCopy.uri)
        : null;
      const verifiedMp3 = reusableCopy ?? await Id3SynchronizedLyricsService.createVerifiedMp3(
        selectedMp3.uri,
        selectedMp3.fileName,
        entries,
        durationMs,
      );
      preparedMp3Ref.current = {
        sourceUri: selectedMp3.uri,
        syncedLyrics,
        durationMs,
        uri: verifiedMp3.uri,
      };
      const previewWasPlaying = playerStatusRef.current.playing;
      const previewPosition = playerStatusRef.current.currentTime;
      const savedTrack = await saveSynchronizedTrack(
        selectedMp3.libraryTrack,
        verifiedMp3.uri,
        syncedLyrics,
        mode,
      );
      if (!savedTrack.localUri) throw new Error('The saved library track has no audio file.');
      preparedMp3Ref.current = null;
      try {
        if (verifiedMp3.exists) verifiedMp3.delete();
      } catch {
        // A leftover verified copy is harmless if cache cleanup is unavailable.
      }

      player.pause();
      try {
        player.replace({ uri: savedTrack.localUri });
        await player.seekTo(Math.min(previewPosition, trackDuration || previewPosition));
        if (previewWasPlaying) player.play();
      } catch {
        if (previewWasPlaying) player.play();
      }

      const savedFile = new File(savedTrack.localUri);
      const savedLyrics = {
        ...selectedMp3,
        libraryTrack: savedTrack,
        uri: savedTrack.localUri,
        fileName: savedFile.name,
        title: savedTrack.title,
        artist: savedTrack.artist,
        lyrics: syncedLyrics,
        lyricsSource: 'embedded' as const,
        hadSyncedLyrics: true,
      };
      setSelectedMp3(savedLyrics);
      Alert.alert(
        mode === 'overwrite' ? 'Track updated' : 'Saved as new track',
        mode === 'overwrite'
          ? `${savedTrack.title} was updated in your library.`
          : `${savedTrack.title} was added to your library.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const showSaveOptions = () => {
    if (!selectedMp3 || !canSave || saveChoiceDialogOpen.current) return;
    saveChoiceDialogOpen.current = true;
    const beginSave = (mode: 'overwrite' | 'new') => {
      saveChoiceDialogOpen.current = false;
      void saveSynchronizedMp3(mode);
    };
    Alert.alert(
      'Save synchronized track',
      `Choose how to save “${selectedMp3.title}” to your library.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            saveChoiceDialogOpen.current = false;
          },
        },
        { text: 'Overwrite old track', style: 'destructive', onPress: () => beginSave('overwrite') },
        { text: 'Save as new track', onPress: () => beginSave('new') },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          saveChoiceDialogOpen.current = false;
        },
      },
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View ref={syncViewportRef} style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.ScrollView
          ref={syncScrollRef}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          onContentSizeChange={(_width, height) => {
            syncScrollContentHeight.current = height;
          }}
          onScrollBeginDrag={handleLyricsScrollBeginDrag}
          onScrollEndDrag={() => {
            if (isManuallyScrollingLyrics.current) scheduleLyricsRecentering();
          }}
          onMomentumScrollBegin={() => {
            if (isManuallyScrollingLyrics.current) clearLyricsRecenterTimer();
          }}
          onMomentumScrollEnd={() => {
            if (isManuallyScrollingLyrics.current) scheduleLyricsRecentering();
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 58, paddingBottom: 380 + persistentPanelBottom }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 74 }}>
            <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginBottom: 22 }}>
              Choose an MP3 from your Musiqapp library to view and synchronize its lyrics.
            </Text>

            <TouchableOpacity
              onPress={() => {
                setImportError(null);
                setTrackPickerVisible(true);
              }}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel={selectedMp3 ? 'Choose another track from your library' : 'Choose a track from your library'}
              style={{
                minHeight: 58,
                paddingHorizontal: 18,
                borderRadius: 18,
                backgroundColor: '#FA243C',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: isImporting ? 0.7 : 1,
              }}
            >
              {isImporting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Ionicons name="musical-notes-outline" size={21} color="white" />
              )}
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                {isImporting ? 'Reading track…' : selectedMp3 ? 'Choose another track' : 'Browse your library'}
              </Text>
            </TouchableOpacity>

            {!selectedMp3 && !isLoadingTracks && !apiInitializing && availableMp3Tracks.length === 0 ? (
              <Text style={{ color: '#8E8E93', fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' }}>
                No local MP3 tracks are available. Add or download an MP3 to your library first.
              </Text>
            ) : null}

            {importError ? (
              <View
                accessibilityRole="alert"
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: 'rgba(250,82,101,0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(250,82,101,0.30)',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                }}
              >
                <Ionicons name="alert-circle-outline" size={19} color="#FA5265" />
                <Text style={{ flex: 1, color: '#FA7A89', fontSize: 13, lineHeight: 19, marginLeft: 9 }}>
                  {importError}
                </Text>
              </View>
            ) : null}

            {selectedMp3 ? (
              <View style={{ marginTop: 28 }}>
                <View
                  style={{
                    minHeight: 88,
                    padding: 16,
                    borderRadius: 18,
                    backgroundColor: '#1C1C1E',
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      backgroundColor: '#382027',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="musical-note" size={24} color="#FA5265" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, marginLeft: 13 }}>
                    <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                      {selectedMp3.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 13, marginTop: 4 }}>
                      {selectedMp3.artist}
                    </Text>
                    <Text numberOfLines={1} style={{ color: '#6F6F76', fontSize: 11, marginTop: 4 }}>
                      {selectedMp3.fileName}
                    </Text>
                  </View>
                </View>

                {lyricLines.length > 0 ? (
                  <View style={{ marginTop: 27 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <View>
                        <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>Lyrics</Text>
                        <Text style={{ color: '#8E8E93', fontSize: 12, marginTop: 3 }}>
                          {selectedMp3.hadSyncedLyrics
                            ? `From ${selectedMp3.lyricsSource === 'sidecar' ? 'LRC file' : 'MP3'} · previous timings cleared · `
                            : selectedMp3.lyricsSource === 'embedded'
                              ? 'From MP3 · '
                              : selectedMp3.lyricsSource === 'sidecar' ? 'From LRC file · ' : 'Pasted · '}
                          {lyricLines.filter((line) => line.text.trim()).length} lines
                          {' · '}{playerStatus.playing ? 'Pause to reorder' : 'Drag handles to reorder'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={confirmDeleteAllLines}
                        disabled={lyricLines.length === 0}
                        accessibilityRole="button"
                        accessibilityLabel="Delete all lyric lines"
                        style={{
                          minHeight: 38,
                          paddingHorizontal: 12,
                          borderRadius: 19,
                          backgroundColor: '#2A2024',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          opacity: lyricLines.length > 0 ? 1 : 0.45,
                        }}
                      >
                        <Ionicons name="trash-outline" size={16} color="#FA5265" />
                        <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700' }}>Delete all</Text>
                      </TouchableOpacity>
                    </View>
                    <View
                      ref={lyricLinesContainerRef}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: '#111113' }}
                    >
                      {lyricLines.map((line, index) => {
                        const dragResponder = lyricDragResponders.get(line.id);
                        return (
                        <Animated.View
                          key={line.id}
                          ref={selectedLineId === line.id ? selectedLineRowRef : undefined}
                          onLayout={(event) => {
                            const { y, height } = event.nativeEvent.layout;
                            lyricRowLayouts.current.set(line.id, { y, height });
                          }}
                          style={{
                            minHeight: line.text.trim() ? 48 : 20,
                            paddingVertical: line.text.trim() ? 10 : 3,
                            borderBottomWidth: index < lyricLines.length - 1 && line.text.trim() ? 1 : 0,
                            borderBottomColor: '#29292B',
                            borderLeftWidth: selectedLineId === line.id ? 2 : 0,
                            borderLeftColor: '#FA5265',
                            paddingLeft: selectedLineId === line.id ? 9 : 0,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: selectedLineId === line.id
                              ? 'rgba(250,82,101,0.08)'
                              : playingLineId === line.id ? 'rgba(255,255,255,0.04)' : 'transparent',
                            transform: [{
                              translateY: draggingLineId === line.id ? lyricDragTranslationY : 0,
                            }],
                            zIndex: draggingLineId === line.id ? 2 : 0,
                            elevation: draggingLineId === line.id ? 4 : 0,
                          }}
                        >
                          {line.text.trim() ? (
                            <TouchableOpacity
                              onPress={() => line.timeMs !== null ? retimeLine(line) : setSelectedLineId(line.id)}
                              accessibilityRole="button"
                              accessibilityLabel={line.timeMs === null ? `Select lyric line ${index + 1}` : `Retime lyric line ${index + 1}`}
                              accessibilityState={{ selected: selectedLineId === line.id }}
                              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}
                            >
                              <Text style={{ width: 30, color: '#68686F', fontSize: 12, fontVariant: ['tabular-nums'] }}>
                                {String(index + 1).padStart(2, '0')}
                              </Text>
                              <Text style={{ flex: 1, color: selectedLineId === line.id ? 'white' : '#E5E5E7', fontSize: 15, lineHeight: 22 }}>
                                {line.text}
                              </Text>
                              {line.timeMs !== null ? (
                                <Text style={{ color: '#FA5265', fontSize: 11, fontVariant: ['tabular-nums'], marginLeft: 7 }}>
                                  {formatLyricTime(line.timeMs)}
                                </Text>
                              ) : selectedLineId === line.id ? (
                                <Text style={{ color: '#FA5265', fontSize: 10, fontWeight: '700', marginLeft: 7 }}>
                                  NEXT
                                </Text>
                              ) : null}
                            </TouchableOpacity>
                          ) : <View style={{ flex: 1 }} />}
                          {line.text.trim() && !playerStatus.playing ? (
                            <View
                              {...(dragResponder?.panHandlers ?? {})}
                              accessibilityRole="button"
                              accessibilityLabel={`Drag to reorder lyric line ${index + 1}`}
                              accessibilityHint="Move this lyric line before or after another line"
                              style={{
                                width: 34,
                                height: 36,
                                marginLeft: 3,
                                borderRadius: 10,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: draggingLineId === line.id ? 'rgba(250,82,101,0.16)' : 'transparent',
                              }}
                            >
                              <Ionicons
                                name="reorder-three-outline"
                                size={21}
                                color={draggingLineId === line.id ? '#FA5265' : '#77777F'}
                              />
                            </View>
                          ) : null}
                          {line.text.trim() ? (
                            <TouchableOpacity
                              onPress={() => setLineEditor({ lineId: line.id, text: line.text })}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit lyric line ${index + 1}`}
                              hitSlop={8}
                              style={{ width: 32, height: 34, marginLeft: 5, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Ionicons name="create-outline" size={16} color="#8E8E93" />
                            </TouchableOpacity>
                          ) : null}
                          {line.text.trim() ? (
                            <TouchableOpacity
                              onPress={() => confirmDeleteLine(line)}
                              accessibilityRole="button"
                              accessibilityLabel={`Delete lyric line ${index + 1}`}
                              hitSlop={8}
                              style={{ width: 32, height: 34, marginLeft: 2, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Ionicons name="trash-outline" size={15} color="#8E8E93" />
                            </TouchableOpacity>
                          ) : null}
                        </Animated.View>
                      );})}
                    </View>
                  </View>
                ) : (
                  <View
                    style={{
                      marginTop: 27,
                      paddingHorizontal: 22,
                      paddingVertical: 30,
                      alignItems: 'center',
                      borderRadius: 20,
                      backgroundColor: '#111113',
                      borderWidth: 1,
                      borderColor: '#29292B',
                    }}
                  >
                    <View
                      style={{
                        width: 58,
                        height: 58,
                        borderRadius: 29,
                        backgroundColor: '#252126',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="document-text-outline" size={27} color="#FA5265" />
                    </View>
                    <Text style={{ color: 'white', fontSize: 17, fontWeight: '700', marginTop: 15 }}>
                      No lyrics found
                    </Text>
                    <Text style={{ color: '#8E8E93', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7 }}>
                      No embedded lyrics or matching lyric sidecar were found. Paste the song lyrics to prepare them for synchronization.
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 19 }}>
                      <TouchableOpacity
                        onPress={() => setPasteModalVisible(true)}
                        accessibilityRole="button"
                        style={{
                          minHeight: 44,
                          flex: 1,
                          paddingHorizontal: 12,
                          borderRadius: 22,
                          backgroundColor: '#2A2024',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                        }}
                      >
                        <Ionicons name="clipboard-outline" size={17} color="#FA5265" />
                        <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>Paste lyrics</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

              </View>
            ) : null}
          </View>
        </Animated.ScrollView>

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
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 58,
            left: 0,
            right: 0,
            height: 46,
            zIndex: 16,
            elevation: 16,
            transform: [{ translateY: titleOffset }],
          }}
        >
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: '#000000' }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={{ color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800' }}
            >
              LRC Synchronizer
            </Text>
          </View>
        </Animated.View>

        <SongsHeader
          onBack={onBack}
          onToggleSort={() => undefined}
          showSortButton={false}
          showMoreButton={false}
          liquidGlass
        />

        <View
          style={{
            position: 'absolute',
            left: -0.5,
            right: -0.5,
            bottom: -2,
            overflow: 'hidden',
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: persistentPanelBottom,
            borderRadius: 25,
            backgroundColor: 'transparent',
            shadowColor: '#000000',
            shadowOpacity: 0.35,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: -5 },
            zIndex: 30,
            elevation: 30,
          }}
        >
          <GlassSurface
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 25 }}
            fallbackColor="rgba(32,32,36,0.92)"
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 42 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: selectedMp3 ? 'white' : '#8E8E93', fontSize: 14, fontWeight: '700' }}>
                {selectedMp3?.title ?? 'Choose an MP3 to begin'}
              </Text>
              {selectedMp3 ? (
                <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 12, marginTop: 3 }}>
                  {selectedMp3.artist}
                </Text>
              ) : null}
            </View>
            {selectedMp3 ? (
              <TouchableOpacity
                onPress={restartSynchronization}
                accessibilityRole="button"
                accessibilityLabel="Restart synchronization"
                style={{ minWidth: 40, height: 40, marginLeft: 8, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="refresh" size={19} color="#A1A1A6" />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 }}>
            <Text style={{ width: 34, color: '#A1A1A6', fontSize: 11, fontVariant: ['tabular-nums'] }}>
              {formatTime(seekPosition)}
            </Text>
            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Playback position"
              accessibilityValue={{
                min: 0,
                max: Math.round(trackDuration),
                now: Math.round(seekPosition),
                text: `${formatTime(seekPosition)} of ${formatTime(trackDuration)}`,
              }}
              accessibilityActions={[
                { name: 'increment', label: 'Seek forward five seconds' },
                { name: 'decrement', label: 'Seek backward five seconds' },
              ]}
              onAccessibilityAction={(event) => {
                const offset = event.nativeEvent.actionName === 'increment' ? 5 : -5;
                void seekTo(seekPosition + offset);
              }}
              onLayout={(event) => setSeekBarWidth(event.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => Boolean(selectedMp3)}
              onMoveShouldSetResponder={() => Boolean(selectedMp3)}
              onResponderGrant={(event) => {
                if (trackDuration && seekBarWidth > 0) {
                  setSeekPreview(Math.max(0, Math.min(trackDuration, (event.nativeEvent.locationX / seekBarWidth) * trackDuration)));
                }
              }}
              onResponderMove={(event) => {
                if (trackDuration && seekBarWidth > 0) {
                  setSeekPreview(Math.max(0, Math.min(trackDuration, (event.nativeEvent.locationX / seekBarWidth) * trackDuration)));
                }
              }}
              onResponderRelease={(event) => {
                if (trackDuration && seekBarWidth > 0) {
                  void seekTo((event.nativeEvent.locationX / seekBarWidth) * trackDuration);
                }
                setSeekPreview(null);
              }}
              onResponderTerminate={() => setSeekPreview(null)}
              style={{ flex: 1, height: 28, justifyContent: 'center' }}
            >
              <View style={{ height: 4, borderRadius: 2, backgroundColor: '#45454B', overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${Math.min(100, ((seekPosition / (trackDuration || 1)) * 100))}%`,
                    height: 4,
                    backgroundColor: '#FA243C',
                  }}
                />
              </View>
            </View>
            <Text style={{ width: 34, color: '#A1A1A6', fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {formatTime(trackDuration)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 5 }}>
            <TouchableOpacity
              onPress={() => void seekTo(playerStatus.currentTime - 3)}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel="Seek backward three seconds"
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', opacity: selectedMp3 ? 1 : 0.4 }}
            >
              <Ionicons name="play-back" size={20} color="#D1D1D6" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setPlaybackError(null);
                if (playerStatus.playing) player.pause();
                else player.play();
              }}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel={playerStatus.playing ? 'Pause preview' : 'Play preview'}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: '#303034',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: selectedMp3 ? 1 : 0.4,
              }}
            >
              <Ionicons name={playerStatus.playing ? 'pause' : 'play'} size={21} color="white" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void seekTo(playerStatus.currentTime + 3)}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel="Seek forward three seconds"
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', opacity: selectedMp3 ? 1 : 0.4 }}
            >
              <Ionicons name="play-forward" size={20} color="#D1D1D6" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={assignTimestampToSelectedLine}
              disabled={!selectedLineId || !playerStatus.playing}
              accessibilityRole="button"
              accessibilityLabel="Sync next lyric line"
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                marginLeft: 2,
                paddingHorizontal: 4,
                borderRadius: 14,
                backgroundColor: '#FA243C',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                opacity: !selectedLineId || !playerStatus.playing ? 0.48 : 1,
              }}
            >
              <Ionicons name="sync" size={16} color="white" />
              <Text numberOfLines={1} style={{ color: 'white', fontSize: 12, fontWeight: '700', flexShrink: 1 }}>
                {selectedLineId ? 'Sync' : 'Done'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLineEditor({ lineId: null, text: '' })}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel="Add lyric line"
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                paddingHorizontal: 4,
                borderRadius: 14,
                backgroundColor: '#2A2024',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                opacity: selectedMp3 ? 1 : 0.45,
              }}
            >
              <Ionicons name="add" size={15} color="#FA5265" />
              <Text numberOfLines={1} style={{ color: '#FA5265', fontSize: 11, fontWeight: '700', flexShrink: 1 }}>
                Add line
              </Text>
            </TouchableOpacity>
          </View>
          {visiblePlaybackError ? (
            <Text accessibilityRole="alert" numberOfLines={2} style={{ color: '#FA7A89', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 5 }}>
              {visiblePlaybackError}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={showSaveOptions}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Choose how to save synchronized track"
            style={{
              minHeight: 44,
              marginTop: 10,
              borderRadius: 14,
              backgroundColor: '#2A2024',
              borderWidth: 1,
              borderColor: 'rgba(250,36,60,0.5)',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: canSave ? 1 : 0.5,
            }}
          >
            {isSaving
              ? <ActivityIndicator size="small" color="#FA5265" />
              : <Ionicons name="save-outline" size={17} color="#FA5265" />}
            <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>
              {isSaving ? 'Saving to library…' : 'Save to library'}
            </Text>
          </TouchableOpacity>
          {saveError ? (
            <Text accessibilityRole="alert" style={{ color: '#FA7A89', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 6 }}>
              {saveError}
            </Text>
          ) : selectedMp3 && !hasAllTimestamps ? (
            <Text style={{ color: '#A1A1A6', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 6 }}>
              Sync every lyric line to enable saving.
            </Text>
          ) : selectedMp3 && !hasChronologicalTimestamps ? (
            <Text style={{ color: '#A1A1A6', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 6 }}>
              Timestamps must be in order and within the track.
            </Text>
          ) : null}
        </View>
        {pauseToastVisible ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '46%',
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 50,
              elevation: 50,
              opacity: pauseToastOpacity,
            }}
          >
            <View
              style={{
                paddingHorizontal: 18,
                paddingVertical: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
                backgroundColor: 'rgba(48,48,52,0.96)',
                shadowColor: '#000000',
                shadowOpacity: 0.2,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 5 },
              }}
            >
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '600' }}>
                pause the player first
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </View>

      <Modal
        visible={trackPickerVisible}
        transparent
        animationType="none"
        onRequestClose={dismissTrackPicker}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <Animated.View
            {...trackPickerPanResponder.panHandlers}
            accessibilityHint="Swipe down to close the track library"
            style={{
              height: '88%',
              paddingHorizontal: 20,
              paddingTop: 22,
              paddingBottom: Math.max(insets.bottom, 20),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: '#1C1C1E',
              transform: [{ translateY: trackPickerTranslateY }],
            }}
          >
            <View {...trackPickerHeaderPanResponder.panHandlers}>
              <View
                style={{
                  alignSelf: 'center',
                  width: 38,
                  height: 5,
                  marginBottom: 17,
                  borderRadius: 3,
                  backgroundColor: '#636366',
                }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <View>
                  <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>Choose a track</Text>
                  <Text style={{ color: '#8E8E93', fontSize: 12, marginTop: 4 }}>Local MP3s in your library</Text>
                </View>
                <TouchableOpacity
                  onPress={dismissTrackPicker}
                  accessibilityRole="button"
                  accessibilityLabel="Close track library"
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="close" size={21} color="white" />
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={{
                minHeight: 50,
                marginBottom: 12,
                paddingHorizontal: 14,
                borderRadius: 15,
                backgroundColor: '#111113',
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Ionicons name="search" size={19} color="#8E8E93" />
              <TextInput
                value={librarySearch}
                onChangeText={setLibrarySearch}
                placeholder="Search songs, artists, albums"
                placeholderTextColor="#8E8E93"
                accessibilityLabel="Search library tracks"
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                style={{ flex: 1, marginLeft: 10, paddingVertical: 12, color: 'white', fontSize: 15 }}
              />
              {librarySearch.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setLibrarySearch('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear track search"
                  style={{ padding: 5 }}
                >
                  <Ionicons name="close-circle" size={19} color="#8E8E93" />
                </TouchableOpacity>
              ) : null}
            </View>

            {importError ? (
              <Text accessibilityRole="alert" style={{ color: '#FA7A89', fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
                {importError}
              </Text>
            ) : null}

            {isLoadingTracks || apiInitializing ? (
              <View style={{ flex: 1 }}>
                <TrackListSkeleton count={6} />
              </View>
            ) : availableMp3Tracks.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
                <Ionicons name="musical-notes-outline" size={34} color="#FA5265" />
                <Text style={{ color: 'white', fontSize: 16, fontWeight: '700', marginTop: 12 }}>No local MP3 tracks</Text>
                <Text style={{ color: '#8E8E93', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 }}>
                  Add or download an MP3 to your library before synchronizing its lyrics.
                </Text>
              </View>
            ) : filteredMp3Tracks.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#A1A1A6', fontSize: 14 }}>No tracks match “{librarySearch.trim()}”.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredMp3Tracks}
                style={{ flex: 1 }}
                onScroll={(event) => {
                  trackPickerListScrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
                }}
                scrollEventThrottle={16}
                keyExtractor={(track) => track.id}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                ItemSeparatorComponent={() => <View style={{ height: 1, marginLeft: 62, backgroundColor: '#303034' }} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => void chooseLibraryTrack(item)}
                    disabled={isImporting}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${item.title} by ${item.artist}`}
                    style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', opacity: isImporting ? 0.55 : 1 }}
                  >
                    {item.artwork ? (
                      <Image source={{ uri: item.artwork }} style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#303034' }} />
                    ) : (
                      <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#382027', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="musical-note" size={21} color="#FA5265" />
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 13 }}>
                      <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>{item.title}</Text>
                      <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 12, marginTop: 4 }}>
                        {item.artist}{item.album ? ` · ${item.album}` : ''}
                      </Text>
                    </View>
                    {selectedMp3?.uri === item.localUri ? <Ionicons name="checkmark-circle" size={21} color="#FA5265" /> : null}
                    {isImporting ? <ActivityIndicator size="small" color="#FA5265" style={{ marginLeft: 10 }} /> : null}
                  </TouchableOpacity>
                )}
              />
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={lineEditor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLineEditor(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 22,
              paddingBottom: Math.max(insets.bottom, 20),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: '#1C1C1E',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
                {lineEditor?.lineId ? 'Edit lyric line' : 'Add lyric line'}
              </Text>
              <TouchableOpacity
                onPress={() => setLineEditor(null)}
                accessibilityRole="button"
                accessibilityLabel="Close line editor"
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={21} color="white" />
              </TouchableOpacity>
            </View>
            <TextInput
              value={lineEditor?.text ?? ''}
              onChangeText={(text) => setLineEditor((current) => current ? { ...current, text } : current)}
              placeholder="Enter one lyric line"
              placeholderTextColor="#8E8E93"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveEditedLine}
              style={{
                minHeight: 52,
                paddingHorizontal: 15,
                borderRadius: 15,
                backgroundColor: '#111113',
                color: 'white',
                fontSize: 16,
              }}
            />
            <TouchableOpacity
              onPress={saveEditedLine}
              disabled={!lineEditor?.text.trim()}
              accessibilityRole="button"
              style={{
                minHeight: 50,
                marginTop: 16,
                borderRadius: 16,
                backgroundColor: '#FA243C',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: lineEditor?.text.trim() ? 1 : 0.5,
              }}
            >
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                {lineEditor?.lineId ? 'Save line' : 'Add line'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={pasteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPasteModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <View
            style={{
              maxHeight: '85%',
              paddingHorizontal: 20,
              paddingTop: 22,
              paddingBottom: Math.max(insets.bottom, 20),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: '#1C1C1E',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>Paste lyrics</Text>
              <TouchableOpacity
                onPress={() => setPasteModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close paste lyrics"
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={21} color="white" />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput
                value={pastedLyrics}
                onChangeText={setPastedLyrics}
                placeholder="Paste or type the lyrics here"
                placeholderTextColor="#8E8E93"
                multiline
                textAlignVertical="top"
                autoCapitalize="sentences"
                style={{
                  minHeight: 220,
                  maxHeight: 400,
                  padding: 15,
                  borderRadius: 15,
                  backgroundColor: '#111113',
                  color: 'white',
                  fontSize: 16,
                  lineHeight: 23,
                }}
              />
            </ScrollView>
            <TouchableOpacity
              onPress={applyPastedLyrics}
              disabled={!pastedLyrics.trim()}
              accessibilityRole="button"
              style={{
                minHeight: 50,
                marginTop: 16,
                borderRadius: 16,
                backgroundColor: '#FA243C',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pastedLyrics.trim() ? 1 : 0.5,
              }}
            >
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Use these lyrics</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};
