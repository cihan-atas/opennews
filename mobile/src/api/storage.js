// Token saklama — native'de expo-secure-store (iOS Keychain / Android Keystore),
// web önizlemesinde localStorage (SecureStore web'i desteklemez).
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';
const PINNED_KEY = 'pinned_rss_lists';
const isWeb = Platform.OS === 'web';

// Sabitlenen (pinlenen) RSS liste id'leri — cihazda yerel olarak saklanır.
export async function getPinnedLists() {
  try {
    const raw = isWeb ? localStorage.getItem(PINNED_KEY) : await SecureStore.getItemAsync(PINNED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function setPinnedLists(ids) {
  const raw = JSON.stringify(Array.isArray(ids) ? ids : []);
  if (isWeb) { localStorage.setItem(PINNED_KEY, raw); return; }
  await SecureStore.setItemAsync(PINNED_KEY, raw);
}

export async function getAccessToken() {
  if (isWeb) return localStorage.getItem(ACCESS_KEY);
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken() {
  if (isWeb) return localStorage.getItem(REFRESH_KEY);
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setTokens(accessToken, refreshToken) {
  if (isWeb) {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    return;
  }
  if (accessToken) await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  if (isWeb) {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
