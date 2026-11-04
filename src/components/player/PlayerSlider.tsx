/* Reanimated shared values and gesture worklets are intentional here. */
/* eslint-disable react-hooks/immutability, react-hooks/refs */

import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

type PlayerSliderProps = {
  value: number;
  accessibilityLabel: string;
  activeColor?: string;
  inactiveColor?: string;
  disabled?: boolean;
  thumbAlwaysVisible?: boolean;
  graduationCount?: number;
  onValueChange?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
};

const clamp = (value: number) => {
  'worklet';
  return Math.max(0, Math.min(1, value));
};

export const PlayerSlider = ({
  value,
  accessibilityLabel,
  activeColor = 'rgba(255,255,255,0.68)',
  inactiveColor = 'rgba(255,255,255,0.25)',
  disabled = false,
  thumbAlwaysVisible = false,
  graduationCount = 0,
  onValueChange,
  onSlidingComplete,
}: PlayerSliderProps) => {
  const sliderWidth = useSharedValue(0);
  const sliderValue = useSharedValue(clamp(value));
  const isInteracting = useSharedValue(false);
  const thumbOpacity = useSharedValue(thumbAlwaysVisible ? 1 : 0);
  const lastCallbackValue = useSharedValue(clamp(value));
  const valueChangeRef = useRef(onValueChange);
  const completeRef = useRef(onSlidingComplete);

  useEffect(() => {
    valueChangeRef.current = onValueChange;
    completeRef.current = onSlidingComplete;
  }, [onSlidingComplete, onValueChange]);

  useEffect(() => {
    if (isInteracting.value) return;
    sliderValue.value = withTiming(clamp(value), { duration: 180 });
  }, [isInteracting, sliderValue, value]);

  const emitValue = useMemo(
    () => (nextValue: number) => valueChangeRef.current?.(nextValue),
    [],
  );
  const completeSliding = useMemo(
    () => (nextValue: number) => completeRef.current?.(nextValue),
    [],
  );

  const sliderGesture = useMemo(() => {
    const progressAtX = (x: number) => {
      'worklet';
      const progress = sliderWidth.value > 0 ? clamp(x / sliderWidth.value) : 0;
      if (graduationCount <= 1) return progress;

      const nearestIndex = Math.round(progress * graduationCount);
      const nearestMark = nearestIndex / graduationCount;
      const isInteriorMark = nearestIndex > 0 && nearestIndex < graduationCount;
      return isInteriorMark && Math.abs(progress - nearestMark) <= 0.035
        ? nearestMark
        : progress;
    };

    const tap = Gesture.Tap()
      .enabled(!disabled)
      .maxDuration(260)
      .onEnd((event, success) => {
        if (!success) return;
        const nextValue = progressAtX(event.x);
        sliderValue.value = withSpring(nextValue, { damping: 24, stiffness: 260 });
        thumbOpacity.value = withTiming(thumbAlwaysVisible ? 1 : 0, { duration: 180 });
        scheduleOnRN(emitValue, nextValue);
        scheduleOnRN(completeSliding, nextValue);
      });

    const pan = Gesture.Pan()
      .enabled(!disabled)
      .activeOffsetX([-4, 4])
      .failOffsetY([-12, 12])
      .onBegin((event) => {
        isInteracting.value = true;
        sliderValue.value = progressAtX(event.x);
        lastCallbackValue.value = sliderValue.value;
        thumbOpacity.value = withTiming(1, { duration: 100 });
      })
      .onUpdate((event) => {
        const nextValue = progressAtX(event.x);
        sliderValue.value = nextValue;

        if (Math.abs(nextValue - lastCallbackValue.value) >= 0.015) {
          lastCallbackValue.value = nextValue;
          scheduleOnRN(emitValue, nextValue);
        }
      })
      .onEnd(() => {
        const finalValue = sliderValue.value;
        isInteracting.value = false;
        thumbOpacity.value = withTiming(thumbAlwaysVisible ? 1 : 0, { duration: 180 });
        scheduleOnRN(emitValue, finalValue);
        scheduleOnRN(completeSliding, finalValue);
      })
      .onFinalize((_event, success) => {
        if (!success) {
          isInteracting.value = false;
          thumbOpacity.value = withTiming(thumbAlwaysVisible ? 1 : 0, { duration: 140 });
        }
      });

    return Gesture.Race(pan, tap);
  }, [
    completeSliding,
    disabled,
    emitValue,
    isInteracting,
    lastCallbackValue,
    sliderValue,
    sliderWidth,
    thumbAlwaysVisible,
    graduationCount,
    thumbOpacity,
  ]);

  const fillStyle = useAnimatedStyle(() => ({
    width: sliderWidth.value * sliderValue.value,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: interpolate(
      sliderValue.value,
      [0, 1],
      [-7, Math.max(-7, sliderWidth.value - 7)],
    ),
    opacity: thumbOpacity.value,
    transform: [{ scale: interpolate(thumbOpacity.value, [0, 1], [0.65, 1]) }],
  }));

  const changeByAccessibility = (direction: number) => {
    if (disabled) return;
    const nextValue = clamp(value + direction * 0.05);
    sliderValue.value = withTiming(nextValue, { duration: 120 });
    valueChangeRef.current?.(nextValue);
    completeRef.current?.(nextValue);
  };

  return (
    <GestureDetector gesture={sliderGesture}>
      <Animated.View
        onLayout={(event) => {
          sliderWidth.value = event.nativeEvent.layout.width;
        }}
        pointerEvents={disabled ? 'none' : 'auto'}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp(value) * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          changeByAccessibility(event.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
        style={{ height: 36, justifyContent: 'center', overflow: 'visible' }}
      >
        <Animated.View
          pointerEvents="none"
          style={{ height: 6, borderRadius: 3, backgroundColor: inactiveColor }}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              height: 6,
              borderRadius: 3,
              backgroundColor: activeColor,
            },
            fillStyle,
          ]}
        />
        {graduationCount > 1 && Array.from({ length: graduationCount + 1 }, (_, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.graduationMark,
              { left: `${(index / graduationCount) * 100}%` },
            ]}
          />
        ))}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 11,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: '#FFFFFF',
              shadowColor: '#000000',
              shadowOpacity: 0.25,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
};

const styles = {
  graduationMark: {
    position: 'absolute' as const,
    top: 14,
    width: 2,
    height: 8,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
};
