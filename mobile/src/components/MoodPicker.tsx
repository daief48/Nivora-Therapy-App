import React from 'react';
import { Pressable, View } from 'react-native';
import { useT, type StringKey } from '../i18n';
import { radius, useTheme } from '../theme';
import { MoodFace, type MoodLevel } from './MoodFace';
import { AppText } from './ui';

/** 1–5 selector. With `faces` it shows the custom mood faces and a label; otherwise plain numbers (used for stress). */
export function ScorePicker({ value, onChange, labelKey, faces = false }: { value: number | null; onChange: (v: number) => void; labelKey: StringKey; faces?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ gap: 10 }}>
      <AppText size={15} weight="700">{t(labelKey)}</AppText>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'space-between' }}>
        {[1, 2, 3, 4, 5].map((v) => {
          const sel = value === v;
          const name = faces ? t(`moods${v}` as StringKey) : String(v);
          return (
            <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="button"
              accessibilityLabel={faces ? `${name} (${v}/5)` : `${v}/5`} accessibilityState={{ selected: sel }}
              style={({ pressed }) => ({
                flex: 1, minHeight: faces ? 96 : 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, opacity: pressed ? 0.8 : 1,
                backgroundColor: sel ? c.tint[0] : c.cardAlt, borderWidth: 2, borderColor: sel ? c.primary : 'transparent', transform: [{ scale: sel ? 1.04 : 1 }],
              })}>
              {faces ? (
                <>
                  <View style={{ opacity: value && !sel ? 0.55 : 1 }}><MoodFace level={v as MoodLevel} size={sel ? 44 : 40} uid={`pk${v}`} /></View>
                  <AppText size={11} weight={sel ? '800' : '600'} numberOfLines={2} style={{ color: sel ? c.primary : c.textMuted, textAlign: 'center', paddingHorizontal: 2 }}>{name}</AppText>
                </>
              ) : <AppText size={18} weight="700" style={{ color: sel ? c.primary : c.text }}>{String(v)}</AppText>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
