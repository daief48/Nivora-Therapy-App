/**
 * GoalVoiceMic — the small "speak instead" button in the goal update box.
 * Loaded lazily (require) by GoalCard ONLY when the native speech-recognition module exists,
 * so Expo Go (where the module is absent) simply never loads this file.
 *
 * Tapping the mic opens a small panel: pick the SPOKEN language (defaults to the app language, may differ), speak
 * (continuous recognition, stop with the stop button), edit the recognised text, then confirm. Nothing is submitted
 * automatically: onText receives the edited text and the caller only puts it in the (still editable) note.
 */
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useT, type StringKey } from '../../i18n';
import { useSettings } from '../../store/settings';
import { speechLocale } from '../../utils/speech';
import { radius, useTheme } from '../../theme';
import { AppText, Chip, Icon, Row } from '../ui';

export type SpokenLang = 'auto' | 'en' | 'bn' | 'hi' | 'ne' | 'th';
/** Native names, so every speaker can find their language whatever the app language is. */
export const SPOKEN_LANGS: { id: SpokenLang; label: string }[] = [
  { id: 'auto', label: 'Auto' }, { id: 'bn', label: 'বাংলা' }, { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी' }, { id: 'ne', label: 'नेपाली' }, { id: 'th', label: 'ไทย' },
];

export function GoalVoiceMic({ onText }: { onText: (text: string) => void }) {
  const t = useT();
  const { c } = useTheme();
  const uiLang = useSettings((s) => s.uiLang);
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<SpokenLang>(uiLang);
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState('');
  const [interim, setInterim] = useState('');
  const [msg, setMsg] = useState<StringKey | null>(null);
  const heard = useRef(false);
  // useSpeechRecognitionEvent is global (every mounted mic hears every event), so events are gated on refs:
  const openRef = useRef(false);     // this instance's panel is open
  const activeRef = useRef(false);   // a native session started by this instance is running
  const staleEnds = useRef(0);       // 'end'/'error' events still owed by a session we replaced (language switch)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  // Leaving the screen must not leave a continuous native session (or a pending restart) running.
  useEffect(() => () => {
    const wasOpen = openRef.current;
    openRef.current = false; clearTimer();
    if (wasOpen || activeRef.current) { try { ExpoSpeechRecognitionModule.abort(); } catch { /* */ } }
    activeRef.current = false; staleEnds.current = 0;
  }, []);

  useSpeechRecognitionEvent('result', (e) => {
    if (!openRef.current) return;
    const text = (e.results?.[0]?.transcript ?? '').trim();
    if (!text) return;
    heard.current = true; setMsg(null);
    if (e.isFinal) { setDraft((cur) => (cur ? `${cur.trimEnd()} ${text}` : text)); setInterim(''); }
    else setInterim(text);
  });
  useSpeechRecognitionEvent('end', () => {
    if (staleEnds.current > 0) { staleEnds.current--; return; } // old session ending after a restart/close: not the live one
    if (!openRef.current) return;
    activeRef.current = false;
    setListening(false); setInterim('');
    if (!heard.current) setMsg((m) => m ?? 'kzVcNoSpeech');
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (!openRef.current || staleEnds.current > 0) return;
    setListening(false);
    const code = (e as { error?: string }).error;
    setMsg(code === 'not-allowed' || code === 'service-not-allowed' ? 'kzVcDenied' : code === 'no-speech' || code === 'speech-timeout' ? 'kzVcNoSpeech' : code === 'aborted' ? null : 'kzVcError');
  });

  const start = async (l: SpokenLang = lang) => {
    setMsg(null); heard.current = false;
    try {
      let perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!perm.granted) perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!openRef.current) return; // closed while the permission prompt was up
      if (!perm.granted) { setListening(false); setMsg('kzVcDenied'); return; }
      setListening(true); activeRef.current = true;
      const locale = speechLocale(l);
      ExpoSpeechRecognitionModule.start({ ...(locale === 'auto' ? {} : { lang: locale }), interimResults: true, continuous: true, maxAlternatives: 1 });
    } catch { setListening(false); setMsg('kzVcError'); }
  };
  const stop = () => { try { ExpoSpeechRecognitionModule.stop(); } catch { /* */ } };
  const pick = (l: SpokenLang) => {
    if (l === lang) return;
    setLang(l);
    if (listening) {
      if (activeRef.current) { staleEnds.current++; activeRef.current = false; }
      stop(); clearTimer();
      timer.current = setTimeout(() => { timer.current = null; if (openRef.current) void start(l); }, 300);
    }
  };
  const close = () => { clearTimer(); openRef.current = false;
    if (activeRef.current) { staleEnds.current++; activeRef.current = false; }
    stop(); setOpen(false); setListening(false); setDraft(''); setInterim(''); setMsg(null); };
  const confirm = () => { const text = draft.trim(); stop(); if (text) onText(text); close(); };

  return (
    <View style={{ gap: 8, ...(open ? { width: '100%' } : {}) }}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={t('kzUpVoice')} accessibilityState={{ busy: listening, expanded: open }}
        onPress={() => { if (open) close(); else { openRef.current = true; setDraft(''); setInterim(''); setOpen(true); void start(); } }}
        style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: open ? c.primary : c.border }}>
        <Icon name={listening ? 'stop' : 'mic-outline'} size={20} color={listening ? c.danger : c.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <AppText size={13} muted>{t('kzVcLang')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            {SPOKEN_LANGS.map((l) => <Chip key={l.id} label={l.id === 'auto' ? t('kzVcAuto') : l.label} selected={lang === l.id} onPress={() => pick(l.id)} />)}
          </Row>
          {msg ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(msg)}</AppText> : null}
          {listening ? <AppText size={13} muted accessibilityLiveRegion="polite">{t('kzVcListening')}</AppText> : null}
          <TextInput
            accessibilityLabel={t('kzVcEdit')} placeholder={t('kzVcEdit')} placeholderTextColor={c.textMuted}
            value={draft} onChangeText={setDraft} multiline maxLength={1000}
            style={{ minHeight: 64, borderWidth: 1.5, borderColor: c.border, borderRadius: radius.md, padding: 10, color: c.text, textAlignVertical: 'top' }} />
          {interim ? <AppText size={13} muted>{interim}</AppText> : null}
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            {listening
              ? <Chip label={t('kzVcStop')} onPress={stop} />
              : <Chip label={t('kzVcAgain')} onPress={() => void start()} />}
            <Chip label={t('kzVcUse')} selected onPress={confirm} />
            <Chip label={t('kzVcCancel')} onPress={close} />
          </Row>
        </View>
      ) : null}
    </View>
  );
}
