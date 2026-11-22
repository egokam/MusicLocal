import { Image } from 'react-native';
import { ThemedText as Text, ThemedView as View, ThemedIcon as ThemedIonicons, ThemedTouchableOpacity as TouchableOpacity } from '../../contexts/AppearanceThemeContext';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';

export const ArtistListItem = ({
  name,
  artwork,
  isLast,
  onPress,
}: {
  name: string;
  artwork: string;
  isLast: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Browse songs by ${name}`}
    style={{ minHeight: 84, paddingLeft: 20, flexDirection: 'row', alignItems: 'center' }}
  >
    <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', backgroundColor: '#29292E', alignItems: 'center', justifyContent: 'center' }}>
      {artwork ? (
        <Image source={{ uri: artwork, headers: getMusicApiHeaders() }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      ) : (
        <ThemedIonicons name="mic" size={25} color="#77777D" />
      )}
    </View>
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height: 84,
        marginLeft: 14,
        paddingRight: 20,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2C2C2E',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: 'white', fontSize: 18, fontWeight: '500' }}>
        {name}
      </Text>
      <ThemedIonicons name="chevron-forward" size={21} color="#3A3A3C" />
    </View>
  </TouchableOpacity>
);
