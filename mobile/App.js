import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef } from '@react-navigation/native';
import { setupNotificationCategories, ACTION_CREATE_PODCAST } from './src/api/notifications';
import { apiFetch } from './src/api/client';

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
    // Bildirime tıklanınca nereye gidileceği. Navigasyon hazır değilse (soğuk
    // başlangıçta olabilir) hazır olana kadar kısa aralıklarla tekrar denenir.
    const routeFor = (data) => {
      if (!data?.type) return null;
      if (data.type === 'podcast_ready') return { screen: 'Podcasts' };
      // RSS bildirimleri: tek makale → makaleyi aç, özet → listeyi aç
      if (data.type === 'rss_article') {
        return {
          screen: 'RSS',
          params: {
            notifArticleId: data.article_id,
            notifListId: data.list_id,
            notifNonce: `a${data.article_id}`,
          },
        };
      }
      if (data.type === 'rss_digest') {
        // Sadece listeye düşmek yetmiyordu: bildirimdeki haberleri yüzlerce
        // makale arasında bulmak zor. batch_at ile tam o parti açılır.
        return {
          screen: 'RSS',
          params: {
            notifListId: data.list_id,
            notifBatchRuleId: data.rule_id,
            notifBatchAt: data.batch_at,
            // Aynı kuraldan ikinci bildirim geldiğinde parametreler birebir aynı
            // kalmasın: ekran değişiklik görmezse partiyi yeniden açmaz.
            notifNonce: `${data.rule_id}:${data.batch_at}`,
          },
        };
      }
      // Akış (kategori / akış gündemi) bildirimleri: haberler news tablosundan
      // geliyor, RSS ekranında gösterilemez → Akış sekmesi açılır.
      if (data.type === 'news_article' && data.news_id) {
        return { screen: 'Home', params: { openNewsId: Number(data.news_id) } };
      }
      if (data.type === 'news_digest') {
        return {
          screen: 'Home',
          params: {
            notifBatchRuleId: data.rule_id,
            notifBatchAt: data.batch_at,
            notifNonce: `${data.rule_id}:${data.batch_at}`,
          },
        };
      }
      return null;
    };

    const go = (data, attempt = 0) => {
      const target = routeFor(data);
      if (!target) return;
      if (navigationRef.isReady()) {
        navigationRef.navigate('Main', target);
      } else if (attempt < 20) {
        setTimeout(() => go(data, attempt + 1), 250);
      }
    };

    const handlePodcastAction = async (data) => {
      try {
        console.log('[Push Action] Podcast oluşturma tetiklendi:', data);
        if (data?.news_id) {
          await apiFetch(`/podcast/generate/${data.news_id}?length=medium`, { method: 'POST' });
        } else if (data?.article_id) {
          await apiFetch(`/rss-reader/podcast-by-article/${data.article_id}?length=medium`, { method: 'POST' });
        } else if (data?.title) {
          await apiFetch('/rss-reader/podcast', {
            method: 'POST',
            body: JSON.stringify({
              title: data.title,
              content: data.content || data.title,
              source_url: data.link || null,
              length: 'medium',
            }),
          });
        }
      } catch (err) {
        console.warn('[Push Action] Podcast isteği hatası:', err);
      }
      const toPodcasts = (att = 0) => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('Main', { screen: 'Podcasts' });
        } else if (att < 20) {
          setTimeout(() => toPodcasts(att + 1), 250);
        }
      };
      toPodcasts();
    };

    const handleResponse = (response) => {
      if (!response) return;
      const actionId = response.actionIdentifier;
      const data = response.notification?.request?.content?.data;
      if (actionId === ACTION_CREATE_PODCAST) {
        handlePodcastAction(data);
      } else {
        go(data);
      }
    };

    setupNotificationCategories();

    // Uygulama açıkken gelen bildirimler
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Push] Bildirim alındı:', notification.request.content.title);
    });

    // Bildirime tıklanınca (arka plan / kapalı dahil)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Uygulama tamamen kapalıyken bildirime tıklanmışsa yukarıdaki dinleyici
    // kaçırabilir — açılışta son yanıtı bir kez kontrol et.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponse(response);
      })
      .catch(() => {});

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
