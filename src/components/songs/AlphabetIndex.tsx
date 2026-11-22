import { ThemedText as Text, ThemedView as View, ThemedTouchableOpacity as TouchableOpacity } from '../../contexts/AppearanceThemeContext';

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

export const AlphabetIndex = ({
  onSelectLetter,
}: {
  onSelectLetter: (letter: string) => void;
}) => (
  <View
    pointerEvents="box-none"
    style={{
      position: 'absolute',
      top: '32.4%',
      bottom: '23%',
      right: 1,
      width: 18,
      justifyContent: 'space-between',
      alignItems: 'center',
    }}
  >
    {letters.map((letter) => (
      <TouchableOpacity
        key={letter}
        onPress={() => onSelectLetter(letter)}
        accessibilityRole="button"
        accessibilityLabel={`Jump to ${letter}`}
        hitSlop={1}
      >
        <Text style={{ color: '#FA243C', fontSize: 11, lineHeight: 13, fontWeight: '700' }}>
          {letter}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);
