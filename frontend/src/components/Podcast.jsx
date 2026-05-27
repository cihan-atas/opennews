import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';
import { usePlayer } from '../contexts/PlayerContext';

function Podcast() {
  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  
  // 🎯 UTKU: Cihan'ın Context yapısı (track nesnesi ve setTrack fonksiyonu)
  const { track, setTrack, clearTrack } = usePlayer();

  // --- MODERN BİLDİRİM SİSTEMİ (TOAST) ---
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

  // --- MODERN SİLME ONAY MODALI STATE'LERİ ---
  const [podcastToDelete, setPodcastToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  useEffect(() => {
    fetchPodcasts();
  }, [page, pageSize]);

  const fetchPodcasts = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/podcast/?page=${page}&size=${pageSize}`);
      if (response.ok) {
        const data = await response.json();
        setPodcasts(data.items || []);
        setTotalCount(data.total_count || 0);
      }
    } catch (error) {
      showToast("Kütüphane yüklenirken hata oluştu.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (id) => {
    setPodcastToDelete(id);
  };

  const confirmDeletePodcast = async () => {
    if (!podcastToDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/podcast/${podcastToDelete}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        if (track?.src === podcasts.find(p => p.id === podcastToDelete)?.audio_url) {
          setTrack(null, '', '', false);
        }
        setPodcasts(prev => prev.filter(p => p.id !== podcastToDelete));
        setTotalCount(prev => prev - 1);
        showToast("Podcast kütüphaneden başarıyla kaldırıldı.", "success");
      } else {
        showToast("Silme işlemi başarısız oldu.", "error");
      }
    } catch (error) {
      showToast("Bağlantı hatası yaşandı.", "error");
    } finally {
      setIsDeleting(false);
      setPodcastToDelete(null); 
    }
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setPage(1);
  };

  // 🎯 UTKU: Cihan'ın setTrack parametre yapısına milimetrik eşleme yapıldı!
  const handlePlayToggle = (pod) => {
    const isCurrentTrack = track?.src === pod.audio_url;

    if (isCurrentTrack) {
      // ✕ "Kapat" butonuna basınca clearTrack() ile track'i null yapıp
      // GlobalPlayer'ı unmount ediyoruz → ses durur, panel kapanır.
      clearTrack();
      showToast("Podcast tamamen kapatıldı.", "success");
    } else {
      // 🎯 DOĞRU PARAMETRE SIRALAMASI: url, title, categoryName, autoPlay
      const categoryLabel = pod.news_id ? 'Akış' : 'RSS';
      setTrack(pod.audio_url, pod.title, categoryLabel, true);
      showToast("Podcast kütüphaneden oynatılıyor...", "success");
    }
  };

  const styles = {
    container: { backgroundColor: '#020617', color: '#f1f5f9', minHeight: '100vh', fontFamily: "'Inter', sans-serif", overflowX: 'hidden' },
    toast: { position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)', backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: toast.type === 'success' ? '#10b981' : '#ef4444', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`, backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', fontWeight: '600', transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', opacity: toast.show ? 1 : 0, zIndex: 9999 },
    headerWrapper: { padding: isMobile ? '5rem 1rem 1.5rem' : '4rem 3rem 3rem', maxWidth: '1200px', margin: '0 auto', textAlign: 'center' },
    card: {
      background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px',
      padding: '1.5rem 2rem', position: 'relative', transition: 'all 0.3s ease',
      display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: '20px'
    },
    playBtn: (isCurrent) => ({
      background: isCurrent ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
      color: 'white', border: 'none', padding: '10px 22px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', transition: '0.2s',
      boxShadow: isCurrent ? '0 6px 16px rgba(220, 38, 38, 0.3)' : '0 6px 16px rgba(99, 102, 241, 0.25)', minWidth: '110px'
    }),
    navBtn: { background: 'rgba(30, 41, 59, 0.6)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.05)', padding: '10px 20px', borderRadius: '12px', fontWeight: '600', cursor: 'pointer', transition: '0.2s', minWidth: '110px' },
    pageNum: (isActive) => ({ padding: '8px 16px', borderRadius: '12px', border: 'none', backgroundColor: isActive ? '#6366f1' : 'rgba(30, 41, 59, 0.5)', color: 'white', cursor: 'pointer', fontWeight: isActive ? '700' : '400', transition: 'all 0.3s' }),
    modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
    modalBox: { background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '3rem', borderRadius: '32px', maxWidth: '440px', textAlign: 'center', boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.5)', position: 'relative' }
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>
        <span style={{marginRight: '8px'}}>{toast.type === 'success' ? '✨' : '⚠️'}</span> {toast.message}
      </div>

      <div style={styles.headerWrapper}>
        <button onClick={() => navigate('/home')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '25px', padding: '8px 16px', borderRadius: '12px', fontWeight: '600', transition: 'all 0.2s' }}>
          ← Akışa Dön
        </button>
        <h1 style={{ fontSize: '3rem', fontWeight: '800', margin: 0, letterSpacing: '-1px', background: 'linear-gradient(to right, #ffffff, #cbd5e1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: '1.2' }}>
          Podcast Kütüphanem
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginTop: '10px' }}>Yapay zeka ile üretilen kişisel ses dosyaların.</p>
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '0 1rem' : '0 3rem' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '4rem', fontSize: '1.2rem' }}>Kasetler sarılıyor...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {podcasts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem', background: 'rgba(15, 23, 42, 0.3)', borderRadius: '32px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                <p style={{ color: '#64748b', fontSize: '1.2rem' }}>Henüz bir podcast üretilmemiş.</p>
              </div>
            ) : (
              podcasts.map((pod) => {
                const isCurrent = track?.src === pod.audio_url;

                return (
                  <div 
                    key={pod.id} 
                    style={styles.card}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                  >
                    
                    {/* SOL KISIM: İkon, Badge ve Metin Bilgileri */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1, minWidth: 0, width: '100%' }}>
                      <div style={{
                        width: '52px', height: '52px', 
                        background: isCurrent ? 'linear-gradient(135deg,#10b981,#34d399)' : 'linear-gradient(135deg, #6366f1, #818cf8)',
                        borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0,
                        boxShadow: isCurrent ? '0 0 16px rgba(16,185,129,0.35)' : 'none', transition: 'all 0.3s'
                      }}>
                        {isCurrent ? '🔊' : '🎙️'}
                      </div>

                      <div style={{ flex: 1, minWidth: 0, paddingRight: isMobile ? '30px' : '0' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: '900', color: isCurrent ? '#10b981' : '#818cf8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            {isCurrent ? 'Şu An Çalıyor' : 'Kayıt Arşivi'}
                          </span>
                          <span style={{ fontSize: '0.6rem', fontWeight: '800', padding: '2px 6px', borderRadius: '5px', background: pod.news_id ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.12)', color: pod.news_id ? '#818cf8' : '#f59e0b', border: `1px solid ${pod.news_id ? 'rgba(99,102,241,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                            {pod.news_id ? '📡 Akış' : '📰 RSS'}
                          </span>
                        </div>
                        <h3 style={{ margin: '4px 0', fontSize: '1.25rem', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: '700' }}>{pod.title}</h3>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>{new Date(pod.created_at).toLocaleString('tr-TR')}</p>
                      </div>
                    </div>

                    {/* SAĞ KISIM: Butonlar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'flex-start' : 'flex-end', paddingRight: isMobile ? '0' : '40px' }}>

                      <button onClick={() => handlePlayToggle(pod)} style={styles.playBtn(isCurrent)} onMouseOver={e => e.currentTarget.style.transform = 'scale(1.02)'} onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}>
                        {isCurrent ? '✕ Kapat' : '▶ Oynat'}
                      </button>

                      {pod.news_id ? (
                        <button onClick={() => navigate(`/home?open=${pod.news_id}`)} style={styles.navBtn} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)'}>
                          📰 Haberi Gör
                        </button>
                      ) : pod.source_url ? (
                        <a href={pod.source_url} target="_blank" rel="noopener noreferrer" style={{ ...styles.navBtn, textDecoration: 'none', textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }} onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)'; e.currentTarget.style.color = '#f59e0b'; }} onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8'; }}>
                          🔗 Kaynağa Git
                        </a>
                      ) : null}

                      <a
                        href={pod.audio_url}
                        download={`${pod.title.replace(/[^a-z0-9]/gi, '_')}.mp3`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Podcast'i İndir"
                        style={{ ...styles.navBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '10px 16px' }}
                        onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)'; e.currentTarget.style.color = '#10b981'; }}
                        onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#cbd5e1'; }}
                      >⬇ İndir</a>
                    </div>

                    {/* KALICI SİLME BUTONU */}
                    <button 
                      onClick={() => handleDeleteClick(pod.id)} 
                      style={{ position: 'absolute', top: isMobile ? '20px' : '50%', transform: isMobile ? 'none' : 'translateY(-50%)', right: '20px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '8px', borderRadius: '10px', fontSize: '1.05rem' }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      🗑️
                    </button>
                  </div>
                );
              })
            )}

            {/* --- SAYFALAMA ALANI --- */}
            {podcasts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'space-between', alignItems: 'center', gap: '1rem', padding: '3rem 0 10rem', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '2rem' }}>
                <div style={{ color: '#64748b', fontSize: '0.95rem' }}>Toplam {totalCount} podcast — Sayfa {page}/{totalPages}</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#64748b', fontSize: '0.9rem', marginRight: '10px' }}>Sayfa Başı:</span>
                  {[10, 25, 50].map(size => ( <button key={size} onClick={() => handlePageSizeChange(size)} style={styles.pageNum(pageSize === size)}>{size}</button> ))}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...styles.pageNum(false), opacity: page === 1 ? 0.3 : 1 }}>←</button>
                  {(() => {
                    const btns = []; const delta = 2; const left = Math.max(2, page - delta); const right = Math.min(totalPages - 1, page + delta);
                    btns.push(<button key={1} onClick={() => setPage(1)} style={styles.pageNum(page === 1)}>1</button>);
                    if (left > 2) btns.push(<span key="l" style={{color: '#444'}}>...</span>);
                    for (let i = left; i <= right; i++) btns.push(<button key={i} onClick={() => setPage(i)} style={styles.pageNum(page === i)}>{i}</button>);
                    if (right < totalPages - 1) btns.push(<span key="r" style={{color: '#444'}}>...</span>);
                    if (totalPages > 1) btns.push(<button key={totalPages} onClick={() => setPage(totalPages)} style={styles.pageNum(page === totalPages)}>{totalPages}</button>);
                    return btns;
                  })()}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...styles.pageNum(false), opacity: page === totalPages ? 0.3 : 1 }}>→</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SİLME ONAY MODAL */}
      {podcastToDelete && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>⚠️</div>
            <h2 style={{ color: 'white', fontSize: '1.8rem', marginBottom: '10px', fontWeight: '800' }}>Kaseti Çöpe At?</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: '1.6', marginBottom: '2rem' }}>Bu kaydı kütüphaneden kalıcı olarak silmek üzeresin. Bu işlem geri alınamaz.</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setPodcastToDelete(null)} disabled={isDeleting} style={{ flex: 1, padding: '14px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>Vazgeç</button>
              <button onClick={confirmDeletePodcast} disabled={isDeleting} style={{ flex: 1, padding: '14px', borderRadius: '14px', border: 'none', background: '#ef4444', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>{isDeleting ? 'Siliniyor...' : 'Evet, Çöpe At'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Podcast;