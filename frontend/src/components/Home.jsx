import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';
import AudioPlayer from './AudioPlayer';
import { usePlayer } from '../contexts/PlayerContext';

function Home() {
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [newsList, setNewsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suggestion, setSuggestion] = useState(null);
  const [selectedNews, setSelectedNews] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [podcastStatus, setPodcastStatus] = useState('idle');
  const [showLengthPicker, setShowLengthPicker] = useState(false);
  const [podcastAutoPlay, setPodcastAutoPlay] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [podcastId, setPodcastId] = useState(null);
  const { setTrack } = usePlayer();
  const pollRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const bulletinPollRef = useRef(null);
  
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [userInterests, setUserInterests] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null); 

  // 🛡️ Havada asılı kalan eski HTTP isteklerini iptal etmek için Ref
  const abortControllerRef = useRef(null);
  // 🛡️ Döngülerin (setInterval) içinde her zaman en güncel kategori ID'sini yakalamak için Ref
  const activeCategoryIdRef = useRef(activeCategoryId);
  // 🛡️ Havada giden büyük POST yenileme isteğini kontrol etmek için yeni Ref
  const refreshAbortControllerRef = useRef(null);
  // 🛡️ Refresh polling interval ref - survives category changes
  const refreshPollRef = useRef(null);

  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
  const [readLaterIds, setReadLaterIds] = useState(new Set());
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [relatedNews, setRelatedNews] = useState([]);
  const [trendingNews, setTrendingNews] = useState([]);
  const [myFeedback, setMyFeedback] = useState(null);
  const [translatedSummary, setTranslatedSummary] = useState(null);
  const [translatedContent, setTranslatedContent] = useState(null);
  const [translatedLang, setTranslatedLang] = useState(null); // translated* hangi dili tutuyor
  const [translationLang, setTranslationLang] = useState('orig'); // görünüm: 'orig' | 'tr' | 'en'
  const [isTranslating, setIsTranslating] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/me`);
        if (res.ok) {
          const data = await res.json();
          setUserInterests(data.interests || []);
        }
      } catch (_) {}
    };
    const loadTrending = async () => {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/trending`);
        if (res.ok) setTrendingNews(await res.json());
      } catch (_) {}
    };
    loadUser();
    loadTrending();
  }, []);

  // Cleanup refresh polling on unmount
  useEffect(() => {
    return () => {
      if (refreshPollRef.current) {
        clearInterval(refreshPollRef.current);
        refreshPollRef.current = null;
      }
      if (bulletinPollRef.current) {
        clearInterval(bulletinPollRef.current);
        bulletinPollRef.current = null;
      }
    };
  }, []);

  // 🔄 Kategori veya sayfa değiştiğinde eski havada kalan istekleri Abort et
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    fetchNews(searchTerm, page, pageSize, activeCategoryId, controller.signal);

    return () => {
      controller.abort();
    };
  }, [page, pageSize, activeCategoryId]);

  // 📡 fetchNews fonksiyonuna iptal sinyali (signal) parametresi ekledik
  const fetchNews = async (query = '', p = page, size = pageSize, catId = activeCategoryId, signal = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, size });
      if (query) params.set('search', query);
      if (catId === 0) {
      } else if (catId) {
        params.set('category_id', catId);
      } else {
        params.set('interests_only', 'true');
      }
      
      const response = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/?${params}`, { signal });
      if (response.ok) {
        const data = await response.json();
        setNewsList(data.items);
        setTotalCount(data.total_count);
      }
    } catch (error) {
      // İstek bizim tarafımızdan bilinçli iptal edildiyse hata fırlatıp arayüzü darlama
      if (error.name === 'AbortError') return;
      showToast("Haberler çekilirken bir sorun oluştu.", "error");
    } finally {
      setLoading(false);
    }
  };

  const pushSearchHistory = (term) => {
    const q = (term || '').trim();
    if (!q) return;
    setSearchHistory(prev => {
      const next = [q, ...prev.filter(t => t.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      try { localStorage.setItem('searchHistory', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const handleSearch = () => {
    pushSearchHistory(searchTerm);
    setShowHistory(false);
    setPage(1);
    fetchNews(searchTerm, 1, pageSize, activeCategoryId);
  };

  const runSearchFromHistory = (term) => {
    setSearchTerm(term);
    pushSearchHistory(term);
    setShowHistory(false);
    setPage(1);
    fetchNews(term, 1, pageSize, activeCategoryId);
  };

  const removeHistoryItem = (term, e) => {
    e.stopPropagation();
    setSearchHistory(prev => {
      const next = prev.filter(t => t !== term);
      try { localStorage.setItem('searchHistory', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const handleToggleReadLater = async (newsId) => {
    const inList = readLaterIds.has(newsId);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/read-later/${newsId}`, {
        method: inList ? 'DELETE' : 'POST',
      });
      if (res.ok) {
        setReadLaterIds(prev => {
          const next = new Set(prev);
          inList ? next.delete(newsId) : next.add(newsId);
          return next;
        });
        showToast(inList ? 'Sonra oku listesinden kaldırıldı.' : 'Sonra oku listesine eklendi! 📑', 'success');
      }
    } catch (_) { showToast('İşlem başarısız.', 'error'); }
  };


  const readingTime = (text) => {
    if (!text) return null;
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words / 200);
  };

  const handleToggleBookmark = async (newsId) => {
    const isBookmarked = bookmarkedIds.has(newsId);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/bookmarks/${newsId}`, {
        method: isBookmarked ? 'DELETE' : 'POST',
      });
      if (res.ok) {
        setBookmarkedIds(prev => {
          const next = new Set(prev);
          isBookmarked ? next.delete(newsId) : next.add(newsId);
          return next;
        });
        showToast(isBookmarked ? 'Kaydedilenlerden kaldırıldı.' : 'Kaydedildi! 🔖', 'success');
      }
    } catch (_) { showToast('İşlem başarısız.', 'error'); }
  };

  const handleShare = async (news) => {
    const shareData = { title: news.title, text: news.summary || news.title, url: news.source_url || window.location.href };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (_) {}
    } else {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast("Bağlantı panoya kopyalandı!", "success");
      } catch (_) {
        showToast("Kopyalanamadı.", "error");
      }
    }
  };
  

  const handleBulletin = async () => {
    if (bulletinLoading) return;
    setBulletinLoading(true);
    showToast("🎙️ Günlük bülten hazırlanıyor, bu bir dakika sürebilir...", "success");
    try {
      // Gerçek bir kategori seçiliyse (null=ilgi alanları, 0=tümü) onu filtre olarak gönder.
      const catId = activeCategoryIdRef.current;
      const payload = { limit: 5 };
      if (catId && catId !== 0) payload.category_id = catId;

      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/bulletin`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Bülten oluşturulamadı.", "error");
        setBulletinLoading(false);
        return;
      }
      const { title } = await res.json();

      // Hazır olana kadar yokla (en fazla ~3 dk).
      let tries = 0;
      if (bulletinPollRef.current) clearInterval(bulletinPollRef.current);
      bulletinPollRef.current = setInterval(async () => {
        tries += 1;
        try {
          const check = await fetchWithAuth(
            `${import.meta.env.VITE_API_URL}/news/bulletin/check?title=${encodeURIComponent(title)}`
          );
          if (check.ok) {
            const pod = await check.json();
            clearInterval(bulletinPollRef.current);
            bulletinPollRef.current = null;
            setBulletinLoading(false);
            setTrack(pod.audio_url, pod.title, 'Günlük Bülten', true, pod.id);
            showToast("✅ Bülten hazır, oynatılıyor!", "success");
          }
        } catch (_) {}
        if (tries >= 90) {
          clearInterval(bulletinPollRef.current);
          bulletinPollRef.current = null;
          setBulletinLoading(false);
          showToast("Bülten beklenenden uzun sürdü; Podcast'ler sayfasından kontrol edin.", "error");
        }
      }, 2000);
    } catch (_) {
      setBulletinLoading(false);
      showToast("Bülten oluşturulamadı.", "error");
    }
  };

  const handleCategoryChange = (catId) => {
    // Ref'i anında en güncel kategori ID'si ile eşitliyoruz, böylece herhangi bir döngü veya asenkron işlem içinde doğru değeri yakalayabiliriz
    activeCategoryIdRef.current = catId;

    // 🛑 Eğer havada asılı kalan bir büyük POST yenileme isteği varsa, onu anında kesiyoruz!
    if (refreshAbortControllerRef.current) {
      refreshAbortControllerRef.current.abort();
      refreshAbortControllerRef.current = null;
    }

    // ⚠️ refreshing durumunu SIFIRLAMIYORUZ - scraping arka planda devam ediyor.
    // Buton disabled kalmalı, kullanıcı başka kategoriye geçse bile.
    setActiveCategoryId(catId); 
    setPage(1); 
  };
  
  const handlePageSizeChange = (newSize) => { setPageSize(newSize); setPage(1); };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true); 
    setPage(1); 
    showToast("Gündem tazeleniyor, canlı akış başladı...", "success");

    // Havada asılı duran eski bir yenileme sinyali varsa önceden tedbir amaçlı iptal et
    if (refreshAbortControllerRef.current) {
      refreshAbortControllerRef.current.abort();
    }

    // Eski polling'i temizle
    if (refreshPollRef.current) {
      clearInterval(refreshPollRef.current);
      refreshPollRef.current = null;
    }

    // Büyük yenileme işlemi (POST) için taze bir AbortController oluşturuyoruz
    const refreshController = new AbortController();
    refreshAbortControllerRef.current = refreshController;

    // 🔄 GERÇEK ZAMANLI TASK TRACKING MECHANISM
    const poll = setInterval(async () => {
      try {
        // Ref'ten oku: interval callback stale closure'dan etkilenmez, her tick'te güncel değeri alır
        const currentCatId = activeCategoryIdRef.current;

        // 📡 Redis flag'i üzerinden scraper'ın gerçek durumunu sorgula
        const statusRes = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/refresh/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();

          // Eğer Redis flag'i silindiyse scraper bitti demektir
          if (statusData.status === "idle") {
            clearInterval(poll);
            refreshPollRef.current = null;
            setRefreshing(false);
            fetchNews(searchTerm, 1, pageSize, activeCategoryIdRef.current);
            showToast("✅ Gündem başarıyla güncellendi! Yeni haberler listelendi.", "success");
            return;
          }
        }

        // 📊 Scraper hâlâ çalışıyorsa o anki kategoriyi canlı güncelle (ref'ten oku)
        const params = new URLSearchParams({ page: 1, size: pageSize });
        if (currentCatId === 0) {}
        else if (currentCatId) params.set('category_id', currentCatId);
        else params.set('interests_only', 'true');
        
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/?${params}`);
        if (res.ok) {
          const data = await res.json();
          setNewsList(data.items);
          setTotalCount(data.total_count);
        }

      } catch (_) {}
    }, 4000);

    refreshPollRef.current = poll;

    try {
      // 📡 Büyük POST isteği yola çıkıyor (Sadece görevi tetikleyip hemen dönecek)
      await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/refresh`, { 
        method: 'POST',
        signal: refreshController.signal
      });
    } catch (error) {
      // Eğer kullanıcı kategori değiştirdiği için istek iptal edildiyse POST'u iptal et
      // ama scraping arka planda devam edebilir, polling hâlâ kontrol eder
      if (error.name !== 'AbortError') {
        // Gerçek bir hata oluştuysa polling'i de durdur
        clearInterval(poll);
        refreshPollRef.current = null;
        setRefreshing(false);
        showToast("Güncelleme sırasında bir hata oluştu.", "error");
      }
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = (newsId, newsTitle = '', newsCategory = '') => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/podcast/by-news/${newsId}`);
        if (res.ok) {
          const data = await res.json();
          setAudioUrl(data.audio_url);
          setPodcastId(data.id);
          setPodcastAutoPlay(true);
          setPodcastStatus('ready');
          setTrack(data.audio_url, newsTitle, newsCategory, true, data.id);
          stopPolling();
          showToast("Podcast hazır!", "success");
        }
      } catch (_) {}
    }, 3000);
  };

  const handleNewsClick = async (newsId) => {
    setPodcastStatus('idle');
    setShowLengthPicker(false);
    setAudioUrl(null);
    setPodcastId(null);
    setPodcastAutoPlay(false);
    stopPolling();
    try {
      setRelatedNews([]);
      setMyFeedback(null);
      setTranslatedSummary(null);
      setTranslatedContent(null);
      setTranslatedLang(null);
      setTranslationLang('orig');
      setIsTranslating(false);
      const [detailResponse, podRes, bookmarkRes, relatedRes, feedbackRes, readLaterRes] = await Promise.all([
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${newsId}`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/podcast/by-news/${newsId}`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/bookmarks/check/${newsId}`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${newsId}/related`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${newsId}/feedback/mine`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/read-later/check/${newsId}`),
      ]);

      let newsDetail = null;
      if (detailResponse.ok) { newsDetail = await detailResponse.json(); setSelectedNews(newsDetail); }

      if (podRes.ok) {
        const podData = await podRes.json();
        setAudioUrl(podData.audio_url);
        setPodcastId(podData.id);
        setPodcastStatus('ready');
        setTrack(podData.audio_url, newsDetail?.title, newsDetail?.category?.name, true, podData.id);
      }

      if (bookmarkRes.ok) {
        const bData = await bookmarkRes.json();
        setBookmarkedIds(prev => {
          const next = new Set(prev);
          bData.bookmarked ? next.add(newsId) : next.delete(newsId);
          return next;
        });
      }

      if (readLaterRes.ok) {
        const rData = await readLaterRes.json();
        setReadLaterIds(prev => {
          const next = new Set(prev);
          rData.in_read_later ? next.add(newsId) : next.delete(newsId);
          return next;
        });
      }

      if (relatedRes.ok) setRelatedNews(await relatedRes.json());
      if (feedbackRes.ok) { const fd = await feedbackRes.json(); setMyFeedback(fd.rating); }
    } catch (error) {}
  };

  // Bookmarks sayfasından ?open=ID ile yönlendirme geldiğinde haberi otomatik aç
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      setSearchParams({});
      handleNewsClick(parseInt(openId));
    }
  }, []);

  const handleFeedback = async (newsId, rating) => {
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${newsId}/feedback?rating=${rating}`, { method: 'POST' });
      if (res.ok) {
        setMyFeedback(prev => prev === rating ? null : rating);
        showToast(rating === 'up' ? 'Teşekkürler! 👍' : 'Geri bildirim alındı 👎', 'success');
      }
    } catch (_) {}
  };

  const handleTranslate = async (mode) => {
    setTranslationLang(mode);
    if (mode === 'orig') return;            // orijinali göster, çağrı yok
    if (translatedLang === mode) return;    // bu dil zaten getirilmiş
    setIsTranslating(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${selectedNews.id}/translate?lang=${mode}`);
      if (res.ok) {
        const data = await res.json();
        setTranslatedSummary(data.summary ?? null);
        setTranslatedContent(data.content ?? null);
        setTranslatedLang(mode);
      }
    } catch (_) { showToast('Çeviri başarısız.', 'error'); setTranslationLang('orig'); }
    finally { setIsTranslating(false); }
  };

  const handleGeneratePodcast = async (length = 'medium') => {
    if (!selectedNews || podcastStatus === 'processing') return;
    setShowLengthPicker(false);
    setPodcastStatus('processing');
    showToast("Podcast üretimi başladı...", "success");
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/podcast/generate/${selectedNews.id}?length=${length}`, { method: 'POST' });
      if (res.ok) {
        startPolling(selectedNews.id, selectedNews.title, selectedNews.category?.name);
      } else {
        setPodcastStatus('idle');
      }
    } catch (error) { setPodcastStatus('idle'); }
  };

  const handleAcceptSuggestion = async () => {
    if (!suggestion) return;
    try {
      const meResponse = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/me`);
      if (meResponse.ok) {
        const userData = await meResponse.json();
        const currentInterestIds = userData.interests.map(item => item.id);
        if (!currentInterestIds.includes(suggestion.id)) {
          const updatedInterestIds = [...currentInterestIds, suggestion.id];
          await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/interests`, {
            method: 'POST',
            body: JSON.stringify({ category_ids: updatedInterestIds })
          });
          showToast(`${suggestion.category_name} eklendi!`, "success");
        }
      }
    } catch (error) {} finally { setSuggestion(null); }
  };

  const styles = {
    container: { 
      color: '#f1f5f9', fontFamily: "'Inter', sans-serif", width: '100%', 
      maxWidth: '1200px', margin: '0 auto', padding: '0 2rem', boxSizing: 'border-box'
    },
    toast: {
      position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
      color: toast.type === 'success' ? '#10b981' : '#ef4444', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
      backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', fontWeight: '600',
      transition: 'all 0.5s', opacity: toast.show ? 1 : 0, zIndex: 9999,
    },
    bentoGrid: { 
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
      gap: '28px', marginBottom: '4rem', width: '100%'
    },
    newsCard: {
      background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '28px',
      padding: '2rem', cursor: 'pointer', transition: 'all 0.4s ease'
    },
    pageNum: (isActive) => ({
      padding: '8px 16px', borderRadius: '12px', border: 'none',
      backgroundColor: isActive ? '#6366f1' : 'rgba(30, 41, 59, 0.5)', color: 'white', cursor: 'pointer', fontWeight: isActive ? '700' : '400', transition: '0.3s'
    }),
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>{toast.message}</div>

      <div style={{ padding: isMobile ? '5rem 0 2.5rem' : '2rem 0 2.5rem', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: '1.5rem', width: '100%' }}>
        <div>
          <h1 style={{ fontSize: isMobile ? '2rem' : '3rem', fontWeight: '900', margin: 0, color: 'white' }}>Günün Özeti</h1>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginTop: '10px' }}>Pürüzsüz ve sana özel bir haber akışı.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', width: isMobile ? '100%' : 'auto' }}>
          <div style={{ position: 'relative', width: isMobile ? '100%' : '300px', flex: isMobile ? 1 : 'none' }}>
            <input type="text" placeholder="Gündemi tara..." value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              onFocus={() => setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 150)}
              style={{ padding: '14px 24px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(15, 23, 42, 0.4)', color: 'white', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            {showHistory && searchHistory.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '6px', zIndex: 1200, boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px 4px' }}>
                  <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Son Aramalar</span>
                </div>
                {searchHistory.map((term) => (
                  <div key={term} onMouseDown={() => runSearchFromHistory(term)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 10px', borderRadius: '9px', cursor: 'pointer', color: '#cbd5e1', fontSize: '0.9rem' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#64748b' }}>🕘</span>{term}
                    </span>
                    <span onMouseDown={(e) => removeHistoryItem(term, e)} style={{ color: '#475569', fontSize: '0.85rem', padding: '0 4px' }}>✕</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleBulletin} disabled={bulletinLoading} title="Günün haberlerinden tek bir sesli bülten oluştur"
            style={{ height: '48px', padding: '0 18px', borderRadius: '16px', border: '1px solid rgba(99,102,241,0.35)', background: bulletinLoading ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.18)', color: '#c7d2fe', cursor: bulletinLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 600 }}>
            <span style={{ fontSize: '18px' }}>🎙️</span>
            {bulletinLoading ? 'Hazırlanıyor…' : 'Bülten'}
          </button>
          <button onClick={handleRefresh} disabled={refreshing} title="Gündemi tazele" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(30, 41, 59, 0.5)', cursor: refreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s', padding: 0 }}
            onMouseOver={e => { if (!refreshing) { e.currentTarget.style.background = 'rgba(99,102,241,0.15)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>

      <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '3rem' }}>
        {[{ id: null, name: '🎯 İlgi Alanlarım' }, { id: 0, name: '🌐 Tümü' }, ...userInterests].map(cat => (
          <button key={cat.id ?? 'interests'} onClick={() => handleCategoryChange(cat.id)} style={{ padding: '10px 22px', borderRadius: '25px', border: '1px solid', borderColor: activeCategoryId === cat.id ? '#818cf8' : 'rgba(255,255,255,0.1)', backgroundColor: activeCategoryId === cat.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent', color: activeCategoryId === cat.id ? '#fff' : '#94a3b8', cursor: 'pointer' }}>{cat.name}</button>
        ))}
      </div>

      {trendingNews.length > 0 && (
        <TrendingStrip trendingNews={trendingNews} onNewsClick={handleNewsClick} isMobile={isMobile} />
      )}

      {loading ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '5rem' }}>Haberler derleniyor...</p>
      ) : (
        <div style={{ width: '100%' }}>
          <div style={styles.bentoGrid}>
            {newsList.map((news, index) => (
              <div key={news.id} onClick={() => handleNewsClick(news.id)} style={{ ...styles.newsCard, gridColumn: index === 0 && !isMobile ? 'span 2' : 'span 1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase' }}>
                    {news.category?.name || 'Haber'}
                  </span>
                  {readingTime(news.summary || news.content) && (
                    <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                      · {readingTime(news.summary || news.content)} dk okuma
                    </span>
                  )}
                </div>
                <h3 style={{ margin: '15px 0', fontSize: index === 0 && !isMobile ? '2.2rem' : '1.5rem', color: 'white', fontWeight: '800' }}>{news.title}</h3>
                <p style={{ color: '#94a3b8', lineHeight: '1.6' }}>{news.summary || "Detaylar yolda..."}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'space-between', alignItems: 'center', gap: '1rem', padding: '3rem 0 10rem', borderTop: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
            <div style={{ color: '#64748b' }}>{totalCount} haber — Sayfa {page}/{totalPages}</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: '#64748b', fontSize: '0.9rem', marginRight: '10px' }}>Sayfa Başı:</span>
              {[10, 25, 50].map(size => ( <button key={size} onClick={() => handlePageSizeChange(size)} style={styles.pageNum(pageSize === size)}>{size}</button> ))}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...styles.pageNum(false), opacity: page === 1 ? 0.3 : 1 }}>←</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2).map(p => (
                <button key={p} onClick={() => setPage(p)} style={styles.pageNum(page === p)}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...styles.pageNum(false), opacity: page === totalPages ? 0.3 : 1 }}>→</button>
            </div>
          </div>
        </div>
      )}

      {selectedNews && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(16px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.98)', border: '1px solid rgba(255,255,255,0.1)', padding: isMobile ? '2rem 1.5rem' : '4rem', borderRadius: '40px', maxWidth: '900px', width: '90%', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => { setSelectedNews(null); }} style={{ position: 'absolute', top: '35px', right: '35px', background: 'transparent', border: 'none', color: '#64748b', fontSize: '2.2rem', cursor: 'pointer' }}>✖</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {selectedNews.category?.name && (
                <span style={{ fontSize: '0.75rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase' }}>{selectedNews.category.name}</span>
              )}
              {readingTime(selectedNews.content) && (
                <span style={{ fontSize: '0.75rem', color: '#475569' }}>· {readingTime(selectedNews.content)} dk okuma</span>
              )}
            </div>

            <h2 style={{ fontSize: isMobile ? '1.8rem' : '2.6rem', fontWeight: '900', color: 'white', marginBottom: '30px', paddingRight: '3rem' }}>{selectedNews.title}</h2>

            {/* Dil seçimi: Orijinal / TR / EN — haberin orijinal diline göre çevirir */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
              {selectedNews.lang && (
                <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: '700' }}>Orijinal dil: {selectedNews.lang.toUpperCase()}</span>
              )}
              <div style={{ display: 'flex', background: 'rgba(2,6,23,0.5)', borderRadius: '10px', padding: '3px', border: '1px solid rgba(255,255,255,0.07)' }}>
                {[{ code: 'orig', label: 'Orijinal' }, { code: 'tr', label: '🇹🇷 TR' }, { code: 'en', label: '🇬🇧 EN' }].map(({ code, label }) => (
                  <button key={code} onClick={() => handleTranslate(code)} disabled={isTranslating}
                    style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', cursor: isTranslating ? 'not-allowed' : 'pointer', fontSize: '0.72rem', fontWeight: '800', transition: '0.2s', background: translationLang === code ? 'rgba(99,102,241,0.25)' : 'transparent', color: translationLang === code ? '#818cf8' : '#64748b' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {selectedNews.summary && (
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '18px', padding: '1.5rem 1.75rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '1px' }}>AI Özet</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button onClick={() => handleFeedback(selectedNews.id, 'up')} title="Özet güzel" style={{ background: myFeedback === 'up' ? 'rgba(16,185,129,0.2)' : 'transparent', border: `1px solid ${myFeedback === 'up' ? '#10b981' : 'rgba(255,255,255,0.1)'}`, color: myFeedback === 'up' ? '#10b981' : '#64748b', padding: '6px 10px', borderRadius: '10px', cursor: 'pointer', fontSize: '1rem', transition: '0.2s' }}>👍</button>
                    <button onClick={() => handleFeedback(selectedNews.id, 'down')} title="Özet yetersiz" style={{ background: myFeedback === 'down' ? 'rgba(239,68,68,0.15)' : 'transparent', border: `1px solid ${myFeedback === 'down' ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, color: myFeedback === 'down' ? '#ef4444' : '#64748b', padding: '6px 10px', borderRadius: '10px', cursor: 'pointer', fontSize: '1rem', transition: '0.2s' }}>👎</button>
                  </div>
                </div>
                {isTranslating
                  ? <p style={{ color: '#475569', lineHeight: '1.8', fontSize: '1rem', margin: 0 }}>Çeviriliyor...</p>
                  : <p style={{ color: '#cbd5e1', lineHeight: '1.8', fontSize: '1rem', margin: 0 }}>{translationLang === 'orig' ? selectedNews.summary : (translatedSummary ?? selectedNews.summary)}</p>
                }
              </div>
            )}

            <div style={{ lineHeight: '1.9', color: '#cbd5e1', fontSize: '1.1rem', whiteSpace: 'pre-wrap' }}>
              {isTranslating
                ? 'Çeviriliyor...'
                : (translationLang === 'orig' ? selectedNews.content : (translatedContent ?? selectedNews.content))}
            </div>

            <div style={{ marginTop: '3rem', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              {podcastStatus === 'idle' && !showLengthPicker && (
                <button onClick={() => setShowLengthPicker(true)} style={{ padding: '14px 28px', borderRadius: '16px', border: 'none', background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)', color: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 20px -5px rgba(99, 102, 241, 0.4)' }}>
                  🎙 Podcast Oluştur
                </button>
              )}
              {podcastStatus === 'idle' && showLengthPicker && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700' }}>🎙 Podcast süresi seç:</span>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {[
                      { key: 'short', label: '30 sn – 1 dk', sub: 'Kısa' },
                      { key: 'medium', label: '1 – 2 dk', sub: 'Orta' },
                      { key: 'long', label: '2 – 4 dk', sub: 'Uzun' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => handleGeneratePodcast(opt.key)}
                        style={{ padding: '12px 20px', borderRadius: '14px', border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#c7d2fe', fontWeight: '700', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <span style={{ fontSize: '0.95rem' }}>{opt.label}</span>
                        <span style={{ fontSize: '0.72rem', color: '#818cf8' }}>{opt.sub}</span>
                      </button>
                    ))}
                    <button onClick={() => setShowLengthPicker(false)} style={{ padding: '12px 16px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              )}
              {podcastStatus === 'processing' && <p style={{ color: '#818cf8', fontWeight: 'bold', margin: 0 }}>🎧 Hazırlanıyor...</p>}
              {podcastStatus === 'ready' && audioUrl && (
                <button
                  onClick={() => setTrack(audioUrl, selectedNews?.title, selectedNews?.category?.name, true, podcastId)}
                  style={{ padding: '14px 28px', borderRadius: '16px', border: 'none', background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)', color: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 20px -5px rgba(16, 185, 129, 0.4)' }}
                >
                  ▶ Podcast'ı Oynat
                </button>
              )}

              <button
                onClick={() => handleToggleBookmark(selectedNews.id)}
                style={{ padding: '14px 22px', borderRadius: '16px', border: `1px solid ${bookmarkedIds.has(selectedNews.id) ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`, background: bookmarkedIds.has(selectedNews.id) ? 'rgba(99,102,241,0.1)' : 'transparent', color: bookmarkedIds.has(selectedNews.id) ? '#818cf8' : '#94a3b8', fontWeight: '600', cursor: 'pointer', transition: '0.2s' }}
                onMouseOver={e => {
                  if (!bookmarkedIds.has(selectedNews.id)) {
                    e.currentTarget.style.borderColor = 'rgba(129,140,248,0.4)';
                    e.currentTarget.style.color = '#818cf8';
                  }
                }}
                onMouseOut={e => {
                  if (!bookmarkedIds.has(selectedNews.id)) {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = '#94a3b8';
                  }
                }}
              >
                {bookmarkedIds.has(selectedNews.id) ? '🔖 Kaydedildi' : '🔖 Kaydet'}
              </button>

              <button
                onClick={() => handleToggleReadLater(selectedNews.id)}
                style={{ padding: '14px 22px', borderRadius: '16px', border: `1px solid ${readLaterIds.has(selectedNews.id) ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`, background: readLaterIds.has(selectedNews.id) ? 'rgba(99,102,241,0.1)' : 'transparent', color: readLaterIds.has(selectedNews.id) ? '#818cf8' : '#94a3b8', fontWeight: '600', cursor: 'pointer', transition: '0.2s' }}
                onMouseOver={e => {
                  if (!readLaterIds.has(selectedNews.id)) {
                    e.currentTarget.style.borderColor = 'rgba(129,140,248,0.4)';
                    e.currentTarget.style.color = '#818cf8';
                  }
                }}
                onMouseOut={e => {
                  if (!readLaterIds.has(selectedNews.id)) {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = '#94a3b8';
                  }
                }}
              >
                {readLaterIds.has(selectedNews.id) ? '📑 Kuyrukta' : '📑 Sonra Oku'}
              </button>

              <button
                onClick={() => handleShare(selectedNews)}
                style={{ padding: '14px 22px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: '0.2s' }}
                onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(129,140,248,0.4)'; e.currentTarget.style.color = '#818cf8'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                {navigator.share ? '↑ Paylaş' : '🔗 Bağlantıyı Kopyala'}
              </button>

              {selectedNews.source_url && (
                <a
                  href={selectedNews.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: '14px 22px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontWeight: '600', cursor: 'pointer', textDecoration: 'none', transition: '0.2s' }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(129,140,248,0.4)'; e.currentTarget.style.color = '#818cf8'; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#94a3b8'; }}
                >
                  Kaynağa Git →
                </a>
              )}
            </div>

            {relatedNews.length > 0 && (
              <div style={{ marginTop: '3rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2.5rem' }}>
                <h4 style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1.5rem', margin: '0 0 1.5rem 0' }}>
                  Benzer Haberler
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {relatedNews.map(r => (
                    <div
                      key={r.id}
                      onClick={() => handleNewsClick(r.id)}
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '16px 20px', cursor: 'pointer', transition: '0.2s' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; e.currentTarget.style.background = 'rgba(99,102,241,0.05)'; }}
                      onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    >
                      {r.category?.name && (
                        <span style={{ fontSize: '0.65rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase' }}>{r.category.name}</span>
                      )}
                      <p style={{ color: 'white', fontWeight: '700', fontSize: '0.95rem', margin: r.category?.name ? '8px 0 0' : '0', lineHeight: '1.4' }}>{r.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {suggestion && (
        <div style={{ position: 'fixed', bottom: '40px', right: '40px', background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(16px)', border: '1px solid #10b981', padding: '24px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.4)', maxWidth: '380px', zIndex: 1001 }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#10b981', fontSize: '1.2rem', fontWeight: '700' }}>İlgi Alanı Önerisi 🎯</h4>
          <p style={{ color: '#cbd5e1', fontSize: '1rem', marginBottom: '20px' }}>{suggestion.message}</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleAcceptSuggestion} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: '#10b981', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>Ekle</button>
            <button onClick={() => setSuggestion(null)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid #10b981', background: 'transparent', color: '#10b981', cursor: 'pointer' }}>Kapat</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendingStrip({ trendingNews, onNewsClick, isMobile }) {
  const scrollRef = useRef(null);

  const scroll = (dir) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  const arrowBtn = {
    background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(245,158,11,0.2)',
    color: '#f59e0b', width: '34px', height: '34px', borderRadius: '50%',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.9rem', flexShrink: 0, transition: '0.2s',
  };

  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: '900', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px', flex: 1 }}>🔥 Şu an Trend</span>
        {!isMobile && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={arrowBtn} onClick={() => scroll(-1)}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(245,158,11,0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(15,23,42,0.9)'}
            >‹</button>
            <button style={arrowBtn} onClick={() => scroll(1)}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(245,158,11,0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(15,23,42,0.9)'}
            >›</button>
          </div>
        )}
      </div>
      <div ref={scrollRef} style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '8px', scrollbarWidth: 'none' }}>
        {trendingNews.map(n => (
          <div
            key={n.id}
            onClick={() => onNewsClick(n.id)}
            style={{ flexShrink: 0, width: isMobile ? '240px' : '280px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '18px', padding: '1.2rem 1.4rem', cursor: 'pointer', transition: '0.2s' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.35)'; e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.15)'; e.currentTarget.style.background = 'rgba(245,158,11,0.05)'; }}
          >
            {n.category?.name && (
              <span style={{ fontSize: '0.65rem', fontWeight: '900', color: '#f59e0b', textTransform: 'uppercase' }}>{n.category.name}</span>
            )}
            <p style={{ color: 'white', fontWeight: '700', fontSize: '0.9rem', margin: '8px 0 0', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;