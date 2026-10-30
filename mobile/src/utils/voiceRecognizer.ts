// Which listening engine to use for a language. Pure so it can be tested without native modules.
export type RecogReason = 'unsupported_language' | 'no_network' | 'denied' | 'failed';

export interface RecognizerCapabilities {
  /** The phone's own recogniser exists (native module present and isRecognitionAvailable()). */
  deviceAvailable: boolean;
  /** Locales the phone's recogniser supports (from getSupportedLocales). Omit if unknown: then only English is assumed to work. */
  supportedLocales?: string[];
  /** Locales it can recognise offline (on-device packs). */
  onDeviceLocales?: string[];
  /** Whether the phone is online (the cloud path and most device recognisers need it). Default true. */
  online?: boolean;
}

export interface RecognizerChoice {
  kind: 'device' | 'cloud' | 'none';
  /** Why the device recogniser was not used (or why nothing can listen): lets the UI explain. */
  reason?: RecogReason;
}

const lc = (l: string) => l.toLowerCase().replace('_', '-');
const matches = (list: string[] | undefined, locale: string) => {
  if (!list) return false;
  const want = lc(locale), lang = want.split('-')[0]!;
  return list.some((l) => { const x = lc(l); return x === want || x.split('-')[0] === lang; });
};

/**
 * 'auto' (speak any language) always goes to the cloud. Otherwise the phone's recogniser is used only when it exists AND supports the
 * locale (online, or offline via an on-device pack); everything else uses the cloud. If the cloud is needed but the phone is offline and
 * has no offline pack, nothing can listen and the reason is 'no_network'.
 */
export function chooseRecognizer(locale: string, caps: RecognizerCapabilities): RecognizerChoice {
  const online = caps.online !== false;
  if (lc(locale) === 'auto') return online ? { kind: 'cloud' } : { kind: 'none', reason: 'no_network' };
  const supported = caps.supportedLocales ? matches(caps.supportedLocales, locale) : lc(locale).startsWith('en');
  const offlineOk = matches(caps.onDeviceLocales, locale);
  if (caps.deviceAvailable && supported && (online || offlineOk)) return { kind: 'device' };
  if (!online) return { kind: 'none', reason: 'no_network' };
  return { kind: 'cloud', reason: caps.deviceAvailable && !supported ? 'unsupported_language' : undefined };
}

/** Maps a native expo-speech-recognition error code to our reason (undefined = it just heard nothing). */
export function reasonFromNativeError(code: string | undefined): RecogReason | 'none' {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': return 'denied';
    case 'language-not-supported': return 'unsupported_language';
    case 'network': return 'no_network';
    case 'no-speech': case 'speech-timeout': case 'aborted': return 'none';
    default: return 'failed';
  }
}
