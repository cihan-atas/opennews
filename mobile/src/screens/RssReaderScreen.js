import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, Modal, StyleSheet,
  ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { usePlayer } from '../contexts/PlayerContext';
import { useToast, Toast } from '../components/Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

const FEED_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
const feedColor = (title) => {
  if (!title) return FEED_COLORS[0];
  const idx = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % FEED_COLORS.length;
  return FEED_COLORS[idx];
};
const stripHtml = (html) => (html ? html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');

export default function RssReaderScreen() {
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

  const [searchTerm, setSearchTerm] = useState('');
  const [activeFeedFilter, setActiveFeedFilter] = useState(null);

  const [selectedArticle, setSelectedArticle] = useState(null);
  const [podcastStatus, setPodcastStatus] = useState(null); // null | loading | processing | ready
  const [podcastCache, setPodcastCache] = useState({});
  const [activeTranslation, setActiveTranslation] = useState(null);
  const [translationCache, setTranslationCache] = useState({});
  const [translating, setTranslating] = useState(false);

  const [showCommunity, setShowCommunity] = useState(false);
  const [communityFeeds, setCommunityFeeds] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityFilter, setCommunityFilter] = useState('');
  const [submitUrl, setSubmitUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Liste seçici
  const [listPickerFeed, setListPickerFeed] = useState(null); // { url, title }
  const [addingToListId, setAddingToListId] = useState(null);

  const [showSaved, setShowSaved] = useState(false);
  const [savedArticles, setSavedArticles] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedIds, setSavedIds] = useState({}); // { link: savedId }

  const pollRef = useRef(null);
  const pollTitleRef = useRef(null);

  useEffect(() => {
    fetchLists();
    fetchSaved();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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

  const fetchLists = async () => {
    setLoadingLists(true);
    try {
      const res = await apiFetch('/rss-reader/lists');
      if (res.ok) {
        const data = await res.json();
        setLists(data);
        if (data.length > 0) { setSelectedList(data[0]); loadArticles(data[0].id); }
      }
    } catch (_) { showToast('Listeler yüklenemedi.', 'error'); }
    finally { setLoadingLists(false); }
  };

  const loadArticles = async (listId) => {
    setLoadingArticles(true);
    setArticles([]); setSearchTerm(''); setActiveFeedFilter(null);
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

  const fetchCommunity = async () => {
    setCommunityLoading(true);
    try {
      const res = await apiFetch('/rss/approved');
      if (res.ok) setCommunityFeeds(await res.json());
    } catch (_) { showToast('Yüklenemedi.', 'error'); }
    finally { setCommunityLoading(false); }
  };

  const handleSubmitSource = async () => {
    if (!submitUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/rss/submit', { method: 'POST', body: JSON.stringify({ url: submitUrl.trim() }) });
      if (res.ok) { showToast('Kaynağın incelemeye alındı!'); setSubmitUrl(''); }
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

  const createPodcast = async () => {
    if (!selectedArticle) return;
    setPodcastStatus('loading');
    const content = stripHtml(selectedArticle.summary) || selectedArticle.title;
    try {
      const res = await apiFetch('/rss-reader/podcast', {
        method: 'POST',
        body: JSON.stringify({ title: selectedArticle.title, content, source_url: selectedArticle.link || null }),
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

  const feedTitles = useMemo(() => {
    const seen = new Set();
    return articles.map((a) => a.feed_title).filter((t) => t && !seen.has(t) && seen.add(t));
  }, [articles]);

  const filteredArticles = useMemo(() => {
    let r = articles;
    if (activeFeedFilter) r = r.filter((a) => a.feed_title === activeFeedFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      r = r.filter((a) => a.title?.toLowerCase().includes(q) || a.feed_title?.toLowerCase().includes(q));
    }
    return r;
  }, [articles, activeFeedFilter, searchTerm]);

  const renderArticle = ({ item: a }) => (
    <Pressable onPress={() => openArticle(a)} style={styles.article}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <Text style={[styles.feedBadge, { color: feedColor(a.feed_title), backgroundColor: `${feedColor(a.feed_title)}22` }]}>{a.feed_title}</Text>
        {!!podcastCache[a.title] && <Text style={styles.podcastBadge}>🎧 Podcast</Text>}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
            {lists.map((lst) => {
              const active = selectedList?.id === lst.id;
              return (
                <Pressable key={lst.id} onPress={() => selectList(lst)} onLongPress={() => deleteList(lst.id)}
                  style={[styles.listChip, active && styles.listChipActive]}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: feedColor(lst.name) }} />
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
            <Pressable onPress={() => { setShowSaved(false); loadArticles(selectedList.id); }} disabled={loadingArticles} style={styles.toolBtn}>
              <Text style={{ color: colors.textMuted, fontWeight: '700' }}>{loadingArticles ? '⏳' : '↻'} Yenile</Text>
            </Pressable>
            <Pressable onPress={() => setShowFeedManager(true)} style={[styles.toolBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={{ color: colors.white, fontWeight: '700' }}>+ RSS Yönet</Text>
            </Pressable>
            <Pressable onPress={() => { setShowSaved(!showSaved); }} style={[styles.toolBtn, showSaved && { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)' }]}>
              <Text style={{ color: showSaved ? colors.primaryLight : colors.textMuted, fontWeight: '700' }}>📌 {savedArticles.length > 0 ? savedArticles.length : ''} Kayıtlar</Text>
            </Pressable>
            <Pressable onPress={() => { setShowCommunity(true); if (communityFeeds.length === 0) fetchCommunity(); }} style={[styles.toolBtn, { borderColor: 'rgba(99,102,241,0.3)' }]}>
              <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>🌐 Topluluk</Text>
            </Pressable>
          </View>

          {articles.length > 0 && (
            <TextInput
              style={styles.search}
              placeholder="🔍 Başlık veya kaynak ara…"
              placeholderTextColor={colors.textFaint}
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
          )}

          {feedTitles.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, marginHorizontal: 16 }} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
              <Pressable onPress={() => setActiveFeedFilter(null)} style={[styles.filterChip, !activeFeedFilter && { backgroundColor: colors.primarySoft }]}>
                <Text style={{ color: !activeFeedFilter ? colors.primaryLight : colors.textFaint, fontWeight: '700', fontSize: 12 }}>Tümü</Text>
              </Pressable>
              {feedTitles.map((t) => (
                <Pressable key={t} onPress={() => setActiveFeedFilter(activeFeedFilter === t ? null : t)}
                  style={[styles.filterChip, activeFeedFilter === t && { backgroundColor: `${feedColor(t)}22` }]}>
                  <Text style={{ color: activeFeedFilter === t ? feedColor(t) : colors.textFaint, fontWeight: '700', fontSize: 12 }}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {showSaved ? (
            loadingSaved ? (
              <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={savedArticles}
                keyExtractor={(a) => String(a.id)}
                renderItem={({ item: a }) => (
                  <Pressable onPress={() => openArticle(a)} style={styles.article}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Text style={[styles.feedBadge, { color: feedColor(a.feed_title), backgroundColor: `${feedColor(a.feed_title)}22` }]}>{a.feed_title || 'RSS'}</Text>
                      <Text style={{ color: 'rgba(99,102,241,0.7)', fontSize: 11, marginLeft: 'auto' }}>📌</Text>
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

      {/* Feed yönetim modalı */}
      <Modal visible={showFeedManager} transparent animationType="slide" onRequestClose={() => setShowFeedManager(false)}>
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
            <ScrollView style={{ marginTop: 12, maxHeight: 320 }}>
              {(selectedList?.feeds || []).map((f) => (
                <View key={f.id} style={styles.feedRow}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: feedColor(f.title || f.url) }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.white, fontWeight: '600' }} numberOfLines={1}>{f.title || f.url}</Text>
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
      </Modal>

      {/* Topluluk kaynakları modalı */}
      <Modal visible={showCommunity} transparent animationType="slide" onRequestClose={() => setShowCommunity(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>🌐 Topluluk Kaynakları</Text>
              <Pressable onPress={() => setShowCommunity(false)} hitSlop={12}><Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            <ScrollView>
              {communityLoading ? (
                <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 24 }} />
              ) : communityFeeds.length === 0 ? (
                <Text style={{ color: colors.textFaint, textAlign: 'center', marginTop: 24 }}>Henüz onaylı kaynak yok.</Text>
              ) : (
                <>
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
                    .filter(f => !communityFilter || f.category === communityFilter)
                    .map((feed) => (
                      <View key={feed.id} style={styles.feedRow}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: feedColor(feed.url), flexShrink: 0, marginTop: 4 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.white, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
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
                <View style={styles.createRow}>
                  <TextInput
                    style={styles.createInput}
                    placeholder="https://example.com/feed.xml"
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    keyboardType="url"
                    value={submitUrl}
                    onChangeText={setSubmitUrl}
                  />
                  <Pressable onPress={handleSubmitSource} disabled={submitting || !submitUrl.trim()} style={[styles.addBtn, { opacity: !submitUrl.trim() ? 0.4 : 1 }]}>
                    <Text style={styles.addBtnText}>{submitting ? '…' : '📨'}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
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
                    <Text style={{ color: colors.white, fontWeight: '600' }}>{list.name}</Text>
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
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '92%' }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.feedBadge, { color: feedColor(selectedArticle?.feed_title), backgroundColor: `${feedColor(selectedArticle?.feed_title)}22` }]}>
                {selectedArticle?.feed_title}
              </Text>
              <Pressable onPress={() => setSelectedArticle(null)} hitSlop={12}><Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            <ScrollView>
              <Text style={styles.modalTitle}>{selectedArticle?.title}</Text>

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
                {podcastStatus !== 'ready' && (
                  <Pressable onPress={createPodcast} disabled={podcastStatus === 'loading' || podcastStatus === 'processing'}
                    style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: colors.white, fontWeight: '700' }}>
                      {podcastStatus === 'loading' ? '⏳ Hazırlanıyor…' : podcastStatus === 'processing' ? '🎙️ Üretiliyor…' : '🎙️ Podcast Oluştur'}
                    </Text>
                  </Pressable>
                )}
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  h1: { color: colors.white, fontSize: 24, fontWeight: '900', marginBottom: 12 },
  createRow: { flexDirection: 'row', gap: 8 },
  createInput: { flex: 1, backgroundColor: 'rgba(2,6,23,0.5)', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, color: colors.white },
  addBtn: { paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primary },
  addBtnText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  listChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.04)' },
  listChipActive: { borderColor: 'rgba(99,102,241,0.25)', backgroundColor: colors.primarySoft },
  listCount: { color: colors.textFaint, fontSize: 11, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  toolBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.05)' },
  search: { marginHorizontal: 16, backgroundColor: 'rgba(2,6,23,0.5)', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, color: colors.white, marginBottom: 4 },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.05)' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  article: { backgroundColor: 'rgba(15,23,42,0.5)', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 16 },
  feedBadge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, textTransform: 'uppercase', overflow: 'hidden' },
  podcastBadge: { fontSize: 11, fontWeight: '800', color: colors.success, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', marginLeft: 'auto' },
  articleTitle: { color: colors.white, fontSize: 16, fontWeight: '700', lineHeight: 22, marginBottom: 6 },
  articleSummary: { color: colors.textFaint, fontSize: 13, lineHeight: 19 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'rgba(10,15,30,0.99)', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderWidth: 1, borderColor: colors.border },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius.sm, marginBottom: 6 },
  removeFeedBtn: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  modalTitle: { color: colors.white, fontSize: 22, fontWeight: '900', lineHeight: 28, marginBottom: 18 },
  summaryCard: { backgroundColor: 'rgba(99,102,241,0.06)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.12)', borderRadius: radius.md, padding: 16, marginBottom: 18 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  summaryLabel: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  langToggle: { flexDirection: 'row', backgroundColor: 'rgba(2,6,23,0.6)', borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7 },
  summaryText: { color: '#cbd5e1', fontSize: 15, lineHeight: 24 },
  modalBtn: { flex: 1, minWidth: 130, paddingVertical: 13, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center' },
  outlineBtn: { borderWidth: 1, borderColor: colors.border },
});
