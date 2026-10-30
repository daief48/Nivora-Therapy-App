import React, { useEffect, useState } from 'react';
import { AppText, Button, Card, Chip, Field, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { authBiometric, biometricAvailable, clearPasscode, lockSupported, setPasscode, validPasscode, verifyPasscode } from '../utils/appLock';

const AFTER = [[0, 'engNow'], [30, 'eng30s'], [60, 'eng1m'], [300, 'eng5m']] as const;
type Step = null | 'create' | 'confirm' | 'verifyOff' | 'verifyChange';

export function SecurityScreen() {
  const t = useT();
  const s = useSettings();
  const [bio, setBio] = useState(false);
  const [step, setStep] = useState<Step>(null);
  const [first, setFirst] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { biometricAvailable().then(setBio); }, []);

  if (!lockSupported) return <Screen><AppText size={24} weight="800" accessibilityRole="header">{t('engSecTitle')}</AppText><Card tone="lavender"><AppText>{t('engWebLock')}</AppText></Card></Screen>;

  const reset = () => { setStep(null); setFirst(''); setCode(''); };
  const submit = async () => {
    setMsg('');
    if (step === 'create') {
      if (!validPasscode(code)) { setMsg(t('engPassRule')); return; }
      setFirst(code); setCode(''); setStep('confirm');
    } else if (step === 'confirm') {
      if (code !== first) { setMsg(t('engPassMismatch')); setCode(''); setStep('create'); setFirst(''); return; }
      if (!(await setPasscode(code))) { setMsg(t('errorTitle')); return; }
      s.set({ lockEnabled: true }); reset(); setMsg(t('engSaved'));
    } else if (step === 'verifyOff') {
      if (!(await verifyPasscode(code))) { setMsg(t('engWrongPass')); setCode(''); return; }
      await clearPasscode(); s.set({ lockEnabled: false }); reset(); setMsg(t('engLockOff'));
    } else if (step === 'verifyChange') {
      if (!(await verifyPasscode(code))) { setMsg(t('engWrongPass')); setCode(''); return; }
      setCode(''); setStep('create');
    }
  };
  // Turning the lock on proves the device biometric works first, when there is one.
  const turnOn = async () => {
    setMsg('');
    if (bio && !(await authBiometric(t('engBioPrompt'), t('engCancel')))) { setMsg(t('engBioFailed')); return; }
    setStep('create');
  };
  const label = step === 'create' ? t('engSetPass') : step === 'confirm' ? t('engConfirmPass') : t('engEnterPass');

  return (
    <Screen>
      <AppText size={24} weight="800" accessibilityRole="header">{t('engSecTitle')}</AppText>
      <AppText muted>{t('engSecIntro')}</AppText>
      <Card>
        <AppText weight="700">{s.lockEnabled ? t('engLockIsOn') : t('engLockIsOff')}</AppText>
        <AppText size={13} muted>{bio ? t('engBioAvail') : t('engBioNone')}</AppText>
        {step ? (
          <>
            <Field label={label} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} onSubmitEditing={submit} />
            {step === 'create' ? <AppText size={13} muted>{t('engPassRule')}</AppText> : null}
            <Row>
              <Button title={t('engCancel')} variant="ghost" onPress={reset} style={{ flex: 1 }} />
              <Button title={t('next')} disabled={code.length < 4} onPress={submit} style={{ flex: 2 }} />
            </Row>
          </>
        ) : s.lockEnabled ? (
          <>
            <Button title={t('engChangePass')} variant="secondary" icon="keypad-outline" onPress={() => { setMsg(''); setStep('verifyChange'); }} />
            <Button title={t('engTurnOff')} variant="ghost" onPress={() => { setMsg(''); setStep('verifyOff'); }} />
          </>
        ) : <Button title={t('engTurnOn')} icon="lock-closed-outline" onPress={turnOn} />}
        {msg ? <AppText size={13} accessibilityLiveRegion="polite">{msg}</AppText> : null}
      </Card>
      {s.lockEnabled ? (
        <>
          <SectionTitle>{t('engAutoLock')}</SectionTitle>
          <Card>
            <Row style={{ flexWrap: 'wrap' }}>
              {AFTER.map(([v, k]) => <Chip key={v} label={t(k)} selected={s.lockAfter === v} onPress={() => s.set({ lockAfter: v })} />)}
            </Row>
            <AppText size={13} muted>{t('engAutoLockNote')}</AppText>
          </Card>
        </>
      ) : null}
      <AppText size={12} muted>{t('engForgotNote')}</AppText>
    </Screen>
  );
}
