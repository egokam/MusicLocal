import { useState, type ComponentProps } from 'react';
import { ThemedText as Text, ThemedView as View, ThemedPressable as Pressable, ThemedTouchableOpacity as TouchableOpacity, ThemedIcon as ThemedIonicons, useAppearanceTheme } from '../../contexts/AppearanceThemeContext';
import {
  Animated,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button as IOSButton, Divider as IOSDivider, Host, Image as IOSImage, Menu as IOSMenu } from '@expo/ui/swift-ui';
import { accessibilityHint, accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled, frame, labelStyle, menuIndicator, menuStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { GlassSurface } from '../../../glass';

const NATIVE_BACK_TINT = 'transparent';
const IOS_MAJOR_VERSION = Number.parseFloat(String(Platform.Version));

export const NativeBackButton = ({
  onPress,
  accessibilityLabel: label,
  size = 44,
  style,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) => {
  const { isDark } = useAppearanceTheme();
  if (Platform.OS !== 'ios') return null;

  return (
    <Host style={[{ width: size, height: size }, style]} colorScheme={isDark ? 'dark' : 'light'}>
      <IOSButton
        label="Back"
        systemImage="chevron.left"
        onPress={onPress}
        modifiers={[
          buttonStyle(IOS_MAJOR_VERSION >= 26 ? 'glassProminent' : 'borderedProminent'),
          buttonBorderShape('circle'),
          controlSize('large'),
          labelStyle('iconOnly'),
          tint(NATIVE_BACK_TINT),
          frame({ width: size, height: size, alignment: 'center' }),
          accessibilityLabel(label),
          accessibilityHint('Returns to the previous screen.'),
        ]}
      />
    </Host>
  );
};

const getIOSMenuSymbol = (icon: ComponentProps<typeof Ionicons>['name']) => {
  switch (icon) {
    case 'play': return 'play.fill';
    case 'shuffle': return 'shuffle';
    case 'checkbox-outline': return 'checkmark.square';
    case 'close': return 'xmark';
    case 'checkmark': return 'checkmark';
    case 'radio-button-off': return 'circle';
    case 'add-circle-outline': return 'plus.circle';
    case 'trash-outline': return 'trash';
    case 'albums-outline': return 'square.stack';
    case 'person-outline': return 'person';
    default: return undefined;
  }
};

export type SongsHeaderMenuItem = {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

export const SongsHeader = ({
  onBack,
  onToggleSort,
  moreMenuItems = [],
  showSortButton = true,
  showMoreButton = true,
  sortAccessibilityLabel = 'Toggle sort order',
  liquidGlass = true,
}: {
  onBack: () => void;
  onToggleSort: () => void;
  moreMenuItems?: SongsHeaderMenuItem[];
  showSortButton?: boolean;
  showMoreButton?: boolean;
  sortAccessibilityLabel?: string;
  liquidGlass?: boolean;
}) => {
  const { isDark, colors } = useAppearanceTheme();
  const glassBorderColor = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(60,60,67,0.32)';
  const [menuVisible, setMenuVisible] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.001));
  const [translateY] = useState(() => new Animated.Value(-25));
  const canOpenMenu = moreMenuItems.length > 0;
  const useIOSMenu = Platform.OS === 'ios' && canOpenMenu;

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
      {menuVisible && Platform.OS !== 'ios' ? (
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
        {Platform.OS === 'ios' ? (
          <NativeBackButton onPress={onBack} accessibilityLabel="Back to Library" size={44} />
        ) : (
          <View
            style={{
            position: 'relative',
            overflow: 'hidden',
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          >
          {liquidGlass ? (
            <GlassSurface
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }}
              colorScheme={isDark ? 'dark' : 'light'}
              fallbackColor={isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.68)'}
              isInteractive
            />
          ) : null}
            <TouchableOpacity
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back to Library"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <ThemedIonicons name="chevron-back" size={27} color="white" />
            </TouchableOpacity>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, borderWidth: 1.2, borderColor: glassBorderColor }}
          />
          </View>
        )}

        {showSortButton ? (
          <View
            style={{
              position: 'relative',
              overflow: 'hidden',
              width: showMoreButton ? undefined : 44,
              height: 44,
              paddingHorizontal: showMoreButton ? 5 : 0,
              borderRadius: 24,
              backgroundColor: 'glass',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: showMoreButton ? 'flex-start' : 'center',
            }}
          >
            {liquidGlass ? (
              <GlassSurface
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 }}
                colorScheme={isDark ? 'dark' : 'light'}
                fallbackColor={isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.68)'}
                isInteractive
              />
            ) : null}
            {Platform.OS === 'ios' ? (
              <Host
                style={{ width: 44, height: 44 }}
                alignment="center"
                colorScheme={isDark ? 'dark' : 'light'}
              >
                <IOSButton
                  onPress={onToggleSort}
                  modifiers={[buttonStyle('plain'), accessibilityLabel(sortAccessibilityLabel)]}
                >
                  <IOSImage
                    systemName="list.bullet"
                    size={25}
                    color={colors.text}
                    modifiers={[frame({ width: 44, height: 44, alignment: 'center' })]}
                  />
                </IOSButton>
              </Host>
            ) : (
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
                <ThemedIonicons name="list" size={25} color="white" />
              </TouchableOpacity>
            )}
            {showMoreButton ? (
              <>
                <View style={{ width: 22 }} />
                {useIOSMenu ? (
                  <Host
                    style={{ width: 44, height: 44 }}
                    alignment="center"
                    colorScheme={isDark ? 'dark' : 'light'}
                  >
                    <IOSMenu
                      label={(
                        <IOSImage
                          systemName="ellipsis"
                          size={24}
                          color={colors.text}
                          modifiers={[frame({ width: 44, height: 44, alignment: 'center' })]}
                        />
                      )}
                      modifiers={[
                        buttonStyle('plain'),
                        menuStyle('button'),
                        menuIndicator('hidden'),
                        accessibilityLabel('More options'),
                      ]}
                    >
                      {moreMenuItems.flatMap((item, index) => [
                        ...(index > 0 ? [<IOSDivider key={`divider-${item.label}`} />] : []),
                        <IOSButton
                          key={item.label}
                          label={item.label}
                          systemImage={getIOSMenuSymbol(item.icon)}
                          role={item.destructive ? 'destructive' : 'default'}
                          onPress={item.onPress}
                          modifiers={item.disabled ? [disabled()] : undefined}
                        />,
                      ])}
                    </IOSMenu>
                  </Host>
                ) : (
                  <TouchableOpacity
                    onPress={() => menuVisible ? closeMenu() : openMenu()}
                    accessibilityRole="button"
                    accessibilityLabel="More options"
                    accessibilityState={{ expanded: menuVisible }}
                    hitSlop={8}
                  >
                    <ThemedIonicons name="ellipsis-horizontal" size={24} color="white" />
                  </TouchableOpacity>
                )}
              </>
            ) : null}
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24, borderWidth: 1.2, borderColor: glassBorderColor }}
            />
          </View>
        ) : null}
      </View>

      {menuVisible && Platform.OS !== 'ios' ? (
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
            borderColor: colors.separator,
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
            colorScheme={isDark ? 'dark' : 'light'}
            fallbackColor={isDark ? 'rgba(37,37,39,0.98)' : 'rgba(242,242,247,0.98)'}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 1,
              left: 1,
              right: 1,
              bottom: 1,
              borderRadius: 15,
              backgroundColor: isDark ? 'rgba(37,37,39,0.90)' : 'rgba(248,248,250,0.92)',
            }}
          />
          <Animated.View style={{ opacity }}>
            {moreMenuItems.map((item, index) => (
              <View key={item.label}>
                {index > 0 ? <View style={{ height: 1, marginHorizontal: 11, backgroundColor: colors.separator }} /> : null}
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
                  <ThemedIonicons name={item.icon} size={18} color={item.destructive ? colors.accent : colors.text} />
                  <Text style={{ color: item.destructive ? colors.accent : colors.text, fontSize: 14, fontWeight: '600', marginLeft: 9 }}>
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
