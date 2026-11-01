/**
 * KaizenSegmentedControl — animated sub-tab toggle for Kaizen.
 * Switches between "Today's step" (আজকের পদক্ষেপ) and "Guided programmes" (গাইডেড প্রোগ্রাম).
 */
import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { tapHaptic } from '../../motion/haptics';
import { spring } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { radius, useTheme } from '../../theme';
import { AppText, Icon, Row } from '../ui';

export type KaizenTab = 'today' | 'programs';

interface Props {
  activeTab: KaizenTab;
  onChangeTab: (tab: KaizenTab) => void;
  todayLabel: string;
  programsLabel: string;
}

export function KaizenSegmentedControl({
  activeTab,
  onChangeTab,
  todayLabel,
  programsLabel,
}: Props) {
  const { c, isDark } = useTheme();
  const reduced = useReducedMotion();

  const [containerWidth, setContainerWidth] = useState(0);
  const tabWidth = containerWidth > 0 ? (containerWidth - 8) / 2 : 0;

  const translateX = useSharedValue(activeTab === 'today' ? 0 : 1);

  useEffect(() => {
    const target = activeTab === 'today' ? 0 : 1;
    if (reduced) {
      translateX.value = target;
    } else {
      translateX.value = withSpring(target, spring.press);
    }
  }, [activeTab, reduced, translateX]);

  const pillAnim = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value * tabWidth }],
      width: tabWidth,
    };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  const handlePress = (tab: KaizenTab) => {
    if (tab !== activeTab) {
      tapHaptic();
      onChangeTab(tab);
    }
  };

  return (
    <View
      onLayout={onLayout}
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#2D2833' : '#F3ECF0',
          borderColor: isDark ? '#3D3645' : '#E8DFE5',
        },
      ]}
    >
      {/* Animated active pill indicator */}
      {tabWidth > 0 ? (
        <Animated.View
          style={[
            styles.pill,
            {
              backgroundColor: isDark ? '#3E3547' : '#FFFFFF',
              boxShadow: isDark
                ? '0 2px 6px rgba(0,0,0,0.3)'
                : '0 2px 8px rgba(120,84,96,0.12)',
            },
            pillAnim,
          ]}
        />
      ) : null}

      {/* Tab 1: Today */}
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={todayLabel}
        accessibilityState={{ selected: activeTab === 'today' }}
        onPress={() => handlePress('today')}
        style={styles.tabButton}
      >
        <Row style={styles.tabContent}>
          <Icon
            name="leaf-outline"
            size={16}
            color={activeTab === 'today' ? c.primary : c.textMuted}
          />
          <AppText
            size={13}
            weight={activeTab === 'today' ? '800' : '600'}
            style={{ color: activeTab === 'today' ? c.text : c.textMuted }}
          >
            {todayLabel}
          </AppText>
        </Row>
      </Pressable>

      {/* Tab 2: Programs */}
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={programsLabel}
        accessibilityState={{ selected: activeTab === 'programs' }}
        onPress={() => handlePress('programs')}
        style={styles.tabButton}
      >
        <Row style={styles.tabContent}>
          <Icon
            name="book-outline"
            size={16}
            color={activeTab === 'programs' ? c.primary : c.textMuted}
          />
          <AppText
            size={13}
            weight={activeTab === 'programs' ? '800' : '600'}
            style={{ color: activeTab === 'programs' ? c.text : c.textMuted }}
          >
            {programsLabel}
          </AppText>
        </Row>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderWidth: 1,
    position: 'relative',
    marginVertical: 4,
  },
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.pill,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tabContent: {
    gap: 6,
    alignItems: 'center',
  },
});

