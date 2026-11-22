import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ElementRef, type PropsWithChildren } from 'react';
import {
  ActivityIndicator as NativeActivityIndicator,
  Animated,
  Appearance,
  Pressable as NativePressable,
  ScrollView as NativeScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  TouchableOpacity as NativeTouchableOpacity,
  View as NativeView,
  type ActivityIndicatorProps,
  type PressableProps,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type TouchableOpacityProps,
  type ViewProps,
  useColorScheme,
} from 'react-native';
import { SafeAreaView as NativeSafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';

export type AppearanceMode = 'automatic' | 'light' | 'dark';

const APPEARANCE_MODE_KEY = 'musiqapp-appearance-mode';

const darkSurfacesToLight: Record<string, string> = {
  black: '#FFFFFF',
  '#000': '#FFFFFF',
  '#000000': '#FFFFFF',
  '#09090a': '#F2F2F7',
  '#111113': '#F2F2F7',
  '#141416': '#F2F2F7',
  '#151518': '#F2F2F7',
  '#161619': '#F2F2F7',
  '#171719': '#F2F2F7',
  '#1b1b1e': '#F2F2F7',
  '#1c1c1e': '#F2F2F7',
  '#202023': '#FFFFFF',
  '#202024': '#FFFFFF',
  '#222623': '#FFFFFF',
  '#242427': '#FFFFFF',
  '#252527': '#FFFFFF',
  '#28282d': '#FFFFFF',
  '#29292d': '#FFFFFF',
  '#241419': '#FCE9EC',
  '#29292b': '#D1D1D6',
  '#2c2c2e': '#E5E5EA',
  '#303034': '#D1D1D6',
  '#303033': '#D1D1D6',
  '#343438': '#E5E5EA',
  '#36363a': '#D1D1D6',
  '#37373a': '#E5E5EA',
};

const darkTextToLight: Record<string, string> = {
  white: '#1C1C1E',
  '#fff': '#1C1C1E',
  '#ffffff': '#1C1C1E',
  '#f5f5f7': '#1C1C1E',
  '#f5f5f5': '#1C1C1E',
  '#d1d1d6': '#3A3A3C',
  '#b7b7bc': '#636366',
  '#a1a1a6': '#636366',
  '#a1a1a8': '#636366',
  '#aaa2a5': '#636366',
  '#aaaaaf': '#636366',
  '#96969c': '#77777D',
  '#929197': '#77777D',
  '#8e8e93': '#77777D',
  '#89898f': '#77777D',
  '#85858b': '#77777D',
  '#77777d': '#8E8E93',
  '#6f6f76': '#8E8E93',
  'rgba(255,255,255,0.68)': '#636366',
  'rgba(255,255,255,0.8)': '#3A3A3C',
  'rgba(255,255,255,0.75)': '#636366',
  'rgba(255,255,255,0.72)': '#636366',
  'rgba(255,255,255,0.7)': '#636366',
  'rgba(255,255,255,0.58)': '#77777D',
  'rgba(255,255,255,0.55)': '#77777D',
  'rgba(255,255,255,0.5)': '#77777D',
};

type AppearanceTheme = {
  mode: AppearanceMode;
  isDark: boolean;
  colors: {
    background: string;
    surface: string;
    raisedSurface: string;
    separator: string;
    text: string;
    secondaryText: string;
    mutedText: string;
    accent: string;
    scrollFade: readonly [string, string, string, string];
  };
  setMode: (mode: AppearanceMode) => void;
};

const AppearanceThemeContext = createContext<AppearanceTheme | null>(null);

export const AppearanceThemeProvider = ({ children }: PropsWithChildren) => {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('dark');
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [themeTransitioning, setThemeTransitioning] = useState(false);
  const [themeTransitionOpacity] = useState(() => new Animated.Value(1));
  const themeTransitionActive = useRef(false);
  const isDark = mode === 'automatic' ? systemColorScheme !== 'light' : mode === 'dark';

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(APPEARANCE_MODE_KEY)
      .then((savedMode) => {
        if (!mounted) return;
        if (savedMode === 'automatic' || savedMode === 'light' || savedMode === 'dark') {
          setModeState(savedMode);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setPreferenceLoaded(true);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (preferenceLoaded) Appearance.setColorScheme(mode === 'automatic' ? 'auto' : mode);
  }, [mode, preferenceLoaded]);

  const setMode = useCallback((nextMode: AppearanceMode) => {
    if (nextMode === mode || themeTransitionActive.current) return;

    themeTransitionActive.current = true;
    setThemeTransitioning(true);
    Animated.timing(themeTransitionOpacity, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        themeTransitionActive.current = false;
        setThemeTransitioning(false);
        return;
      }

      setModeState(nextMode);
      void SecureStore.setItemAsync(APPEARANCE_MODE_KEY, nextMode).catch(() => undefined);
      requestAnimationFrame(() => {
        Animated.timing(themeTransitionOpacity, {
          toValue: 1,
          duration: 210,
          useNativeDriver: true,
        }).start(({ finished: fadeInFinished }) => {
          if (!fadeInFinished) return;
          themeTransitionActive.current = false;
          setThemeTransitioning(false);
        });
      });
    });
  }, [mode, themeTransitionOpacity]);

  const colors = useMemo(() => isDark ? {
    background: '#000000',
    surface: '#1C1C1E',
    raisedSurface: '#2C2C2E',
    separator: '#2C2C2E',
    text: '#FFFFFF',
    secondaryText: '#A1A1A6',
    mutedText: '#8E8E93',
    accent: '#FA5265',
    scrollFade: ['#000000', '#000000', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0)'] as const,
  } : {
    background: '#FFFFFF',
    surface: '#F2F2F7',
    raisedSurface: '#FFFFFF',
    separator: '#D1D1D6',
    text: '#1C1C1E',
    secondaryText: '#636366',
    mutedText: '#77777D',
    accent: '#FA5265',
    scrollFade: ['#FFFFFF', '#FFFFFF', 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0)'] as const,
  }, [isDark]);

  const value = useMemo(() => ({ mode, isDark, colors, setMode }), [colors, isDark, mode, setMode]);

  return (
    <AppearanceThemeContext.Provider value={value}>
      <NativeView style={{ flex: 1, backgroundColor: colors.background }}>
        <Animated.View
          pointerEvents={themeTransitioning ? 'none' : 'auto'}
          style={{ flex: 1, opacity: themeTransitionOpacity }}
        >
          {children}
        </Animated.View>
      </NativeView>
    </AppearanceThemeContext.Provider>
  );
};

export const useAppearanceTheme = () => {
  const theme = useContext(AppearanceThemeContext);
  if (!theme) throw new Error('Appearance theme is unavailable outside AppearanceThemeProvider.');
  return theme;
};

const resolveLightStyle = (style: unknown, isDark: boolean, kind: 'view' | 'text' | 'input'): unknown => {
  if (isDark) return style;
  if (typeof style === 'function') {
    return (...args: unknown[]) => resolveLightStyle(style(...args), isDark, kind);
  }
  const flattened = StyleSheet.flatten(style as never);
  if (!flattened) return style;
  const adapted: Record<string, unknown> = {};
  if (kind === 'view') {
    for (const property of ['backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']) {
      const color = flattened[property as keyof typeof flattened];
      if (typeof color === 'string') {
        const lightColor = darkSurfacesToLight[color.toLowerCase()];
        if (lightColor) adapted[property] = lightColor;
      }
    }
  } else {
    const color = kind === 'input'
      ? (flattened as { color?: unknown }).color
      : (flattened as { color?: unknown }).color;
    if (typeof color === 'string') {
      const hasTextShadow = kind === 'text' && Boolean((flattened as { textShadowColor?: unknown }).textShadowColor);
      if (!hasTextShadow) {
        const lightColor = darkTextToLight[color.toLowerCase()];
        if (lightColor) adapted.color = lightColor;
      }
    }
  }
  return Object.keys(adapted).length ? [style, adapted] : style;
};

export const ThemedView = forwardRef<ElementRef<typeof NativeView>, ViewProps>(({ style, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return <NativeView {...props} ref={ref} style={resolveLightStyle(style, isDark, 'view') as ViewProps['style']} />;
});
ThemedView.displayName = 'ThemedView';

export const ThemedSafeAreaView = forwardRef<ElementRef<typeof NativeSafeAreaView>, SafeAreaViewProps>(({ style, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return <NativeSafeAreaView {...props} ref={ref} style={resolveLightStyle(style, isDark, 'view') as SafeAreaViewProps['style']} />;
});
ThemedSafeAreaView.displayName = 'ThemedSafeAreaView';

export const ThemedText = forwardRef<ElementRef<typeof NativeText>, TextProps>(({ style, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return <NativeText {...props} ref={ref} style={resolveLightStyle(style, isDark, 'text') as TextProps['style']} />;
});
ThemedText.displayName = 'ThemedText';

export const ThemedTextInput = forwardRef<ElementRef<typeof NativeTextInput>, TextInputProps>(({ style, placeholderTextColor, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  const mappedPlaceholder = typeof placeholderTextColor === 'string'
    ? darkTextToLight[placeholderTextColor.toLowerCase()] ?? placeholderTextColor
    : placeholderTextColor;
  return (
    <NativeTextInput
      {...props}
      ref={ref}
      placeholderTextColor={isDark ? placeholderTextColor : mappedPlaceholder}
      style={resolveLightStyle(style, isDark, 'input') as TextInputProps['style']}
    />
  );
});
ThemedTextInput.displayName = 'ThemedTextInput';

export const ThemedActivityIndicator = ({ color, ...props }: ActivityIndicatorProps) => {
  const { isDark } = useAppearanceTheme();
  const mappedColor = typeof color === 'string' ? darkTextToLight[color.toLowerCase()] ?? color : color;
  return <NativeActivityIndicator {...props} color={isDark ? color : mappedColor} />;
};

export const ThemedIcon = (props: ComponentProps<typeof Ionicons>) => {
  const { isDark } = useAppearanceTheme();
  const mappedColor = typeof props.color === 'string' ? darkTextToLight[props.color.toLowerCase()] ?? props.color : props.color;
  return <Ionicons {...props} color={isDark ? props.color : mappedColor} />;
};

export const ThemedPressable = forwardRef<ElementRef<typeof NativePressable>, PressableProps>(({ style, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return <NativePressable {...props} ref={ref} style={resolveLightStyle(style, isDark, 'view') as PressableProps['style']} />;
});
ThemedPressable.displayName = 'ThemedPressable';

export const ThemedTouchableOpacity = forwardRef<ElementRef<typeof NativeTouchableOpacity>, TouchableOpacityProps>(({ style, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return <NativeTouchableOpacity {...props} ref={ref} style={resolveLightStyle(style, isDark, 'view') as TouchableOpacityProps['style']} />;
});
ThemedTouchableOpacity.displayName = 'ThemedTouchableOpacity';

export const ThemedScrollView = forwardRef<ElementRef<typeof NativeScrollView>, ScrollViewProps>(({ style, contentContainerStyle, ...props }, ref) => {
  const { isDark } = useAppearanceTheme();
  return (
    <NativeScrollView
      {...props}
      ref={ref}
      style={resolveLightStyle(style, isDark, 'view') as ScrollViewProps['style']}
      contentContainerStyle={resolveLightStyle(contentContainerStyle, isDark, 'view') as ScrollViewProps['contentContainerStyle']}
    />
  );
});
ThemedScrollView.displayName = 'ThemedScrollView';
