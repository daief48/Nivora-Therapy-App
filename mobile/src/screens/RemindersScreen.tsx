import React, { useState } from 'react';
import { Platform } from 'react-native';
import { AppText, Button, Card, Check, Row, Screen, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { useSettings, type SettingsState } from '../store/settings';
import { fmtTime, rescheduleAll } from '../utils/reminders';

type Patch = Partial<Omit<SettingsState, 'set'>>;
const STEP = 15;

function TimeRow({ value, onChange, label }: { value: number; onChange: (m: number) => void; label: string }) {
  const t = useT();
  const bump = (d: number) => onChange((value + d + 1440) % 1440);
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText size={14} muted>{label}</AppText>
      <Row style={{ gap: 6 }}>
        <Button title="−" variant="secondary" accessibilityLabel={t('engTimeEarlier')} onPress={() => bump(-STEP)} />
        <AppText weight="800" size={18} accessibilityLiveRegion="polite" style={{ minWidth: 64, textAlign: 'center' }}>{fmtTime(value)}</AppText>
        <Button title="+" variant="secondary" accessibilityLabel={t('engTimeLater')} onPress={() => bump(STEP)} />
      </Row>
    </Row>
  );
}

export function RemindersScreen() {
  const t = useT();
  const s = useSettings();
  const [note, setNote] = useState('');
  if (Platform.OS === 'web') return <Screen><AppText size={24} weight="800" accessibilityRole="header">{t('engRemTitle')}</AppText><Card tone="lavender"><AppText>{t('engWebNote')}</AppText></Card></Screen>;

  const apply = async (patch: Patch) => {
    s.set(patch);
    const ok = await rescheduleAll({ ...useSettings.getState(), ...patch }, t);
    setNote(ok ? '' : t('engDenied'));
  };
  const slot = (on: 'remMorningOn' | 'remEveningOn' | 'remBedOn', at: 'remMorningAt' | 'remEveningAt' | 'remBedAt', title: StringKey, desc: StringKey) => (
    <Card>
      <Check checked={s[on]} onToggle={() => apply({ [on]: !s[on] })} label={t(title)} />
      <AppText size={13} muted>{t(desc)}</AppText>
      {s[on] ? <TimeRow value={s[at]} label={t('engAt')} onChange={(m) => apply({ [at]: m })} /> : null}
    </Card>
  );

  return (
    <Screen>
      <AppText size={24} weight="800" accessibilityRole="header">{t('engRemTitle')}</AppText>
      <AppText muted>{t('engRemIntro')}</AppText>
      {slot('remMorningOn', 'remMorningAt', 'engMorning', 'engMorningBody')}
      {slot('remEveningOn', 'remEveningAt', 'engEvening', 'engEveningBody')}
      {slot('remBedOn', 'remBedAt', 'engBed', 'engBedBody')}

      <SectionTitle>{t('engQuiet')}</SectionTitle>
      <Card>
        <Check checked={s.quietOn} onToggle={() => apply({ quietOn: !s.quietOn })} label={t('engQuiet')} />
        <AppText size={13} muted>{t('engQuietNote')}</AppText>
        {s.quietOn ? (
          <>
            <TimeRow value={s.quietStart} label={t('engQuietFrom')} onChange={(m) => apply({ quietStart: m })} />
            <TimeRow value={s.quietEnd} label={t('engQuietTo')} onChange={(m) => apply({ quietEnd: m })} />
          </>
        ) : null}
      </Card>

      <SectionTitle>{t('engGentle')}</SectionTitle>
      <Card>
        <Check checked={s.gentleReturn} onToggle={() => apply({ gentleReturn: !s.gentleReturn })} label={t('engGentle')} />
        <AppText size={13} muted>{t('engGentleNote')}</AppText>
      </Card>
      {note ? <AppText accessibilityRole="alert">{note}</AppText> : null}
    </Screen>
  );
}
