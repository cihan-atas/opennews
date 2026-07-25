/**
 * Push bildirim yardımcıları.
 *
 * Expo Push API ücretsizdir ve FCM/APNs'e yönlendirmeyi üstlenir.
 *
 * ANCAK Android'de kendi FCM projemiz gerekir (Expo Go'da gerekmez, APK'da gerekir):
 *   - google-services.json → app.json'da expo.android.googleServicesFile
 *     (istemci FCM'e kaydolup token alabilsin diye APK'ya gömülür)
 *   - FCM V1 service account key → `eas credentials` ile Expo'ya yüklenir
 *     (exp.host bizim adımıza FCM'e gönderebilsin diye)
 * Eksikse token alınamaz: "Default FirebaseApp is not initialized".
 *
 * ÖNEMLİ: Push, Expo Go'da çalışmaz — development build ya da APK gerekir.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiFetch } from './client';

// SDK 56: shouldShowAlert kaldırıldı → shouldShowBanner + shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const ANDROID_CHANNEL_ID = 'default';

/** Android 8+ kanal olmadan bildirimi HİÇ göstermez — izinden önce oluşturulmalı. */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Genel bildirimler',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#020617',
  });
}

/** app.json → extra.eas.projectId. Token bu kimliğe bağlanır, olmadan alınamaz. */
function getProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId ??
    null
  );
}

/**
 * İzin ister ve Expo push token'ı döner. Başarısızlıkta null döner ama
 * SEBEBİ loglar — sessiz başarısızlık bu mekanizmayı uzun süre çalışmaz tuttu.
 */
export async function registerForPushNotifications() {
  if (Platform.OS === 'web') return null;

  try {
    await ensureAndroidChannel();

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

    const projectId = getProjectId();
    if (!projectId) {
      console.warn('[Push] projectId bulunamadı (app.json → extra.eas.projectId) — token alınamaz.');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Push] Token alındı:', tokenData.data);
    return tokenData.data; // "ExponentPushToken[...]"
  } catch (e) {
    // Expo Go'da bu adım beklenen şekilde başarısız olur; build'de gerçek hatadır.
    console.warn('[Push] Token alınamadı:', e?.message || e);
    return null;
  }
}

export async function sendTokenToServer(expoPushToken) {
  if (!expoPushToken) return;
  try {
    const res = await apiFetch('/users/push-token', {
      method: 'POST',
      body: JSON.stringify({ token: expoPushToken, platform: Platform.OS }),
    });
    if (!res.ok) {
      console.warn('[Push] Token kaydedilemedi — HTTP', res.status);
      return;
    }
    console.log('[Push] Token sunucuya kaydedildi.');
  } catch (e) {
    console.warn('[Push] Token gönderilemedi:', e?.message || e);
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
    console.warn('[Push] Token silinemedi:', e?.message || e);
  }
}

/**
 * İzin+kayıt akışının tamamı. Girişte VE uygulama açılışında (mevcut oturum)
 * çağrılır — yalnızca login'de çağrılması, bir kez giren kullanıcının hiçbir
 * zaman token kaydetmemesine yol açıyordu.
 */
export async function syncPushToken() {
  const token = await registerForPushNotifications();
  if (token) await sendTokenToServer(token);
  return token;
}
