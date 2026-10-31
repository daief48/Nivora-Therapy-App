import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { asRoutineMark, runUndo, type RoutineMark } from '../api/connect';
import { useCn } from '../i18n/connectT';
import { AppText, Button, Row } from './ui';

/**
 * Quiet line shown when finishing breathing or sounds ticked a step of tonight's routine, with Undo. It renders nothing unless the
 * server says `marked`, and nothing about a failure to mark: a missed tick is never shown as a problem.
 */
export function RoutineTicked({ routine }: { routine?: RoutineMark | null }) {
  const cn = useCn();
  const qc = useQueryClient();
  const mark = asRoutineMark(routine);
  const [state, setState] = useState<'ticked' | 'undone' | 'failed'>('ticked');
  const [busy, setBusy] = useState(false);
  // A new mark (another step, another finish) starts as 'ticked' again, not as the previous 'undone'/'failed'.
  const markKey = mark ? `${mark.stepId}|${mark.undo?.path ?? ''}|${mark.stepsDone ?? ''}` : '';
  useEffect(() => { setState('ticked'); setBusy(false); }, [markKey]);
  if (!mark) return null;
  const undo = async () => {
    if (!mark.undo) return;
    setBusy(true);
    try { await runUndo(mark.undo); setState('undone'); void qc.invalidateQueries({ queryKey: ['routine'] }); }
    catch { setState('failed'); } finally { setBusy(false); }
  };
  return (
    <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
      <AppText size={13} muted accessibilityLiveRegion="polite">{state === 'undone' ? cn('cnUndone') : cn('cnTicked')}</AppText>
      {state !== 'undone' && mark.undo ? <Button title={cn('cnUndo')} variant="ghost" onPress={undo} loading={busy} /> : null}
      {state === 'failed' ? <AppText size={12} muted accessibilityRole="alert">{cn('cnUndoFailed')}</AppText> : null}
    </Row>
  );
}
