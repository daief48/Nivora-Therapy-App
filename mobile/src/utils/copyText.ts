/**
 * Copies text to the clipboard where the platform allows it (web). Returns false when it cannot, so the caller can say
 * "hold the text to copy it, or use Share". There is no native clipboard module in this app yet: to enable it on phones,
 * install expo-clipboard and call `Clipboard.setStringAsync(text)` here.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } } }).navigator;
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return false;
}
