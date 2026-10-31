import { useEffect } from 'react';
import { useAiSettings } from '../api/aiSettings';
import { useGuide } from './guideEngine';

/** Mirrors the server's "How much should Nivora suggest?" level into the guide store. Keeps the last known level (default SOMETIMES) when offline. */
export function SuggestionBridge() {
  const level = useAiSettings().data?.suggestionLevel;
  useEffect(() => { if (level) useGuide.getState().setSuggestionLevel(level); }, [level]);
  return null;
}
