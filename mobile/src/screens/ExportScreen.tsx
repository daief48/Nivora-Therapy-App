import { useQuery } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { StatBlock } from '../components/nv';
import { AppText, Button, Card, EmptyState, QueryBoundary, Row, Screen, Segmented, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { useTheme } from '../theme';

type Metric = { avg: number | null; previous: number | null; change: number | null };
type Report = {
  range: { from: string | null; to: string | null; days: number }; checkIns: number; mood: Metric; stress: Metric; energy: Metric;
  sleep: { nights: number; avgScore: number | null; avgHours: number | null; change: number | null };
  kaizen: { doneDays: number; totalDays: number };
  topTags: { tag: string; n: number }[]; observations: string[]; lang: 'en' | 'bn'; disclaimer: string;
};

const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 10) / 10));
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Weekly report preview + clean ivory/blush PDF. Self-reported data only, never a diagnosis. */
export function ExportScreen() {
  const t = useT();
  const { c } = useTheme();
  const [days, setDays] = useState<'7' | '14' | '30'>('7');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const q = useQuery({ queryKey: ['report', days], queryFn: () => api<Report>(`/insights/report?days=${days}`) });
  const tagName = (k: string) => t(`insTag_${k}` as StringKey);

  const html = (r: Report) => {
    const row = (label: string, m: Metric) => `<tr><td>${esc(label)}</td><td>${fmt(m.avg)}</td><td>${m.change == null ? '–' : (m.change > 0 ? '+' : '') + m.change}</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Bengali',sans-serif;background:#FFFDF8;color:#393B38;margin:0;padding:36px}
      .band{background:#F9EDF0;border-radius:18px;padding:22px 26px;margin-bottom:22px}
      h1{margin:0 0 4px;font-size:26px;color:#A9667A}h2{font-size:16px;color:#A9667A;margin:22px 0 8px}
      p{margin:4px 0;line-height:1.5}.muted{color:#6C6E69;font-size:13px}
      table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
      th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #EDE6DA;font-size:14px}th{background:#F7F3EB;font-size:12px;color:#6C6E69}
      .tag{display:inline-block;background:#F9E4E9;color:#A9667A;border-radius:999px;padding:5px 12px;margin:0 6px 6px 0;font-size:13px}
      li{margin:6px 0;line-height:1.5}.foot{margin-top:28px;padding-top:14px;border-top:1px solid #EDE6DA}
    </style></head><body>
      <div class="band"><h1>${esc(t('insReportTitle'))}</h1><p class="muted">${esc(r.range.from ?? '')} – ${esc(r.range.to ?? '')} · ${esc(t('insRangeDays', { n: r.range.days }))} · ${esc(t('insCheckIns'))}: ${r.checkIns}</p></div>
      <table><tr><th></th><th>${esc(t('insAvg'))}</th><th>${esc(t('insChange'))}</th></tr>
        ${row(t('mood'), r.mood)}${row(t('stress'), r.stress)}${row(t('energy'), r.energy)}
        <tr><td>${esc(t('insSleepAvg'))}</td><td>${fmt(r.sleep.avgScore)}</td><td>${r.sleep.change == null ? '–' : (r.sleep.change > 0 ? '+' : '') + r.sleep.change}</td></tr></table>
      <p class="muted">${esc(t('insSleepNights', { n: r.sleep.nights }))} · ${esc(t('insSleepHours'))}: ${fmt(r.sleep.avgHours)}</p>
      <p>${esc(t('insKaizenDays', { a: r.kaizen.doneDays, b: r.kaizen.totalDays }))}</p>
      ${r.topTags.length ? `<h2>${esc(t('insTopTags'))}</h2>${r.topTags.map((x) => `<span class="tag">${esc(tagName(x.tag))} · ${x.n}</span>`).join('')}` : ''}
      ${r.observations.length ? `<h2>${esc(t('insObs'))}</h2><ul>${r.observations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      <div class="foot"><p class="muted">${esc(r.disclaimer)}</p><p class="muted">${esc(t('insDisclaimer'))} · ${esc(t('insGenerated'))}</p></div>
    </body></html>`;
  };

  const share = async (r: Report) => {
    setBusy(true); setFailed(false);
    try {
      if (Platform.OS === 'web') { await Print.printAsync({ html: html(r) }); return; }
      const { uri } = await Print.printToFileAsync({ html: html(r) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      else await Print.printAsync({ uri });
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <AppText size={26} weight="800" accessibilityRole="header">{t('insReportTitle')}</AppText>
      <AppText size={13} muted>{t('insReportSub')}</AppText>
      <Segmented value={days} onChange={setDays} options={(['7', '14', '30'] as const).map((d) => ({ value: d, label: t('insRangeDays', { n: d }) }))} />

      <QueryBoundary q={q}>
        {(r) => {
          if (r.checkIns === 0 && r.sleep.nights === 0) return <EmptyState icon="document-text-outline" body={t('insNoData')} />;
          return (
            <>
              <Row style={{ gap: 10, alignItems: 'stretch' }}>
                <StatBlock label={t('mood')} value={fmt(r.mood.avg)} change={r.mood.change} good="up" icon="happy-outline" />
                <StatBlock label={t('stress')} value={fmt(r.stress.avg)} change={r.stress.change} good="down" icon="pulse-outline" />
                <StatBlock label={t('energy')} value={fmt(r.energy.avg)} change={r.energy.change} good="up" icon="flash-outline" />
              </Row>
              <Card style={{ gap: 6 }}>
                <AppText weight="700">{t('insSleepAvg')}: {fmt(r.sleep.avgScore)}</AppText>
                <AppText size={13} muted>{t('insSleepNights', { n: r.sleep.nights })} · {t('insSleepHours')} {fmt(r.sleep.avgHours)}</AppText>
                <AppText size={13}>{t('insKaizenDays', { a: r.kaizen.doneDays, b: r.kaizen.totalDays })}</AppText>
              </Card>
              {r.topTags.length ? (
                <>
                  <SectionTitle>{t('insTopTags')}</SectionTitle>
                  <Row style={{ flexWrap: 'wrap' }}>{r.topTags.map((x) => <AppText key={x.tag} size={13} style={{ color: c.tintFg[0] }}>{tagName(x.tag)} · {x.n}</AppText>)}</Row>
                </>
              ) : null}
              {r.observations.length ? (
                <>
                  <SectionTitle>{t('insObs')}</SectionTitle>
                  <Card style={{ gap: 8 }}>{r.observations.map((o) => <AppText key={o}>{o}</AppText>)}</Card>
                </>
              ) : null}
              <AppText size={11} muted>{r.disclaimer}</AppText>
              {failed ? <AppText style={{ color: c.danger }} accessibilityRole="alert">{t('insShareFail')}</AppText> : null}
              <Button title={busy ? t('insPreparing') : t('insShare')} icon="document-text-outline" loading={busy} onPress={() => share(r)} />
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
