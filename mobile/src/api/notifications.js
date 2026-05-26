/**
 * Push bildirim yardımcıları.
 *
 * Expo Push API ücretsizdir — FCM/APNs routing dahil, ek credential gerekmez.
 * Android için ayrıca google-services.json gerekmez (Expo yönetimli build'lerde Expo kendi FCM projesini kullanır).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from './client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
  if (Platform.OS === 'web') return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Bildirim izni verilmedi.');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data; // "ExponentPushToken[...]"
}

export async function sendTokenToServer(expoPushToken) {
  if (!expoPushToken) return;
  try {
    await apiFetch('/users/push-token', {
      method: 'POST',
      body: JSON.stringify({ token: expoPushToken, platform: Platform.OS }),
    });
  } catch (e) {
    console.warn('[Push] Token gönderilemedi:', e);
  }
}

export async function removeTokenFromServer(expoPushToken) {
  if (!expoPushToken) return;
  try {
    await apiFetch('/users/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ token: expoPushToken, platform: Platform.OS }),
    });
  } catch (e) {
    console.warn('[Push] Token silinemedi:', e);
  }
}
