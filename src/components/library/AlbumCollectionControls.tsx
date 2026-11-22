import { ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedIcon as ThemedIonicons, ThemedTouchableOpacity as TouchableOpacity } from '../../contexts/AppearanceThemeContext';

export const AlbumCollectionControls = ({
  search,
  onSearchChange,
  onPlay,
  onShuffle,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onPlay: () => void;
  onShuffle: () => void;
}) => (
  <View style={{ paddingHorizontal: 20, paddingBottom: 3 }}>
    <Text style={{ color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800' }}>Albums</Text>
    <View
      style={{
        height: 44,
        marginTop: 4,
        paddingHorizontal: 14,
        borderRadius: 24,
        backgroundColor: '#1C1C1E',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <ThemedIonicons name="search" size={22} color="white" />
      <TextInput
        value={search}
        onChangeText={onSearchChange}
        placeholder="Search"
        placeholderTextColor="#8E8E93"
        returnKeyType="search"
        autoCorrect={false}
        underlineColorAndroid="transparent"
        accessibilityLabel="Search albums and artists"
        style={{ flex: 1, height: '100%', marginLeft: 10, padding: 0, color: 'white', fontSize: 18 }}
      />
      <ThemedIonicons name="mic" size={22} color="white" />
    </View>

    <View style={{ flexDirection: 'row', gap: 14, marginTop: 24 }}>
      <TouchableOpacity
        onPress={onPlay}
        accessibilityRole="button"
        accessibilityLabel="Play albums"
        style={{ flex: 1, height: 46, borderRadius: 24, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
      >
        <ThemedIonicons name="play" size={20} color="#FA243C" />
        <Text style={{ color: '#FA243C', fontSize: 17, fontWeight: '700' }}>Play</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onShuffle}
        accessibilityRole="button"
        accessibilityLabel="Shuffle albums"
        style={{ flex: 1, height: 46, borderRadius: 24, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
      >
        <ThemedIonicons name="shuffle" size={22} color="#FA243C" />
        <Text style={{ color: '#FA243C', fontSize: 17, fontWeight: '700' }}>Shuffle</Text>
      </TouchableOpacity>
    </View>
  </View>
);
