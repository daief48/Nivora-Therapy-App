import { Platform } from 'react-native';

// Only the backend URL lives in the app. There is NO GLM key (or any other secret) in the app bundle.
// Android emulators reach the host machine at 10.0.2.2. For a physical device set EXPO_PUBLIC_API_URL to your LAN IP.
const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:4010' : 'http://localhost:4010';
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? fallback).replace(/\/$/, '');
export const API_BASE = `${API_URL}/api/v1`;
export const MAX_MESSAGE_CHARS = 4000;
/** Optional support inbox (operator-provided). When unset the About screen says so instead of showing a dead link. */
export const SUPPORT_EMAIL: string | undefined = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || undefined;
