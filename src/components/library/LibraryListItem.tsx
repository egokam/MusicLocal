import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText as Text, ThemedView as View, ThemedTouchableOpacity as TouchableOpacity, ThemedIcon } from '../../contexts/AppearanceThemeContext';

import { Ionicons } from '@expo/vector-icons';

export const LibraryListItem = ({
  title,
  icon,
  isLast,
  onPress,
}: {
  title: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  isLast: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20 }}>
    <View style={{ width: 40, alignItems: 'flex-start' }}>
      <ThemedIcon name={icon} size={24} color="#FA243C" />
    </View>
    <View
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingRight: 20, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2E' }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 20 }}>{title}</Text>
      <ThemedIcon name="chevron-forward" size={20} color="#3A3A3C" />
    </View>
  </TouchableOpacity>
);
