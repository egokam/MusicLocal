import { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PlaylistSummary, Track } from '../types';
import type { ImportProgress, TrackEditChanges } from '../services/MusicCatalogService';

/* eslint-disable react-hooks/immutability */

type DownloaderScreenProps = {
  onBack: () => void;
  onConnectLibrary: () => void;
  onSelectTrack: (track: Track, queue?: Track[]) => void;
  tracks: Track[];
  apiConnected: boolean;
  isLoadingTracks: boolean;
  loadError: string | null;
  downloadedTrackIds: string[];
  downloadingTrackIds: string[];
  onSearch: (query?: string) => Promise<void>;
  onDownload: (track: Track) => Promise<Track>;
  onImportAudioToLibrary: (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
  ) => Promise<Track>;
  onImportLocalFile: () => Promise<Track | null>;
  playlists: PlaylistSummary[];
  hasActiveTrack: boolean;
  onPlayNext: (track: Track) => void;
  onToggleFavorite: (track: Track) => Promise<Track>;
  onAddToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<PlaylistSummary>;
  onSaveTrack: (track: Track, changes: TrackEditChanges) => Promise<void>;
  onDeleteTrack: (track: Track) => Promise<void>;
};

export const DownloaderScreen = ({ onBack }: DownloaderScreenProps) => {
  const [mode, setMode] = useState<'track' | 'custom'>('track');
  const [tabsWidth, setTabsWidth] = useState(0);
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

  const selectTab = (nextMode: 'track' | 'custom') => {
    setMode(nextMode);
    tabPosition.value = withSpring(nextMode === 'custom' ? 1 : 0, {
      damping: 15,
      stiffness: 190,
      mass: 0.7,
    });
    bubbleScale.value = withSpring(1.04, { damping: 10, stiffness: 220 }, () => {
      bubbleScale.value = withSpring(1, { damping: 12, stiffness: 220 });
    });
  };

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
            onPress={() => Alert.alert('About Downloader', 'Downloader tools will be built here.')}
            accessibilityRole="button"
            accessibilityLabel="About downloader"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-horizontal" size={23} color="white" />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 68 }}>
          <Text style={{ color: 'white', fontSize: 37, lineHeight: 44, fontWeight: '800' }}>Downloader</Text>
          <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginTop: 5 }}>
            Find a track or save audio to your library.
          </Text>

          <GestureDetector gesture={tabPan}>
            <View
              onLayout={(event) => setTabsWidth(event.nativeEvent.layout.width)}
              style={{ height: 48, marginTop: 25, padding: 4, borderRadius: 25, backgroundColor: '#1C1C1E', flexDirection: 'row', overflow: 'hidden' }}
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
        </View>
      </View>
    </SafeAreaView>
  );
};
