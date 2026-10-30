import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { errorMessageKey } from '../api/hooks';
import { ContactCard, PLAN_KEYS, useContactMutations, useSafetyPlan, useSavePlan, useTrustedContacts, type PlanKey, type SafetyPlanData } from '../components/TrustedPeople';
import { AppText, Button, Card, EmptyState, ErrorState, Field, Hero, Loading, Row, Screen, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { useAuth } from '../store/auth';

const MAX_LINES = 10;
const MAX_PEOPLE = 5;
const emptyPlan = (): SafetyPlanData => ({ warningSigns: [], copingSteps: [], distractions: [], peopleToContact: [], professionals: [], safeEnvironment: [], reasonsToLive: [] });
const cap = (k: PlanKey) => k[0].toUpperCase() + k.slice(1);

function PlanSection({ k, lines, onChange }: { k: PlanKey; lines: string[]; onChange: (l: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const full = lines.length >= MAX_LINES;
  const add = () => { const v = draft.trim(); if (v && !full) { onChange([...lines, v.slice(0, 200)]); setDraft(''); } };
  return (
    <Card>
      <AppText weight="700">{t(`safety${cap(k)}` as StringKey)}</AppText>
      <AppText size={14} muted>{t(`safety${cap(k)}Hint` as StringKey)}</AppText>
      {lines.length === 0 ? <AppText size={14} muted>{t('safetyEmptySection')}</AppText> : lines.map((l, i) => (
        <Row key={`${i}-${l}`} style={{ alignItems: 'center' }}>
          <AppText style={{ flex: 1 }}>{l}</AppText>
          <Button title={t('safetyRemoveLine')} variant="ghost" onPress={() => onChange(lines.filter((_, j) => j !== i))} />
        </Row>
      ))}
      {full ? <AppText size={13} muted>{t('safetyFull')}</AppText> : (
        <>
          <Field value={draft} onChangeText={setDraft} placeholder={t('safetyLinePlaceholder')} maxLength={200} onSubmitEditing={add} returnKeyType="done" accessibilityLabel={t(`safety${cap(k)}` as StringKey)} />
          <Button title={t('safetyAddLine')} variant="secondary" disabled={!draft.trim()} onPress={add} />
        </>
      )}
    </Card>
  );
}

function PeopleSection() {
  const t = useT();
  const q = useTrustedContacts();
  const { add, remove } = useContactMutations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const list = q.data ?? [];
  const validPhone = /^\+?[\d\s\-()]{3,24}$/.test(phone.trim());

  const save = () => {
    if (!validPhone) { Alert.alert(t('safetyBadPhone')); return; }
    add.mutate({ name: name.trim(), phone: phone.trim(), relation: relation.trim() || undefined }, {
      onSuccess: () => { setOpen(false); setName(''); setPhone(''); setRelation(''); },
      onError: (e) => Alert.alert(t(errorMessageKey(e))),
    });
  };
  const confirmDelete = (id: string) => Alert.alert(t('safetyDeletePersonTitle'), t('safetyDeletePersonBody'), [
    { text: t('safetyCancel'), style: 'cancel' },
    { text: t('safetyDelete'), style: 'destructive', onPress: () => remove.mutate(id) },
  ]);

  return (
    <>
      <SectionTitle>{t('safetyPeopleTitle')}</SectionTitle>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 && !open ? (
        <EmptyState body={t('safetyPeopleEmpty')} />
      ) : list.map((c) => <ContactCard key={c.id} c={c} onDelete={() => confirmDelete(c.id)} />)}
      {open ? (
        <Card>
          <Field label={t('safetyName')} value={name} onChangeText={setName} maxLength={80} />
          <Field label={t('safetyPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={24} />
          <Field label={t('safetyRelation')} value={relation} onChangeText={setRelation} maxLength={40} />
          <Button title={t('safetySavePerson')} disabled={!name.trim() || !phone.trim()} loading={add.isPending} onPress={save} />
          <Button title={t('safetyCancel')} variant="ghost" onPress={() => setOpen(false)} />
        </Card>
      ) : list.length >= MAX_PEOPLE ? <AppText size={13} muted>{t('safetyPeopleFull')}</AppText> : (
        <Button title={t('safetyAddPerson')} variant="secondary" onPress={() => setOpen(true)} />
      )}
    </>
  );
}

export function SafetyPlanScreen() {
  const t = useT();
  const signedIn = useAuth((s) => s.status === 'in');
  const q = useSafetyPlan();
  const save = useSavePlan();
  const [plan, setPlan] = useState<SafetyPlanData>(emptyPlan());
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (q.data && !dirty) setPlan({ ...emptyPlan(), ...q.data.plan }); }, [q.data, dirty]);

  if (!signedIn) return <Screen><EmptyState body={t('safetySignInNeeded')} /></Screen>;
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const set = (k: PlanKey) => (lines: string[]) => { setDirty(true); setPlan((p) => ({ ...p, [k]: lines })); };
  const when = q.data?.updatedAt ? new Date(q.data.updatedAt).toLocaleString() : null;

  return (
    <Screen>
      <Hero><AppText>{t('safetyPlanIntro')}</AppText></Hero>
      {PLAN_KEYS.map((k) => <PlanSection key={k} k={k} lines={plan[k]} onChange={set(k)} />)}
      <Button title={save.isSuccess && !dirty ? t('safetySaved') : t('safetySave')} loading={save.isPending} disabled={!dirty}
        onPress={() => save.mutate(plan, { onSuccess: () => setDirty(false), onError: (e) => Alert.alert(t(errorMessageKey(e))) })} />
      {when ? <AppText size={13} muted>{t('safetyUpdatedAt', { when })}</AppText> : null}
      <PeopleSection />
    </Screen>
  );
}
