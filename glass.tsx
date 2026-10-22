import type { ReactNode } from 'react';
import { View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassColorScheme,
  type GlassEffectStyleConfig,
  type GlassStyle,
} from 'expo-glass-effect';

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
  colorScheme = 'dark',
  tintColor,
  isInteractive = false,
  fallbackColor = 'rgba(32,32,36,0.92)',
  pointerEvents = 'none',
}: GlassSurfaceProps) {
  if (supportsLiquidGlass) {
    return (
      <GlassView
        pointerEvents={pointerEvents}
        style={style}
        glassEffectStyle={glassEffectStyle}
        colorScheme={colorScheme}
        tintColor={tintColor}
        isInteractive={isInteractive}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View pointerEvents={pointerEvents} style={[{ backgroundColor: fallbackColor }, style]}>
      {children}
    </View>
  );
}

