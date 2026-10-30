import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { authBiometric, biometricAvailable, lockSupported, verifyPasscode } from '../utils/appLock';
import { SakuraPetals } from './sakura';
import { AppText, Button, Field, IconCircle } from './ui';

/** True once persisted settings (incl. the lock flag) have loaded; hold the splash until then. */
export function useAppLockReady(): boolean {
  const [ready, setReady] = useState(() => useSettings.persist.hasHydrated());
  useEffect(() => {
    if (useSettings.persist.hasHydrated()) { setReady(true); return; }
    return useSettings.persist.onFinishHydration(() => setReady(true));
  }, []);
  return ready;
}

/** Wraps the app. When app lock is on, covers everything with a calm lock screen until unlocked. Web: no-op. */
export function LockGate({ children }: { children: React.ReactNode }) {
  const ready = useAppLockReady();
  const enabled = useSettings((s) => s.lockEnabled);
  const lockAfter = useSettings((s) => s.lockAfter);
  const [locked, setLocked] = useState(true);
  const bgAt = useRef<number | null>(null);

  useEffect(() => { if (ready) setLocked(lockSupported && enabled); }, [ready, enabled]);
  useEffect(() => {
    if (!lockSupported || !enabled) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') {
        bgAt.current = Date.now();
        if (lockAfter === 0) setLocked(true);
      } else if (st === 'active' && bgAt.current != null) {
        if (Date.now() - bgAt.current >= lockAfter * 1000) setLocked(true);
        bgAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled, lockAfter]);

  const show = lockSupported && (!ready || (enabled && locked));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} accessibilityElementsHidden={show} importantForAccessibility={show ? 'no-hide-descendants' : 'auto'}>{ready ? children : null}</View>
      {show ? <LockScreen waiting={!ready} onUnlock={() => setLocked(false)} /> : null}
    </View>
  );
}

function LockScreen({ onUnlock, waiting }: { onUnlock: () => void; waiting: boolean }) {
  const t = useT();
  const { c } = useTheme();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [bio, setBio] = useState(false);
  const fails = useRef(0);
  const until = useRef(0);

  const tryBio = useCallback(async () => {
    if (await authBiometric(t('engBioPrompt'), t('engCancel'))) onUnlock();
  }, [t, onUnlock]);
  useEffect(() => {
    if (waiting) return;
    biometricAvailable().then((ok) => { setBio(ok); if (ok) void tryBio(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const submit = async () => {
    const wait = Math.ceil((until.current - Date.now()) / 1000);
    if (wait > 0) { setMsg(t('engTryLater', { n: wait })); return; }
    if (await verifyPasscode(code)) { fails.current = 0; setCode(''); onUnlock(); return; }
    fails.current += 1; setCode('');
    if (fails.current >= 5) { until.current = Date.now() + 30000; fails.current = 0; setMsg(t('engTryLater', { n: 30 })); } else setMsg(t('engWrongPass'));
  };

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <SakuraPetals count={5} height={420} />
      <IconCircle icon="lock-closed-outline" tone={0} size={72} />
      <AppText size={24} weight="800" accessibilityRole="header" style={{ textAlign: 'center' }}>{t('engLocked')}</AppText>
      {waiting ? null : (
        <View style={{ width: '100%', maxWidth: 340, gap: 12 }}>
          <AppText muted style={{ textAlign: 'center' }}>{t('engLockSub')}</AppText>
          <Field label={t('engEnterPass')} value={code} onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setMsg(''); }}
            keyboardType="number-pad" secureTextEntry maxLength={6} onSubmitEditing={submit} />
          {msg ? <AppText size={13} accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>{msg}</AppText> : null}
          <Button title={t('engUnlock')} icon="lock-closed-outline" disabled={code.length < 4} onPress={submit} />
          {bio ? <Button title={t('engUseBio')} variant="secondary" icon="keypad-outline" onPress={tryBio} /> : null}
        </View>
      )}
    </View>
  );
}
