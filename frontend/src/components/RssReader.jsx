import { useState, useEffect, useMemo } from 'react';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';
import AudioPlayer from './AudioPlayer';
import { usePlayer } from '../contexts/PlayerContext';

function RssReader() {
  const { isMobile } = useWindowSize();
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [loadingLists, setLoadingLists] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const [showListPanel, setShowListPanel] = useState(true);
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [showFeedForm, setShowFeedForm] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFeedFilter, setActiveFeedFilter] = useState(null);

  // Article modal
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [podcastStatus, setPodcastStatus] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [podcastPollTitle, setPodcastPollTitle] = useState(null);
  const [podcastCache, setPodcastCache] = useState({});
  const { setTrack } = usePlayer();

  // Translation
  const [activeTranslation, setActiveTranslation] = useState(null);
  const [translationCache, setTranslationCache] = useState({});
  const [isTranslating, setIsTranslating] = useState(false);

  // Community RSS
  const [leftTab, setLeftTab] = useState('mine'); // 'mine' | 'community' | 'saved'
  const [communityFeeds, setCommunityFeeds] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityFilter, setCommunityFilter] = useState(''); // kategori filtresi
  const [submitUrl, setSubmitUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Liste seçici modal (community feed eklerken)
  const [listPickerFeed, setListPickerFeed] = useState(null); // { url, title }
  const [addingToList, setAddingToList] = useState(null); // list id

  // Saved articles
  const [savedIds, setSavedIds] = useState({}); // { link: savedId }
  const [savedArticles, setSavedArticles] = useState([]);
  const [showSaved, setShowSaved] = useState(false);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ show: true, message, type });
  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast(p => ({ ...p, show: false })), 2500);
      return () => clearTimeout(t);
    }
  }, [toast.show]);

  useEffect(() => { fetchLists(); fetchSaved(); }, []);

  useEffect(() => {
    if (leftTab === 'community' && communityFeeds.length === 0) fetchCommunity();
  }, [leftTab]);

  // Podcast polling
  useEffect(() => {
    if (podcastStatus !== 'processing' || !podcastPollTitle) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchWithAuth(
          `${import.meta.env.VITE_API_URL}/rss-reader/podcast/check?title=${encodeURIComponent(podcastPollTitle)}`
        );
        if (res.ok) {
          const data = await res.json();
          clearInterval(interval);
          setAudioUrl(data.audio_url);
          setPodcastStatus('ready');
          setPodcastCache(prev => ({ ...prev, [podcastPollTitle]: data.audio_url }));
          setTrack(data.audio_url, podcastPollTitle, selectedArticle?.feed_title, true, data.podcast_id);
          showToast('Podcast hazır! 🎧', 'success');
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [podcastStatus, podcastPollTitle]);

  const fetchSaved = async () => {
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/saved?size=100`);
      if (res.ok) {
        const data = await res.json();
        setSavedArticles(data.items);
        const ids = {};
        data.items.forEach(a => { ids[a.link] = a.id; });
        setSavedIds(ids);
      }
    } catch (_) {}
  };

  const toggleSave = async (article) => {
    const existingId = savedIds[article.link];
    if (existingId) {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/saved/${existingId}`, { method: 'DELETE' });
        if (res.ok) {
          setSavedIds(p => { const n = { ...p }; delete n[article.link]; return n; });
          setSavedArticles(p => p.filter(a => a.id !== existingId));
          showToast('Kaydedilenlerden silindi.');
        }
      } catch (_) { showToast('İşlem başarısız.', 'error'); }
    } else {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/saved`, {
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
          setSavedIds(p => ({ ...p, [article.link]: saved.id }));
          setSavedArticles(p => [saved, ...p]);
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
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists`);
      if (res.ok) {
        const data = await res.json();
        setLists(data);
        if (data.length > 0 && !selectedList) {
          setSelectedList(data[0]);
          loadArticles(data[0].id);
        }
      }
    } catch (_) { showToast('Listeler yüklenemedi.', 'error'); }
    finally { setLoadingLists(false); }
  };

  const loadArticles = async (listId) => {
    setLoadingArticles(true);
    setArticles([]);
    setSearchTerm('');
    setActiveFeedFilter(null);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${listId}/articles`);
      if (res.ok) {
        setArticles(await res.json());
        setLastRefreshed(new Date());
      }
    } catch (_) { showToast('Haberler çekilemedi.', 'error'); }
    finally { setLoadingArticles(false); }
  };

  const handleRefresh = () => {
    if (selectedList) loadArticles(selectedList.id);
  };

  const handleSelectList = (lst) => {
    setSelectedList(lst);
    setShowFeedForm(false);
    setSelectedArticle(null);
    loadArticles(lst.id);
    if (isMobile) setShowListPanel(false);
  };

  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    setCreatingList(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists`, {
        method: 'POST',
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setLists(prev => [...prev, created]);
        setNewListName('');
        setSelectedList(created);
        setArticles([]);
        if (isMobile) setShowListPanel(false);
        showToast('Liste oluşturuldu!', 'success');
      }
    } catch (_) { showToast('Oluşturulamadı.', 'error'); }
    finally { setCreatingList(false); }
  };

  const handleDeleteList = async (listId, e) => {
    e.stopPropagation();
    if (!confirm('Bu listeyi ve tüm feedlerini silmek istiyor musun?')) return;
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${listId}`, { method: 'DELETE' });
      if (res.ok) {
        setLists(prev => prev.filter(l => l.id !== listId));
        if (selectedList?.id === listId) { setSelectedList(null); setArticles([]); }
        showToast('Liste silindi.', 'success');
      }
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  const handleRename = async (listId) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${listId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setLists(prev => prev.map(l => l.id === listId ? { ...l, name: updated.name } : l));
        if (selectedList?.id === listId) setSelectedList(p => ({ ...p, name: updated.name }));
        showToast('Yeniden adlandırıldı.', 'success');
      }
    } catch (_) {}
    finally { setRenamingId(null); }
  };

  const handleAddFeed = async (e) => {
    e.preventDefault();
    if (!newFeedUrl.trim() || !selectedList) return;
    setAddingFeed(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${selectedList.id}/feeds`, {
        method: 'POST',
        body: JSON.stringify({ url: newFeedUrl.trim() }),
      });
      if (res.ok) {
        const feed = await res.json();
        const updatedList = { ...selectedList, feeds: [...(selectedList.feeds || []), feed], feed_count: (selectedList.feed_count || 0) + 1 };
        setSelectedList(updatedList);
        setLists(prev => prev.map(l => l.id === selectedList.id ? updatedList : l));
        setNewFeedUrl('');
        showToast(`"${feed.title || feed.url}" eklendi!`, 'success');
        loadArticles(selectedList.id);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Eklenemedi.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setAddingFeed(false); }
  };

  const handleRemoveFeed = async (feedId) => {
    if (!selectedList) return;
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${selectedList.id}/feeds/${feedId}`, { method: 'DELETE' });
      if (res.ok) {
        const updatedFeeds = selectedList.feeds.filter(f => f.id !== feedId);
        const updatedList = { ...selectedList, feeds: updatedFeeds, feed_count: updatedFeeds.length };
        setSelectedList(updatedList);
        setLists(prev => prev.map(l => l.id === selectedList.id ? updatedList : l));
        showToast('Feed kaldırıldı.', 'success');
        loadArticles(selectedList.id);
      }
    } catch (_) { showToast('Kaldırılamadı.', 'error'); }
  };

  const fetchCommunity = async () => {
    setCommunityLoading(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/approved`);
      if (res.ok) setCommunityFeeds(await res.json());
    } catch (_) { showToast('Topluluk kaynakları yüklenemedi.', 'error'); }
    finally { setCommunityLoading(false); }
  };

  const handleSubmitSource = async (e) => {
    e.preventDefault();
    if (!submitUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/submit`, {
        method: 'POST',
        body: JSON.stringify({ url: submitUrl.trim() }),
      });
      if (res.ok) {
        showToast('Kaynağın incelemeye alındı!', 'success');
        setSubmitUrl('');
      } else {
        const err = await res.json();
        showToast(err.detail || 'Gönderilemedi.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAddFromCommunity = (url, title) => {
    if (selectedList) {
      // Liste zaten seçiliyse doğrudan ekle
      addFeedToList(selectedList.id, url);
    } else {
      // Liste seçilmediyse picker aç
      setListPickerFeed({ url, title });
    }
  };

  const addFeedToList = async (listId, url) => {
    setAddingToList(listId);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/lists/${listId}/feeds`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const feed = await res.json();
        if (selectedList?.id === listId) {
          const updatedList = { ...selectedList, feeds: [...(selectedList.feeds || []), feed], feed_count: (selectedList.feed_count || 0) + 1 };
          setSelectedList(updatedList);
          setLists(prev => prev.map(l => l.id === listId ? updatedList : l));
          loadArticles(listId);
        }
        showToast('Kaynak listeye eklendi!', 'success');
        setListPickerFeed(null);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Eklenemedi.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setAddingToList(null);
    }
  };

  const handleArticleClick = (article) => {
    setSelectedArticle(article);
    setActiveTranslation(null);
    setTranslationCache({});
    setIsTranslating(false);
    setPodcastPollTitle(null);
    const cached = podcastCache[article.title];
    if (cached) {
      setAudioUrl(cached);
      setPodcastStatus('ready');
    } else {
      setPodcastStatus(null);
      setAudioUrl(null);
    }
  };

  const handleTranslate = async (lang) => {
    if (activeTranslation === lang) { setActiveTranslation(null); return; }
    if (translationCache[lang]) { setActiveTranslation(lang); return; }
    setActiveTranslation(lang);
    setIsTranslating(true);
    try {
      const content = stripHtmlFull(selectedArticle.summary) || selectedArticle.title;
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/translate`, {
        method: 'POST',
        body: JSON.stringify({ text: content, lang }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslationCache(prev => ({ ...prev, [lang]: data.translated }));
      }
    } catch (_) { showToast('Çeviri başarısız.', 'error'); setActiveTranslation(null); }
    finally { setIsTranslating(false); }
  };

  const handleCreatePodcast = async () => {
    if (!selectedArticle) return;
    setPodcastStatus('loading');
    const content = stripHtmlFull(selectedArticle.summary) || selectedArticle.title;
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss-reader/podcast`, {
        method: 'POST',
        body: JSON.stringify({ title: selectedArticle.title, content, source_url: selectedArticle.link || null }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.status === 'exists') {
        setAudioUrl(data.audio_url);
        setPodcastStatus('ready');
        setPodcastCache(prev => ({ ...prev, [selectedArticle.title]: data.audio_url }));
        setTrack(data.audio_url, selectedArticle.title, selectedArticle.feed_title, true, data.podcast_id);
      } else {
        setPodcastStatus('processing');
        setPodcastPollTitle(selectedArticle.title);
      }
    } catch {
      showToast('Podcast oluşturulamadı.', 'error');
      setPodcastStatus(null);
    }
  };

  // Unique feed titles for filter chips
  const feedTitles = useMemo(() => {
    const seen = new Set();
    return articles.map(a => a.feed_title).filter(t => t && !seen.has(t) && seen.add(t));
  }, [articles]);

  // Filtered articles
  const filteredArticles = useMemo(() => {
    let result = articles;
    if (activeFeedFilter) result = result.filter(a => a.feed_title === activeFeedFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(a => a.title?.toLowerCase().includes(q) || a.feed_title?.toLowerCase().includes(q));
    }
    return result;
  }, [articles, activeFeedFilter, searchTerm]);

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffH = (now - d) / 3600000;
    if (diffH < 1) return `${Math.floor(diffH * 60)} dk önce`;
    if (diffH < 24) return `${Math.floor(diffH)} sa önce`;
    if (diffH < 48) return 'Dün';
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };

  const formatLastRefreshed = () => {
    if (!lastRefreshed) return '';
    const diffMin = Math.floor((new Date() - lastRefreshed) / 60000);
    if (diffMin < 1) return 'az önce güncellendi';
    return `${diffMin} dk önce güncellendi`;
  };

  const readingTime = (text) => {
    if (!text) return null;
    const words = text.replace(/<[^>]*>/g, '').trim().split(/\s+/).length;
    const min = Math.ceil(words / 200);
    return min > 0 ? `${min} dk` : null;
  };

  const stripHtml = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  };

  const stripHtmlFull = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
  };

  // Deterministic color per feed title
  const feedColor = (title) => {
    const colors = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
    if (!title) return colors[0];
    const idx = [...title].reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
    return colors[idx];
  };

  const s = {
    page: { display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', sans-serif", color: '#f1f5f9', padding: isMobile ? '5rem 0 0' : '0' },
    listPanel: {
      width: isMobile ? '100%' : '260px',
      flexShrink: 0,
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: isMobile ? (showListPanel ? 'flex' : 'none') : 'flex',
      flexDirection: 'column',
      background: 'rgba(8, 12, 24, 0.7)',
      overflowY: 'auto',
      padding: isMobile ? '1rem' : '1.5rem 1rem',
    },
    articlePanel: {
      flex: 1,
      overflowY: 'auto',
      display: isMobile ? (showListPanel ? 'none' : 'flex') : 'flex',
      flexDirection: 'column',
      padding: isMobile ? '1rem' : '1.75rem 2.5rem',
    },
    listItem: (active) => ({
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '10px 12px', borderRadius: '12px', cursor: 'pointer',
      background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
      border: active ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
      marginBottom: '3px', transition: '0.2s',
    }),
    input: {
      width: '100%', padding: '10px 14px', borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(2,6,23,0.5)',
      color: 'white', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
    },
    btn: (variant = 'primary') => ({
      padding: '9px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer',
      fontWeight: '700', fontSize: '0.82rem', transition: '0.2s',
      ...(variant === 'primary' ? { background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: 'white' } : {}),
      ...(variant === 'ghost' ? { background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' } : {}),
      ...(variant === 'danger' ? { background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' } : {}),
      ...(variant === 'icon' ? { background: 'rgba(255,255,255,0.05)', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)', padding: '8px 12px' } : {}),
    }),
    toast: {
      position: 'fixed', top: toast.show ? '24px' : '-80px', left: '50%', transform: 'translateX(-50%)',
      background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      color: toast.type === 'success' ? '#10b981' : '#ef4444',
      border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
      backdropFilter: 'blur(12px)', padding: '10px 22px', borderRadius: '14px', fontWeight: '600',
      transition: 'all 0.4s', opacity: toast.show ? 1 : 0, zIndex: 9999, whiteSpace: 'nowrap',
    },
  };

  return (
    <div style={s.page}>
      <div style={s.toast}>{toast.message}</div>

      {/* ── LIST PANEL ────────────────────────────────────────── */}
      <div style={s.listPanel}>
        {/* Tab toggle */}
        <div style={{ display: 'flex', background: 'rgba(2,6,23,0.6)', borderRadius: '12px', padding: '3px', border: '1px solid rgba(255,255,255,0.07)', marginBottom: '1.25rem' }}>
          {[{ key: 'mine', label: '📡 Listelerim' }, { key: 'community', label: '🌐 Topluluk' }, { key: 'saved', label: `📌 Kayıtlar${savedArticles.length > 0 ? ` (${savedArticles.length})` : ''}` }].map(tab => (
            <button
              key={tab.key}
              onClick={() => setLeftTab(tab.key)}
              style={{ flex: 1, padding: '7px 8px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '800', transition: '0.2s', background: leftTab === tab.key ? 'rgba(99,102,241,0.25)' : 'transparent', color: leftTab === tab.key ? '#818cf8' : '#475569' }}
            >{tab.label}</button>
          ))}
        </div>

        {leftTab === 'mine' && (
          <>
            <form onSubmit={handleCreateList} style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem' }}>
              <input
                style={{ ...s.input, fontSize: '0.8rem', padding: '8px 12px' }}
                placeholder="Yeni liste..."
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
              />
              <button type="submit" disabled={creatingList || !newListName.trim()} style={{ ...s.btn('primary'), padding: '8px 14px', flexShrink: 0, opacity: !newListName.trim() ? 0.4 : 1 }}>+</button>
            </form>

            {loadingLists ? (
              <p style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>Yükleniyor...</p>
            ) : lists.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '0.82rem', textAlign: 'center', marginTop: '2rem', lineHeight: '1.6' }}>Henüz liste yok.<br />Yukarıdan oluştur.</p>
            ) : (
              lists.map(lst => (
                <div key={lst.id}>
                  {renamingId === lst.id ? (
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                      <input
                        autoFocus
                        style={{ ...s.input, fontSize: '0.82rem', padding: '8px 10px' }}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(lst.id); if (e.key === 'Escape') setRenamingId(null); }}
                      />
                      <button onClick={() => handleRename(lst.id)} style={{ ...s.btn('primary'), padding: '8px 10px', flexShrink: 0 }}>✓</button>
                    </div>
                  ) : (
                    <div
                      style={s.listItem(selectedList?.id === lst.id)}
                      onClick={() => handleSelectList(lst)}
                      onMouseOver={e => { if (selectedList?.id !== lst.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                      onMouseOut={e => { if (selectedList?.id !== lst.id) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: feedColor(lst.name), flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: selectedList?.id === lst.id ? '700' : '500', color: selectedList?.id === lst.id ? 'white' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lst.name}</span>
                      <span style={{ fontSize: '0.68rem', color: '#334155', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: '6px', flexShrink: 0 }}>{lst.feed_count}</span>
                      <button onClick={e => { e.stopPropagation(); setRenamingId(lst.id); setRenameValue(lst.name); }} style={{ background: 'transparent', border: 'none', color: '#334155', cursor: 'pointer', padding: '2px 4px', fontSize: '0.7rem', flexShrink: 0, opacity: 0.7 }} title="Yeniden adlandır">✏️</button>
                      <button onClick={e => handleDeleteList(lst.id, e)} style={{ background: 'transparent', border: 'none', color: '#334155', cursor: 'pointer', padding: '2px 4px', fontSize: '0.7rem', flexShrink: 0, opacity: 0.7 }} title="Sil">🗑</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {leftTab === 'community' && (
          <div>
            {communityLoading ? (
              <p style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>Yükleniyor...</p>
            ) : communityFeeds.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '0.82rem', textAlign: 'center', marginTop: '1.5rem', lineHeight: '1.6' }}>Henüz onaylı kaynak yok.</p>
            ) : (
              <>
                {/* Kategori filtre butonları */}
                {(() => {
                  const cats = [...new Set(communityFeeds.map(f => f.category).filter(Boolean))];
                  return cats.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      <button
                        onClick={() => setCommunityFilter('')}
                        style={{ fontSize: '0.68rem', fontWeight: '800', padding: '3px 9px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: !communityFilter ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)', color: !communityFilter ? '#818cf8' : '#64748b', transition: '0.2s' }}
                      >Tümü</button>
                      {cats.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setCommunityFilter(communityFilter === cat ? '' : cat)}
                          style={{ fontSize: '0.68rem', fontWeight: '800', padding: '3px 9px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: communityFilter === cat ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)', color: communityFilter === cat ? '#818cf8' : '#64748b', transition: '0.2s' }}
                        >{cat}</button>
                      ))}
                    </div>
                  ) : null;
                })()}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem' }}>
                  {communityFeeds
                    .filter(f => !communityFilter || f.category === communityFilter)
                    .map(feed => (
                      <div key={feed.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: feedColor(feed.url), flexShrink: 0 }} />
                          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: '700', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {feed.title || feed.url}
                          </p>
                        </div>
                        {feed.title && (
                          <p style={{ margin: '0 0 4px 12px', fontSize: '0.7rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feed.url}</p>
                        )}
                        {feed.category && (
                          <span style={{ fontSize: '0.62rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.12)', padding: '2px 7px', borderRadius: '5px', display: 'inline-block', marginBottom: '6px', marginLeft: '12px' }}>{feed.category}</span>
                        )}
                        <button
                          onClick={() => handleAddFromCommunity(feed.url, feed.title || feed.url)}
                          style={{ ...s.btn('primary'), fontSize: '0.72rem', padding: '6px 12px', width: '100%', marginTop: '2px' }}
                        >+ Listeme Ekle</button>
                      </div>
                    ))}
                </div>
              </>
            )}

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
              <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Kaynak Öner</p>
              <form onSubmit={handleSubmitSource} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input
                  style={{ ...s.input, fontSize: '0.8rem', padding: '8px 12px' }}
                  placeholder="https://example.com/feed.xml"
                  type="url"
                  required
                  value={submitUrl}
                  onChange={e => setSubmitUrl(e.target.value)}
                />
                <button type="submit" disabled={submitting || !submitUrl.trim()} style={{ ...s.btn('primary'), opacity: !submitUrl.trim() ? 0.4 : 1 }}>
                  {submitting ? 'Gönderiliyor...' : '📨 Öneri Gönder'}
                </button>
              </form>
            </div>
          </div>
        )}

        {leftTab === 'saved' && (
          <div>
            {savedArticles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#475569' }}>
                <p style={{ fontSize: '2rem', margin: '0 0 8px' }}>📌</p>
                <p style={{ fontWeight: '700', margin: '0 0 4px' }}>Henüz kaydedilen makale yok.</p>
                <p style={{ fontSize: '0.85rem', margin: 0 }}>Makale açıkken "📌 Kaydet" butonuna bas.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {savedArticles.map(a => (
                  <div
                    key={a.id}
                    onClick={() => { setSelectedArticle(a); setPodcastStatus(podcastCache[a.title] ? 'ready' : null); setActiveTranslation(null); setTranslationCache({}); }}
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', transition: '0.2s' }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
                  >
                    {a.feed_title && (
                      <span style={{ fontSize: '0.65rem', fontWeight: '800', color: feedColor(a.feed_title), background: `${feedColor(a.feed_title)}18`, padding: '2px 7px', borderRadius: '5px', display: 'inline-block', marginBottom: '6px', textTransform: 'uppercase' }}>{a.feed_title}</span>
                    )}
                    <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: '700', color: '#e2e8f0', lineHeight: 1.4 }}>{a.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── ARTICLE PANEL ─────────────────────────────────────── */}
      <div style={s.articlePanel}>
        {isMobile && !showListPanel && (
          <button onClick={() => setShowListPanel(true)} style={{ ...s.btn('ghost'), marginBottom: '1.25rem', alignSelf: 'flex-start' }}>← Listeler</button>
        )}

        {!selectedList ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#475569', gap: '16px' }}>
            <div style={{ fontSize: '4rem' }}>📡</div>
            <p style={{ fontSize: '1.1rem', fontWeight: '700', color: '#64748b', margin: 0 }}>Bir liste seç veya oluştur</p>
            <p style={{ fontSize: '0.9rem', margin: 0 }}>Soldaki panelden başla.</p>
          </div>
        ) : (
          <>
            {/* ── Header ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '10px' }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: isMobile ? '1.5rem' : '1.8rem', fontWeight: '900', color: 'white', letterSpacing: '-0.5px' }}>{selectedList.name}</h1>
                  <p style={{ margin: '4px 0 0', color: '#334155', fontSize: '0.78rem' }}>
                    {selectedList.feed_count || 0} kaynak
                    {articles.length > 0 && ` · ${filteredArticles.length}${filteredArticles.length !== articles.length ? `/${articles.length}` : ''} makale`}
                    {lastRefreshed && <span style={{ marginLeft: '8px', color: '#1e293b' }}>· {formatLastRefreshed()}</span>}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleRefresh}
                    disabled={loadingArticles}
                    style={{ ...s.btn('icon'), opacity: loadingArticles ? 0.5 : 1 }}
                    title="Yenile"
                  >
                    {loadingArticles ? '⏳' : '↻'} Yenile
                  </button>
                  <button onClick={() => setShowFeedForm(p => !p)} style={{ ...s.btn(showFeedForm ? 'ghost' : 'primary'), whiteSpace: 'nowrap' }}>
                    {showFeedForm ? '✕ Kapat' : '+ RSS Ekle/Kaldır'}
                  </button>
                </div>
              </div>

              {/* Feed management panel */}
              {showFeedForm && (
                <div style={{ marginBottom: '1.25rem', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '16px', padding: '1.25rem' }}>
                  <form onSubmit={handleAddFeed} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: selectedList.feeds?.length > 0 ? '1rem' : 0 }}>
                    <input
                      style={{ ...s.input, flex: 1, minWidth: '200px' }}
                      placeholder="https://example.com/feed.xml"
                      type="url"
                      required
                      value={newFeedUrl}
                      onChange={e => setNewFeedUrl(e.target.value)}
                    />
                    <button type="submit" disabled={addingFeed} style={{ ...s.btn('primary'), flexShrink: 0 }}>
                      {addingFeed ? 'Ekleniyor...' : 'Ekle'}
                    </button>
                  </form>
                  {selectedList.feeds?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {selectedList.feeds.map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: feedColor(f.title || f.url), flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: '600', color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title || f.url}</p>
                            {f.title && <p style={{ margin: 0, fontSize: '0.7rem', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</p>}
                          </div>
                          <button onClick={() => handleRemoveFeed(f.id)} style={{ ...s.btn('danger'), padding: '5px 10px', flexShrink: 0 }}>Kaldır</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Search bar */}
              {articles.length > 0 && (
                <div style={{ position: 'relative', marginBottom: '12px' }}>
                  <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#334155', fontSize: '0.9rem', pointerEvents: 'none' }}>🔍</span>
                  <input
                    style={{ ...s.input, paddingLeft: '38px', fontSize: '0.88rem' }}
                    placeholder="Başlık veya kaynak ara..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
                    >×</button>
                  )}
                </div>
              )}

              {/* Source filter chips */}
              {feedTitles.length > 1 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setActiveFeedFilter(null)}
                    style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', transition: '0.2s', background: !activeFeedFilter ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)', color: !activeFeedFilter ? '#818cf8' : '#475569' }}
                  >
                    Tümü
                  </button>
                  {feedTitles.map(title => (
                    <button
                      key={title}
                      onClick={() => setActiveFeedFilter(activeFeedFilter === title ? null : title)}
                      style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', transition: '0.2s', background: activeFeedFilter === title ? `${feedColor(title)}22` : 'rgba(255,255,255,0.05)', color: activeFeedFilter === title ? feedColor(title) : '#475569', borderLeft: `2px solid ${activeFeedFilter === title ? feedColor(title) : 'transparent'}` }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Articles ── */}
            {loadingArticles ? (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '12px', color: '#334155' }}>
                <div style={{ fontSize: '2rem' }}>⏳</div>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Haberler çekiliyor...</p>
              </div>
            ) : filteredArticles.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#475569', gap: '12px' }}>
                <div style={{ fontSize: '3rem' }}>🗞️</div>
                {articles.length === 0 && selectedList.feed_count === 0
                  ? <><p style={{ fontWeight: '700', margin: 0 }}>Henüz kaynak eklenmedi.</p><p style={{ fontSize: '0.9rem', margin: 0 }}>"+ RSS Ekle" butonuna tıkla.</p></>
                  : articles.length === 0
                  ? <p style={{ fontWeight: '700', margin: 0 }}>Kaynaklar boş veya erişilemiyor.</p>
                  : <p style={{ fontWeight: '700', margin: 0 }}>Aramanızla eşleşen makale yok.</p>
                }
              </div>
            ) : (
              <div style={{ paddingBottom: '4rem' }}>
                {filteredArticles.map((a, i) => {
                  const rt = readingTime(a.summary);
                  const hasPodcast = !!podcastCache[a.title];
                  return (
                    <div
                      key={i}
                      onClick={() => handleArticleClick(a)}
                      style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '18px', padding: '1.1rem 1.4rem', marginBottom: '10px', transition: '0.2s', cursor: 'pointer', position: 'relative' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = `${feedColor(a.feed_title)}33`; e.currentTarget.style.background = 'rgba(15,23,42,0.8)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.background = 'rgba(15,23,42,0.5)'; e.currentTarget.style.transform = 'none'; }}
                    >
                      {/* Meta row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.62rem', fontWeight: '800', color: feedColor(a.feed_title), background: `${feedColor(a.feed_title)}18`, padding: '3px 8px', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {a.feed_title}
                        </span>
                        {a.published && <span style={{ fontSize: '0.7rem', color: '#334155' }}>{formatDate(a.published)}</span>}
                        {rt && <span style={{ fontSize: '0.68rem', color: '#1e293b' }}>· {rt} okuma</span>}
                        {hasPodcast && (
                          <span style={{ fontSize: '0.62rem', fontWeight: '800', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 7px', borderRadius: '6px', marginLeft: 'auto' }}>
                            🎧 Podcast
                          </span>
                        )}
                      </div>
                      {/* Title */}
                      <h3 style={{ margin: '0 0 6px', fontSize: isMobile ? '1rem' : '1.05rem', color: 'white', fontWeight: '700', lineHeight: '1.4' }}>{a.title}</h3>
                      {/* Summary */}
                      {a.summary && (
                        <p style={{ margin: 0, fontSize: '0.83rem', color: '#475569', lineHeight: '1.55', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {stripHtml(a.summary)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── ARTICLE MODAL ─────────────────────────────────────── */}
      {selectedArticle && (
        <div
          onClick={() => setSelectedArticle(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.88)', backdropFilter: 'blur(16px)', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'center', zIndex: 2000, padding: isMobile ? 0 : '2rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'rgba(10,15,30,0.99)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: isMobile ? '28px 28px 0 0' : '32px', padding: isMobile ? '2rem 1.5rem 2.5rem' : '2.75rem', width: '100%', maxWidth: '720px', maxHeight: isMobile ? '92vh' : '88vh', overflowY: 'auto', position: 'relative', boxShadow: '0 40px 100px rgba(0,0,0,0.7)' }}
          >
            {/* Close */}
            <button
              onClick={() => setSelectedArticle(null)}
              style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.07)', color: '#64748b', width: '38px', height: '38px', borderRadius: '50%', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#ef4444'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#64748b'; }}
            >✕</button>

            {/* Meta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem', flexWrap: 'wrap', paddingRight: '3rem' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: '800', color: feedColor(selectedArticle.feed_title), background: `${feedColor(selectedArticle.feed_title)}18`, padding: '4px 10px', borderRadius: '8px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                {selectedArticle.feed_title}
              </span>
              {selectedArticle.published && (
                <span style={{ fontSize: '0.75rem', color: '#334155' }}>{new Date(selectedArticle.published).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>

            {/* Title */}
            <h2 style={{ margin: '0 0 1.75rem', fontSize: isMobile ? '1.35rem' : '1.7rem', fontWeight: '900', color: 'white', lineHeight: '1.3', letterSpacing: '-0.3px' }}>
              {selectedArticle.title}
            </h2>

            {/* Summary card */}
            <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: '18px', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.62rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '1px' }}>İçerik</span>
                <div style={{ display: 'flex', background: 'rgba(2,6,23,0.6)', borderRadius: '10px', padding: '3px', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {[{ code: null, label: 'Orijinal' }, { code: 'tr', label: '🇹🇷 TR' }, { code: 'en', label: '🇬🇧 EN' }].map(({ code, label }) => (
                    <button
                      key={label}
                      onClick={() => code === null ? setActiveTranslation(null) : handleTranslate(code)}
                      disabled={isTranslating}
                      style={{ padding: '4px 10px', borderRadius: '7px', border: 'none', cursor: isTranslating ? 'not-allowed' : 'pointer', fontSize: '0.65rem', fontWeight: '800', transition: '0.2s', background: activeTranslation === code ? 'rgba(99,102,241,0.25)' : 'transparent', color: activeTranslation === code ? '#818cf8' : '#475569' }}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.95rem', lineHeight: '1.75' }}>
                {isTranslating
                  ? <span style={{ color: '#475569' }}>Çeviriliyor...</span>
                  : (activeTranslation && translationCache[activeTranslation])
                    ? translationCache[activeTranslation]
                    : stripHtmlFull(selectedArticle.summary) || 'Bu makale için içerik mevcut değil.'}
              </p>
            </div>

            {/* Podcast ready info */}
            {podcastStatus === 'ready' && audioUrl && (
              <p style={{ color: '#10b981', fontWeight: 'bold', margin: '0 0 1.5rem', fontSize: '0.9rem' }}>🎧 Podcast hazır — açılan oynatıcıdan dinleyebilirsin.</p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <a
                href={selectedArticle.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, minWidth: '130px', padding: '13px 18px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: '#94a3b8', fontWeight: '700', fontSize: '0.88rem', textDecoration: 'none', textAlign: 'center', transition: '0.2s' }}
                onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = 'white'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                🔗 Kaynağa Git
              </a>

              <button
                onClick={() => toggleSave(selectedArticle)}
                style={{ flex: 1, minWidth: '130px', padding: '13px 18px', borderRadius: '14px', border: savedIds[selectedArticle.link] ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.09)', background: savedIds[selectedArticle.link] ? 'rgba(99,102,241,0.12)' : 'transparent', color: savedIds[selectedArticle.link] ? '#818cf8' : '#94a3b8', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer', transition: '0.2s' }}
              >
                {savedIds[selectedArticle.link] ? '📌 Kaydedildi' : '📌 Kaydet'}
              </button>

              {podcastStatus !== 'ready' && (
                <button
                  onClick={handleCreatePodcast}
                  disabled={podcastStatus === 'loading' || podcastStatus === 'processing'}
                  style={{ flex: 1, minWidth: '130px', padding: '13px 18px', borderRadius: '14px', border: 'none', background: (podcastStatus === 'loading' || podcastStatus === 'processing') ? 'rgba(99,102,241,0.25)' : 'linear-gradient(135deg,#6366f1,#818cf8)', color: 'white', fontWeight: '700', fontSize: '0.88rem', cursor: (podcastStatus === 'loading' || podcastStatus === 'processing') ? 'not-allowed' : 'pointer', transition: '0.2s', boxShadow: (!podcastStatus) ? '0 8px 20px -4px rgba(99,102,241,0.4)' : 'none' }}
                >
                  {podcastStatus === 'loading' ? '⏳ Hazırlanıyor...' : podcastStatus === 'processing' ? '🎙️ Üretiliyor...' : '🎙️ Podcast Oluştur'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Liste Seçici Modal — community feed eklerken liste seçilmediyse */}
      {listPickerFeed && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}
          onClick={() => setListPickerFeed(null)}
        >
          <div
            style={{ background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '24px', padding: '2rem', width: '90%', maxWidth: '440px', boxShadow: '0 30px 60px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ color: 'white', fontSize: '1.2rem', fontWeight: '800', marginTop: 0, marginBottom: '6px' }}>Listeye Ekle</h3>
            <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: '1.25rem', wordBreak: 'break-all' }}>{listPickerFeed.title}</p>
            {lists.length === 0 ? (
              <p style={{ color: '#475569', textAlign: 'center', padding: '1rem 0' }}>Önce bir liste oluşturman gerekiyor.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {lists.map(list => (
                  <button
                    key={list.id}
                    disabled={addingToList === list.id}
                    onClick={() => addFeedToList(list.id, listPickerFeed.url)}
                    style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.2)', background: addingToList === list.id ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.07)', color: 'white', fontWeight: '600', cursor: addingToList === list.id ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: '0.9rem', transition: '0.2s' }}
                    onMouseOver={e => { if (!addingToList) e.currentTarget.style.background = 'rgba(99,102,241,0.18)'; }}
                    onMouseOut={e => { if (!addingToList) e.currentTarget.style.background = 'rgba(99,102,241,0.07)'; }}
                  >
                    📋 {list.name}
                    {list.feed_count != null && <span style={{ color: '#475569', fontSize: '0.78rem', marginLeft: '8px' }}>{list.feed_count} kaynak</span>}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setListPickerFeed(null)}
              style={{ marginTop: '1rem', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: '600' }}
            >İptal</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RssReader;
