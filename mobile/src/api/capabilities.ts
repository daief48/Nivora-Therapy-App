import { useEffect, useState } from 'react';
import { api } from './client';

export type CapabilitySection = 'CHAT' | 'KAIZEN' | 'SLEEP' | 'HOME';
/** The short, static "What I can do here" menu for the start of a section (server text, already localized). */
export interface Capabilities { section: CapabilitySection; kind?: string | null; title: string; items: { id: string; label: string }[] }

export const isCapabilities = (c: unknown): c is Capabilities =>
  !!c && typeof c === 'object' && typeof (c as Capabilities).title === 'string' && Array.isArray((c as Capabilities).items) && (c as Capabilities).items.length > 0;

export const getCapabilities = (section: CapabilitySection, kind?: string) => {
  const q = new URLSearchParams({ section });
  if (kind) q.set('kind', kind);
  return api<Capabilities>(`/actions/capabilities?${q.toString()}`);
};

/** Informational only: errors are swallowed (the card just never appears). Plain effect, so it works without a QueryClient. */
export function useCapabilities(section: CapabilitySection, kind?: string): { data: Capabilities | null } {
  const [data, setData] = useState<Capabilities | null>(null);
  useEffect(() => {
    let live = true;
    getCapabilities(section, kind).then((r) => { if (live && isCapabilities(r)) setData(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [section, kind]);
  return { data };
}
