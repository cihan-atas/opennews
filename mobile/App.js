import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef } from '@react-navigation/native';

import { AuthProvider } from './src/contexts/AuthContext';
import { PlayerProvider } from './src/contexts/PlayerContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';

// Status bar ikonları uygulama temasına göre (açık temada koyu ikon → şarj/saat görünür)
function ThemedStatusBar() {
  const { theme } = useTheme();
  return <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />;
}
import RootNavigator from './src/navigation/RootNavigator';
import MiniPlayer from './src/components/MiniPlayer';
import OfflineBanner from './src/components/OfflineBanner';

export default function App() {
  const navigationRef = useNavigationContainerRef();
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
      if (data?.type === 'podcast_ready' && navigationRef.isReady()) {
        navigationRef.navigate('Main', { screen: 'Podcasts' });
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
        <ThemeProvider>
          <AuthProvider>
            <PlayerProvider>
              <ThemedStatusBar />
              <RootNavigator navigationRef={navigationRef} />
              <MiniPlayer />
              <OfflineBanner />
            </PlayerProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
