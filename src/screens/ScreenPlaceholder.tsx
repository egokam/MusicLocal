
import { ThemedText as Text, ThemedView as View } from '../contexts/AppearanceThemeContext';

export const ScreenPlaceholder = ({ title }: { title: string }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
    <Text style={{ color: 'white', fontSize: 24, fontWeight: '700' }}>{title}</Text>
  </View>
);
