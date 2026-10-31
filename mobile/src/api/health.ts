import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export type HealthSource = 'healthconnect' | 'healthkit';
export interface HealthStatus { connected: boolean; importedSleepNights: number; importedActivityDays: number }
export interface SleepNight { date: string; bedtime: string; wakeTime: string; awakenings?: number; latencyMin?: number }
export interface ActivityDay { date: string; steps?: number; walkingMin?: number; exerciseMin?: number }
export interface ImportResult { source: HealthSource; imported: { sleep: number; activity: number }; skippedManual: { sleep: number; activity: number } }
export interface DisconnectResult { deleted: { sleep: number; activity: number }; consentWithdrawn: boolean }

export const useHealthStatus = () => useQuery({ queryKey: ['health', 'status'], queryFn: () => api<HealthStatus>('/health/status') });
export const grantHealthConsent = () => api('/consents', { method: 'POST', body: { consentType: 'HEALTH_IMPORT' } });
export const importHealth = (body: { source: HealthSource; sleep: SleepNight[]; activity: ActivityDay[] }) => api<ImportResult>('/health/import', { method: 'POST', body: { ...body, sleep: body.sleep.slice(-120), activity: body.activity.slice(-120) } });
export const disconnectHealth = () => api<DisconnectResult>('/health/import', { method: 'DELETE' });
