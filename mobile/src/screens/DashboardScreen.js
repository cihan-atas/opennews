import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../api/client';
import { useToast, Toast } from '../components/Toast';
import NewsDetailModal from '../components/NewsDetailModal';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stats, setStats] = useState(null);
  const [trending, setTrending] = useState([]);
  const [rssTrending, setRssTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes, rRes] = await Promise.all([
        apiFetch('/users/stats'),
        apiFetch('/news/trending'),
        apiFetch('/rss-reader/trending'),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (tRes.ok) setTrending(await tRes.json());
      if (rRes.ok) setRssTrending(await rRes.json());
    } catch (_) {
      showToast('Gündem yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const statCards = stats ? [
    { icon: '📰', label: 'Toplam Okuma', value: stats.articles_read ?? 0, color: colors.primaryLight },
    { icon: '📅', label: 'Bu Hafta', value: stats.week_reads ?? 0, color: colors.success },
    { icon: '🎙️', label: 'Podcast', value: stats.podcasts_count ?? 0, color: colors.warning },
    { icon: '🔖', label: 'Kaydedilen', value: stats.bookmarks_count ?? 0, color: '#ec4899' },
  ] : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primaryLight} />}
      >
        <Text style={styles.h1}>Gündem</Text>
        <Text style={styles.sub}>Okuma özetin ve şu an öne çıkanlar.</Text>

        {loading && !stats ? (
          <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* İstatistik kartları */}
            <View style={styles.statGrid}>
              {statCards.map((c) => (
                <View key={c.label} style={styles.statCard}>
                  <Text style={{ fontSize: 24 }}>{c.icon}</Text>
                  <Text style={[styles.statValue, { color: c.color }]}>{c.value}</Text>
                  <Text style={styles.statLabel}>{c.label}</Text>
                </View>
              ))}
            </View>

            {!!stats?.favorite_category && (
              <View style={styles.favCard}>
                <Text style={{ fontSize: 22 }}>🏆</Text>
                <View>
                  <Text style={styles.favLabel}>En Çok Okuduğun Kategori</Text>
                  <Text style={styles.favValue}>{stats.favorite_category}</Text>
                </View>
              </View>
            )}

            {/* Trend haberler */}
            {trending.length > 0 && (
              <View style={{ marginTop: 28 }}>
                <Text style={styles.sectionTitle}>🔥 Şu An Gündemde</Text>
                {trending.slice(0, 8).map((n, idx) => (
                  <Pressable key={n.id} onPress={() => setSelectedId(n.id)} style={styles.row}>
                    <Text style={[styles.rank, { color: idx < 3 ? colors.warning : colors.textFaint }]}>{idx + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{n.title}</Text>
                      <View style={styles.rowMeta}>
                        {!!n.category?.name && <Text style={styles.badge}>{n.category.name}</Text>}
                        <Text style={styles.date}>{new Date(n.created_at).toLocaleDateString('tr-TR')}</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* RSS Gündemi */}
            {rssTrending.length > 0 && (
              <View style={{ marginTop: 28 }}>
                <Text style={styles.sectionTitle}>📡 RSS Gündemi</Text>
                <Text style={styles.sectionSub}>Takip ettiğin RSS beslemelerinden güncel başlıklar.</Text>
                {rssTrending.map((art, idx) => (
                  <Pressable key={art.link || idx} onPress={() => art.link && Linking.openURL(art.link)} style={styles.row}>
                    <Text style={{ fontSize: 18 }}>📰</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{art.title}</Text>
                      <View style={styles.rowMeta}>
                        {!!art.feed_title && <Text style={[styles.badge, { color: colors.success, backgroundColor: 'rgba(16,185,129,0.12)' }]}>{art.feed_title}</Text>}
                        {!!art.published && <Text style={styles.date}>{new Date(art.published).toLocaleDateString('tr-TR')}</Text>}
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {!loading && !stats && (
              <Text style={{ color: colors.textDim, textAlign: 'center', marginTop: 40 }}>Veri yüklenemedi.</Text>
            )}
          </>
        )}
      </ScrollView>

      <NewsDetailModal newsId={selectedId} visible={!!selectedId} onClose={() => setSelectedId(null)} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 28, fontWeight: '900' },
  sub: { color: colors.textMuted, marginTop: 6, marginBottom: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%', flexGrow: 1, backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.lg, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '900', marginTop: 6 },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 4, letterSpacing: 0.5 },
  favCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)', borderRadius: radius.lg, padding: 16, marginTop: 16 },
  favLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  favValue: { color: colors.primaryLight, fontSize: 18, fontWeight: '900', marginTop: 2 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  sectionSub: { color: colors.textDim, fontSize: 13, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 14, marginTop: 10 },
  rank: { fontSize: 18, fontWeight: '900', minWidth: 22 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  badge: { color: colors.primaryLight, backgroundColor: colors.primarySoft, fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, textTransform: 'uppercase' },
  date: { color: colors.textFaint, fontSize: 12 },
});
