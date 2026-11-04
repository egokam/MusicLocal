/* Reanimated shared values and gesture callbacks intentionally run on the UI thread. */
/* eslint-disable react-hooks/immutability, react-hooks/refs */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../../../glass';
import { PlayerSlider } from './PlayerSlider';

export type PlayerEffectsSettings = {
  muffling: number;
  reverb: number;
  speed: number;
  pitch: number;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const speedToSlider = (speed: number) => speed <= 1
  ? clamp(speed - 0.5)
  : 0.5 + clamp(speed - 1) * 0.5;
const sliderToSpeed = (value: number) => {
  const position = clamp(value);
  return position <= 0.5
    ? 0.5 + position
    : 1 + (position - 0.5) * 2;
};
const pitchToSlider = (pitch: number) => (pitch + 12) / 24;
const sliderToPitch = (value: number) => Math.round(clamp(value) * 24 - 12);

const AnimatedBlurLayer = Animated.createAnimatedComponent(View);

const EffectControl = ({
  icon,
  label,
  valueLabel,
  sliderValue,
  accessibilityLabel,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  valueLabel: string;
  sliderValue: number;
  accessibilityLabel: string;
  onValueChange: (value: number) => void;
}) => (
  <View style={styles.control}>
    <View style={styles.controlHeading}>
      <View style={styles.controlIcon}>
        <Ionicons name={icon} size={18} color="#FA5265" />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
      <Text style={styles.controlValue}>{valueLabel}</Text>
    </View>
    <PlayerSlider
      value={sliderValue}
      accessibilityLabel={accessibilityLabel}
      activeColor="#FA5265"
      inactiveColor="rgba(255,255,255,0.18)"
      thumbAlwaysVisible
      graduationCount={4}
      onValueChange={onValueChange}
      onSlidingComplete={onValueChange}
    />
  </View>
);

export const PlayerEffectsSheet = ({
  initialSettings,
  onChange,
  onClose,
}: {
  initialSettings: PlayerEffectsSettings;
  onChange: (settings: PlayerEffectsSettings) => void;
  onClose: (settings: PlayerEffectsSettings) => void;
}) => {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.min(
    680,
    Math.max(460, windowHeight * 0.56),
    windowHeight - Math.max(insets.top + 24, 48),
  );
  const sheetWidth = windowWidth;
  const offscreenY = sheetHeight + 32;
  const translateY = useSharedValue(offscreenY);
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(settings);
  const dismissing = useRef(false);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 28, stiffness: 290, mass: 0.82 });
  }, [translateY]);

  const updateSettings = useCallback((changes: Partial<PlayerEffectsSettings>) => {
    const nextSettings = { ...settingsRef.current, ...changes };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    onChange(nextSettings);
  }, [onChange]);

  const finishDismiss = useCallback(() => {
    onClose(settingsRef.current);
  }, [onClose]);

  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    translateY.value = withTiming(offscreenY, {
      duration: 250,
      easing: Easing.in(Easing.cubic),
    }, (finished) => {
      if (finished) scheduleOnRN(finishDismiss);
    });
  }, [finishDismiss, offscreenY, translateY]);

  const dragGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetX([-18, 18])
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > sheetHeight * 0.22 || event.velocityY > 850) {
        scheduleOnRN(dismiss);
        return;
      }
      translateY.value = withSpring(0, { damping: 28, stiffness: 290, mass: 0.82 });
    }), [dismiss, sheetHeight, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, offscreenY], [1, 0], Extrapolation.CLAMP),
  }), [offscreenY]);

  const reset = () => updateSettings({ muffling: 0, reverb: 0, speed: 1, pitch: 0 });
  const bottomPadding = 18 + insets.bottom;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <AnimatedBlurLayer pointerEvents="none" style={[StyleSheet.absoluteFill, backdropStyle]}>
          <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.backdropTint} />
        </AnimatedBlurLayer>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close audio effects"
        />

        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, {
            left: 0,
            width: sheetWidth,
            height: sheetHeight,
            bottom: 0,
            paddingBottom: bottomPadding,
          }, sheetStyle]}
        >
          <GlassSurface style={StyleSheet.absoluteFill} fallbackColor="rgba(24,24,28,0.98)" />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sheetTint]} />

          <GestureDetector gesture={dragGesture}>
            <View style={styles.grabArea} accessibilityLabel="Drag down to close audio effects">
              <View style={styles.grabber} />
            </View>
          </GestureDetector>

          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="options-outline" size={21} color="#FA5265" />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Audio Effects</Text>
              <Text style={styles.subtitle}>Shape the sound as it plays</Text>
            </View>
            <TouchableOpacity
              onPress={dismiss}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close audio effects"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={22} color="#D1D1D6" />
            </TouchableOpacity>
          </View>

          <View style={styles.separator} />

          <ScrollView
            style={styles.controlsScroll}
            contentContainerStyle={styles.controlsContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <EffectControl
              icon="volume-low-outline"
              label="Muffling"
              valueLabel={settings.muffling === 0 ? 'Off' : `${Math.round(settings.muffling * 100)}%`}
              sliderValue={settings.muffling}
              accessibilityLabel="Muffling amount"
              onValueChange={(muffling) => updateSettings({ muffling })}
            />
            <View style={styles.controlSeparator} />
            <EffectControl
              icon="water-outline"
              label="Reverb"
              valueLabel={settings.reverb === 0 ? 'Off' : `${Math.round(settings.reverb * 100)}%`}
              sliderValue={settings.reverb}
              accessibilityLabel="Reverb amount"
              onValueChange={(reverb) => updateSettings({ reverb })}
            />
            <View style={styles.controlSeparator} />
            <EffectControl
              icon="speedometer-outline"
              label="Speed"
              valueLabel={`${settings.speed.toFixed(2)}×`}
              sliderValue={clamp(speedToSlider(settings.speed))}
              accessibilityLabel="Playback speed"
              onValueChange={(value) => updateSettings({ speed: sliderToSpeed(value) })}
            />
            <View style={styles.controlSeparator} />
            <EffectControl
              icon="musical-note-outline"
              label="Pitch"
              valueLabel={`${settings.pitch > 0 ? '+' : ''}${settings.pitch} st`}
              sliderValue={clamp(pitchToSlider(settings.pitch))}
              accessibilityLabel="Pitch adjustment"
              onValueChange={(value) => updateSettings({ pitch: sliderToPitch(value) })}
            />
          </ScrollView>

          <View style={styles.footerSeparator} />
          <TouchableOpacity
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Reset audio adjustments"
            style={styles.resetButton}
          >
            <Ionicons name="refresh-outline" size={17} color="#A1A1A6" />
            <Text style={styles.resetLabel}>Reset adjustments</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheet: {
    position: 'absolute',
    overflow: 'hidden',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.17)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 28,
  },
  sheetTint: {
    backgroundColor: 'rgba(24,24,28,0.72)',
  },
  grabArea: {
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(235,235,245,0.52)',
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,82,101,0.16)',
  },
  headerCopy: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    color: '#F5F5F7',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: '#A1A1A6',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  controlsScroll: {
    flex: 1,
  },
  controlsContent: {
    paddingHorizontal: 22,
    paddingTop: 3,
    paddingBottom: 8,
  },
  control: {
    paddingVertical: 5,
  },
  controlHeading: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,82,101,0.12)',
  },
  controlLabel: {
    flex: 1,
    marginLeft: 10,
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '600',
  },
  controlValue: {
    color: '#A1A1A6',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  controlSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  footerSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  resetButton: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resetLabel: {
    color: '#B5B5BA',
    fontSize: 14,
    fontWeight: '600',
  },
});
