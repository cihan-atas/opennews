import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, Modal, StyleSheet,
  ActivityIndicator, Linking, Animated, PanResponder, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { getPinnedLists, setPinnedLists } from '../api/storage';
import { usePlayer } from '../contexts/PlayerContext';
import { useToast, Toast } from '../components/Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { groupCategories } from '../utils/categoryTree';
import { formatArticleDate, formatArticleDateLong } from '../utils/formatDate';
import IntervalStepper, { formatInterval, INTERVAL_MIN } from '../components/IntervalStepper';

const FEED_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
const feedColor = (title) => {
  if (!title) return FEED_COLORS[0];
  const idx = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % FEED_COLORS.length;
  return FEED_COLORS[idx];
};
const stripHtml = (html) => (html ? html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
// Başlığı çekilemeyen beslemeler için url'den okunur bir etiket üret (örn. venturebeat.com)
const hostFromUrl = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export default function RssReaderScreen({ route }) {
  const insets = useSafeAreaInsets();
  const { setTrack } = usePlayer();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(false);

  const [newListName, setNewListName] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [showFeedManager, setShowFeedManager] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null); // { id, name }
  const [renameValue, setRenameValue] = useState('');
  const [listMenu, setListMenu] = useState(null); // basılı tutunca açılan liste menüsü
  const [menuConfirm, setMenuConfirm] = useState(false); // silme onay adımı
  const [pinnedIds, setPinnedIds] = useState([]); // sabitlenen liste id'leri (cihazda yerel)

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Çoklu besleme filtresi: boş dizi = tümü. Dokunma tek seçer, basılı tutma
  // seçime ekler/çıkarır (birden fazla besleme birlikte görüntülenebilsin).
  const [activeFeedFilters, setActiveFeedFilters] = useState([]);

  const [selectedArticle, setSelectedArticle] = useState(null);
  const [podcastStatus, setPodcastStatus] = useState(null); // null | loading | processing | ready
  const [showLengthPicker, setShowLengthPicker] = useState(false);
  const [podcastCache, setPodcastCache] = useState({});
  const [activeTranslation, setActiveTranslation] = useState(null);
  const [translationCache, setTranslationCache] = useState({});
  const [translating, setTranslating] = useState(false);

  // Bildirim kuralları — seçili listeye birden fazla kural bağlanabilir.
  const [showNotifRules, setShowNotifRules] = useState(false);
  const [notifRules, setNotifRules] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [ruleForm, setRuleForm] = useState(null); // null = liste görünümü, obje = form
  // Özet bildirimine tıklanınca o partinin makaleleri gösterilir: { count, name }
  const [notifBatch, setNotifBatch] = useState(null);

  const [showCommunity, setShowCommunity] = useState(false);
  const [communityFeeds, setCommunityFeeds] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityFilter, setCommunityFilter] = useState('');
  const [communitySearch, setCommunitySearch] = useState('');
  const [submitUrl, setSubmitUrl] = useState('');
  const [submitCategory, setSubmitCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // Liste seçici
  const [listPickerFeed, setListPickerFeed] = useState(null); // { url, title }
  const [addingToListId, setAddingToListId] = useState(null);

  const [showSaved, setShowSaved] = useState(false);
  const [savedArticles, setSavedArticles] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedIds, setSavedIds] = useState({}); // { link: savedId }

  const [showTrending, setShowTrending] = useState(false);
  const [rssTrending, setRssTrending] = useState([]);
  const [loadingTrending, setLoadingTrending] = useState(false);
  const [trendingFilter, setTrendingFilter] = useState(null);

  const pollRef = useRef(null);
  const pollTitleRef = useRef(null);
  // Liste şeridi: bildirimle gelen listeye kaydırmak için
  const listStripRef = useRef(null);
  const listChipX = useRef({});

  // Makale modalı: kartın her yerinden aşağı çekince kapat (içerik en üstteyken)
  const articleY = useRef(new Animated.Value(0)).current;
  const articleScrollY = useRef(0);
  useEffect(() => { if (selectedArticle) articleY.setValue(0); }, [selectedArticle, articleY]);
  const articlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => articleScrollY.current <= 0 && g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { articleY.setValue(Math.max(0, g.dy)); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 1.1) {
          Animated.timing(articleY, { toValue: 800, duration: 200, useNativeDriver: true }).start(() => setSelectedArticle(null));
        } else {
          Animated.spring(articleY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    fetchLists();
    fetchSaved();
    getPinnedLists().then(setPinnedIds);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const togglePin = (id) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      setPinnedLists(next);
      return next;
    });
  };

  // Sabitlenenler en başta; geri kalanlar orijinal sırada.
  const orderedLists = useMemo(() => {
    const pinned = pinnedIds.map((id) => lists.find((l) => l.id === id)).filter(Boolean);
    const rest = lists.filter((l) => !pinnedIds.includes(l.id));
    return [...pinned, ...rest];
  }, [lists, pinnedIds]);

  // Aramayı geciktir: her tuşta ağır liste filtresini tetikleyip klavyeyi kapatmamak için
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 220);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Liste değişince kuralları çek — araç çubuğundaki rozet modal açılmadan da doğru olsun.
  useEffect(() => {
    if (!selectedList) { setNotifRules([]); return; }
    loadNotifRules(selectedList.id);
    // loadNotifRules stabil değil ama yalnızca liste kimliğine bağlıyız.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList?.id]);

  const activeRuleCount = useMemo(
    () => notifRules.filter((r) => r.enabled).length,
    [notifRules],
  );

  // Bildirime tıklanınca App.js buraya notifArticleId / notifListId ile yönlendirir.
  // Aynı bildirim iki kez işlenmesin diye son işlenen anahtar tutulur.
  const handledNotifRef = useRef(null);
  // Ekran bir özet bildirimiyle açıldı mı? İlk render'da belli olmalı: fetchLists
  // aksi halde varsayılan listeyi yükleyip partinin üstüne yazıyor.
  const notifPendingRef = useRef(!!route?.params?.notifBatchRuleId);
  useEffect(() => {
    const { notifArticleId, notifListId, notifBatchRuleId, notifBatchAt, notifNonce } = route?.params || {};
    if (!notifArticleId && !notifListId && !notifBatchRuleId) return;

    const key = notifNonce || `${notifArticleId || ''}:${notifListId || ''}:${notifBatchAt || ''}`;
    if (handledNotifRef.current === key) return;
    handledNotifRef.current = key;

    const wantsBatch = !!(notifBatchRuleId && notifBatchAt);
    notifPendingRef.current = wantsBatch;

    // Liste seçimi ayrı effect'te (aşağıda) — listeler geç yüklendiğinde burası
    // bir kez çalışıp bittiği için seçim hiç yapılamıyordu.

    // Özet bildirimi: tam olarak o partideki makaleleri göster.
    if (wantsBatch) {
      (async () => {
        try {
          const res = await apiFetch(
            `/rss-reader/notification-batch/${notifBatchRuleId}?at=${encodeURIComponent(notifBatchAt)}`,
          );
          if (!res.ok) throw new Error();
          const data = await res.json();
          setShowSaved(false);
          setShowTrending(false);
          setSearchTerm('');
          setActiveFeedFilters([]);
          setArticles(data.articles || []);
          setNotifBatch({ count: data.count, name: data.rule_name });
        } catch (_) {
          showToast('Bildirimdeki haberler açılamadı.', 'error');
          // Parti gelmediyse ekran boş kalmasın: normal liste akışına dön.
          notifPendingRef.current = false;
          fetchLists();
        }
      })();
      return;
    }

    if (!notifArticleId) return;

    // Makale anlık görüntüsü sunucudan gelir — RSS makaleleri DB'de tutulmuyor,
    // bildirim anındaki hali rss_seen_articles'ta saklanıyor.
    (async () => {
      try {
        const res = await apiFetch(`/rss-reader/notified-articles/${notifArticleId}`);
        if (!res.ok) throw new Error();
        const a = await res.json();
        setShowSaved(false);
        setShowTrending(false);
        setSelectedArticle({
          title: a.title, link: a.link, summary: a.summary,
          feed_title: a.feed_title, feed_url: a.feed_url, published: a.published,
        });
      } catch (_) {
        showToast('Bildirimdeki makale açılamadı.', 'error');
      }
    })();
    // notifNonce şart: aynı kuraldan gelen ikinci özet bildiriminde rule_id ve
    // list_id değişmediği için effect tekrar çalışmıyor, bildirime basmak hiçbir
    // şey yapmıyordu. batch_at de burada olmalı — parti kimliği o.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.notifArticleId, route?.params?.notifListId,
      route?.params?.notifBatchRuleId, route?.params?.notifBatchAt,
      route?.params?.notifNonce, lists.length]);

  // Bildirimin listesini seç. Ayrı effect: listeler bildirim işlendikten sonra
  // yükleniyor, tek effect'te seçim atlanıyordu (araç çubuğu ve besleme
  // filtreleri partiye ait olmayan listeyi gösteriyordu).
  const listSelectedForRef = useRef(null);

  // Seçili liste şeridin görünen kısmına kaydırılır. Ölçüm (onLayout) bildirim
  // işlendiğinde henüz gelmemiş olabiliyor → kısa aralıklarla birkaç deneme.
  const scrollListIntoView = (listId, attempt = 0) => {
    const x = listChipX.current[listId];
    if (x === undefined) {
      if (attempt < 12) setTimeout(() => scrollListIntoView(listId, attempt + 1), 150);
      return;
    }
    listStripRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  };

  useEffect(() => {
    const { notifListId, notifBatchRuleId, notifBatchAt, notifNonce } = route?.params || {};
    if (!notifListId || lists.length === 0) return;

    const key = notifNonce || `${notifListId}`;
    if (listSelectedForRef.current === key) return;

    const target = lists.find((l) => l.id === notifListId);
    if (!target) return;
    listSelectedForRef.current = key;
    scrollListIntoView(target.id);
    if (target.id === selectedList?.id) return;

    setSelectedList(target);
    // Parti gösteriliyorsa makaleleri ÇEKME: loadArticles partinin üstüne yazar.
    if (!(notifBatchRuleId && notifBatchAt)) loadArticles(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.notifListId, route?.params?.notifNonce, lists.length]);

  const fetchSaved = async () => {
    setLoadingSaved(true);
    try {
      const res = await apiFetch('/rss-reader/saved?size=100');
      if (res.ok) {
        const data = await res.json();
        setSavedArticles(data.items);
        const ids = {};
        data.items.forEach((a) => { ids[a.link] = a.id; });
        setSavedIds(ids);
      }
    } catch (_) { showToast('Kaydedilenler yüklenemedi.', 'error'); }
    finally { setLoadingSaved(false); }
  };

  const toggleSave = async (article) => {
    const existingId = savedIds[article.link];
    if (existingId) {
      try {
        const res = await apiFetch(`/rss-reader/saved/${existingId}`, { method: 'DELETE' });
        if (res.ok) {
          setSavedIds((p) => { const n = { ...p }; delete n[article.link]; return n; });
          setSavedArticles((p) => p.filter((a) => a.id !== existingId));
          showToast('Kaydedilenlerden silindi.');
        }
      } catch (_) { showToast('İşlem başarısız.', 'error'); }
    } else {
      try {
        const res = await apiFetch('/rss-reader/saved', {
          method: 'POST',
          body: JSON.stringify({
            title: article.title,
            link: article.link,
            summary: article.summary || null,
            feed_title: article.feed_title || null,
            feed_url: article.feed_url || null,
            published: article.published || null,
          }),
        });
        if (res.ok) {
          const saved = await res.json();
          setSavedIds((p) => ({ ...p, [article.link]: saved.id }));
          setSavedArticles((p) => [saved, ...p]);
          showToast('Makale kaydedildi! 📌');
        } else {
          const err = await res.json();
          showToast(err.detail || 'Kaydedilemedi.', 'error');
        }
      } catch (_) { showToast('Kaydedilemedi.', 'error'); }
    }
  };

  const fetchRssTrending = async () => {
    setLoadingTrending(true);
    try {
      const res = await apiFetch('/rss-reader/trending');
      if (res.ok) setRssTrending(await res.json());
    } catch (_) { showToast('RSS gündemi yüklenemedi.', 'error'); }
    finally { setLoadingTrending(false); }
  };

  const fetchLists = async () => {
    setLoadingLists(true);
    try {
      const res = await apiFetch('/rss-reader/lists');
      if (res.ok) {
        const data = await res.json();
        setLists(data);
        // Bildirimle açıldıysa ilk listeyi seçip makalelerini ÇEKME: bu istek
        // parti isteğinden sonra bitip bildirimdeki haberlerin üstüne yazıyordu
        // (kullanıcı bildirime basınca alakasız liste açılıyordu).
        if (data.length > 0) {
          setSelectedList(data[0]);
          // Bayrak burada tüketilir: parti isteği liste isteğinden önce bitince
          // (sık oluyor) bayrağı orada temizlemek yarışı çözmüyordu — bu yükleme
          // yine partinin üstüne yazıyordu.
          const skipAuto = notifPendingRef.current;
          notifPendingRef.current = false;
          if (!skipAuto) loadArticles(data[0].id);
        }
      }
    } catch (_) { showToast('Listeler yüklenemedi.', 'error'); }
    finally { setLoadingLists(false); }
  };

  const loadArticles = async (listId) => {
    setLoadingArticles(true);
    setArticles([]); setSearchTerm(''); setDebouncedSearch(''); setActiveFeedFilters([]);
    setNotifBatch(null);   // normal listeye dönüldü, bildirim şeridi kalkar
    try {
      const res = await apiFetch(`/rss-reader/lists/${listId}/articles`);
      if (res.ok) setArticles(await res.json());
    } catch (_) { showToast('Haberler çekilemedi.', 'error'); }
    finally { setLoadingArticles(false); }
  };

  const selectList = (lst) => {
    setSelectedList(lst);
    setShowFeedManager(false);
    loadArticles(lst.id);
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    try {
      const res = await apiFetch('/rss-reader/lists', { method: 'POST', body: JSON.stringify({ name: newListName.trim() }) });
      if (res.ok) {
        const created = await res.json();
        setLists((p) => [...p, created]);
        setNewListName('');
        setSelectedList(created);
        setArticles([]);
        showToast('Liste oluşturuldu!');
      }
    } catch (_) { showToast('Oluşturulamadı.', 'error'); }
  };

  const deleteList = async (listId) => {
    try {
      const res = await apiFetch(`/rss-reader/lists/${listId}`, { method: 'DELETE' });
      if (res.ok) {
        setLists((p) => p.filter((l) => l.id !== listId));
        if (selectedList?.id === listId) { setSelectedList(null); setArticles([]); }
        showToast('Liste silindi.');
      }
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  // Listeye basılı tutunca uygulama-içi menü aç (Android'in sistem dialogu yerine)
  const handleListLongPress = (lst) => { setListMenu(lst); setMenuConfirm(false); };
  const closeListMenu = () => { setListMenu(null); setMenuConfirm(false); };

  const renameList = async () => {
    if (!renameValue.trim() || !renameTarget) return;
    try {
      const res = await apiFetch(`/rss-reader/lists/${renameTarget.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue.trim() }) });
      if (res.ok) {
        const nm = renameValue.trim();
        setLists((p) => p.map((l) => (l.id === renameTarget.id ? { ...l, name: nm } : l)));
        if (selectedList?.id === renameTarget.id) setSelectedList((s) => ({ ...s, name: nm }));
        setRenameTarget(null); setRenameValue('');
        showToast('Liste adı güncellendi.');
      } else showToast('Güncellenemedi.', 'error');
    } catch (_) { showToast('İşlem başarısız.', 'error'); }
  };

  const addFeed = async () => {
    if (!newFeedUrl.trim() || !selectedList) return;
    setAddingFeed(true);
    try {
      const res = await apiFetch(`/rss-reader/lists/${selectedList.id}/feeds`, {
        method: 'POST', body: JSON.stringify({ url: newFeedUrl.trim() }),
      });
      if (res.ok) {
        const feed = await res.json();
        const updated = { ...selectedList, feeds: [...(selectedList.feeds || []), feed], feed_count: (selectedList.feed_count || 0) + 1 };
        setSelectedList(updated);
        setLists((p) => p.map((l) => (l.id === selectedList.id ? updated : l)));
        setNewFeedUrl('');
        showToast(`"${feed.title || feed.url}" eklendi!`);
        loadArticles(selectedList.id);
      } else {
        showToast((await res.json()).detail || 'Eklenemedi.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setAddingFeed(false); }
  };

  const removeFeed = async (feedId) => {
    if (!selectedList) return;
    try {
      const res = await apiFetch(`/rss-reader/lists/${selectedList.id}/feeds/${feedId}`, { method: 'DELETE' });
      if (res.ok) {
        const feeds = selectedList.feeds.filter((f) => f.id !== feedId);
        const updated = { ...selectedList, feeds, feed_count: feeds.length };
        setSelectedList(updated);
        setLists((p) => p.map((l) => (l.id === selectedList.id ? updated : l)));
        showToast('Feed kaldırıldı.');
        loadArticles(selectedList.id);
      }
    } catch (_) { showToast('Kaldırılamadı.', 'error'); }
  };

  // ── Bildirim kuralları ───────────────────────────────────────────────────────

  const EMPTY_RULE = {
    id: null, name: '', scope: 'all', feed_ids: [],
    mode: 'immediate', interval_minutes: 60, grouping: 'digest',
  };

  const loadNotifRules = async (listId) => {
    setNotifLoading(true);
    try {
      const res = await apiFetch(`/rss-reader/lists/${listId}/notification-rules`);
      if (!res.ok) throw new Error();
      setNotifRules(await res.json());
    } catch (_) {
      showToast('Bildirim kuralları yüklenemedi.', 'error');
      setNotifRules([]);
    } finally { setNotifLoading(false); }
  };

  const openNotifRules = () => {
    if (!selectedList) return;
    setRuleForm(null);
    setShowNotifRules(true);
    loadNotifRules(selectedList.id);
  };

  const saveRule = async () => {
    if (!ruleForm || !selectedList) return;
    if (!ruleForm.name.trim()) { showToast('Kural adı gerekli.', 'error'); return; }
    if (ruleForm.scope === 'selected' && ruleForm.feed_ids.length === 0) {
      showToast('En az bir besleme seç.', 'error'); return;
    }
    setNotifSaving(true);
    const payload = {
      name: ruleForm.name.trim(),
      scope: ruleForm.scope,
      feed_ids: ruleForm.scope === 'selected' ? ruleForm.feed_ids : null,
      mode: ruleForm.mode,
      interval_minutes: ruleForm.mode === 'interval' ? ruleForm.interval_minutes : null,
      grouping: ruleForm.grouping,
    };
    try {
      const res = ruleForm.id
        ? await apiFetch(`/rss-reader/notification-rules/${ruleForm.id}`, {
            method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch(`/rss-reader/lists/${selectedList.id}/notification-rules`, {
            method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '');
      }
      showToast(ruleForm.id ? 'Kural güncellendi.' : 'Kural eklendi.');
      setRuleForm(null);
      loadNotifRules(selectedList.id);
    } catch (e) {
      showToast(e?.message || 'Kaydedilemedi.', 'error');
    } finally { setNotifSaving(false); }
  };

  const toggleRule = async (rule) => {
    // İyimser güncelleme — anahtar anında tepki versin.
    setNotifRules((p) => p.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    try {
      const res = await apiFetch(`/rss-reader/notification-rules/${rule.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error();
    } catch (_) {
      setNotifRules((p) => p.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      showToast('Değiştirilemedi.', 'error');
    }
  };

  const deleteRule = async (ruleId) => {
    try {
      const res = await apiFetch(`/rss-reader/notification-rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setNotifRules((p) => p.filter((r) => r.id !== ruleId));
      showToast('Kural silindi.');
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  // "Tüm beslemeler · 15 dk · tek özet" gibi tek satırlık okunur özet
  const ruleSummary = (r) => {
    const kapsam = r.scope === 'all' ? 'Tüm beslemeler' : `${r.feed_ids.length} besleme`;
    const sure = formatInterval(r.effective_interval_minutes);
    const grup = r.grouping === 'digest' ? 'tek özet' : 'her makale ayrı';
    return `${kapsam} · ${sure} · ${grup}`;
  };

  const fetchCommunity = async () => {
    setCommunityLoading(true);
    try {
      const res = await apiFetch('/rss/community');
      if (res.ok) setCommunityFeeds(await res.json());
      if (categories.length === 0) {
        const catRes = await apiFetch('/categories/');
        if (catRes.ok) setCategories(await catRes.json());
      }
    } catch (_) { showToast('Yüklenemedi.', 'error'); }
    finally { setCommunityLoading(false); }
  };

  const handleSubmitSource = async () => {
    if (!submitUrl.trim()) return;
    if (!submitCategory) { showToast('Lütfen bir kategori seçin.', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch('/rss/submit', { method: 'POST', body: JSON.stringify({ url: submitUrl.trim(), category_id: submitCategory }) });
      if (res.ok) { showToast('Kaynağın incelemeye alındı!'); setSubmitUrl(''); setSubmitCategory(null); }
      else showToast((await res.json()).detail || 'Gönderilemedi.', 'error');
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAddFromCommunity = (url, title) => {
    setListPickerFeed({ url, title });
  };

  const addFeedToList = async (listId, url) => {
    setAddingToListId(listId);
    try {
      const res = await apiFetch(`/rss-reader/lists/${listId}/feeds`, {
        method: 'POST', body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const feed = await res.json();
        const targetList = lists.find((l) => l.id === listId) || selectedList;
        const updated = { ...targetList, feeds: [...(targetList?.feeds || []), feed], feed_count: (targetList?.feed_count || 0) + 1 };
        setLists((p) => p.map((l) => (l.id === listId ? updated : l)));
        setSelectedList(updated);
        setListPickerFeed(null);
        setShowCommunity(false);
        showToast('Kaynak listeye eklendi!');
        loadArticles(listId);
      } else {
        showToast((await res.json()).detail || 'Eklenemedi.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setAddingToListId(null); }
  };

  const openArticle = (article) => {
    setSelectedArticle(article);
    setShowLengthPicker(false);
    setActiveTranslation(null); setTranslationCache({}); setTranslating(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const cached = podcastCache[article.title];
    setPodcastStatus(cached ? 'ready' : null);
  };

  const translate = async (lang) => {
    if (lang === null) { setActiveTranslation(null); return; }
    if (activeTranslation === lang) { setActiveTranslation(null); return; }
    if (translationCache[lang]) { setActiveTranslation(lang); return; }
    setActiveTranslation(lang);
    setTranslating(true);
    try {
      const content = stripHtml(selectedArticle.summary) || selectedArticle.title;
      const res = await apiFetch('/rss-reader/translate', { method: 'POST', body: JSON.stringify({ text: content, lang }) });
      if (res.ok) {
        const data = await res.json();
        setTranslationCache((p) => ({ ...p, [lang]: data.translated }));
      }
    } catch (_) { showToast('Çeviri başarısız.', 'error'); setActiveTranslation(null); }
    finally { setTranslating(false); }
  };

  const createPodcast = async (length = 'medium') => {
    if (!selectedArticle) return;
    setShowLengthPicker(false);
    setPodcastStatus('loading');
    const content = stripHtml(selectedArticle.summary) || selectedArticle.title;
    try {
      const res = await apiFetch('/rss-reader/podcast', {
        method: 'POST',
        body: JSON.stringify({ title: selectedArticle.title, content, source_url: selectedArticle.link || null, length }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.status === 'exists') {
        setPodcastStatus('ready');
        setPodcastCache((p) => ({ ...p, [selectedArticle.title]: data.audio_url }));
        setTrack(data.audio_url, selectedArticle.title, selectedArticle.feed_title, true, data.podcast_id);
      } else {
        setPodcastStatus('processing');
        pollTitleRef.current = selectedArticle.title;
        startPoll(selectedArticle.title, selectedArticle.feed_title);
      }
    } catch (_) { showToast('Podcast oluşturulamadı.', 'error'); setPodcastStatus(null); }
  };

  const startPoll = (title, feedTitle) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/rss-reader/podcast/check?title=${encodeURIComponent(title)}`);
        if (res.ok) {
          const data = await res.json();
          clearInterval(pollRef.current); pollRef.current = null;
          setPodcastCache((p) => ({ ...p, [title]: data.audio_url }));
          setTrack(data.audio_url, title, feedTitle, true, data.podcast_id);
          if (pollTitleRef.current === title) setPodcastStatus('ready');
          showToast('Podcast hazır! 🎧');
        }
      } catch (_) {}
    }, 2000);
  };

  // Filtre çipleri haberlerden değil, listenin beslemelerinden üretilir → susan
  // (geçici olarak haber döndürmeyen) bir besleme bile çipini korur. Eşleştirme
  // feed_url ile yapılır çünkü başlık boş/çakışan olabilir.
  const feedFilters = useMemo(() => {
    const feeds = selectedList?.feeds || [];
    const titleByUrl = {};
    for (const a of articles) {
      if (a.feed_url && a.feed_title && !titleByUrl[a.feed_url]) titleByUrl[a.feed_url] = a.feed_title;
    }
    const seen = new Set();
    return feeds
      .filter((f) => f.url && !seen.has(f.url) && seen.add(f.url))
      .map((f) => ({ url: f.url, label: f.title || titleByUrl[f.url] || hostFromUrl(f.url) }));
  }, [selectedList, articles]);

  /**
   * Besleme çipi seçimi.
   *  dokunma      → yalnızca o besleme (zaten tek seçiliyse tümüne döner)
   *  basılı tutma → seçime ekler / çıkarır (çoklu seçim)
   */
  const toggleFeedFilter = (url, additive) => {
    setActiveFeedFilters((prev) => {
      if (additive) {
        return prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url];
      }
      const onlyThis = prev.length === 1 && prev[0] === url;
      return onlyThis ? [] : [url];
    });
  };

  /**
   * Birden fazla besleme seçiliyken sırayla her kaynaktan bir yazı alır:
   * en yeni A, en yeni B, ikinci A, ikinci B…
   *
   * Saf tarih sıralamasında çok yayın yapan kaynak listeyi dolduruyordu:
   * The Hacker News (günde ~10) + Krebs (haftada ~1) seçilince ilk 25 yazının
   * 25'i de Hacker News oluyordu, Krebs hiç görünmüyordu.
   */
  const interleaveByFeed = (list) => {
    const buckets = new Map();
    for (const a of list) {
      const key = a.feed_url || a.feed_title || '?';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(a);
    }
    const queues = [...buckets.values()];   // her kova zaten tarihe göre sıralı
    const out = [];
    for (let i = 0; out.length < list.length; i++) {
      for (const q of queues) if (i < q.length) out.push(q[i]);
    }
    return out;
  };

  const filteredArticles = useMemo(() => {
    let r = articles;
    if (activeFeedFilters.length) {
      r = r.filter((a) => activeFeedFilters.includes(a.feed_url));
      if (activeFeedFilters.length > 1) r = interleaveByFeed(r);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      r = r.filter((a) => a.title?.toLowerCase().includes(q) || a.feed_title?.toLowerCase().includes(q));
    }
    return r;
  }, [articles, activeFeedFilters, debouncedSearch]);

  const trendingFeedTitles = useMemo(() => {
    const seen = new Set();
    return rssTrending.map((a) => a.feed_title).filter((t) => t && !seen.has(t) && seen.add(t));
  }, [rssTrending]);

  const filteredTrending = useMemo(() => (
    trendingFilter ? rssTrending.filter((a) => a.feed_title === trendingFilter) : rssTrending
  ), [rssTrending, trendingFilter]);

  const renderArticle = ({ item: a }) => (
    <Pressable onPress={() => openArticle(a)} style={styles.article}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Text numberOfLines={1} style={[styles.feedBadge, { color: feedColor(a.feed_title), backgroundColor: `${feedColor(a.feed_title)}22`, flexShrink: 1 }]}>{a.feed_title}</Text>
        {!!podcastCache[a.title] && <Text style={styles.podcastBadge}>🎧 Podcast</Text>}
        {!!a.published && (
          <Text style={{ color: colors.textFaint, fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>
            {formatArticleDate(a.published)}
          </Text>
        )}
      </View>
      <Text style={styles.articleTitle}>{a.title}</Text>
      {!!a.summary && <Text style={styles.articleSummary} numberOfLines={2}>{stripHtml(a.summary)}</Text>}
    </Pressable>
  );

  const summaryText = activeTranslation && translationCache[activeTranslation]
    ? translationCache[activeTranslation]
    : stripHtml(selectedArticle?.summary) || 'Bu makale için içerik mevcut değil.';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />

      <View style={styles.header}>
        <Text style={styles.h1}>📡 RSS Okuyucu</Text>
        <View style={styles.createRow}>
          <TextInput
            style={styles.createInput}
            placeholder="Yeni liste adı…"
            placeholderTextColor={colors.textFaint}
            value={newListName}
            onChangeText={setNewListName}
            onSubmitEditing={createList}
          />
          <Pressable onPress={createList} style={styles.addBtn}><Text style={styles.addBtnText}>+</Text></Pressable>
        </View>

        {loadingLists ? (
          <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 12 }} />
        ) : (
          <ScrollView ref={listStripRef} horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
            {orderedLists.map((lst) => {
              const active = selectedList?.id === lst.id;
              const pinned = pinnedIds.includes(lst.id);
              return (
                <Pressable key={lst.id} onPress={() => selectList(lst)} onLongPress={() => handleListLongPress(lst)}
                  // Bildirimle gelen liste şeridin görünmeyen kısmında olabiliyor;
                  // konumunu bilmeden oraya kaydıramayız.
                  onLayout={(e) => { listChipX.current[lst.id] = e.nativeEvent.layout.x; }}
                  style={[styles.listChip, active && styles.listChipActive]}>
                  {pinned ? (
                    <Text style={{ fontSize: 11 }}>📌</Text>
                  ) : (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: feedColor(lst.name) }} />
                  )}
                  <Text style={{ color: active ? colors.white : colors.textMuted, fontWeight: active ? '700' : '500' }}>{lst.name}</Text>
                  <Text style={styles.listCount}>{lst.feed_count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {!selectedList ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 48 }}>📡</Text>
          <Text style={{ color: colors.textDim, fontSize: 16, marginTop: 12 }}>Bir liste seç veya oluştur.</Text>
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Pressable onPress={() => { setShowSaved(false); setShowTrending(false); loadArticles(selectedList.id); }} disabled={loadingArticles} style={styles.toolBtn}>
              <Text style={{ color: colors.textMuted, fontWeight: '700' }}>{loadingArticles ? '⏳' : '↻'} Yenile</Text>
            </Pressable>
            <Pressable onPress={() => setShowFeedManager(true)} style={[styles.toolBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={{ color: colors.white, fontWeight: '700' }}>+ RSS Yönet</Text>
            </Pressable>
            <Pressable onPress={() => { const next = !showTrending; setShowTrending(next); if (next) { setShowSaved(false); setTrendingFilter(null); fetchRssTrending(); } }} style={[styles.toolBtn, showTrending && { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.4)' }]}>
              <Text style={{ color: showTrending ? '#34d399' : colors.textMuted, fontWeight: '700' }}>📡 Gündem</Text>
            </Pressable>
            <Pressable onPress={() => { setShowSaved(!showSaved); setShowTrending(false); }} style={[styles.toolBtn, showSaved && { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)' }]}>
              <Text style={{ color: showSaved ? colors.primaryLight : colors.textMuted, fontWeight: '700' }}>📌 {savedArticles.length > 0 ? savedArticles.length : ''} Kayıtlar</Text>
            </Pressable>
            <Pressable onPress={() => { setShowCommunity(true); if (communityFeeds.length === 0) fetchCommunity(); }} style={[styles.toolBtn, { borderColor: 'rgba(99,102,241,0.3)' }]}>
              <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>🌐 Topluluk</Text>
            </Pressable>
            <Pressable onPress={openNotifRules} style={[styles.toolBtn, { borderColor: 'rgba(245,158,11,0.35)' }]}>
              <Text style={{ color: '#fbbf24', fontWeight: '700' }}>
                🔔 {activeRuleCount > 0 ? `${activeRuleCount} ` : ''}Bildirim
              </Text>
            </Pressable>
          </View>

          {/* Bildirim partisi şeridi — hangi bildirime baktığın belli olsun */}
          {notifBatch && (
            <View style={styles.batchBanner}>
              <Text style={{ color: '#fbbf24', fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={2}>
                🔔 {notifBatch.name} · bildirimdeki {notifBatch.count} haber
              </Text>
              <Pressable
                onPress={() => { setNotifBatch(null); if (selectedList) loadArticles(selectedList.id); }}
                hitSlop={8} style={styles.batchClose}>
                <Text style={{ color: colors.textDim, fontWeight: '700', fontSize: 12 }}>✕ Tümü</Text>
              </Pressable>
            </View>
          )}

          {articles.length > 0 && (
            <TextInput
              style={styles.search}
              placeholder="🔍 Başlık veya kaynak ara…"
              placeholderTextColor={colors.textFaint}
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
          )}

          {!showTrending && !showSaved && feedFilters.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 44, marginHorizontal: 16, marginTop: 6, marginBottom: 4, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 6, alignItems: 'center', paddingVertical: 6 }}>
              <Pressable onPress={() => setActiveFeedFilters([])} style={[styles.filterChip, activeFeedFilters.length === 0 && { backgroundColor: colors.primarySoft }]}>
                <Text style={{ color: activeFeedFilters.length === 0 ? colors.primaryLight : colors.textFaint, fontWeight: '700', fontSize: 12 }}>Tümü</Text>
              </Pressable>
              {feedFilters.map((f) => (
                <Pressable key={f.url}
                  onPress={() => toggleFeedFilter(f.url, false)}
                  onLongPress={() => toggleFeedFilter(f.url, true)}
                  delayLongPress={280}
                  style={[styles.filterChip, activeFeedFilters.includes(f.url) && { backgroundColor: `${feedColor(f.label)}22`, borderColor: feedColor(f.label) }]}>
                  <Text style={{ color: activeFeedFilters.includes(f.url) ? feedColor(f.label) : colors.textFaint, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {showTrending ? (
            loadingTrending ? (
              <ActivityIndicator color="#34d399" style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={filteredTrending}
                keyExtractor={(a, i) => `${a.link || a.title}-${i}`}
                renderItem={({ item: a }) => {
                  const isSaved = !!savedIds[a.link];
                  return (
                    <Pressable onPress={() => openArticle(a)} style={styles.article}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Text numberOfLines={1} style={[styles.feedBadge, { color: feedColor(a.feed_title), backgroundColor: `${feedColor(a.feed_title)}22`, flexShrink: 1 }]}>{a.feed_title || 'RSS'}</Text>
                        {!!a.published && <Text style={{ color: colors.textFaint, fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>{formatArticleDate(a.published)}</Text>}
                      </View>
                      <Text style={styles.articleTitle}>{a.title}</Text>
                      {!!a.summary && <Text style={styles.articleSummary} numberOfLines={2}>{stripHtml(a.summary)}</Text>}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <Pressable onPress={() => toggleSave(a)} style={[styles.trendAction, isSaved && { borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                          <Text style={{ color: isSaved ? '#34d399' : colors.textMuted, fontWeight: '700', fontSize: 12 }}>{isSaved ? '📌 Kaydedildi' : '📌 Kaydet'}</Text>
                        </Pressable>
                        <Pressable onPress={() => openArticle(a)} style={[styles.trendAction, { borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.1)' }]}>
                          <Text style={{ color: colors.primaryLight, fontWeight: '700', fontSize: 12 }}>🎙 Podcast</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                }}
                contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListHeaderComponent={
                  <View>
                    <Text style={{ color: colors.textFaint, fontSize: 13, marginBottom: 12 }}>
                      📡 Takip ettiğin tüm RSS beslemelerinden en güncel başlıklar.
                    </Text>
                    {trendingFeedTitles.length > 1 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6 }}>
                        <Pressable onPress={() => setTrendingFilter(null)} style={[styles.filterChip, !trendingFilter && { backgroundColor: 'rgba(16,185,129,0.18)' }]}>
                          <Text style={{ color: !trendingFilter ? '#34d399' : colors.textFaint, fontWeight: '700', fontSize: 12 }}>Tümü</Text>
                        </Pressable>
                        {trendingFeedTitles.map((t) => (
                          <Pressable key={t} onPress={() => setTrendingFilter(trendingFilter === t ? null : t)}
                            style={[styles.filterChip, trendingFilter === t && { backgroundColor: `${feedColor(t)}22` }]}>
                            <Text style={{ color: trendingFilter === t ? feedColor(t) : colors.textFaint, fontWeight: '700', fontSize: 12 }}>{t}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                }
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={{ fontSize: 40 }}>📡</Text>
                    <Text style={{ color: colors.textDim, marginTop: 12, textAlign: 'center' }}>Gündem için RSS beslemesi ekle.</Text>
                  </View>
                }
              />
            )
          ) : showSaved ? (
            loadingSaved ? (
              <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={savedArticles}
                keyExtractor={(a) => String(a.id)}
                renderItem={({ item: a }) => (
                  <Pressable onPress={() => openArticle(a)} style={styles.article}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Text numberOfLines={1} style={[styles.feedBadge, { color: feedColor(a.feed_title), backgroundColor: `${feedColor(a.feed_title)}22`, flexShrink: 1 }]}>{a.feed_title || 'RSS'}</Text>
                      {!!a.published && (
                        <Text style={{ color: colors.textFaint, fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>
                          {formatArticleDate(a.published)}
                        </Text>
                      )}
                      <Text style={{ color: 'rgba(99,102,241,0.7)', fontSize: 11, marginLeft: a.published ? 6 : 'auto', flexShrink: 0 }}>📌</Text>
                    </View>
                    <Text style={styles.articleTitle}>{a.title}</Text>
                    {!!a.summary && <Text style={styles.articleSummary} numberOfLines={2}>{stripHtml(a.summary)}</Text>}
                  </Pressable>
                )}
                contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={{ fontSize: 40 }}>📌</Text>
                    <Text style={{ color: colors.textDim, marginTop: 12 }}>Henüz kaydedilen makale yok.</Text>
                    <Text style={{ color: colors.textFaint, fontSize: 13, marginTop: 6, textAlign: 'center' }}>Makaleyi açıp "Kaydet" butonuna bas.</Text>
                  </View>
                }
              />
            )
          ) : loadingArticles ? (
            <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredArticles}
              keyExtractor={(a, i) => `${a.link || a.title}-${i}`}
              renderItem={renderArticle}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ fontSize: 40 }}>🗞️</Text>
                  <Text style={{ color: colors.textDim, marginTop: 12 }}>
                    {selectedList.feed_count === 0 ? 'Henüz kaynak eklenmedi. "+ RSS Yönet" ile ekle.' : 'Makale bulunamadı.'}
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Listeye basılı tutunca açılan menü (uygulama-içi) */}
      <Modal visible={!!listMenu} transparent animationType="fade" onRequestClose={closeListMenu}>
        <Pressable style={[styles.sheetOverlay, { justifyContent: 'center', padding: 28 }]} onPress={closeListMenu}>
          <Pressable style={[styles.sheet, { borderRadius: radius.lg, padding: 20 }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { marginBottom: 4 }]} numberOfLines={1}>{listMenu?.name}</Text>
            {!menuConfirm ? (
              <>
                <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 16 }}>Bu liste için ne yapmak istersin?</Text>
                <Pressable onPress={() => { togglePin(listMenu.id); closeListMenu(); }}
                  style={[styles.menuItem, { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.4)' }]}>
                  <Text style={{ color: '#f59e0b', fontWeight: '700', fontSize: 15 }}>
                    {pinnedIds.includes(listMenu?.id) ? '📌  Sabitlemeyi Kaldır' : '📌  Başa Sabitle'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => { setRenameValue(listMenu.name); setRenameTarget({ id: listMenu.id, name: listMenu.name }); closeListMenu(); }}
                  style={[styles.menuItem, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryLight, fontWeight: '700', fontSize: 15 }}>✏️  Yeniden Adlandır</Text>
                </Pressable>
                <Pressable onPress={() => setMenuConfirm(true)} style={[styles.menuItem, { borderColor: 'rgba(239,68,68,0.4)' }]}>
                  <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>🗑  Sil</Text>
                </Pressable>
                <Pressable onPress={closeListMenu} style={[styles.menuItem, { alignItems: 'center', borderColor: 'transparent' }]}>
                  <Text style={{ color: colors.textMuted, fontWeight: '700', fontSize: 15 }}>Vazgeç</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ color: colors.textMuted, fontSize: 14, marginVertical: 14, lineHeight: 20 }}>
                  "{listMenu?.name}" listesini ve içindeki kaynakları kalıcı olarak silmek istiyor musun?
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => setMenuConfirm(false)} style={[styles.menuItem, { flex: 1, alignItems: 'center', marginBottom: 0 }]}>
                    <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Vazgeç</Text>
                  </Pressable>
                  <Pressable onPress={() => { const id = listMenu.id; closeListMenu(); deleteList(id); }} style={[styles.menuItem, { flex: 1, alignItems: 'center', marginBottom: 0, backgroundColor: colors.error, borderColor: colors.error }]}>
                    <Text style={{ color: colors.white, fontWeight: '800' }}>Evet, Sil</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Liste yeniden adlandırma modalı */}
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <KeyboardAvoidingView style={[styles.sheetOverlay, { justifyContent: 'center', padding: 24 }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.sheet, { borderRadius: radius.lg, padding: 20 }]}>
            <Text style={styles.sheetTitle}>Listeyi Yeniden Adlandır</Text>
            <TextInput
              style={[styles.createInput, { marginTop: 12, color: colors.text, fontSize: 16, minHeight: 50, paddingVertical: 14 }]}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Liste adı"
              placeholderTextColor={colors.textFaint}
              autoFocus
              onSubmitEditing={renameList}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => { setRenameTarget(null); setRenameValue(''); }} style={[styles.toolBtn, { flex: 1, alignItems: 'center' }]}>
                <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Vazgeç</Text>
              </Pressable>
              <Pressable onPress={renameList} style={[styles.toolBtn, { flex: 1, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primary }]}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>Kaydet</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Feed yönetim modalı */}
      <Modal visible={showFeedManager} transparent animationType="slide" onRequestClose={() => setShowFeedManager(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>RSS Kaynakları</Text>
              <Pressable onPress={() => setShowFeedManager(false)} hitSlop={12}><Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            <View style={styles.createRow}>
              <TextInput
                style={styles.createInput}
                placeholder="https://example.com/feed.xml"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                keyboardType="url"
                value={newFeedUrl}
                onChangeText={setNewFeedUrl}
              />
              <Pressable onPress={addFeed} disabled={addingFeed} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.addBtnText}>{addingFeed ? '…' : 'Ekle'}</Text>
              </Pressable>
            </View>
            <ScrollView style={{ marginTop: 12, maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {(selectedList?.feeds || []).map((f) => (
                <View key={f.id} style={styles.feedRow}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: feedColor(f.title || f.url) }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{f.title || f.url}</Text>
                    {!!f.title && <Text style={{ color: colors.textFaint, fontSize: 11 }} numberOfLines={1}>{f.url}</Text>}
                  </View>
                  <Pressable onPress={() => removeFeed(f.id)} style={styles.removeFeedBtn}>
                    <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Kaldır</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bildirim kuralları modalı — seçili listeye birden fazla kural bağlanabilir */}
      <Modal visible={showNotifRules} transparent animationType="slide" onRequestClose={() => setShowNotifRules(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                🔔 {ruleForm ? (ruleForm.id ? 'Kuralı Düzenle' : 'Yeni Kural') : `Bildirimler — ${selectedList?.name || ''}`}
              </Text>
              <Pressable onPress={() => (ruleForm ? setRuleForm(null) : setShowNotifRules(false))} hitSlop={12}>
                <Text style={{ color: colors.textDim, fontSize: 20 }}>{ruleForm ? '‹' : '✕'}</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {notifLoading ? (
                <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 24 }} />
              ) : !ruleForm ? (
                <>
                  <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 14 }}>
                    Bu listedeki yeni haberler için bildirim kuralları. Birden fazla kural
                    ekleyebilirsin — örneğin biri anlık, biri günlük özet.
                  </Text>

                  {notifRules.length === 0 ? (
                    <Text style={{ color: colors.textFaint, textAlign: 'center', marginVertical: 20 }}>
                      Henüz kural yok.
                    </Text>
                  ) : notifRules.map((r) => (
                    <View key={r.id} style={styles.feedRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>{r.name}</Text>
                        <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                          {ruleSummary(r)}
                        </Text>
                        {!r.ready && (
                          <Text style={{ color: '#fbbf24', fontSize: 10, marginTop: 2 }}>
                            ⏳ ilk tarama sürüyor…
                          </Text>
                        )}
                      </View>
                      {/* Aç/kapa — önce ◉/○ karakteriydi ve fark edilmiyordu. */}
                      <Switch
                        value={!!r.enabled}
                        onValueChange={() => toggleRule(r)}
                        trackColor={{ false: colors.border, true: colors.primary }}
                      />
                      <Pressable
                        onPress={() => setRuleForm({
                          id: r.id, name: r.name, scope: r.scope, feed_ids: r.feed_ids || [],
                          mode: r.mode, interval_minutes: r.interval_minutes || 60, grouping: r.grouping,
                        })}
                        style={styles.removeFeedBtn}>
                        <Text style={{ color: colors.primaryLight, fontSize: 12, fontWeight: '600' }}>Düzenle</Text>
                      </Pressable>
                      <Pressable onPress={() => deleteRule(r.id)} style={styles.removeFeedBtn}>
                        <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Sil</Text>
                      </Pressable>
                    </View>
                  ))}

                  <Pressable
                    onPress={() => setRuleForm({ ...EMPTY_RULE })}
                    style={[styles.addBtn, { backgroundColor: colors.primary, marginTop: 16, alignSelf: 'stretch', alignItems: 'center' }]}>
                    <Text style={styles.addBtnText}>+ Yeni kural</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.ruleLabel}>Kural adı</Text>
                  <TextInput
                    style={styles.createInput}
                    placeholder="ör. Kritik açıklar"
                    placeholderTextColor={colors.textFaint}
                    value={ruleForm.name}
                    onChangeText={(v) => setRuleForm((p) => ({ ...p, name: v }))}
                  />

                  <Text style={styles.ruleLabel}>Hangi beslemeler?</Text>
                  <View style={styles.ruleChipRow}>
                    {[{ k: 'all', l: 'Tüm beslemeler' }, { k: 'selected', l: 'Seçili beslemeler' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setRuleForm((p) => ({ ...p, scope: o.k }))}
                        style={[styles.ruleChip, ruleForm.scope === o.k && styles.ruleChipOn]}>
                        <Text style={{ color: ruleForm.scope === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {ruleForm.scope === 'selected' && (
                    <View style={{ marginTop: 8 }}>
                      {(selectedList?.feeds || []).map((f) => {
                        const on = ruleForm.feed_ids.includes(f.id);
                        return (
                          <Pressable key={f.id}
                            onPress={() => setRuleForm((p) => ({
                              ...p,
                              feed_ids: on ? p.feed_ids.filter((x) => x !== f.id) : [...p.feed_ids, f.id],
                            }))}
                            style={styles.feedRow}>
                            <Text style={{ color: on ? '#34d399' : colors.textFaint, fontSize: 16 }}>{on ? '☑' : '☐'}</Text>
                            <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                              {f.title || hostFromUrl(f.url)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  <Text style={styles.ruleLabel}>Ne zaman?</Text>
                  <View style={styles.ruleChipRow}>
                    {[{ k: 'immediate', l: 'Hemen (~15 dk)' }, { k: 'interval', l: 'Aralıklı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setRuleForm((p) => ({ ...p, mode: o.k }))}
                        style={[styles.ruleChip, ruleForm.mode === o.k && styles.ruleChipOn]}>
                        <Text style={{ color: ruleForm.mode === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {ruleForm.mode === 'interval' && (
                    <IntervalStepper
                      value={ruleForm.interval_minutes || INTERVAL_MIN}
                      onChange={(v) => setRuleForm((p) => ({ ...p, interval_minutes: v }))}
                      colors={colors}
                    />
                  )}

                  <Text style={styles.ruleLabel}>Nasıl gelsin?</Text>
                  <View style={styles.ruleChipRow}>
                    {[{ k: 'digest', l: 'Tek özet' }, { k: 'individual', l: 'Her makale ayrı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setRuleForm((p) => ({ ...p, grouping: o.k }))}
                        style={[styles.ruleChip, ruleForm.grouping === o.k && styles.ruleChipOn]}>
                        <Text style={{ color: ruleForm.grouping === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 12, lineHeight: 16 }}>
                    Sessiz saatlerde bildirim gönderilmez; biriken haberler aralık bitince
                    tek özet olarak gelir. Ayarlar → Bildirimler'den değiştirebilirsin.
                  </Text>

                  <Pressable onPress={saveRule} disabled={notifSaving}
                    style={[styles.addBtn, { backgroundColor: colors.primary, marginTop: 18, alignSelf: 'stretch', alignItems: 'center' }]}>
                    <Text style={styles.addBtnText}>{notifSaving ? '…' : 'Kaydet'}</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Topluluk kaynakları modalı */}
      <Modal visible={showCommunity} transparent animationType="slide" onRequestClose={() => setShowCommunity(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>🌐 Topluluk Kaynakları</Text>
              <Pressable onPress={() => setShowCommunity(false)} hitSlop={12}><Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {communityLoading ? (
                <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 24 }} />
              ) : communityFeeds.length === 0 ? (
                <Text style={{ color: colors.textFaint, textAlign: 'center', marginTop: 24 }}>Henüz onaylı kaynak yok.</Text>
              ) : (
                <>
                  {/* Kaynak/kategori arama */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, marginBottom: 10 }}>
                    <Text style={{ color: colors.textFaint, fontSize: 15 }}>🔍</Text>
                    <TextInput
                      style={{ flex: 1, color: colors.text, paddingVertical: 10 }}
                      placeholder="Kaynak veya kategori ara (ör. spor)"
                      placeholderTextColor={colors.textFaint}
                      value={communitySearch}
                      onChangeText={setCommunitySearch}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {communitySearch.length > 0 && (
                      <Pressable onPress={() => setCommunitySearch('')} hitSlop={8}>
                        <Text style={{ color: colors.textFaint, fontSize: 14 }}>✕</Text>
                      </Pressable>
                    )}
                  </View>
                  {/* Kategori filtre butonları */}
                  {(() => {
                    const cats = [...new Set(communityFeeds.map(f => f.category).filter(Boolean))];
                    return cats.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 2 }}>
                          <Pressable onPress={() => setCommunityFilter('')} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: !communityFilter ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)' }}>
                            <Text style={{ color: !communityFilter ? colors.primaryLight : colors.textDim, fontSize: 11, fontWeight: '800' }}>Tümü</Text>
                          </Pressable>
                          {cats.map(cat => (
                            <Pressable key={cat} onPress={() => setCommunityFilter(communityFilter === cat ? '' : cat)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: communityFilter === cat ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)' }}>
                              <Text style={{ color: communityFilter === cat ? colors.primaryLight : colors.textDim, fontSize: 11, fontWeight: '800' }}>{cat}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    ) : null;
                  })()}
                  {communityFeeds
                    .filter(f => {
                      if (communityFilter && f.category !== communityFilter) return false;
                      const q = communitySearch.trim().toLowerCase();
                      if (!q) return true;
                      return (f.title || '').toLowerCase().includes(q)
                        || (f.url || '').toLowerCase().includes(q)
                        || (f.category || '').toLowerCase().includes(q);
                    })
                    .map((feed) => (
                      <View key={feed.id} style={styles.feedRow}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: feedColor(feed.url), flexShrink: 0, marginTop: 4 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                            {feed.title || feed.url}
                          </Text>
                          {!!feed.title && <Text style={{ color: colors.textDim, fontSize: 10, marginTop: 1 }} numberOfLines={1}>{feed.url}</Text>}
                          {!!feed.category && <Text style={{ color: colors.primaryLight, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{feed.category}</Text>}
                        </View>
                        <Pressable onPress={() => handleAddFromCommunity(feed.url, feed.title || feed.url)} style={[styles.removeFeedBtn, { borderColor: 'rgba(99,102,241,0.3)' }]}>
                          <Text style={{ color: colors.primaryLight, fontSize: 12, fontWeight: '700' }}>+ Ekle</Text>
                        </Pressable>
                      </View>
                    ))
                  }
                </>
              )}

              <View style={{ borderTopWidth: 1, borderTopColor: colors.borderSoft, marginTop: 16, paddingTop: 16 }}>
                <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Kaynak Öner</Text>
                <TextInput
                  style={[styles.createInput, { marginBottom: 8 }]}
                  placeholder="https://example.com/feed.xml"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  keyboardType="url"
                  value={submitUrl}
                  onChangeText={setSubmitUrl}
                />
                <Text style={{ color: colors.textFaint, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>Kategori seç *</Text>
                <View style={{ maxHeight: 220, marginBottom: 10 }}>
                  <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {groupCategories(categories).map(group => (
                      <View key={group.id} style={{ marginBottom: 8 }}>
                        <Text style={{ color: colors.primaryLight, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 }}>{group.name}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {[group, ...group.children].map(cat => (
                            <Pressable key={cat.id} onPress={() => setSubmitCategory(submitCategory === cat.id ? null : cat.id)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: submitCategory === cat.id ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)' }}>
                              <Text style={{ color: submitCategory === cat.id ? colors.primaryLight : colors.textDim, fontSize: 11, fontWeight: '800' }}>{cat.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
                <Pressable onPress={handleSubmitSource} disabled={submitting || !submitUrl.trim() || !submitCategory} style={[styles.addBtn, { opacity: (!submitUrl.trim() || !submitCategory) ? 0.4 : 1, alignSelf: 'flex-start', paddingHorizontal: 16 }]}>
                  <Text style={styles.addBtnText}>{submitting ? '…' : '📨 Öneri Gönder'}</Text>
                </Pressable>
              </View>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Liste Seçici Modal */}
      <Modal visible={!!listPickerFeed} transparent animationType="slide" onRequestClose={() => setListPickerFeed(null)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>📋 Hangi Listeye Ekleyelim?</Text>
              <Pressable onPress={() => setListPickerFeed(null)} hitSlop={12}><Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            {listPickerFeed && <Text style={{ color: colors.textDim, fontSize: 11, marginBottom: 12 }} numberOfLines={1}>{listPickerFeed.title}</Text>}
            {lists.length === 0 ? (
              <Text style={{ color: colors.textFaint, textAlign: 'center', paddingVertical: 24 }}>Önce bir liste oluşturman gerekiyor.</Text>
            ) : (
              <ScrollView>
                {lists.map(list => (
                  <Pressable
                    key={list.id}
                    disabled={addingToListId === list.id}
                    onPress={() => addFeedToList(list.id, listPickerFeed.url)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)', backgroundColor: addingToListId === list.id ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.07)', opacity: addingToListId && addingToListId !== list.id ? 0.5 : 1 }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{list.name}</Text>
                    {list.feed_count != null && <Text style={{ color: colors.textDim, fontSize: 12 }}>{list.feed_count} kaynak</Text>}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Makale modalı */}
      <Modal visible={!!selectedArticle} transparent animationType="slide" onRequestClose={() => setSelectedArticle(null)}>
        <View style={styles.sheetOverlay}>
          <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '92%', transform: [{ translateY: articleY }] }]} {...articlePan.panHandlers}>
            <View style={{ paddingVertical: 10, alignItems: 'center' }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.textDim, opacity: 0.6 }} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={[styles.feedBadge, { color: feedColor(selectedArticle?.feed_title), backgroundColor: `${feedColor(selectedArticle?.feed_title)}22` }]}>
                {selectedArticle?.feed_title}
              </Text>
              <Pressable onPress={() => setSelectedArticle(null)} hitSlop={16} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text, fontSize: 18 }}>✕</Text></Pressable>
            </View>
            <ScrollView
              onScroll={(e) => { articleScrollY.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              <Text style={styles.modalTitle}>{selectedArticle?.title}</Text>
              {!!selectedArticle?.published && (
                <Text style={styles.modalDate}>🕐 {formatArticleDateLong(selectedArticle.published)}</Text>
              )}

              <View style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <Text style={styles.summaryLabel}>İÇERİK</Text>
                  <View style={styles.langToggle}>
                    {[{ c: null, l: 'Orijinal' }, { c: 'tr', l: '🇹🇷' }, { c: 'en', l: '🇬🇧' }].map(({ c, l }) => (
                      <Pressable key={l} onPress={() => translate(c)} disabled={translating}
                        style={[styles.langBtn, activeTranslation === c && { backgroundColor: colors.primarySoft }]}>
                        <Text style={{ color: activeTranslation === c ? colors.primaryLight : colors.textFaint, fontWeight: '800', fontSize: 11 }}>{l}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Text style={styles.summaryText}>{translating ? 'Çevriliyor…' : summaryText}</Text>
              </View>

              {podcastStatus === 'ready' && (
                <Text style={{ color: colors.success, fontWeight: '700', marginBottom: 16 }}>🎧 Podcast hazır — oynatıcıdan dinleyebilirsin.</Text>
              )}

              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {!!selectedArticle?.link && (
                  <Pressable onPress={() => Linking.openURL(selectedArticle.link)} style={[styles.modalBtn, styles.outlineBtn]}>
                    <Text style={{ color: colors.textMuted, fontWeight: '700' }}>🔗 Kaynağa Git</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => selectedArticle && toggleSave(selectedArticle)}
                  style={[styles.modalBtn, styles.outlineBtn, savedIds[selectedArticle?.link] && { borderColor: 'rgba(99,102,241,0.4)', backgroundColor: 'rgba(99,102,241,0.08)' }]}
                >
                  <Text style={{ color: savedIds[selectedArticle?.link] ? colors.primaryLight : colors.textMuted, fontWeight: '700' }}>
                    {savedIds[selectedArticle?.link] ? '📌 Kaydedildi' : '📌 Kaydet'}
                  </Text>
                </Pressable>
                {podcastStatus !== 'ready' && (podcastStatus === 'loading' || podcastStatus === 'processing') && (
                  <Pressable disabled style={[styles.modalBtn, { backgroundColor: 'rgba(99,102,241,0.4)' }]}>
                    <Text style={{ color: colors.white, fontWeight: '700' }}>
                      {podcastStatus === 'loading' ? '⏳ Hazırlanıyor…' : '🎙️ Üretiliyor…'}
                    </Text>
                  </Pressable>
                )}
                {podcastStatus !== 'ready' && podcastStatus !== 'loading' && podcastStatus !== 'processing' && !showLengthPicker && (
                  <Pressable onPress={() => setShowLengthPicker(true)} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: colors.white, fontWeight: '700' }}>🎙️ Podcast Oluştur</Text>
                  </Pressable>
                )}
                {podcastStatus !== 'ready' && podcastStatus !== 'loading' && podcastStatus !== 'processing' && showLengthPicker && (
                  <>
                    {[
                      { key: 'short', label: '🎙️ 30sn-1dk' },
                      { key: 'medium', label: '🎙️ 1-2dk' },
                      { key: 'long', label: '🎙️ 2-4dk' },
                    ].map((opt) => (
                      <Pressable key={opt.key} onPress={() => createPodcast(opt.key)}
                        style={[styles.modalBtn, { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{opt.label}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setShowLengthPicker(false)} style={[styles.modalBtn, styles.outlineBtn]}>
                      <Text style={{ color: colors.textDim, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </>
                )}
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '900', marginBottom: 12 },
  createRow: { flexDirection: 'row', gap: 8 },
  createInput: { flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, color: colors.text },
  addBtn: { paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primary },
  addBtnText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  listChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.chip },
  listChipActive: { borderColor: 'rgba(99,102,241,0.25)', backgroundColor: colors.primarySoft },
  listCount: { color: colors.textFaint, fontSize: 11, backgroundColor: colors.chip, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  toolBtn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chip },
  search: { marginHorizontal: 16, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, color: colors.text, marginBottom: 4 },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.chip },
  trendAction: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chip },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  article: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 16 },
  feedBadge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, textTransform: 'uppercase', overflow: 'hidden' },
  podcastBadge: { fontSize: 11, fontWeight: '800', color: colors.success, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', marginLeft: 'auto' },
  articleTitle: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 22, marginBottom: 6 },
  articleSummary: { color: colors.textFaint, fontSize: 13, lineHeight: 19 },
  sheetOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderWidth: 1, borderColor: colors.border },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  menuItem: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: colors.chip, borderRadius: radius.sm, marginBottom: 6 },
  removeFeedBtn: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  // Bildirim kuralı formu
  ruleLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  ruleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ruleChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 12 },
  ruleChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLight },
  // Bildirim partisi şeridi
  batchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 8, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)', borderRadius: radius.sm,
  },
  batchClose: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingVertical: 4, paddingHorizontal: 8,
  },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', lineHeight: 28, marginBottom: 8 },
  modalDate: { color: colors.textFaint, fontSize: 12, marginBottom: 18 },
  summaryCard: { backgroundColor: 'rgba(99,102,241,0.06)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.12)', borderRadius: radius.md, padding: 16, marginBottom: 18 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  summaryLabel: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  langToggle: { flexDirection: 'row', backgroundColor: colors.overlay, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7 },
  summaryText: { color: '#cbd5e1', fontSize: 15, lineHeight: 24 },
  modalBtn: { flex: 1, minWidth: 130, paddingVertical: 13, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center' },
  outlineBtn: { borderWidth: 1, borderColor: colors.border },
});
