import { Easing } from 'react-native-reanimated';

/** Motion tokens. Calm and unhurried: nothing snaps, nothing bounces hard. (theme.ts `motion` holds the older coarse durations.) */
export const duration = { instant: 90, fast: 150, base: 250, slow: 420, calm: 700, breath: 4000 };

export const easing = {
  /** Gentle deceleration for things arriving. */
  out: Easing.out(Easing.cubic),
  /** Soft acceleration for things leaving. */
  in: Easing.in(Easing.cubic),
  /** Symmetric ease for loops and state changes. */
  inOut: Easing.inOut(Easing.cubic),
  /** Slow sine curve, ideal for breathing. */
  breath: Easing.inOut(Easing.sin),
};

/** Reanimated spring configs (damped, low overshoot). */
export const spring = {
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  soft: { damping: 20, stiffness: 180, mass: 0.9 },
  bloom: { damping: 12, stiffness: 140, mass: 0.8 },
};
