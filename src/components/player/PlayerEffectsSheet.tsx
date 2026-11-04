import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '../../../glass';
import type { SongMenuAnchor } from '../songs/SongListItem';
import { PlayerSlider } from './PlayerSlider';

export type PlayerEffectsSettings = {
  muffling: number;
  reverb: number;
  speed: number;
  pitch: number;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const speedToSlider = (speed: number) => (speed - 0.5) / 1.5;
const sliderToSpeed = (value: number) => 0.5 + clamp(value) * 1.5;
const pitchToSlider = (pitch: number) => (pitch + 12) / 24;
const sliderToPitch = (value: number) => Math.round(clamp(value) * 24 - 12);

const EffectControl = ({
  icon,
  label,
  valueLabel,
  sliderValue,
  accessibilityLabel,
  onValueChange,
  activeColor = '#FA5265',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  valueLabel: string;
  sliderValue: number;
  accessibilityLabel: string;
  onValueChange: (value: number) => void;
  activeColor?: string;
}) => (
  <View style={{ paddingHorizontal: 13, paddingVertical: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 1 }}>
      <Ionicons name={icon} size={17} color="#FA5265" />
      <Text style={{ flex: 1, marginLeft: 9, color: '#F5F5F7', fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: '#A1A1A6', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{valueLabel}</Text>
    </View>
    <PlayerSlider
      value={sliderValue}
      accessibilityLabel={accessibilityLabel}
      activeColor={activeColor}
      inactiveColor="rgba(255,255,255,0.18)"
      thumbAlwaysVisible
      onValueChange={onValueChange}
      onSlidingComplete={onValueChange}
    />
  </View>
);

export const PlayerEffectsSheet = ({
  anchor,
  initialSettings,
  onChange,
  onClose,
}: {
  anchor: SongMenuAnchor;
  initialSettings: PlayerEffectsSettings;
  onChange: (settings: PlayerEffectsSettings) => void;
  onClose: (settings: PlayerEffectsSettings) => void;
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(settings);
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.96));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const dismissing = useRef(false);
  const menuWidth = Math.min(windowWidth - 32, 324);
  const menuHeight = 390;
  const menuTop = anchor.y + anchor.height + menuHeight + 16 <= windowHeight - 12
    ? anchor.y + anchor.height + 8
    : Math.max(52, anchor.y - menuHeight - 8);
  const menuLeft = Math.max(16, Math.min(anchor.x + anchor.width - menuWidth, windowWidth - menuWidth - 16));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 145, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 22, stiffness: 300, mass: 0.65, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, opacity, scale]);

  const updateSettings = (changes: Partial<PlayerEffectsSettings>) => {
    const nextSettings = { ...settingsRef.current, ...changes };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    onChange(nextSettings);
  };

  const dismiss = () => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.97, duration: 130, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start(() => onClose(settingsRef.current));
  };

  const reset = () => updateSettings({ muffling: 0, reverb: 0, speed: 1, pitch: 0 });

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)', opacity: backdropOpacity }]}
        />
        <Pressable onPress={dismiss} style={StyleSheet.absoluteFill} accessibilityLabel="Close audio effects" />
        <Animated.View
          style={{
            position: 'absolute',
            top: menuTop,
            left: menuLeft,
            width: menuWidth,
            height: menuHeight,
            borderRadius: 23,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
            backgroundColor: 'rgba(28,28,31,0.97)',
            shadowColor: '#000',
            shadowOpacity: 0.42,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 10 },
            elevation: 28,
            opacity,
            transform: [{ scale }],
          }}
        >
          <GlassSurface
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 23 }}
            fallbackColor="rgba(30,30,33,0.97)"
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(28,28,31,0.48)' }]} />

          <View style={{ minHeight: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(250,82,101,0.16)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="options-outline" size={19} color="#FA5265" />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>Equalizer</Text>
              <Text style={{ color: '#A1A1A6', fontSize: 11, marginTop: 2 }}>Muffling, reverb, speed & pitch</Text>
            </View>
            <TouchableOpacity onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close audio effects" style={{ width: 32, height: 38, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={20} color="#A1A1A6" />
            </TouchableOpacity>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 12 }} />

          <EffectControl
            icon="volume-low-outline"
            label="Muffling"
            valueLabel={settings.muffling === 0 ? 'Off' : `${Math.round(settings.muffling * 100)}%`}
            sliderValue={settings.muffling}
            accessibilityLabel="Muffling amount"
            onValueChange={(muffling) => updateSettings({ muffling })}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.09)', marginHorizontal: 14 }} />
          <EffectControl
            icon="water-outline"
            label="Reverb"
            valueLabel={settings.reverb === 0 ? 'Off' : `${Math.round(settings.reverb * 100)}%`}
            sliderValue={settings.reverb}
            accessibilityLabel="Reverb amount"
            onValueChange={(reverb) => updateSettings({ reverb })}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.09)', marginHorizontal: 14 }} />
          <EffectControl
            icon="speedometer-outline"
            label="Speed"
            valueLabel={`${settings.speed.toFixed(2).replace(/0$/, '')}×`}
            sliderValue={clamp(speedToSlider(settings.speed))}
            accessibilityLabel="Playback speed"
            onValueChange={(value) => updateSettings({ speed: sliderToSpeed(value) })}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.09)', marginHorizontal: 14 }} />
          <EffectControl
            icon="musical-note-outline"
            label="Pitch"
            valueLabel={`${settings.pitch > 0 ? '+' : ''}${settings.pitch} st`}
            sliderValue={clamp(pitchToSlider(settings.pitch))}
            accessibilityLabel="Pitch adjustment"
            onValueChange={(value) => updateSettings({ pitch: sliderToPitch(value) })}
          />

          <View style={{ flex: 1 }} />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 }} />
          <TouchableOpacity onPress={reset} accessibilityRole="button" style={{ height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Ionicons name="refresh-outline" size={16} color="#A1A1A6" />
            <Text style={{ color: '#A1A1A6', fontSize: 12, fontWeight: '600' }}>Reset adjustments</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};
