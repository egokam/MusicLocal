import { Image } from 'react-native';
import { ThemedText as Text, ThemedView as View, ThemedIcon as ThemedIonicons, ThemedTouchableOpacity as TouchableOpacity } from '../../contexts/AppearanceThemeContext';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';

export const AlbumGridItem = ({
  title,
  artist,
  artwork,
  onPress,
}: {
  title: string;
  artist: string;
  artwork: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${title} by ${artist}`}
    style={{ flex: 1, minWidth: 0 }}
  >
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
  </TouchableOpacity>
);
