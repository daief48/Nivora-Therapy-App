/** Calendar helpers. "Today" always means the user's own local day. */
export function localDate(timezone: string | null | undefined, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function lastDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const fromMinutes = (min: number): string => {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** Monday (YYYY-MM-DD) of the week that contains `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** Local weekday (0 = Sunday) and minutes since local midnight for an instant in a timezone. */
export function localClock(timezone: string | null | undefined, at: Date = new Date()): { date: string; dow: number; minutes: number } {
  const date = localDate(timezone, at);
  let hh = 0, mm = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0); mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  } catch { hh = at.getUTCHours(); mm = at.getUTCMinutes(); }
  return { date, dow: new Date(`${date}T00:00:00Z`).getUTCDay(), minutes: hh * 60 + mm };
}
