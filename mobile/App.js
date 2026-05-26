import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import { AuthProvider } from './src/contexts/AuthContext';
import { PlayerProvider } from './src/contexts/PlayerContext';
import RootNavigator from './src/navigation/RootNavigator';
import MiniPlayer from './src/components/MiniPlayer';

export default function App() {
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    // Uygulama açıkken gelen bildirimler
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Push] Bildirim alındı:', notification.request.content.title);
    });

    // Bildirime tıklanınca (arka plan / kapalı dahil)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'podcast_ready') {
        // Podcast sekmesine yönlendirme RootNavigator'dan yapılabilir;
        // şimdilik sadece logluyoruz — navigasyon entegrasyonu ileride eklenebilir.
        console.log('[Push] Podcast bildirimine tıklandı.');
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PlayerProvider>
            <StatusBar style="light" />
            <RootNavigator />
            <MiniPlayer />
          </PlayerProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
