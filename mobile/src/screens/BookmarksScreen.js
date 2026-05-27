import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useToast, Toast } from '../components/Toast';
import NewsDetailModal from '../components/NewsDetailModal';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

export default function BookmarksScreen() {
  const insets = useSafeAreaInsets();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const fetchBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/bookmarks/?page=${page}&size=${pageSize}`);
      if (res.ok) {
        const data = await res.json();
        setBookmarks(data.items || []);
        setTotalCount(data.total_count || 0);
      }
    } catch (_) {
      showToast('Kaydedilenler yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, showToast]);

  useEffect(() => { fetchBookmarks(); }, [fetchBookmarks]);

  const handleRemove = async (newsId) => {
    try {
      const res = await apiFetch(`/bookmarks/${newsId}`, { method: 'DELETE' });
      if (res.ok) {
        setBookmarks((prev) => prev.filter((b) => b.news_id !== newsId));
        setTotalCount((p) => p - 1);
        showToast('Kaydedilenlerden kaldırıldı.');
      }
    } catch (_) { showToast('İşlem başarısız.', 'error'); }
  };

  const renderItem = ({ item: b }) => (
    <Pressable onPress={() => setSelectedId(b.news_id)} style={styles.card}>
      {!!b.news?.category?.name && <Text style={styles.cat}>{b.news.category.name}</Text>}
      <Text style={styles.title} numberOfLines={2}>{b.news?.title || 'Başlık yok'}</Text>
      {!!b.news?.summary && <Text style={styles.summary} numberOfLines={3}>{b.news.summary}</Text>}
      <View style={styles.cardFooter}>
        <Text style={styles.date}>
          {new Date(b.saved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}
        </Text>
        <Pressable onPress={() => handleRemove(b.news_id)} style={styles.removeBtn}>
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Kaldır</Text>
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />
      <View style={styles.header}>
        <Text style={styles.h1}>Kaydedilenler</Text>
        <Text style={styles.sub}>{totalCount > 0 ? `${totalCount} kayıtlı haber` : 'Henüz kayıtlı haber yok.'}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
      ) : bookmarks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 48 }}>🔖</Text>
          <Text style={{ color: colors.textDim, fontSize: 16, marginTop: 12 }}>Henüz haber kaydetmediniz.</Text>
        </View>
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(b) => String(b.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pager}>
                <Pressable disabled={page === 1} onPress={() => setPage((p) => p - 1)} style={[styles.pageBtn, page === 1 && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>←</Text>
                </Pressable>
                <Text style={{ color: colors.textMuted }}>{page}/{totalPages}</Text>
                <Pressable disabled={page === totalPages} onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, page === totalPages && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>→</Text>
                </Pressable>
              </View>
            ) : null
          }
        />
      )}

      <NewsDetailModal newsId={selectedId} visible={!!selectedId} onClose={() => setSelectedId(null)} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  h1: { color: colors.white, fontSize: 26, fontWeight: '900' },
  sub: { color: colors.textMuted, marginTop: 6 },
  empty: { alignItems: 'center', marginTop: 80 },
  card: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.lg, padding: 18 },
  cat: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: colors.white, fontSize: 17, fontWeight: '800', marginVertical: 10, lineHeight: 23 },
  summary: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { color: colors.textFaint, fontSize: 12 },
  removeBtn: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
  pageBtn: { backgroundColor: 'rgba(30,41,59,0.5)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
  pageBtnText: { color: colors.white, fontWeight: '700' },
});
