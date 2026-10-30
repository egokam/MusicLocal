import { useEffect, useState, type ReactNode } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';

export const SkeletonPulse = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const [opacity] = useState(() => new Animated.Value(0.48));

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.92,
          duration: 760,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 0.48,
          duration: 760,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View pointerEvents="none" style={[style, { opacity }]}>
      {children}
    </Animated.View>
  );
};

export const SkeletonBlock = ({ style }: { style?: StyleProp<ViewStyle> }) => (
  <View style={[{ backgroundColor: '#242427', borderColor: 'rgba(255,255,255,0.035)', borderWidth: 1 }, style]} />
);

export const TrackListSkeleton = ({ count = 7 }: { count?: number }) => (
  <SkeletonPulse style={{ paddingHorizontal: 20, paddingTop: 10 }}>
    {Array.from({ length: count }, (_, index) => (
      <View key={index} style={{ minHeight: 84, flexDirection: 'row', alignItems: 'center' }}>
        <SkeletonBlock style={{ width: 58, height: 58, borderRadius: 11 }} />
        <View style={{ flex: 1, marginLeft: 13 }}>
          <SkeletonBlock style={{ width: `${index % 2 === 0 ? 74 : 59}%`, height: 16, borderRadius: 8 }} />
          <SkeletonBlock style={{ width: '43%', height: 13, borderRadius: 7, marginTop: 8 }} />
          <SkeletonBlock style={{ width: '31%', height: 10, borderRadius: 6, marginTop: 7 }} />
        </View>
        <SkeletonBlock style={{ width: 24, height: 24, borderRadius: 12, marginLeft: 10 }} />
      </View>
    ))}
  </SkeletonPulse>
);
