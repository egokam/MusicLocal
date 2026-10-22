import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Directory, File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { parseBuffer } from 'music-metadata';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../../glass';
import { SongsHeader } from '../components/songs/SongsHeader';
import { Id3SynchronizedLyricsService } from '../services/Id3SynchronizedLyricsService';

type ImportedMp3 = {
  uri: string;
  fileName: string;
  title: string;
  artist: string;
  lyrics: string | null;
  lyricsSource: 'embedded' | 'pasted';
  duration: number;
};

type TimedLyricLine = {
  id: string;
  text: string;
  timeMs: number | null;
};

const getUnsynchronizedLyrics = (metadata: Awaited<ReturnType<typeof parseBuffer>>) => {
  const lyrics = Object.values(metadata.native).flatMap((frames) => frames
    .filter((frame) => frame.id === 'USLT')
    .map((frame) => {
      if (typeof frame.value !== 'object' || frame.value === null || !('text' in frame.value)) return '';
      return typeof frame.value.text === 'string' ? frame.value.text.trim() : '';
    })
    .filter(Boolean));
  return lyrics.length > 0 ? lyrics.join('\n\n') : null;
};

const splitLyricText = (lyrics: string) => lyrics
  .replace(/^\uFEFF/, '')
  .split(/\r\n|[\n\r\u0085\u2028\u2029]/);

const parseLyrics = (lyrics: string): TimedLyricLine[] => splitLyricText(lyrics)
  .map((text, index) => ({ id: `${index}-${text}`, text, timeMs: null }));

const formatFileTitle = (fileName: string) => fileName.replace(/\.mp3$/i, '').replace(/[-_]+/g, ' ').trim() || 'Untitled track';

export const LrcSynchronizerScreen = ({ onBack }: { onBack: () => void }) => {
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const playerStatus = useAudioPlayerStatus(player);
  const insets = useSafeAreaInsets();
  const playerStatusRef = useRef(playerStatus);
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const [selectedMp3, setSelectedMp3] = useState<ImportedMp3 | null>(null);
  const [lyricLines, setLyricLines] = useState<TimedLyricLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [seekBarWidth, setSeekBarWidth] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pasteModalVisible, setPasteModalVisible] = useState(false);
  const [pastedLyrics, setPastedLyrics] = useState('');
  const [lineEditor, setLineEditor] = useState<{ lineId: string | null; text: string } | null>(null);
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
    playerStatusRef.current = playerStatus;
  }, [playerStatus]);

  const loadLyrics = useCallback((lyrics: string | null) => {
    const lines = lyrics === null ? [] : parseLyrics(lyrics);
    setLyricLines(lines);
    setSelectedLineId(lines.find((line) => line.text.trim())?.id ?? null);
  }, []);

  const chooseMp3 = async () => {
    setImportError(null);
    setIsImporting(true);
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/mp3'],
        copyToCacheDirectory: true,
      });
      if (selection.canceled) return;

      const asset = selection.assets[0];
      if (!asset) throw new Error('No MP3 file was selected.');
      if (!asset.name.toLocaleLowerCase().endsWith('.mp3')) {
        throw new Error('Choose an MP3 file to continue.');
      }
      const file = new File(asset.uri);
      if (!file.exists || (file.size ?? 0) === 0) {
        throw new Error('The selected MP3 is empty or no longer available.');
      }

      const metadata = await parseBuffer(await file.bytes(), 'audio/mpeg');
      const embeddedLyrics = getUnsynchronizedLyrics(metadata);
      const imported: ImportedMp3 = {
        uri: asset.uri,
        fileName: asset.name,
        title: metadata.common.title?.trim() || formatFileTitle(asset.name),
        artist: metadata.common.artist?.trim() || metadata.common.albumartist?.trim() || 'Unknown artist',
        lyrics: embeddedLyrics,
        lyricsSource: 'embedded',
        duration: metadata.format.duration ?? 0,
      };
      player.pause();
      player.replace({ uri: imported.uri });
      await player.seekTo(0);
      setSelectedMp3(imported);
      loadLyrics(embeddedLyrics);
      setPlaybackError(null);
      setExportError(null);
      setPastedLyrics('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read the selected MP3.');
    } finally {
      setIsImporting(false);
    }
  };

  const applyPastedLyrics = () => {
    if (!selectedMp3 || !pastedLyrics.trim()) return;
    setSelectedMp3({ ...selectedMp3, lyrics: pastedLyrics, lyricsSource: 'pasted' });
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

  const assignTimestampToSelectedLine = useCallback(() => {
    if (!playerStatus.playing) {
      setPlaybackError('Start playback before assigning a timestamp.');
      return;
    }
    if (!selectedLineId) return;

    const timestampMs = Math.max(0, Math.round(playerStatusRef.current.currentTime * 1000));
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
  }, [lyricLines, playerStatus.playing, selectedLineId]);

  const retimeLine = useCallback((line: TimedLyricLine) => {
    setSelectedLineId(line.id);
    if (!playerStatusRef.current.playing) {
      setPlaybackError('Play the track, then tap a lyric line to set its timestamp.');
      return;
    }
    const timestampMs = Math.max(0, Math.round(playerStatusRef.current.currentTime * 1000));
    setLyricLines((currentLines) => currentLines.map((currentLine) => (
      currentLine.id === line.id ? { ...currentLine, timeMs: timestampMs } : currentLine
    )));
    setPlaybackError(null);
  }, []);

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
  const playingLineId = lyricLines.reduce<string | null>((currentId, line) => (
    line.text.trim() && line.timeMs !== null && line.timeMs <= playerStatus.currentTime * 1000
      ? line.id
      : currentId
  ), null);

  useEffect(() => {
    if (playerStatus.error) setPlaybackError(playerStatus.error);
  }, [playerStatus.error]);

  const saveSynchronizedMp3 = async () => {
    if (!selectedMp3 || !canSave) return;
    setIsSaving(true);
    setExportError(null);
    try {
      if (Platform.OS === 'web') {
        throw new Error('Saving synchronized MP3 files is available on iOS and Android.');
      }
      const entries = exportableLines.filter((line): line is NonNullable<typeof line> => line !== null);
      const verifiedMp3 = await Id3SynchronizedLyricsService.createVerifiedMp3(
        selectedMp3.uri,
        selectedMp3.fileName,
        entries,
        trackDuration * 1000,
      );
      const destinationDirectory = await Directory.pickDirectoryAsync();
      const savedMp3 = await Id3SynchronizedLyricsService.copyToDirectory(
        verifiedMp3,
        destinationDirectory,
        selectedMp3.fileName,
        entries,
      );
      Alert.alert('MP3 saved', `${savedMp3.name} was saved. Your original MP3 was not changed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(message)) setExportError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.ScrollView
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 58, paddingBottom: 380 + persistentPanelBottom }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 74 }}>
            <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginBottom: 22 }}>
              Select an MP3 to view its embedded unsynchronized lyrics.
            </Text>

            <TouchableOpacity
              onPress={() => void chooseMp3()}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel={selectedMp3 ? 'Choose another MP3 file' : 'Choose an MP3 file'}
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
                <Ionicons name="folder-open-outline" size={21} color="white" />
              )}
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                {isImporting ? 'Reading MP3…' : selectedMp3 ? 'Choose another MP3' : 'Choose MP3 file'}
              </Text>
            </TouchableOpacity>

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
                          {selectedMp3.lyricsSource === 'embedded' ? 'From MP3 · ' : 'Pasted · '}
                          {lyricLines.filter((line) => line.text.trim()).length} lines
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setLineEditor({ lineId: null, text: '' })}
                        accessibilityRole="button"
                        accessibilityLabel="Add lyric line"
                        style={{
                          minHeight: 38,
                          paddingHorizontal: 12,
                          borderRadius: 19,
                          backgroundColor: '#2A2024',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <Ionicons name="add" size={18} color="#FA5265" />
                        <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700' }}>Add line</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: '#111113' }}>
                      {lyricLines.map((line, index) => (
                        <View
                          key={`${index}-${line}`}
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
                        </View>
                      ))}
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
                      No embedded lyrics found
                    </Text>
                    <Text style={{ color: '#8E8E93', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7 }}>
                      Paste the song lyrics to prepare them for synchronization.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 9, marginTop: 19 }}>
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
                      <TouchableOpacity
                        onPress={() => setLineEditor({ lineId: null, text: '' })}
                        accessibilityRole="button"
                        accessibilityLabel="Add first lyric line"
                        style={{
                          minHeight: 44,
                          flex: 1,
                          paddingHorizontal: 12,
                          borderRadius: 22,
                          backgroundColor: '#2A2024',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <Ionicons name="add" size={18} color="#FA5265" />
                        <Text style={{ color: '#FA5265', fontSize: 14, fontWeight: '700' }}>Add line</Text>
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
            left: -0.6,
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

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
            <TouchableOpacity
              onPress={() => void seekTo(playerStatus.currentTime - 10)}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel="Seek backward ten seconds"
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
              onPress={() => void seekTo(playerStatus.currentTime + 10)}
              disabled={!selectedMp3}
              accessibilityRole="button"
              accessibilityLabel="Seek forward ten seconds"
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
                minHeight: 44,
                marginLeft: 2,
                borderRadius: 14,
                backgroundColor: '#FA243C',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                opacity: !selectedLineId || !playerStatus.playing ? 0.48 : 1,
              }}
            >
              <Ionicons name="sync" size={17} color="white" />
              <Text numberOfLines={1} style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>
                {selectedLineId ? 'Sync Next Line' : 'All lines synced'}
              </Text>
            </TouchableOpacity>
          </View>
          {playbackError ? (
            <Text accessibilityRole="alert" numberOfLines={2} style={{ color: '#FA7A89', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 5 }}>
              {playbackError}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={() => void saveSynchronizedMp3()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save synchronized MP3"
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
              {isSaving ? 'Preparing MP3…' : 'Save synchronized MP3'}
            </Text>
          </TouchableOpacity>
          {exportError ? (
            <Text accessibilityRole="alert" style={{ color: '#FA7A89', fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 6 }}>
              {exportError}
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
      </View>

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
