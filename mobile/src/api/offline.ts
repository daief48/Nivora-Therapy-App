import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { useEffect, useState } from 'react';

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'nivora-rq-v1', throttleTime: 1500 });

/** Therapy transcripts, journal text and memories are never written to the on-device query cache. */
const SENSITIVE = ['session', 'journal', 'memories']; // 'session' also covers 'sessions'

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      if (q.state.status !== 'success') return false;
      const k = q.queryKey[0];
      return !(typeof k === 'string' && SENSITIVE.some((p) => k.startsWith(p)));
    },
  },
};

/** True when the device is online. Offline-capable features (breathing, routine, Sounds) work either way; this is for UI hints. */
export function useOfflineReady() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return { online, offline: !online };
}
