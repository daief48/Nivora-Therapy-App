import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation } from '../api/hooks';
import type { CheckIn } from '../api/types';
import { ScalePicker } from '../components/nv';
import { AppText, Button, Card, Chip, Field, Hero, Icon, IconCircle, Row, Screen, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';

const QUALITY = [['POOR', 'sqPoor'], ['OKAY', 'sqOkay'], ['GOOD', 'sqGood'], ['GREAT', 'sqGreat']] as const;

const TAGS = ['work', 'study', 'family', 'relationship', 'friends', 'health', 'sleep', 'money', 'loneliness', 'other', 'good-news', 'rest', 'exercise', 'nature'] as const;

/** Morning / evening check-in. The evening one also holds the short Kaizen reflection. */
export function CheckInScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const { kind } = useRoute<RouteProp<RootParams, 'CheckIn'>>().params;
  const morning = kind === 'MORNING';
  const [mood, setMood] = useState(6), [stress, setStress] = useState(5), [energy, setEnergy] = useState(5), [rested, setRested] = useState(6);
  const [quality, setQuality] = useState<string>('OKAY');
  const [worry, setWorry] = useState(''), [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [result, setResult] = useState<CheckIn | null>(null);

  const save = useInvalidatingMutation(async () => {
    const saved = await api<CheckIn>('/checkins', { method: 'POST', body: {
      kind, mood, stress, energy, ...(morning ? { sleepQuality: quality, rested } : {}),
      ...(tags.length ? { tags } : {}), ...(worry.trim() ? { worry: worry.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
    } });
    return saved;
  }, NIVORA_KEYS);

  const submit = () => save.mutate(undefined, { onSuccess: (r) => setResult(r as unknown as CheckIn) });

  if (result) {
    const crisis = result.safety?.crisis;
    return (
      <Screen>
        {crisis ? (
          <Card tone="danger">
            <AppText size={18} weight="800">{t('crisisCardTitle')}</AppText>
            {result.safety?.message ? <AppText>{result.safety.message}</AppText> : null}
            <Button title={t('crisisCardBtn')} variant="danger" icon="medkit-outline" onPress={() => nav.navigate('Emergency')} />
          </Card>
        ) : (
          <Hero>
            <Icon name="checkmark-circle" size={44} color={c.success} />
            <AppText size={22} weight="800" style={{ color: c.onHero }}>{t('checkInSaved')}</AppText>
            {stress >= 7 || mood <= 3 ? <AppText style={{ color: c.onHeroMuted }}>{t('checkInTherapySuggest')}</AppText> : null}
          </Hero>
        )}
        {!crisis && (stress >= 7 || mood <= 3) ? <Button title={t('talkNow')} icon="chatbubble-ellipses-outline" onPress={() => nav.navigate('Tabs', { screen: 'SessionsTab' } as never)} /> : null}
        <Button title={t('done')} variant={crisis ? 'secondary' : 'ghost'} onPress={() => nav.navigate('Tabs')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Row style={{ gap: 14 }}>
        <IconCircle icon={morning ? 'sunny-outline' : 'moon-outline'} tone={morning ? 3 : 0} size={56} />
        <View style={{ flex: 1 }}>
          <AppText size={22} weight="800" accessibilityRole="header">{t(morning ? 'ciMorningTitle' : 'ciEveningTitle')}</AppText>
          <AppText size={14} muted>{t(morning ? 'ciMorningSub' : 'ciEveningSub')}</AppText>
        </View>
      </Row>

      <Card style={{ gap: 18 }}>
        <ScalePicker label={t('mood')} value={mood} onChange={setMood} lowLabel={t('scaleLow')} highLabel={t('scaleHigh')} />
        <ScalePicker label={t('stress')} value={stress} onChange={setStress} lowLabel={t('scaleLow')} highLabel={t('scaleHigh')} />
        <ScalePicker label={t('energy')} value={energy} onChange={setEnergy} lowLabel={t('scaleLow')} highLabel={t('scaleHigh')} />
      </Card>

      {morning ? (
        <Card style={{ gap: 14 }}>
          <AppText weight="700">{t('sleepQuality')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>{QUALITY.map(([k, label]) => <Chip key={k} label={t(label)} selected={quality === k} onPress={() => setQuality(k)} />)}</Row>
          <ScalePicker label={t('rested')} value={rested} onChange={setRested} />
        </Card>
      ) : (
        <Field label={t('worryLabel')} hint={t('worryHint')} value={worry} onChangeText={setWorry} multiline maxLength={1000} />
      )}
      <Card style={{ gap: 10 }}>
        <AppText weight="700">{t('insWhyTitle')}</AppText>
        <AppText size={12} muted>{t('insWhyHint')}</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          {TAGS.map((k) => <Chip key={k} label={t(`insTag_${k}` as StringKey)} selected={tags.includes(k)} onPress={() => setTags((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />)}
        </Row>
      </Card>
      <Field label={t('noteLabel')} value={note} onChangeText={setNote} multiline maxLength={3000} />

      {save.isError ? <AppText style={{ color: c.danger }} accessibilityRole="alert">{t(errorMessageKey(save.error))}</AppText> : null}
      <Button title={t('saveCheckIn')} icon="checkmark" loading={save.isPending} onPress={submit} />
    </Screen>
  );
}
