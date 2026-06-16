import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { apiFetch } from '../api/client';
import { useToast, Toast } from '../components/Toast';
import NewsDetailModal from '../components/NewsDetailModal';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayer } from '../contexts/PlayerContext';
import * as SecureStore from 'expo-secure-store';

const PAGE_SIZE = 10;
const SEARCH_HISTORY_KEY = 'searchHistory';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const { setTrack } = usePlayer();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [newsList, setNewsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [searchHistory, setSearchHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(null); // null=ilgi, 0=tümü, id=kategori
  const [interests, setInterests] = useState([]);
  const [trending, setTrending] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [suggestion, setSuggestion] = useState(null);

  const [bulletinLoading, setBulletinLoading] = useState(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const refreshPoll = useRef(null);
  const bulletinPoll = useRef(null);

  const fetchNews = useCallback(async (query, p, catId) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), size: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      if (catId === 0) { /* tümü */ }
      else if (catId) params.set('category_id', String(catId));
      else params.set('interests_only', 'true');

      const res = await apiFetch(`/news/?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNewsList(data.items);
        setTotalCount(data.total_count);
      }
    } catch (_) {
      showToast('Haberler çekilirken bir sorun oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, trRes] = await Promise.all([apiFetch('/users/me'), apiFetch('/news/trending')]);
        if (meRes.ok) setInterests((await meRes.json()).interests || []);
        if (trRes.ok) setTrending(await trRes.json());
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    fetchNews(search, page, activeCategoryId);
    // search'i değişimde tetiklemiyoruz; sadece submit'te (handleSearch) çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeCategoryId]);

  useEffect(() => () => {
    if (refreshPoll.current) clearInterval(refreshPoll.current);
    if (bulletinPoll.current) clearInterval(bulletinPoll.current);
  }, []);

  // Arama geçmişini cihazdan yükle (SecureStore — tema ile aynı kalıcılık).
  useEffect(() => {
    SecureStore.getItemAsync(SEARCH_HISTORY_KEY).then((raw) => {
      if (raw) { try { setSearchHistory(JSON.parse(raw)); } catch (_) {} }
    });
  }, []);

  const pushSearchHistory = (term) => {
    const q = (term || '').trim();
    if (!q) return;
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((t) => t.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      SecureStore.setItemAsync(SEARCH_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const removeHistoryItem = (term) => {
    setSearchHistory((prev) => {
      const next = prev.filter((t) => t !== term);
      SecureStore.setItemAsync(SEARCH_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const handleSearch = () => {
    pushSearchHistory(search);
    setShowHistory(false);
    setPage(1);
    fetchNews(search, 1, activeCategoryId);
  };

  const runSearchFromHistory = (term) => {
    setSearch(term);
    pushSearchHistory(term);
    setShowHistory(false);
    setPage(1);
    fetchNews(term, 1, activeCategoryId);
  };

  const handleCategory = (catId) => { setActiveCategoryId(catId); setPage(1); };

  const handleBulletin = async () => {
    if (bulletinLoading) return;
    setBulletinLoading(true);
    showToast('🎙️ Günlük bülten hazırlanıyor…');
    try {
      const payload = { limit: 5 };
      if (activeCategoryId && activeCategoryId !== 0) payload.category_id = activeCategoryId;
      const res = await apiFetch('/news/bulletin', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Bülten oluşturulamadı.', 'error');
        setBulletinLoading(false);
        return;
      }
      const { title } = await res.json();
      let tries = 0;
      if (bulletinPoll.current) clearInterval(bulletinPoll.current);
      bulletinPoll.current = setInterval(async () => {
        tries += 1;
        try {
          const check = await apiFetch(`/news/bulletin/check?title=${encodeURIComponent(title)}`);
          if (check.ok) {
            const pod = await check.json();
            clearInterval(bulletinPoll.current);
            bulletinPoll.current = null;
            setBulletinLoading(false);
            setTrack(pod.audio_url, pod.title, 'Günlük Bülten', true, pod.id);
            showToast('✅ Bülten hazır, oynatılıyor!');
          }
        } catch (_) {}
        if (tries >= 90) {
          clearInterval(bulletinPoll.current);
          bulletinPoll.current = null;
          setBulletinLoading(false);
          showToast('Bülten beklenenden uzun sürdü; Podcast sekmesinden bakın.', 'error');
        }
      }, 2000);
    } catch (_) {
      setBulletinLoading(false);
      showToast('Bülten oluşturulamadı.', 'error');
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    showToast('Gündem tazeleniyor…');
    try {
      await apiFetch('/news/refresh', { method: 'POST' });
      if (refreshPoll.current) clearInterval(refreshPoll.current);
      refreshPoll.current = setInterval(async () => {
        try {
          const st = await apiFetch('/news/refresh/status');
          if (st.ok && (await st.json()).status === 'idle') {
            clearInterval(refreshPoll.current);
            refreshPoll.current = null;
            setRefreshing(false);
            fetchNews(search, 1, activeCategoryId);
            setPage(1);
            showToast('✅ Gündem güncellendi!');
          }
        } catch (_) {}
      }, 4000);
    } catch (_) {
      setRefreshing(false);
      showToast('Güncelleme sırasında bir hata oluştu.', 'error');
    }
  };

  const openNews = async (newsId) => {
    setSelectedId(newsId);
    try {
      const res = await apiFetch(`/news/${newsId}/click`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestion) setSuggestion(data.suggestion);
      }
    } catch (_) {}
  };

  // Podcast ekranından "Yeniden Oluştur" ile gelindiğinde ilgili haberi aç.
  useEffect(() => {
    const id = route.params?.openNewsId;
    if (id) {
      openNews(id);
      navigation.setParams({ openNewsId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openNewsId]);

  const acceptSuggestion = async () => {
    if (!suggestion) return;
    try {
      const meRes = await apiFetch('/users/me');
      if (meRes.ok) {
        const me = await meRes.json();
        const ids = me.interests.map((i) => i.id);
        if (!ids.includes(suggestion.id)) {
          await apiFetch('/users/interests', {
            method: 'POST',
            body: JSON.stringify({ category_ids: [...ids, suggestion.id] }),
          });
          setInterests([...me.interests, { id: suggestion.id, name: suggestion.name }]);
          showToast(`${suggestion.name} eklendi!`);
        }
      }
    } catch (_) {} finally { setSuggestion(null); }
  };

  const readingTime = (text) => {
    if (!text) return null;
    return Math.ceil(text.trim().split(/\s+/).length / 200);
  };

  const categories = [{ id: null, name: '🎯 İlgi Alanlarım' }, { id: 0, name: '🌐 Tümü' }, ...interests];

  const renderHeader = () => (
    <View>
      <Text style={styles.h1}>Günün Özeti</Text>
      <Text style={styles.sub}>Pürüzsüz ve sana özel bir haber akışı.</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Gündemi tara…"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          onFocus={() => setShowHistory(true)}
          returnKeyType="search"
        />
        <Pressable onPress={handleRefresh} disabled={refreshing} style={styles.refreshBtn}>
          <Text style={{ color: colors.textMuted, fontSize: 18 }}>{refreshing ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      {showHistory && searchHistory.length > 0 && (
        <View style={styles.historyBox}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Son Aramalar</Text>
            <Pressable onPress={() => setShowHistory(false)}>
              <Text style={{ color: colors.textFaint, fontSize: 12 }}>Gizle</Text>
            </Pressable>
          </View>
          {searchHistory.map((term) => (
            <View key={term} style={styles.historyRow}>
              <Pressable onPress={() => runSearchFromHistory(term)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.textFaint }}>🕘</Text>
                <Text style={{ color: colors.textMuted, fontSize: 14 }} numberOfLines={1}>{term}</Text>
              </Pressable>
              <Pressable onPress={() => removeHistoryItem(term)} hitSlop={8}>
                <Text style={{ color: colors.textFaint, fontSize: 14 }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={handleBulletin} disabled={bulletinLoading} style={styles.bulletinBtn}>
        <Text style={styles.bulletinBtnText}>
          {bulletinLoading ? '🎙️  Bülten hazırlanıyor…' : '🎙️  Günlük Bülten Oluştur'}
        </Text>
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }} contentContainerStyle={{ gap: 8 }}>
        {categories.map((cat) => {
          const active = activeCategoryId === cat.id;
          return (
            <Pressable key={cat.id ?? 'interests'} onPress={() => handleCategory(cat.id)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={{ color: active ? colors.white : colors.textMuted, fontWeight: '600' }}>{cat.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {trending.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.trendLabel}>🔥 Şu an Trend</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {trending.map((n) => (
              <Pressable key={n.id} onPress={() => openNews(n.id)} style={styles.trendCard}>
                {!!n.category?.name && <Text style={styles.trendCat}>{n.category.name}</Text>}
                <Text style={styles.trendTitle} numberOfLines={3}>{n.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const renderItem = ({ item: news }) => (
    <Pressable onPress={() => openNews(news.id)} style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.cardCat}>{news.category?.name || 'Haber'}</Text>
        {readingTime(news.summary || news.content) && (
          <Text style={styles.cardMeta}>· {readingTime(news.summary || news.content)} dk okuma</Text>
        )}
      </View>
      <Text style={styles.cardTitle}>{news.title}</Text>
      <Text style={styles.cardSummary} numberOfLines={3}>{news.summary || 'Detaylar yolda…'}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Toast toast={toast} />
      {loading && newsList.length === 0 ? (
        <View style={{ flex: 1 }}>
          {renderHeader()}
          <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
        </View>
      ) : (
        <FlatList
          data={newsList}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primaryLight} />}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>Haber bulunamadı.</Text> : null}
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pager}>
                <Pressable disabled={page === 1} onPress={() => setPage((p) => p - 1)} style={[styles.pageBtn, page === 1 && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>←</Text>
                </Pressable>
                <Text style={{ color: colors.textMuted }}>{totalCount} haber · {page}/{totalPages}</Text>
                <Pressable disabled={page === totalPages} onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, page === totalPages && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>→</Text>
                </Pressable>
              </View>
            ) : null
          }
        />
      )}

      <NewsDetailModal newsId={selectedId} visible={!!selectedId} onClose={() => setSelectedId(null)} />

      {suggestion && (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionTitle}>İlgi Alanı Önerisi 🎯</Text>
          <Text style={styles.suggestionMsg}>{suggestion.message}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable onPress={acceptSuggestion} style={[styles.sgBtn, { backgroundColor: colors.success }]}>
              <Text style={{ color: colors.white, fontWeight: '700' }}>Ekle</Text>
            </Pressable>
            <Pressable onPress={() => setSuggestion(null)} style={[styles.sgBtn, { borderWidth: 1, borderColor: colors.success }]}>
              <Text style={{ color: colors.success, fontWeight: '700' }}>Kapat</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 30, fontWeight: '900', paddingHorizontal: 0, marginTop: 8 },
  sub: { color: colors.textMuted, fontSize: 15, marginTop: 6, marginBottom: 18 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  historyBox: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 6, marginTop: -8, marginBottom: 18 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  historyTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 10 },
  search: {
    flex: 1, backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 12, color: colors.text,
  },
  refreshBtn: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceAlpha, alignItems: 'center', justifyContent: 'center',
  },
  bulletinBtn: {
    marginBottom: 18, paddingVertical: 13, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.primaryLight, backgroundColor: colors.primarySoft, alignItems: 'center',
  },
  bulletinBtnText: { color: colors.primaryLight, fontWeight: '800', fontSize: 14 },
  chip: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipActive: { borderColor: colors.primaryLight, backgroundColor: colors.primarySoft },
  trendLabel: { color: colors.warning, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  trendCard: { width: 240, backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)', borderRadius: radius.md, padding: 16 },
  trendCat: { color: colors.warning, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  trendTitle: { color: colors.text, fontWeight: '700', fontSize: 14, marginTop: 8, lineHeight: 19 },
  card: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, padding: 20 },
  cardCat: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  cardMeta: { color: colors.textFaint, fontSize: 11 },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '800', marginVertical: 12, lineHeight: 25 },
  cardSummary: { color: colors.textMuted, lineHeight: 22 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
  pageBtn: { backgroundColor: colors.surfaceAlpha, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
  pageBtnText: { color: colors.white, fontWeight: '700' },
  suggestion: {
    position: 'absolute', bottom: 24, right: 16, left: 16, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.success, borderRadius: radius.lg, padding: 20,
  },
  suggestionTitle: { color: colors.success, fontSize: 17, fontWeight: '700' },
  suggestionMsg: { color: '#cbd5e1', marginTop: 8 },
  sgBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
});
