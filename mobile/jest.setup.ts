jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => {}), fetch: jest.fn() }));
// Icon fonts cannot load under Jest; render the icon name as text instead.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: (p: { name: string }) => React.createElement(Text, { accessibilityElementsHidden: true }, p.name) };
});
// Motion libraries: reanimated ships a Jest mock; haptics and blur are native-only.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const id = (v: unknown) => v;
  const Animated = { View, Text: require('react-native').Text, createAnimatedComponent: (C: unknown) => C };
  const Easing = new Proxy({}, { get: () => (...a: unknown[]) => a[0] ?? id });
  return {
    __esModule: true, default: Animated, ...Animated, Easing,
    useSharedValue: (v: unknown) => React.useRef({ value: v }).current,
    useAnimatedStyle: (fn: () => object) => fn(),
    useAnimatedProps: (fn: () => object) => fn?.() ?? {},
    withTiming: id, withSpring: id, withDelay: (_d: number, v: unknown) => v, withSequence: (...a: unknown[]) => a[a.length - 1],
    withRepeat: id, cancelAnimation: () => {},
  };
});
jest.mock('react-native-worklets', () => ({}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}), notificationAsync: jest.fn(async () => {}), selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BlurView: (p: object) => React.createElement(View, p) };
});
// Modal mock: render children inside a View when visible !== false so tests can inspect modal contents.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  const { View } = require('react-native');
  function MockModal(props: any) {
    return props.visible !== false ? React.createElement(View, props, props.children) : null;
  }
  return { __esModule: true, default: MockModal };
});
