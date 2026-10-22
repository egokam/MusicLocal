import { useState, type ComponentProps } from 'react';
import { Animated, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '../../../glass';

export const SongsHeader = ({
  onBack,
  onToggleSort,
  moreMenuItems = [],
  showSortButton = true,
  showMoreButton = true,
  sortAccessibilityLabel = 'Toggle sort order',
  liquidGlass = false,
}: {
  onBack: () => void;
  onToggleSort: () => void;
  moreMenuItems?: {
    label: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }[];
  showSortButton?: boolean;
  showMoreButton?: boolean;
  sortAccessibilityLabel?: string;
  liquidGlass?: boolean;
}) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.001));
  const [translateY] = useState(() => new Animated.Value(-25));
  const canOpenMenu = moreMenuItems.length > 0;

  const openMenu = () => {
    if (!canOpenMenu) return;
    setMenuVisible(true);
    opacity.setValue(0);
    scale.setValue(0.001);
    translateY.setValue(-25);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 170, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 19, stiffness: 260, mass: 0.7, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, damping: 19, stiffness: 260, mass: 0.7, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = (afterClose?: () => void) => {
    if (!menuVisible) {
      afterClose?.();
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 0.001, damping: 20, stiffness: 300, mass: 0.65, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: -25, damping: 20, stiffness: 300, mass: 0.65, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setMenuVisible(false);
      afterClose?.();
    });
  };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 }}>
      {menuVisible ? (
        <Pressable
          accessibilityLabel="Close menu"
          onPress={() => closeMenu()}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}

      <View
        style={{
          position: 'absolute',
          top: 16,
          left: 0,
          right: 0,
          height: 58,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
          style={{
            position: 'relative',
            overflow: 'hidden',
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: liquidGlass ? 'transparent' : 'rgba(28,28,30,0.84)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {liquidGlass ? <GlassSurface style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }} /> : null}
          <Ionicons name="chevron-back" size={27} color="white" />
        </TouchableOpacity>

        {showSortButton ? (
          <View
            style={{
              position: 'relative',
              overflow: 'hidden',
              width: showMoreButton ? undefined : 44,
              height: 44,
              paddingHorizontal: showMoreButton ? 18 : 0,
              borderRadius: 24,
              backgroundColor: liquidGlass ? 'transparent' : 'rgba(28,28,30,0.84)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: showMoreButton ? 'flex-start' : 'center',
            }}
          >
            {liquidGlass ? <GlassSurface style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 }} /> : null}
            <TouchableOpacity
              onPress={onToggleSort}
              accessibilityRole="button"
              accessibilityLabel={sortAccessibilityLabel}
              style={{
                width: showMoreButton ? undefined : 42,
                height: showMoreButton ? undefined : 42,
                paddingVertical: showMoreButton ? 6 : 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="list" size={25} color="white" />
            </TouchableOpacity>
            {showMoreButton ? (
              <>
                <View style={{ width: 22 }} />
                <TouchableOpacity
                  onPress={() => menuVisible ? closeMenu() : openMenu()}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                  accessibilityState={{ expanded: menuVisible }}
                  hitSlop={8}
                >
                  <Ionicons name="ellipsis-horizontal" size={24} color="white" />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {menuVisible ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 70,
            right: 46,
            minWidth: 188,
            padding: 4,
            borderRadius: 16,
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            shadowColor: '#000000',
            shadowOpacity: 0.34,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            zIndex: 2,
            elevation: 22,
            transformOrigin: ['100%', 0, 0],
            transform: [{ scale }, { translateY }],
          }}
        >
          <GlassSurface
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 }}
            fallbackColor="rgba(37,37,39,0.98)"
          />
          <Animated.View style={{ opacity }}>
            {moreMenuItems.map((item, index) => (
              <View key={item.label}>
                {index > 0 ? <View style={{ height: 1, marginHorizontal: 11, backgroundColor: 'rgba(255,255,255,0.09)' }} /> : null}
                <TouchableOpacity
                  onPress={() => closeMenu(item.onPress)}
                  disabled={item.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={{
                  minHeight: 42,
                  paddingHorizontal: 10,
                  borderRadius: 11,
                    flexDirection: 'row',
                    alignItems: 'center',
                    opacity: item.disabled ? 0.4 : 1,
                  }}
                >
                  <Ionicons name={item.icon} size={18} color={item.destructive ? '#FA5265' : 'white'} />
                  <Text style={{ color: item.destructive ? '#FA5265' : 'white', fontSize: 14, fontWeight: '600', marginLeft: 9 }}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
};
