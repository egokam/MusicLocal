import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Track } from '../types';
import type { ImportProgress } from '../services/MusicCatalogService';
import { MusicCatalogService } from '../services/MusicCatalogService';
import { YouTubeDownloaderService, type YouTubeVideoMatch } from '../native/YouTubeDownloader';

/* eslint-disable react-hooks/immutability */

type DownloaderScreenProps = {
  onBack: () => void;
  onImportAudioToLibrary: (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
    artworkUrl?: string,
  ) => Promise<Track>;
  onImportLocalAudioFile: (
    uri: string,
    title: string,
    artist: string,
    sourceUrl?: string,
    artworkUrl?: string,
  ) => Promise<Track>;
};

type DownloaderMode = 'track' | 'custom';

const inputStyle = {
  minHeight: 54,
  borderRadius: 17,
  paddingHorizontal: 16,
  paddingVertical: 13,
  backgroundColor: '#1C1C1E',
  color: 'white',
  fontSize: 16,
  borderWidth: 1,
  borderColor: '#2B2B30',
} as const;

const supportedAudioExtension = (url: URL) => /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(url.pathname);

const youtubeVideoId = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    let id = '';
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
      else id = url.pathname.split('/').filter(Boolean)[1] ?? '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
};

const isSoundCloudLink = (value: string) => {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
};

const formatVideoDuration = (video: YouTubeVideoMatch) => video.durationText || 'YouTube result';

export const DownloaderScreen = ({
  onBack,
  onImportAudioToLibrary,
  onImportLocalAudioFile,
}: DownloaderScreenProps) => {
  const [mode, setMode] = useState<DownloaderMode>('track');
  const [tabsWidth, setTabsWidth] = useState(0);
  const [trackLink, setTrackLink] = useState('');
  const [customLink, setCustomLink] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [artworkUrl, setArtworkUrl] = useState('');
  const [matches, setMatches] = useState<YouTubeVideoMatch[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const tabPosition = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const bubbleScale = useSharedValue(1);
  const tabWidth = Math.max((tabsWidth - 8) / 2, 1);

  const highlightStyle = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [
      { translateX: tabPosition.value * tabWidth },
      { scaleX: bubbleScale.value },
    ],
  }), [tabWidth]);

  const tabPan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onStart(() => {
      dragOrigin.value = tabPosition.value;
      bubbleScale.value = withSpring(1.06, { damping: 14, stiffness: 220 });
    })
    .onUpdate((event) => {
      const nextPosition = dragOrigin.value + event.translationX / tabWidth;
      tabPosition.value = Math.min(1, Math.max(0, nextPosition));
      bubbleScale.value = Math.min(1.12, 1 + Math.abs(event.velocityX) / 9000);
    })
    .onEnd((event) => {
      const nextMode = tabPosition.value >= 0.5 ? 'custom' : 'track';
      const nextPosition = nextMode === 'custom' ? 1 : 0;
      tabPosition.value = withSpring(nextPosition, {
        damping: 15,
        stiffness: 190,
        mass: 0.7,
        velocity: event.velocityX / tabWidth,
      });
      bubbleScale.value = withSpring(1, { damping: 12, stiffness: 220 });
      scheduleOnRN(setMode, nextMode);
    });

  const selectTab = (nextMode: DownloaderMode) => {
    setMode(nextMode);
    tabPosition.value = withSpring(nextMode === 'custom' ? 1 : 0, {
      damping: 15,
      stiffness: 190,
      mass: 0.7,
    });
    bubbleScale.value = withSpring(1.04, { damping: 10, stiffness: 220 }, () => {
      bubbleScale.value = withSpring(1, { damping: 12, stiffness: 220 });
    });
    setError('');
    setMessage('');
  };

  const downloadYouTubeResult = async (
    video: YouTubeVideoMatch,
    sourceUrl: string,
    sourceTitle: string,
    sourceArtist: string,
    sourceArtwork: string,
  ) => {
    const downloadTitle = sourceTitle.trim() || video.title;
    const downloadArtist = sourceArtist.trim() || video.artist;
    let cover = sourceArtwork || video.thumbnailURL;
    let temporaryUri = '';
    setBusy(video.videoId);
    setError('');
    setMessage('Preparing the M4A audio and embedding its track details…');
    try {
      const downloadedAudio = await YouTubeDownloaderService.downloadAudio(
        video.videoId,
        sourceTitle.trim(),
        sourceArtist.trim(),
        cover,
      );
      temporaryUri = downloadedAudio.uri;
      const savedTitle = downloadTitle || downloadedAudio.title;
      const savedArtist = downloadArtist || downloadedAudio.artist;
      cover = cover || downloadedAudio.artworkURL;
      await onImportLocalAudioFile(
        temporaryUri,
        savedTitle,
        savedArtist,
        sourceUrl || `https://www.youtube.com/watch?v=${video.videoId}`,
        cover,
      );
      setMessage(`“${savedTitle}” was added to your library.`);
      Alert.alert('Saved to library', `${savedTitle} is ready to play offline.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this YouTube result.');
      setMessage('');
    } finally {
      if (temporaryUri) {
        try {
          YouTubeDownloaderService.deleteTemporaryAudio(temporaryUri);
        } catch {
          // The app-owned temporary file is cleaned on the next import if removal fails.
        }
      }
      setBusy('');
    }
  };

  const searchTrack = async () => {
    if (!trackLink.trim()) {
      setError('Paste a Spotify or SoundCloud track link first.');
      return;
    }
    setBusy('search');
    setError('');
    setMessage('Reading track details…');
    setMatches([]);
    try {
      const metadata = await MusicCatalogService.resolveMediaLink(trackLink);
      setTitle(metadata.title);
      setArtist(metadata.artist);
      setArtworkUrl(metadata.artwork);
      setMessage(`Searching YouTube for “${metadata.title}”…`);
      const results = await YouTubeDownloaderService.searchVideos(
        [metadata.title, metadata.artist].filter(Boolean).join(' '),
      );
      if (results.length === 0) {
        selectTab('custom');
        setMessage('No YouTube match was found. You can enter a YouTube video link or a direct audio-file link in Custom.');
        return;
      }
      setMatches(results);
      setMessage('Choose the matching YouTube result to save it to your library.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not find this track.');
      setMessage('');
    } finally {
      setBusy('');
    }
  };

  const saveCustomAudio = async () => {
    const source = customLink.trim();
    if (!source) {
      setError('Paste a YouTube video link or a direct audio-file link.');
      return;
    }
    setError('');
    setMessage('');

    const videoId = youtubeVideoId(source);
    if (videoId) {
      await downloadYouTubeResult(
        {
          videoId,
          title: title.trim(),
          artist: artist.trim(),
          thumbnailURL: '',
          durationText: '',
        },
        source,
        title,
        artist,
        artworkUrl,
      );
      return;
    }

    if (isSoundCloudLink(source)) {
      setError('SoundCloud audio links are not supported. Paste a YouTube video link or a direct audio-file URL instead.');
      return;
    }

    let audioUrl: URL;
    try {
      audioUrl = new URL(source);
    } catch {
      setError('Paste a valid HTTPS YouTube or direct audio-file link.');
      return;
    }
    if (audioUrl.protocol !== 'https:' || !supportedAudioExtension(audioUrl)) {
      setError('Use a secure direct link ending in MP3, M4A, AAC, WAV, FLAC, OGG, or OPUS.');
      return;
    }

    setBusy('direct');
    setMessage('Saving audio to your library…');
    try {
      const savedTitle = title.trim() || decodeURIComponent(audioUrl.pathname.split('/').at(-1) ?? 'Imported audio')
        .replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '')
        .replace(/[-_]+/g, ' ');
      const imported = await onImportAudioToLibrary(
        source,
        savedTitle,
        artist.trim() || 'Unknown artist',
        source,
        (progress) => setMessage(progress.message),
        artworkUrl,
      );
      setMessage(`“${imported.title}” was added to your library.`);
      Alert.alert('Saved to library', `${imported.title} is ready to play offline.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this audio file.');
      setMessage('');
    } finally {
      setBusy('');
    }
  };

  const renderTextInput = (
    value: string,
    onChangeText: (text: string) => void,
    placeholder: string,
    autoCapitalize: 'none' | 'sentences' = 'sentences',
  ) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#77777D"
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      selectionColor="#FA5265"
      style={inputStyle}
    />
  );

  const actionButton = (label: string, onPress: () => void, loading: boolean, disabled = false) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading || Boolean(busy)}
      accessibilityRole="button"
      style={{ minHeight: 54, borderRadius: 17, backgroundColor: '#F62442', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', opacity: disabled || loading || Boolean(busy) ? 0.55 : 1 }}
    >
      {loading ? <ActivityIndicator color="white" /> : <Ionicons name="arrow-down-circle-outline" size={21} color="white" />}
      <Text style={{ color: 'white', fontSize: 16, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <View style={{ position: 'absolute', zIndex: 5, top: 10, left: 16, right: 16, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Library"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Alert.alert('Downloader', 'Track links are used to find the song on YouTube. Custom accepts YouTube video links or direct audio files. SoundCloud audio extraction is not supported.')}
            accessibilityRole="button"
            accessibilityLabel="About downloader"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="information-circle-outline" size={23} color="#A1A1A6" />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 68, paddingBottom: 42, gap: 14 }}
          >
            <Text style={{ color: 'white', fontSize: 37, lineHeight: 44, fontWeight: '800' }}>Downloader</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginTop: -10 }}>
              Find a track on YouTube or save a direct audio file to your library.
            </Text>

            <GestureDetector gesture={tabPan}>
              <View
                onLayout={(event) => setTabsWidth(event.nativeEvent.layout.width)}
                style={{ height: 48, marginTop: 8, padding: 4, borderRadius: 25, backgroundColor: '#1C1C1E', flexDirection: 'row', overflow: 'hidden' }}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[{ position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 22, backgroundColor: '#39393D' }, highlightStyle]}
                />
                {(['track', 'custom'] as const).map((item) => {
                  const selected = mode === item;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => selectTab(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{ flex: 1, borderRadius: 22, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                    >
                      <Ionicons name={item === 'track' ? 'musical-note' : 'link'} size={17} color={selected ? '#FA5265' : '#A1A1A6'} />
                      <Text style={{ color: selected ? 'white' : '#A1A1A6', fontSize: 14, fontWeight: '700' }}>
                        {item === 'track' ? 'Track' : 'Custom'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </GestureDetector>

            {Platform.OS !== 'ios' && (
              <View style={{ borderRadius: 15, padding: 13, backgroundColor: '#211C1D' }}>
                <Text style={{ color: '#F3A0A8', fontSize: 13, lineHeight: 19 }}>
                  YouTubeKit search and download require an iOS app build. Direct audio-file links can still be saved here.
                </Text>
              </View>
            )}

            {mode === 'track' ? (
              <View style={{ gap: 12 }}>
                <Text style={{ color: '#A1A1A6', fontSize: 14, lineHeight: 19 }}>
                  Paste a Spotify or SoundCloud track link. The link only identifies the song; the audio result comes from YouTube.
                </Text>
                {renderTextInput(trackLink, setTrackLink, 'Spotify or SoundCloud track link', 'none')}
                {actionButton('Find on YouTube', searchTrack, busy === 'search')}

                {title ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderRadius: 17, backgroundColor: '#1C1C1E' }}>
                    {artworkUrl ? (
                      <Image source={{ uri: artworkUrl }} style={{ width: 58, height: 58, borderRadius: 11, backgroundColor: '#2A2A2E' }} />
                    ) : (
                      <View style={{ width: 58, height: 58, borderRadius: 11, backgroundColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="musical-note" size={24} color="#FA5265" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>{title}</Text>
                      <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 14, marginTop: 4 }}>{artist || 'Artist not supplied'}</Text>
                    </View>
                  </View>
                ) : null}

                {matches.map((video) => (
                  <TouchableOpacity
                    key={video.videoId}
                    onPress={() => void downloadYouTubeResult(video, trackLink.trim(), title, artist || video.artist, artworkUrl || video.thumbnailURL)}
                    disabled={Boolean(busy)}
                    accessibilityRole="button"
                    accessibilityLabel={`Save ${title || video.title} by ${artist || video.artist}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, borderRadius: 17, backgroundColor: '#1C1C1E', opacity: busy && busy !== video.videoId ? 0.55 : 1 }}
                  >
                    {video.thumbnailURL ? (
                      <Image source={{ uri: video.thumbnailURL }} style={{ width: 70, height: 62, borderRadius: 10, backgroundColor: '#2A2A2E' }} />
                    ) : (
                      <View style={{ width: 70, height: 62, borderRadius: 10, backgroundColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="musical-note" size={24} color="#FA5265" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={2} style={{ color: 'white', fontSize: 14, lineHeight: 19, fontWeight: '700' }}>{video.title}</Text>
                      <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 12, marginTop: 3 }}>
                        {[video.artist, formatVideoDuration(video)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {busy === video.videoId ? <ActivityIndicator color="#FA5265" /> : <Ionicons name="arrow-down-circle" size={25} color="#FA5265" />}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <Text style={{ color: '#A1A1A6', fontSize: 14, lineHeight: 19 }}>
                  Add track details, then paste a YouTube video link or a direct audio-file URL. SoundCloud audio links are not extracted.
                </Text>
                {renderTextInput(title, setTitle, 'Track name')}
                {renderTextInput(artist, setArtist, 'Artist')}
                {renderTextInput(artworkUrl, setArtworkUrl, 'Artwork image URL (optional)', 'none')}
                {renderTextInput(customLink, setCustomLink, 'YouTube video or direct audio URL', 'none')}
                {actionButton('Save to library', saveCustomAudio, busy === 'direct' || Boolean(busy && busy !== 'search'))}
              </View>
            )}

            {Boolean(error) && (
              <Text accessibilityRole="alert" style={{ color: '#FF7280', fontSize: 14, lineHeight: 20, paddingHorizontal: 2 }}>{error}</Text>
            )}
            {Boolean(message) && !error && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                {Boolean(busy) && <ActivityIndicator size="small" color="#FA5265" />}
                <Text style={{ flex: 1, color: '#A1A1A6', fontSize: 13, lineHeight: 19 }}>{message}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
};
