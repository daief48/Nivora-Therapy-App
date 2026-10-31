import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/** The app's QueryClient, or undefined when the component is rendered without a provider (isolated renders). Hook order is unchanged either way. */
export function useOptionalQueryClient(): QueryClient | undefined {
  try { return useQueryClient(); } catch { return undefined; }
}
