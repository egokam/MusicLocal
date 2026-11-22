import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassColorScheme,
  type GlassEffectStyleConfig,
  type GlassStyle,
} from 'expo-glass-effect';
import { useAppearanceTheme } from './src/contexts/AppearanceThemeContext';

/**
 * Liquid-glass surface for layering behind a component's content.
 * Give it the shape and position of the surface; place content after it so
 * the glass samples the already-rendered scene behind the surface.
 */
export type GlassSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  glassEffectStyle?: GlassStyle | GlassEffectStyleConfig;
  colorScheme?: GlassColorScheme;
  tintColor?: ColorValue;
  isInteractive?: boolean;
  fallbackColor?: ColorValue;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
};

const supportsLiquidGlass = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function GlassSurface({
  style,
  children,
  glassEffectStyle = 'regular',
  colorScheme = 'auto',
  tintColor,
  isInteractive = false,
  fallbackColor = 'rgba(32,32,36,0.92)',
  pointerEvents = 'none',
}: GlassSurfaceProps) {
  const { isDark, colors } = useAppearanceTheme();
  const resolvedColorScheme = colorScheme === 'auto' ? (isDark ? 'dark' : 'light') : colorScheme;

  if (supportsLiquidGlass) {
    return (
      <GlassView
        pointerEvents={pointerEvents}
        style={style}
        glassEffectStyle={glassEffectStyle}
        colorScheme={resolvedColorScheme}
        tintColor={tintColor}
        isInteractive={isInteractive}
      >
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <View pointerEvents={pointerEvents} style={[style, { overflow: 'hidden' }]}>
        <BlurView
          intensity={72}
          tint={resolvedColorScheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(28,28,30,0.24)' : 'rgba(255,255,255,0.22)' },
          ]}
        />
        {children}
      </View>
    );
  }

  return (
    <View pointerEvents={pointerEvents} style={[{ backgroundColor: isDark ? fallbackColor : colors.surface }, style]}>
      {children}
    </View>
  );
}
