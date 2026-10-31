import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useCheckIns, useKaizenToday, useMe, usePlan, useSummary } from '../api/hooks';
import { usePrograms } from '../api/sessionPrograms';
import { TodayButton } from '../components/ProgramParts';
import { StatBlock } from '../components/nv';
import { AppText, Button, Card, Hero, Icon, IconCircle, Row, Screen, SectionTitle, Tile, type IconName } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { radius, useTheme } from '../theme';

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Home: one clear next action for the part of the day, today's single Kaizen step, and quick ways in. */
export function HomeScreen() {
  const t = useT();
  const { c, shadow } = useTheme();
  const nav = useNavigation<Nav>();
  const me = useMe();
  const checkIns = useCheckIns();
  const kz = useKaizenToday();
  const plan = usePlan();
  const summary = useSummary();
  const programs = usePrograms();
  const live = (programs.data ?? []).filter((x) => x.status === 'ACTIVE');
  const sitting = live.find((x) => x.todayState === 'IN_PROGRESS') ?? live.find((x) => x.todayState === 'READY') ?? live.find((x) => x.todayState === 'DONE_TODAY');

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'goodNight' : hour < 12 ? 'goodMorning' : hour < 18 ? 'goodAfternoon' : hour < 22 ? 'goodEvening' : 'goodNight';
  const today = (checkIns.data ?? []).filter((x) => sameDay(x.createdAt));
  const morningDone = today.some((x) => x.kind === 'MORNING');
  const eveningDone = today.some((x) => x.kind === 'EVENING');
  // Morning prompt until noon; evening prompt from 17:00; otherwise invite a conversation.
  const prompt: { kind: 'MORNING' | 'EVENING' | null; title: string; sub: string; icon: IconName } =
    hour < 12 && !morningDone ? { kind: 'MORNING', title: t('ciMorningTitle'), sub: t('ciMorningSub'), icon: 'sunny-outline' }
    : hour >= 17 && !eveningDone ? { kind: 'EVENING', title: t('ciEveningTitle'), sub: t('ciEveningSub'), icon: 'moon-outline' }
    : { kind: null, title: t('spHomeHero'), sub: t('spHomeHeroSub'), icon: 'leaf-outline' };

  const act = kz.data?.action;
  const sleepAvg = summary.data?.sleep.avgScore;
  const latest = (checkIns.data ?? [])[0];

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <AppText size={14} muted>{t(greeting)}</AppText>
          <AppText size={30} weight="800" accessibilityRole="header">{me.data?.displayName ?? t('appName')}</AppText>
          <AppText size={14} muted>{t('homeSub')}</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('emergency')} onPress={() => nav.navigate('Emergency')}
          style={[{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border }, shadow('sm')]}>
          <Icon name="medkit-outline" size={22} color={c.danger} />
        </Pressable>
      </Row>

      <Pressable accessibilityRole="button" accessibilityLabel={`${prompt.title}. ${prompt.sub}`}
        onPress={() => (prompt.kind ? nav.navigate('CheckIn', { kind: prompt.kind }) : nav.navigate('Tabs', { screen: 'SessionsTab' } as never))}>
        <Hero branch>
          <Row style={{ gap: 14, paddingRight: 70 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.tint[0], alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={prompt.icon} size={28} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText size={20} weight="800" style={{ color: c.onHero }}>{prompt.title}</AppText>
              <AppText size={14} style={{ color: c.onHeroMuted }}>{prompt.sub}</AppText>
            </View>
          </Row>
        </Hero>
      </Pressable>

      <SectionTitle>{t('kzToday')}</SectionTitle>
      <Pressable accessibilityRole="button" onPress={() => nav.navigate('Tabs', { screen: 'KaizenTab' } as never)}>
        <Card style={{ gap: 10 }}>
          {act ? (
            <>
              <Row style={{ gap: 12 }}>
                <IconCircle icon={act.status === 'DONE' || act.status === 'PARTIAL' ? 'checkmark-circle' : 'leaf-outline'} tone={act.status === 'PLANNED' ? 1 : 0} size={46} />
                <View style={{ flex: 1 }}>
                  <AppText size={17} weight="800">{act.title}</AppText>
                  <AppText size={13} muted numberOfLines={2}>{act.micro ? t('kzRestartNote') : act.description}</AppText>
                </View>
              </Row>
              {act.status !== 'PLANNED' ? <AppText size={13} weight="700" style={{ color: c.success }}>{t('kzDoneToday')}</AppText> : null}
            </>
          ) : (
            <Row style={{ gap: 12 }}>
              <IconCircle icon="leaf-outline" tone={1} size={46} />
              <View style={{ flex: 1 }}><AppText size={17} weight="800">{t('kzTitle')}</AppText><AppText size={13} muted>{t('kzIntro')}</AppText></View>
              <Icon name="chevron-forward" size={20} color={c.textMuted} />
            </Row>
          )}
        </Card>
      </Pressable>

      <Row style={{ gap: 10, alignItems: 'stretch' }}>
        <StatBlock label={t('lastMood')} value={latest ? `${latest.mood}/10` : '–'} icon="happy-outline" />
        <StatBlock label={t('lastStress')} value={latest ? `${latest.stress}/10` : '–'} icon="pulse-outline" />
        <StatBlock label={t('lastSleep')} value={sleepAvg != null ? String(Math.round(sleepAvg)) : '–'} icon="bed-outline" />
      </Row>

      {plan.data ? (
        <>
          <SectionTitle>{t('todayPlan')}</SectionTitle>
          <Card style={{ gap: 12 }}>
            {plan.data.note ? <AppText size={14} style={{ color: c.primary }}>{plan.data.note}</AppText> : null}
            {plan.data.items.map((i) => (
              <Row key={i.id} style={{ gap: 12 }}>
                <View style={{ width: 62, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: i.done ? c.success : c.lavender, alignItems: 'center' }}>
                  <AppText size={13} weight="800" style={{ color: i.done ? c.onPrimary : c.primary }}>{i.time}</AppText>
                </View>
                <AppText style={{ flex: 1 }} weight={i.done ? '400' : '600'}>{i.title}</AppText>
                {i.done ? <Icon name="checkmark-circle" size={20} color={c.success} /> : null}
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('spTodayTitle')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {sitting ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={t('spOpenA11y', { title: sitting.title })} onPress={() => nav.navigate('ProgramDetail', { programId: sitting.id })}>
              <AppText size={17} weight="800">{sitting.title}</AppText>
              <AppText size={13} muted>{t('spDayOf', { n: sitting.currentDay, m: sitting.plannedDays })} · {t('spMinutesADay', { n: sitting.dailyMinutes })}</AppText>
            </Pressable>
            <TodayButton p={sitting} />
          </>
        ) : (
          <>
            <AppText muted>{t('spHomeNone')}</AppText>
            <Button title={t('spNewShort')} icon="add-circle-outline" variant="secondary" onPress={() => nav.navigate('NewProgram')} />
          </>
        )}
      </Card>
      <Row style={{ gap: 10, alignItems: 'stretch' }}>
        <Tile icon="flower-outline" label={t('quickBreathe')} tone={1} onPress={() => nav.navigate('Exercise', { kind: 'breathing' })} style={{ minWidth: 90 }} />
        <Tile icon="book-outline" label={t('quickJournal')} tone={3} onPress={() => nav.navigate('JournalEdit')} style={{ minWidth: 90 }} />
        <Tile icon="bulb-outline" label={t('quickWellness')} tone={0} onPress={() => nav.navigate('Wellness')} style={{ minWidth: 90 }} />
      </Row>
      <Row style={{ gap: 10, alignItems: 'stretch' }}>
        <Tile icon="school-outline" label={t('tilePrograms')} tone={2} onPress={() => nav.navigate('Programs')} style={{ minWidth: 90 }} />
        <Tile icon="flower-outline" label={t('tileGarden')} tone={0} onPress={() => nav.navigate('Garden')} style={{ minWidth: 90 }} />
        <Tile icon="rainy-outline" label={t('tileSounds')} tone={1} onPress={() => nav.navigate('Sounds')} style={{ minWidth: 90 }} />
      </Row>

      <AppText size={12} muted style={{ textAlign: 'center', marginTop: 8 }}>{t('disclosureShort')}</AppText>
    </Screen>
  );
}
