import { useRef } from 'react';
import { Image, Platform } from 'react-native';
import { Button as NativeMenuButton, ContextMenu as NativeContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import { ThemedText as Text, ThemedView as View, ThemedIcon as ThemedIonicons, ThemedTouchableOpacity as TouchableOpacity, useAppearanceTheme } from '../../contexts/AppearanceThemeContext';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';

export const AlbumGridItem = ({
  title,
  artist,
  artwork,
  onPress,
  onPlay,
  onShuffle,
}: {
  title: string;
  artist: string;
  artwork: string;
  onPress: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => {
  const { isDark, colors } = useAppearanceTheme();
  const pressStartedAt = useRef(0);

  const cardContents = (
    <>
      <View style={{ width: '100%', aspectRatio: 1, borderRadius: 15, overflow: 'hidden', backgroundColor: '#202024' }}>
        {artwork ? (
          <Image source={{ uri: artwork, headers: getMusicApiHeaders() }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#29292E' }}>
            <ThemedIonicons name="albums" size={42} color="#77777D" />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '600', marginTop: 9 }}>
        {title}
      </Text>
      <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 14, fontWeight: '500', marginTop: 3 }}>
        {artist}
      </Text>
    </>
  );

  const card = (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title} by ${artist}`} style={{ flex: 1, minWidth: 0 }}>
      {cardContents}
    </TouchableOpacity>
  );

  if (Platform.OS !== 'ios') return card;

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: '100%' }}
      >
        {cardContents}
      </View>
      <Host style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} colorScheme={isDark ? 'dark' : 'light'}>
        <NativeContextMenu>
          <NativeContextMenu.Items>
            <NativeMenuButton label="Open Album" systemImage="square.stack" onPress={onPress} />
            <NativeMenuButton label="Play Album" systemImage="play.fill" onPress={onPlay} />
            <NativeMenuButton label="Shuffle Album" systemImage="shuffle" onPress={onShuffle} />
          </NativeContextMenu.Items>
          <NativeContextMenu.Trigger>
            <RNHostView>
              <TouchableOpacity
                onPressIn={() => { pressStartedAt.current = Date.now(); }}
                onPress={() => {
                  if (Date.now() - pressStartedAt.current >= 450) return;
                  onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${title} by ${artist}`}
                accessibilityHint="Open album. Long press for album actions."
                style={{ flex: 1, minWidth: 0 }}
              >
                <View style={{ flex: 1, backgroundColor: 'transparent' }} />
              </TouchableOpacity>
            </RNHostView>
          </NativeContextMenu.Trigger>
          <NativeContextMenu.Preview>
            <RNHostView matchContents>
              <View style={{ width: 230, padding: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }}>
                {artwork ? (
                  <Image
                    source={{ uri: artwork, headers: getMusicApiHeaders() }}
                    resizeMode="cover"
                    style={{ width: 210, height: 210, borderRadius: 12, backgroundColor: colors.raisedSurface }}
                  />
                ) : (
                  <View style={{ width: 210, height: 210, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raisedSurface }}>
                    <ThemedIonicons name="albums" size={44} color={colors.secondaryText} />
                  </View>
                )}
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 10 }}>{title}</Text>
                <Text numberOfLines={1} style={{ color: colors.secondaryText, fontSize: 14, marginTop: 3 }}>{artist}</Text>
              </View>
            </RNHostView>
          </NativeContextMenu.Preview>
        </NativeContextMenu>
      </Host>
    </View>
  );
};
