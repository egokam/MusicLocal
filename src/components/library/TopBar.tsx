import { LinearGradient } from 'expo-linear-gradient';
import { ThemedIcon, ThemedText as Text, ThemedTouchableOpacity as TouchableOpacity, ThemedView as View, useAppearanceTheme } from '../../contexts/AppearanceThemeContext';

export const TopBar = ({ onProfilePress }: { onProfilePress: () => void }) => {
  const { colors, isDark } = useAppearanceTheme();

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
      <Text style={{ color: colors.text, fontSize: 34, fontWeight: '700' }}>Library</Text>

      <TouchableOpacity
        onPress={onProfilePress}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel="Open developer profile"
        style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden' }}
      >
        <LinearGradient colors={isDark ? ['#514A68', '#262331'] : ['#D8D2E8', '#F0EDF7']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedIcon name="person" size={27} color="white" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
};
