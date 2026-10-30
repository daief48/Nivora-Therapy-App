import { useFocusEffect } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Button, Card, Check, Chip, Icon, IconCircle, Row, Screen, SectionTitle, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { radius, useTheme } from '../theme';
import { SOUND_ASSETS, SOUND_IDS, type SoundId } from '../utils/soundAssets';
import { loadWake, setWakeWindow, WAKE_DEFAULT, type WakeSettings } from '../utils/wakeAlarm';

const META: Record<SoundId, { icon: IconName; name: StringKey; tone: 0 | 1 | 2 | 3 }> = {
  rain: { icon: 'sparkles-outline', name: 'sndRain', tone: 1 },
  ocean: { icon: 'flower-outline', name: 'sndOcean', tone: 2 },
  forest: { icon: 'leaf-outline', name: 'sndForest', tone: 0 },
  brown: { icon: 'moon-outline', name: 'sndBrown', tone: 3 },
  drone: { icon: 'volume-high-outline', name: 'sndDrone', tone: 1 },
};
const TIMERS = [15, 30, 60, 90];
const FADE_MS = 20_000;
const MAX_MIX = 2;
const pad = (n: number) => String(n).padStart(2, '0');

export function SoundsScreen() {
  const t = useT();
  const { c } = useTheme();
  const players = useRef<Partial<Record<SoundId, AudioPlayer>>>({});
  const [active, setActive] = useState<SoundId[]>([]);
  const [volume, setVolume] = useState(0.6);
  const [timer, setTimer] = useState<number | null>(null); // minutes, null = until stopped
  const [left, setLeft] = useState<number | null>(null); // minutes remaining, for display
  const endAt = useRef<number | null>(null);
  const fade = useRef(1);
  const vol = useRef(0.6);
  const err = useRef(false);
  const [error, setError] = useState(false);

  const applyVolume = useCallback(() => {
    for (const p of Object.values(players.current)) { try { if (p) p.volume = Math.max(0, Math.min(1, vol.current * fade.current)); } catch { /* */ } }
  }, []);

  const release = useCallback((id: SoundId) => {
    const p = players.current[id];
    delete players.current[id];
    try { p?.pause(); } catch { /* */ }
    try { p?.remove(); } catch { /* */ }
  }, []);

  const stopAll = useCallback(() => {
    (Object.keys(players.current) as SoundId[]).forEach(release);
    endAt.current = null; fade.current = 1; setActive([]); setLeft(null);
  }, [release]);

  // Stop when the screen loses focus or unmounts. (Phone lock does not blur the screen, so playback continues where the OS allows.)
  useFocusEffect(useCallback(() => stopAll, [stopAll]));
  useEffect(() => stopAll, [stopAll]);

  const toggle = async (id: SoundId) => {
    if (players.current[id]) { release(id); setActive((a) => a.filter((x) => x !== id)); return; }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, allowsRecording: false });
      const p = createAudioPlayer(SOUND_ASSETS[id]);
      p.loop = true;
      fade.current = 1;
      p.volume = vol.current;
      p.play();
      players.current[id] = p;
      setError(false);
      setActive((a) => {
        const next = [...a, id];
        while (next.length > MAX_MIX) release(next.shift()!);
        return next;
      });
      if (timer && !endAt.current) endAt.current = Date.now() + timer * 60_000;
    } catch { err.current = true; setError(true); }
  };

  const pickTimer = (m: number | null) => {
    setTimer(m);
    endAt.current = m && active.length ? Date.now() + m * 60_000 : null;
    fade.current = 1; applyVolume();
    setLeft(m && active.length ? m : null);
  };

  // Countdown with a gentle fade-out over the last 20 s, then stop.
  useEffect(() => {
    if (!active.length) return;
    const iv = setInterval(() => {
      const end = endAt.current;
      if (!end) return;
      const rem = end - Date.now();
      if (rem <= 0) { stopAll(); return; }
      fade.current = rem < FADE_MS ? rem / FADE_MS : 1;
      applyVolume();
      setLeft(Math.ceil(rem / 60_000));
    }, 500);
    return () => clearInterval(iv);
  }, [active.length, applyVolume, stopAll]);

  const step = (d: number) => { vol.current = Math.max(0.1, Math.min(1, Math.round((vol.current + d) * 10) / 10)); setVolume(vol.current); applyVolume(); };

  return (
    <Screen>
      <AppText size={22} weight="800" accessibilityRole="header">{t('sndTitle')}</AppText>
      <AppText muted>{t('sndIntro')}</AppText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {SOUND_IDS.map((id) => {
          const on = active.includes(id);
          const m = META[id];
          return (
            <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t(m.name)}, ${on ? t('sndPause') : t('sndPlay')}`}
              onPress={() => toggle(id)}
              style={{ flexGrow: 1, flexBasis: '45%', minHeight: 120, padding: 14, gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg ?? 20, backgroundColor: on ? c.primary : c.card, borderWidth: 1, borderColor: on ? c.primary : c.border }}>
              <IconCircle icon={m.icon} tone={m.tone} size={48} />
              <AppText size={15} weight="700" style={on ? { color: c.onPrimary } : undefined}>{t(m.name)}</AppText>
              <Icon name={on ? 'stop' : 'play'} size={18} color={on ? c.onPrimary : c.textMuted} />
            </Pressable>
          );
        })}
      </View>
      <AppText size={12} muted>{t('sndMixHint')}</AppText>

      <Card style={{ gap: 12 }}>
        <SectionTitle>{t('sndVolume')}</SectionTitle>
        <Row style={{ gap: 12, justifyContent: 'center' }}>
          <Chip label="−" onPress={() => step(-0.1)} />
          <View accessibilityRole="adjustable" accessibilityLabel={t('sndVolume')} accessibilityValue={{ min: 0, max: 100, now: Math.round(volume * 100) }} style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.border, overflow: 'hidden' }}>
            <View style={{ width: `${volume * 100}%`, height: '100%', backgroundColor: c.primary }} />
          </View>
          <Chip label="+" onPress={() => step(0.1)} />
        </Row>
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionTitle>{t('sndTimer')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TIMERS.map((m) => <Chip key={m} label={`${m} ${t('sndMin')}`} selected={timer === m} onPress={() => pickTimer(m)} />)}
          <Chip label={t('sndUntilStopped')} selected={timer === null} onPress={() => pickTimer(null)} />
        </View>
        {timer && left && active.length ? <AppText size={13} muted>{t('sndTimerLeft', { n: left })}</AppText> : null}
        {active.length ? <Button title={t('sndStopAll')} icon="stop" variant="secondary" onPress={stopAll} /> : null}
        {error ? <AppText size={13} style={{ color: c.danger }}>{t('sndError')}</AppText> : null}
      </Card>

      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sndOffline')}</AppText>

      <WakeCard />
    </Screen>
  );
}

function WakeCard() {
  const t = useT();
  const [s, setS] = useState<WakeSettings>(WAKE_DEFAULT);
  const [msg, setMsg] = useState('');
  useEffect(() => { void loadWake().then(setS); }, []);

  const save = async (next: WakeSettings) => {
    setS(next);
    const ok = await setWakeWindow(next, t('sndWakeTitleN'), [t('sndWakeB1'), t('sndWakeB2'), t('sndWakeB3')]);
    if (!ok && next.enabled) { setS({ ...next, enabled: false }); setMsg(t('sndWakeDenied')); }
    else setMsg(next.enabled ? t('sndWakeSaved', { t: `${pad(next.hour)}:${pad(next.minute)}` }) : t('sndWakeOff'));
  };
  const shift = (mins: number) => { const total = (s.hour * 60 + s.minute + mins + 1440) % 1440; void save({ ...s, hour: Math.floor(total / 60), minute: total % 60 }); };

  return (
    <Card tone="lavender" style={{ gap: 12 }}>
      <SectionTitle>{t('sndWakeTitle')}</SectionTitle>
      <AppText size={13} muted>{t('sndWakeNote')}</AppText>
      <Check checked={s.enabled} onToggle={() => void save({ ...s, enabled: !s.enabled })} label={t('sndWakeOn')} />
      <AppText size={14} weight="700">{t('sndWakeTime')}</AppText>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <Chip label="− 1h" onPress={() => shift(-60)} />
        <Chip label="− 5m" onPress={() => shift(-5)} />
        <AppText size={24} weight="800" style={{ minWidth: 80, textAlign: 'center' }}>{pad(s.hour)}:{pad(s.minute)}</AppText>
        <Chip label="+ 5m" onPress={() => shift(5)} />
        <Chip label="+ 1h" onPress={() => shift(60)} />
      </Row>
      <AppText size={14} weight="700">{t('sndWakeWindow')}</AppText>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        {([0, 15, 30] as const).map((w) => <Chip key={w} label={w === 0 ? t('sndWakeNoWindow') : `${w} ${t('sndMin')}`} selected={s.window === w} onPress={() => void save({ ...s, window: w })} />)}
      </Row>
      {msg ? <AppText size={13} muted accessibilityLiveRegion="polite">{msg}</AppText> : null}
    </Card>
  );
}
