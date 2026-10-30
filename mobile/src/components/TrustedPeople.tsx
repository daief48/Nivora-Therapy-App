import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { api } from '../api/client';
import { useT } from '../i18n';
import { useAuth } from '../store/auth';
import { AppText, Button, Card, EmptyState, Row } from './ui';

export interface TrustedContact { id: string; name: string; phone: string; relation: string | null }
export const PLAN_KEYS = ['warningSigns', 'copingSteps', 'distractions', 'peopleToContact', 'professionals', 'safeEnvironment', 'reasonsToLive'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type SafetyPlanData = Record<PlanKey, string[]>;

export const useTrustedContacts = () => {
  const signedIn = useAuth((s) => s.status === 'in');
  return useQuery({ queryKey: ['crisis-contacts'], enabled: signedIn, queryFn: () => api<TrustedContact[]>('/crisis/contacts') });
};
export const useSafetyPlan = () => {
  const signedIn = useAuth((s) => s.status === 'in');
  return useQuery({ queryKey: ['crisis-plan'], enabled: signedIn, queryFn: () => api<{ plan: SafetyPlanData; updatedAt: string | null }>('/crisis/plan') });
};
export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: SafetyPlanData) => api('/crisis/plan', { method: 'PUT', body: plan }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crisis-plan'] }),
  });
}
export function useContactMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['crisis-contacts'] });
  return {
    add: useMutation({ mutationFn: (v: { name: string; phone: string; relation?: string }) => api('/crisis/contacts', { method: 'POST', body: v }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/crisis/contacts/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

const dialable = (s: string) => s.replace(/[^\d+]/g, '');

/** Always asks first; the app never calls or messages anyone by itself. */
export function useContactActions() {
  const t = useT();
  const go = async (url: string) => {
    try { await Linking.openURL(url); } catch { Alert.alert(t('safetyCantOpen')); }
  };
  return (c: TrustedContact, kind: 'call' | 'message') => {
    const scheme = kind === 'call' ? 'tel' : 'sms';
    Alert.alert(
      t(kind === 'call' ? 'safetyCallConfirmTitle' : 'safetyMessageConfirmTitle', { name: c.name }),
      t(kind === 'call' ? 'safetyCallConfirmBody' : 'safetyMessageConfirmBody', { phone: c.phone }),
      [{ text: t('safetyCancel'), style: 'cancel' }, { text: t(kind === 'call' ? 'safetyCall' : 'safetyMessage'), onPress: () => { void go(`${scheme}:${dialable(c.phone)}`); } }],
    );
  };
}

/** One person with call/message buttons. */
export function ContactCard({ c, onDelete }: { c: TrustedContact; onDelete?: () => void }) {
  const t = useT();
  const act = useContactActions();
  return (
    <Card>
      <AppText weight="700">{c.name}{c.relation ? ` · ${c.relation}` : ''}</AppText>
      <AppText size={14} muted>{c.phone}</AppText>
      <Row>
        <Button title={t('safetyCall')} icon={'call-outline' as never} onPress={() => act(c, 'call')} style={{ flex: 1 }} />
        <Button title={t('safetyMessage')} variant="secondary" icon={'chatbubble-outline' as never} onPress={() => act(c, 'message')} style={{ flex: 1 }} />
      </Row>
      {onDelete ? <Button title={t('safetyDelete')} variant="ghost" onPress={onDelete} /> : null}
    </Card>
  );
}

/** Read-only "people I trust" block for the emergency screen. Renders nothing when signed out. */
export function PeopleITrust({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  const signedIn = useAuth((s) => s.status === 'in');
  const q = useTrustedContacts();
  if (!signedIn) return null;
  const list = q.data ?? [];
  return (
    <>
      <AppText size={18} weight="700">{t('safetyPeopleTitle')}</AppText>
      {list.length === 0 && !q.isLoading ? (
        <EmptyState body={t('safetyPeopleEmpty')} action={<Button title={t('safetyAddPerson')} variant="secondary" onPress={onAdd} />} />
      ) : list.map((c) => <ContactCard key={c.id} c={c} />)}
    </>
  );
}
