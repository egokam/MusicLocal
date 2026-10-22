import { useContext } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { LibrarySelectionBarContext } from '../../contexts/PlaybackContext';

export const SongsControls = ({
  search,
  onSearchChange,
  onPlay,
  onShuffle,
  selectionMode = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onPlay: () => void;
  onShuffle: () => void;
  selectionMode?: boolean;
}) => {
  const actionsProgress = useContext(LibrarySelectionBarContext)!.transitionProgress;

  const actionsStyle = useAnimatedStyle(() => ({
    height: interpolate(actionsProgress.value, [0, 1], [70, 0], Extrapolation.CLAMP),
    opacity: 1 - actionsProgress.value,
    transform: [
      { translateY: interpolate(actionsProgress.value, [0, 1], [0, 8], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
      <View style={{ height: 46 }} />

    <View
      style={{
        height: 44,
        marginTop: 14,
        paddingHorizontal: 14,
        borderRadius: 24,
        backgroundColor: '#1C1C1E',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Ionicons name="search" size={22} color="white" />
      <TextInput
        value={search}
        onChangeText={onSearchChange}
        placeholder="Search"
        placeholderTextColor="#8E8E93"
        returnKeyType="search"
        autoCorrect={false}
        underlineColorAndroid="transparent"
        style={{
          flex: 1,
          height: '100%',
          marginLeft: 10,
          padding: 0,
          color: 'white',
          fontSize: 18,
        }}
      />
      <Ionicons name="mic" size={22} color="white" />
    </View>

      <Animated.View style={[{ overflow: 'hidden' }, actionsStyle]}>
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 24 }}>
      <TouchableOpacity
        onPress={onPlay}
        disabled={selectionMode}
        accessibilityRole="button"
        accessibilityLabel="Play all songs"
        style={{
          flex: 1,
          height: 46,
          borderRadius: 24,
          backgroundColor: '#1C1C1E',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
        }}
      >
        <Ionicons name="play" size={20} color="#FA243C" />
        <Text style={{ color: '#FA243C', fontSize: 17, fontWeight: '700' }}>Play</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onShuffle}
        disabled={selectionMode}
        accessibilityRole="button"
        accessibilityLabel="Shuffle songs"
        style={{
          flex: 1,
          height: 46,
          borderRadius: 24,
          backgroundColor: '#1C1C1E',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
        }}
      >
        <Ionicons name="shuffle" size={22} color="#FA243C" />
        <Text style={{ color: '#FA243C', fontSize: 17, fontWeight: '700' }}>Shuffle</Text>
      </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};
