import React, { useState } from 'react';
import { View } from 'react-native';
import { isCapabilities, useCapabilities, type Capabilities, type CapabilitySection } from '../api/capabilities';
import { useT } from '../i18n';
import { AppText, Button, Card, Chip, Row } from './ui';

/** Compact, dismissible "What I can do here" card. Purely informational: it never blocks anything. */
export function CapabilitiesView({ caps, onPick }: { caps: Capabilities; onPick?: (label: string) => void }) {
  const t = useT();
  const [gone, setGone] = useState(false);
  if (gone || !isCapabilities(caps)) return null;
  return (
    <View testID="capabilities-card">
      <Card style={{ gap: 8, padding: 12 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText size={14} weight="800" accessibilityRole="header" style={{ flex: 1 }}>{caps.title || t('capTitle')}</AppText>
          <Button title={t('capHide')} variant="ghost" onPress={() => setGone(true)} style={{ minHeight: 44, paddingVertical: 6 }} />
        </Row>
        <Row style={{ flexWrap: 'wrap' }}>
            {caps.items.map((it) => <Chip key={it.id} label={it.label} onPress={() => onPick?.(it.label)} />)}
        </Row>
      </Card>
    </View>
  );
}

/** Fetches the section menu and shows it; renders nothing while loading or on any error. */
export function CapabilitiesCard({ section, kind }: { section: CapabilitySection; kind?: string }) {
  const q = useCapabilities(section, kind);
  if (!q.data) return null;
  return <CapabilitiesView caps={q.data} />;
}
