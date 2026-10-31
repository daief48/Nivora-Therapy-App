import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useG, type GKey } from '../i18n/guideT';
import { PressScale } from '../motion';
import { radius, useTheme } from '../theme';
import { suggestNever, useGuide, type GuideLevel } from './guideEngine';

const LEVELS: { id: GuideLevel; label: GKey; desc: GKey }[] = [
  { id: 'Full', label: 'gLevelFull', desc: 'gLevelFullDesc' },
  { id: 'Hints', label: 'gLevelHints', desc: 'gLevelHintsDesc' },
  { id: 'Off', label: 'gLevelOff', desc: 'gLevelOffDesc' },
];

/** "Nivora Guide" block for the Profile screen: level, replay the tour, reset tips, read-aloud opt-in. Props-free; state is local to the device. */
export function GuideSettingsSection() {
  const { c, text } = useTheme();
  const g = useG();
  const level = useGuide((s) => s.guideLevel);
  const readAloud = useGuide((s) => s.readAloud);
  const [done, setDone] = useState(false);
  const never = suggestNever();
  const btn = { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, justifyContent: 'center' as const, backgroundColor: c.lavender };
  return (
    <View style={{ gap: 10, padding: 16, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
      <Text accessibilityRole="header" style={text(17, '700')}>{g('gSecTitle')}</Text>
      <Text style={[text(13), { color: c.textMuted }]}>{g('gSecBody')}</Text>
      {never ? <Text style={[text(13, '600'), { color: c.textMuted }]}>{g('gNeverNote')}</Text> : null}
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {LEVELS.map((l) => {
          const on = level === l.id;
          return (
            <Pressable
              key={l.id} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} accessibilityLabel={`${g(l.label)}. ${g(l.desc)}`}
              onPress={() => useGuide.getState().setLevel(l.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, minHeight: 48, borderRadius: radius.md, backgroundColor: on ? c.tint[1] : 'transparent', borderWidth: 1, borderColor: on ? c.primary : c.border }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={text(15, '700')}>{g(l.label)}</Text>
                <Text style={[text(12), { color: c.textMuted }]}>{g(l.desc)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="switch" accessibilityState={{ checked: readAloud }} accessibilityLabel={`${g('gReadAloud')}. ${g('gReadAloudDesc')}`}
        onPress={() => useGuide.getState().setReadAloud(!readAloud)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.primary, backgroundColor: readAloud ? c.primary : 'transparent' }} />
        <View style={{ flex: 1 }}>
          <Text style={text(15, '600')}>{g('gReadAloud')}</Text>
          <Text style={[text(12), { color: c.textMuted }]}>{g('gReadAloudDesc')}</Text>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <PressScale accessibilityRole="button" accessibilityLabel={g('gReplayTour')} onPress={() => { useGuide.getState().replay('tour', 'settings'); }} style={btn}>
          <Text style={[text(14, '700'), { color: c.tintFg[2] }]}>{g('gReplayTour')}</Text>
        </PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel={g('gResetTips')} onPress={() => { useGuide.getState().resetTips(); setDone(true); }} style={btn}>
          <Text style={[text(14, '700'), { color: c.tintFg[2] }]}>{g('gResetTips')}</Text>
        </PressScale>
      </View>
      {done ? <Text accessibilityLiveRegion="polite" style={[text(12), { color: c.textMuted }]}>{g('gResetDone')}</Text> : null}
    </View>
  );
}
