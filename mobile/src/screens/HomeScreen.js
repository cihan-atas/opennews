import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { apiFetch } from '../api/client';
import { formatArticleDate } from '../utils/formatDate';
import IntervalStepper, { INTERVAL_MIN } from '../components/IntervalStepper';
import { useToast, Toast } from '../components/Toast';
import NewsDetailModal from '../components/NewsDetailModal';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
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
  const { user, refreshUser } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [newsList, setNewsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [catSearch, setCatSearch] = useState('');

  // Akış bildirim kuralları — kategori başına ayrı kural (RSS'teki liste-başına
  // kural yapısının karşılığı). Yönetimi bu ekrandaki 🔔 butonundan.
  const [showCatRules, setShowCatRules] = useState(false);
  const [catRules, setCatRules] = useState([]);
  const [catRuleForm, setCatRuleForm] = useState(null);
  const [catRuleSaving, setCatRuleSaving] = useState(false);
  const [ruleCatSearch, setRuleCatSearch] = useState('');   // kural eklerken kategori arama
  const [searchHistory, setSearchHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(null); // null=ilgi, 0=tümü, id=kategori
  // Çoklu kategori seçimi (basılı tutma ile). Boşsa activeCategoryId geçerlidir;
  // doluysa yalnızca bu kategoriler getirilir. "İlgi Alanlarım" ve "Tümü" bu
  // listeye giremez — onlar kapsayıcı seçenekler, birleştirilmeleri anlamsız.
  const [multiCategoryIds, setMultiCategoryIds] = useState([]);
  const [interests, setInterests] = useState([]);
  const [trending, setTrending] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [suggestion, setSuggestion] = useState(null);

  const [bulletinLoading, setBulletinLoading] = useState(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const refreshPoll = useRef(null);
  const bulletinPoll = useRef(null);

  // Son başlatılan yükleme kazanır. Akış ilk sekme olduğu için normal çekim
  // bildirim partisinden önce başlıyor ve geç dönüp partinin üstüne yazabiliyordu.
  const loadTokenRef = useRef(0);

  const fetchNews = useCallback(async (query, p, catId, multiIds = []) => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), size: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      if (multiIds.length) params.set('category_ids', multiIds.join(','));
      else if (catId === 0) { /* tümü */ }
      else if (catId) params.set('category_id', String(catId));
      else params.set('interests_only', 'true');

      const res = await apiFetch(`/news/?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (loadTokenRef.current !== token) return;   // daha yeni bir yükleme var
        setNewsList(data.items);
        setTotalCount(data.total_count);
      }
    } catch (_) {
      showToast('Haberler çekilirken bir sorun oluştu.', 'error');
    } finally {
      if (loadTokenRef.current === token) setLoading(false);
    }
  }, [showToast]);

  // İlgi alanları AuthContext'ten okunuyor: Ayarlar'da kaydedince refreshUser()
  // context'i tazeliyor ve kategori çipleri anında güncelleniyor. Kendi
  // /users/me isteğimizle sadece açılışta okuyorduk; Haber Tercihleri
  // değiştirilince akış eski listeyi göstermeye devam ediyordu.
  useEffect(() => { setInterests(user?.interests || []); }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const trRes = await apiFetch('/news/trending');
        if (trRes.ok) setTrending(await trRes.json());
      } catch (_) {}
    })();
  }, []);

  // Özet bildirimiyle açıldıysa akış listesi yerine o partinin haberleri gösterilir.
  // Ref ilk render'da dolu olmalı: aşağıdaki normal çekim yoksa parti listesinin
  // üstüne yazıyor (bildirime basınca alakasız haberler geliyordu).
  const notifBatchPendingRef = useRef(!!route.params?.notifBatchRuleId);
  const [notifBatch, setNotifBatch] = useState(null); // { count, name }
  const handledBatchRef = useRef(null);

  // Kategori şeridi: bildirimle gelen kategoriye kaydırmak için
  const catStripRef = useRef(null);
  const catChipX = useRef({});
  // Bildirim kategoriyi seçtiğinde tetiklenen çekim atlanır — parti gösteriliyor.
  const skipNextFetchRef = useRef(false);
  // Seçim durumunun güncel kopyası (async parti işleyicisi eski state'i görmesin)
  const activeCatRef = useRef(activeCategoryId);
  const multiCatRef = useRef(multiCategoryIds);
  useEffect(() => {
    activeCatRef.current = activeCategoryId;
    multiCatRef.current = multiCategoryIds;
  }, [activeCategoryId, multiCategoryIds]);

  // Kaydırılmayı bekleyen kategori: { id, until }.
  //
  // Soğuk başlangıçta (uygulama kapalıyken bildirime basmak) tek seferlik
  // kaydırma tutmuyordu — iki ayrı sebeple: çipler henüz ölçülmemiş oluyor
  // (ilgi alanları AuthContext'ten sonradan geliyor) ve ölçülmüş olsa bile
  // şerit birkaç kez yeniden yerleşip kaydırmayı başa alıyor. Bu yüzden hedef
  // kısa bir süre korunur ve her yerleşimde yeniden uygulanır.
  const pendingScrollCatRef = useRef(null);

  const applyPendingCatScroll = () => {
    const pending = pendingScrollCatRef.current;
    if (!pending) return;
    if (Date.now() > pending.until) {
      // Kategori ilgi alanlarından çıkarılmışsa çip hiç gelmez; hedef sonsuza
      // dek beklemesin, sonraki bir yerleşimde beklenmedik yere kaymasın.
      pendingScrollCatRef.current = null;
      return;
    }
    const x = catChipX.current[pending.id];
    if (x === undefined) return;
    catStripRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  };

  const scrollCategoryIntoView = (catId) => {
    pendingScrollCatRef.current = { id: catId, until: Date.now() + 4000 };
    applyPendingCatScroll();
  };

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    if (notifBatchPendingRef.current) {
      // İlk çekim parti için atlanır; sonraki tetiklemeler (kategori/sayfa
      // değişimi) normal akışa döner.
      notifBatchPendingRef.current = false;
      return;
    }
    setNotifBatch(null);
    fetchNews(search, page, activeCategoryId, multiCategoryIds);
    // search'i değişimde tetiklemiyoruz; sadece submit'te (handleSearch) çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeCategoryId, multiCategoryIds]);

  // Akış özet bildirimine tıklanınca: tam olarak o bildirimdeki haberler.
  useEffect(() => {
    const { notifBatchRuleId, notifBatchAt, notifNonce } = route.params || {};
    if (!notifBatchRuleId || !notifBatchAt) return;

    // Aynı kuraldan ikinci bildirim geldiğinde rule_id değişmediği için nonce şart.
    const key = notifNonce || `${notifBatchRuleId}:${notifBatchAt}`;
    if (handledBatchRef.current === key) return;
    handledBatchRef.current = key;

    (async () => {
      const token = ++loadTokenRef.current;
      setLoading(true);
      try {
        const res = await apiFetch(
          `/notifications/batch/${notifBatchRuleId}?at=${encodeURIComponent(notifBatchAt)}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (loadTokenRef.current !== token) return;
        setSearch('');
        setNewsList(data.items || []);
        setTotalCount((data.items || []).length);
        setNotifBatch({ count: data.count, name: data.rule_name });

        // Kuralın kategorisi seçili görünsün ve şerit oraya kaysın; kullanıcı
        // hangi kategoriden bildirim geldiğini çipten de görebilsin.
        if (data.category_id) {
          // Seçim değişmiyorsa effect hiç tetiklenmez; bayrağı boşuna yakmayalım.
          if (activeCatRef.current !== data.category_id || multiCatRef.current.length) {
            skipNextFetchRef.current = true;
          }
          setMultiCategoryIds([]);
          setActiveCategoryId(data.category_id);
          scrollCategoryIntoView(data.category_id);
        }
      } catch (_) {
        notifBatchPendingRef.current = false;
        showToast('Bildirimdeki haberler açılamadı.', 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.notifBatchRuleId, route.params?.notifBatchAt, route.params?.notifNonce]);

  const closeNotifBatch = () => {
    setNotifBatch(null);
    handledBatchRef.current = null;
    navigation.setParams({ notifBatchRuleId: undefined, notifBatchAt: undefined, notifNonce: undefined });
    fetchNews(search, page, activeCategoryId, multiCategoryIds);
  };

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
    setNotifBatch(null);
    fetchNews(search, 1, activeCategoryId, multiCategoryIds);
  };

  const runSearchFromHistory = (term) => {
    setSearch(term);
    pushSearchHistory(term);
    setShowHistory(false);
    setPage(1);
    fetchNews(term, 1, activeCategoryId, multiCategoryIds);
  };

  /**
   * Kategori çipi.
   *  dokunma      → yalnızca o kategori (çoklu seçim varsa temizlenir)
   *  basılı tutma → seçime ekler / çıkarır
   * "İlgi Alanlarım" (null) ve "Tümü" (0) basılı tutmaya kapalı.
   */
  const handleCategory = (catId) => {
    setMultiCategoryIds([]);
    setActiveCategoryId(catId);
    setPage(1);
  };

  const handleCategoryLong = (catId) => {
    if (catId === null || catId === 0) return;      // kapsayıcı seçenekler
    setMultiCategoryIds((prev) => {
      const next = prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId];
      // Tek kategori kaldıysa normal tekil seçime düş; hiç kalmadıysa ilgi alanlarına.
      if (next.length === 0) setActiveCategoryId(null);
      return next;
    });
    setPage(1);
  };

  const loadCatRules = async () => {
    try {
      const res = await apiFetch('/notifications/category-rules');
      if (res.ok) setCatRules(await res.json());
    } catch (_) { showToast('Bildirim kuralları yüklenemedi.', 'error'); }
  };

  useEffect(() => { loadCatRules(); }, []);

  const saveCatRule = async () => {
    if (!catRuleForm) return;
    setCatRuleSaving(true);
    const payload = {
      mode: catRuleForm.mode,
      interval_minutes: catRuleForm.mode === 'interval' ? catRuleForm.interval_minutes : null,
      grouping: catRuleForm.grouping,
    };
    try {
      const res = catRuleForm.id
        ? await apiFetch(`/notifications/category-rules/${catRuleForm.id}`, {
            method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch('/notifications/category-rules', {
            method: 'POST', body: JSON.stringify({ ...payload, category_id: catRuleForm.category_id }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '');
      }
      showToast(catRuleForm.id ? 'Kural güncellendi.' : 'Kural eklendi.');
      setCatRuleForm(null);
      loadCatRules();
    } catch (e) { showToast(e?.message || 'Kaydedilemedi.', 'error'); }
    finally { setCatRuleSaving(false); }
  };

  const toggleCatRule = async (rule) => {
    setCatRules((p) => p.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    try {
      const res = await apiFetch(`/notifications/category-rules/${rule.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) });
      if (!res.ok) throw new Error();
    } catch (_) {
      setCatRules((p) => p.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      showToast('Değiştirilemedi.', 'error');
    }
  };

  const deleteCatRule = async (id) => {
    try {
      const res = await apiFetch(`/notifications/category-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setCatRules((p) => p.filter((r) => r.id !== id));
      showToast('Kural silindi.');
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  const catRuleSummary = (r) => {
    const dk = r.effective_interval_minutes;
    const sure = dk >= 60 ? `${Math.floor(dk / 60)} sa${dk % 60 ? ` ${dk % 60} dk` : ''}` : `${dk} dk`;
    return `${sure} · ${r.grouping === 'digest' ? 'tek özet' : 'her haber ayrı'}`;
  };

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
            setNotifBatch(null);
            fetchNews(search, 1, activeCategoryId, multiCategoryIds);
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
          // Context tazelenir → çipler ve Ayarlar aynı listeyi görür.
          await refreshUser();
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

  // Not: aşağıda FlatList'e ListHeaderComponent olarak renderHeader'ı FONKSİYON
  // değil, ÜRETTİĞİ ELEMANI (renderHeader()) veriyoruz. Fonksiyon kimliği her
  // render'da değişince FlatList header'ı (ve arama TextInput'unu) remount edip
  // klavyeyi her tuşta kapatıyordu.
  const renderHeader = () => (
    <View>
      <Text style={styles.h1}>Günün Özeti</Text>
      <Text style={styles.sub}>Pürüzsüz ve sana özel bir haber akışı.</Text>

      {/* Özet bildirimine tıklanınca: yalnızca o bildirimdeki haberler listelenir */}
      {notifBatch && (
        <View style={styles.batchBanner}>
          <Text style={{ color: '#fbbf24', fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={2}>
            🔔 {notifBatch.name} · bildirimdeki {notifBatch.count} haber
          </Text>
          <Pressable onPress={closeNotifBatch} hitSlop={8} style={styles.batchClose}>
            <Text style={{ color: colors.textDim, fontWeight: '700', fontSize: 12 }}>✕ Tümü</Text>
          </Pressable>
        </View>
      )}

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

      <Pressable
        onPress={() => { setCatRuleForm(null); setShowCatRules(true); loadCatRules(); }}
        style={styles.notifBtn}>
        <Text style={{ color: '#fbbf24', fontWeight: '800' }}>
          🔔 Akış Bildirimleri{catRules.filter((r) => r.enabled).length > 0
            ? ` (${catRules.filter((r) => r.enabled).length})` : ''}
        </Text>
      </Pressable>

      <Pressable onPress={handleBulletin} disabled={bulletinLoading} style={styles.bulletinBtn}>
        <Text style={styles.bulletinBtnText}>
          {bulletinLoading ? '🎙️  Bülten hazırlanıyor…' : '🎙️  Günlük Bülten Oluştur'}
        </Text>
      </Pressable>

      {/* Kategori arama (ör. siber) — çok sayıda kategori arasında hızlı bulma */}
      <View style={styles.catSearchRow}>
        <Text style={{ color: colors.textFaint, fontSize: 14 }}>🔍</Text>
        <TextInput
          style={{ flex: 1, color: colors.text, paddingVertical: 8, fontSize: 14 }}
          placeholder="Kategori ara (ör. siber)"
          placeholderTextColor={colors.textFaint}
          value={catSearch}
          onChangeText={setCatSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {catSearch.length > 0 && (
          <Pressable onPress={() => setCatSearch('')} hitSlop={8}>
            <Text style={{ color: colors.textFaint, fontSize: 13 }}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView ref={catStripRef} horizontal showsHorizontalScrollIndicator={false}
        // Yerleşim/içerik boyutu her değiştiğinde bekleyen hedefe yeniden kayar
        // (soğuk başlangıçta şerit birkaç kez yeniden yerleşiyor).
        onLayout={applyPendingCatScroll}
        onContentSizeChange={applyPendingCatScroll}
        style={{ marginBottom: 18 }} contentContainerStyle={{ gap: 8 }}>
        {categories
          .filter((cat) => {
            const q = catSearch.trim().toLowerCase();
            if (!q) return true;
            return (cat.name || '').toLowerCase().includes(q);
          })
          .map((cat) => {
          const active = multiCategoryIds.length
            ? multiCategoryIds.includes(cat.id)
            : activeCategoryId === cat.id;
          return (
            <Pressable key={cat.id ?? 'interests'}
              onPress={() => handleCategory(cat.id)}
              onLongPress={() => handleCategoryLong(cat.id)}
              delayLongPress={280}
              // Bildirimle gelen kategori şeridin dışında kalabiliyor; konumu
              // bilinmeden oraya kaydırılamaz.
              onLayout={(e) => {
                if (!cat.id) return;
                catChipX.current[cat.id] = e.nativeEvent.layout.x;
                // Bildirim bu çipi bekliyorduysa ölçüm gelir gelmez kaydır.
                if (pendingScrollCatRef.current?.id === cat.id) applyPendingCatScroll();
              }}
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
        {!!news.published_at && (
          <Text style={[styles.cardMeta, { marginLeft: 'auto' }]}>{formatArticleDate(news.published_at)}</Text>
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
          ListHeaderComponent={renderHeader()}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primaryLight} />}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>Haber bulunamadı.</Text> : null}
          ListFooterComponent={
            !notifBatch && totalPages > 1 ? (
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

      {/* Akış bildirim kuralları — kategori başına */}
      <Modal visible={showCatRules} transparent animationType="slide" onRequestClose={() => setShowCatRules(false)}>
        {/* Klavye açılınca kart yukarı kayar; yoksa arama alanı klavyenin altında kalıyordu */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                🔔 {catRuleForm ? (catRuleForm.id ? 'Kuralı Düzenle' : 'Yeni Kural') : 'Akış Bildirimleri'}
              </Text>
              <Pressable onPress={() => (catRuleForm ? setCatRuleForm(null) : setShowCatRules(false))} hitSlop={12}>
                <Text style={{ color: colors.textDim, fontSize: 20 }}>{catRuleForm ? '‹' : '✕'}</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {!catRuleForm ? (
                <>
                  <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
                    Kategori başına bildirim kuralı. Örneğin Bilim için saatlik özet,
                    Ekonomi için anında bildirim.
                  </Text>

                  {catRules.length === 0 ? (
                    <Text style={{ color: colors.textFaint, textAlign: 'center', marginVertical: 20 }}>
                      Henüz kural yok.
                    </Text>
                  ) : catRules.map((r) => (
                    <View key={r.id} style={styles.ruleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                          {r.category_name || r.name}
                        </Text>
                        <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }}>
                          {catRuleSummary(r)}
                        </Text>
                        {!r.ready && (
                          <Text style={{ color: '#fbbf24', fontSize: 10, marginTop: 2 }}>⏳ ilk tarama sürüyor…</Text>
                        )}
                      </View>
                      <Switch value={!!r.enabled} onValueChange={() => toggleCatRule(r)}
                        trackColor={{ false: colors.border, true: colors.primary }} />
                      <Pressable
                        onPress={() => setCatRuleForm({
                          id: r.id, category_id: r.category_id, mode: r.mode,
                          interval_minutes: r.interval_minutes || 60, grouping: r.grouping,
                        })}
                        style={styles.ruleBtn}>
                        <Text style={{ color: colors.primaryLight, fontSize: 12, fontWeight: '600' }}>Düzenle</Text>
                      </Pressable>
                      <Pressable onPress={() => deleteCatRule(r.id)} style={styles.ruleBtn}>
                        <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Sil</Text>
                      </Pressable>
                    </View>
                  ))}

                  <Text style={[styles.ruleLabel, { marginTop: 18 }]}>Kategori seç ve kural ekle</Text>
                  <View style={styles.ruleSearchRow}>
                    <Text style={{ color: colors.textFaint, fontSize: 14 }}>🔍</Text>
                    <TextInput
                      style={{ flex: 1, color: colors.text, paddingVertical: 8 }}
                      placeholder="Kategori ara (ör. bilim)"
                      placeholderTextColor={colors.textFaint}
                      value={ruleCatSearch}
                      onChangeText={setRuleCatSearch}
                      autoCapitalize="none"
                    />
                    {ruleCatSearch.length > 0 && (
                      <Pressable onPress={() => setRuleCatSearch('')} hitSlop={8}>
                        <Text style={{ color: colors.textFaint }}>✕</Text>
                      </Pressable>
                    )}
                  </View>

                  {(() => {
                    const q = ruleCatSearch.trim().toLowerCase();
                    const list = interests
                      .filter((c) => !catRules.some((r) => r.category_id === c.id))
                      .filter((c) => !q || (c.name || '').toLowerCase().includes(q));
                    if (list.length === 0) {
                      return (
                        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 8 }}>
                          {q ? 'Eşleşen kategori yok.' : 'Tüm kategoriler için kural kurulmuş.'}
                        </Text>
                      );
                    }
                    return (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {list
                      .map((c) => (
                        <Pressable key={c.id}
                          onPress={() => setCatRuleForm({
                            id: null, category_id: c.id, mode: 'immediate',
                            interval_minutes: 60, grouping: 'digest',
                          })}
                          style={styles.ruleChip}>
                          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700' }}>+ {c.name}</Text>
                        </Pressable>
                      ))}
                  </View>
                    );
                  })()}
                </>
              ) : (
                <>
                  <Text style={styles.ruleLabel}>Ne zaman?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[{ k: 'immediate', l: 'Hemen (~15 dk)' }, { k: 'interval', l: 'Aralıklı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setCatRuleForm((p) => ({ ...p, mode: o.k }))}
                        style={[styles.ruleChip, catRuleForm.mode === o.k && styles.ruleChipOn]}>
                        <Text style={{ color: catRuleForm.mode === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {catRuleForm.mode === 'interval' && (
                    <View style={{ marginTop: 10 }}>
                      <IntervalStepper
                        value={catRuleForm.interval_minutes || INTERVAL_MIN}
                        onChange={(v) => setCatRuleForm((p) => ({ ...p, interval_minutes: v }))}
                        colors={colors}
                      />
                    </View>
                  )}

                  <Text style={styles.ruleLabel}>Nasıl gelsin?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[{ k: 'digest', l: 'Tek özet' }, { k: 'individual', l: 'Her haber ayrı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setCatRuleForm((p) => ({ ...p, grouping: o.k }))}
                        style={[styles.ruleChip, catRuleForm.grouping === o.k && styles.ruleChipOn]}>
                        <Text style={{ color: catRuleForm.grouping === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable onPress={saveCatRule} disabled={catRuleSaving}
                    style={[styles.notifBtn, { marginTop: 18, borderColor: colors.primary }]}>
                    <Text style={{ color: colors.primaryLight, fontWeight: '800' }}>
                      {catRuleSaving ? 'Kaydediliyor…' : 'Kaydet'}
                    </Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

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
  catSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, marginBottom: 10 },
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
  // Akış bildirim kuralları
  notifBtn: {
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', borderRadius: radius.sm,
    paddingVertical: 12, alignItems: 'center', marginBottom: 12,
  },
  // Bildirim partisi şeridi (RSS ekranındakiyle aynı görünüm)
  batchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 14, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)', borderRadius: radius.sm,
  },
  batchClose: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingVertical: 4, paddingHorizontal: 8,
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: 20, maxHeight: '85%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  ruleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  ruleBtn: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingVertical: 5, paddingHorizontal: 9,
  },
  ruleLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  ruleChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingVertical: 7, paddingHorizontal: 12,
  },
  ruleChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLight },
  ruleSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 12,
  },
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
