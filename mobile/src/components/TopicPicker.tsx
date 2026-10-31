import React, { useState } from 'react';
import { View } from 'react-native';
import { createTopic, TOPIC_KINDS, topicName, useTopicMutation, useTopics, type TopicKind } from '../api/topics';
import { useT, type StringKey } from '../i18n';
import { useTheme } from '../theme';
import { track } from '../utils/analytics';
import { AppText, Button, Chip, Field, Row } from './ui';

export const kindKey = (k: TopicKind) => `topicKind${k}` as StringKey;

/** Picks an existing topic or creates one on the spot. `value` is a topic id (null = no topic). */
export function TopicPicker({ value, onChange, allowNone = true }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const t = useT();
  const { c } = useTheme();
  const topics = useTopics();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<TopicKind | null>(null);
  const [label, setLabel] = useState('');
  const [err, setErr] = useState(false);
  const create = useTopicMutation(createTopic);
  const ready = !!kind && (kind !== 'OTHER' || !!label.trim());

  const submit = () => {
    if (!kind || !ready) return;
    setErr(false);
    create.mutate({ kind, ...(kind === 'OTHER' ? { label: label.trim() } : {}) }, {
      onSuccess: (tp) => {
        track('topic_created', { kind: kind.toLowerCase() }); // never the custom label
        onChange(tp.id); setAdding(false); setKind(null); setLabel('');
      },
      onError: () => setErr(true),
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <Row style={{ flexWrap: 'wrap' }}>
        {allowNone ? <Chip label={t('topicPickNone')} selected={value === null} onPress={() => onChange(null)} /> : null}
        {(Array.isArray(topics.data) ? topics.data : []).map((tp) => (
          <Chip key={tp.id} label={topicName(tp, (k) => t(kindKey(k)))} selected={value === tp.id} onPress={() => onChange(tp.id)} />
        ))}
        <Chip label={`+ ${t('topicsNew')}`} selected={adding} onPress={() => setAdding((a) => !a)} />
      </Row>
      {adding ? (
        <View style={{ gap: 10 }}>
          <Row style={{ flexWrap: 'wrap' }}>
            {TOPIC_KINDS.map((k) => <Chip key={k} label={t(kindKey(k))} selected={kind === k} onPress={() => setKind(k)} />)}
          </Row>
          {kind === 'OTHER' ? <Field label={t('topicCustomLabel')} hint={t('topicCustomHint')} value={label} onChangeText={setLabel} maxLength={60} /> : null}
          {err ? <AppText size={13} style={{ color: c.danger }}>{t('topicCreateError')}</AppText> : null}
          <Button title={t('topicCreate')} onPress={submit} loading={create.isPending} disabled={!ready} />
        </View>
      ) : null}
    </View>
  );
}
