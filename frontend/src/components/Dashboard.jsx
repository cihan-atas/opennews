import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  const [stats, setStats] = useState(null);
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNews, setSelectedNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'error') => setToast({ show: true, message, type });
  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast(p => ({ ...p, show: false })), 2500);
      return () => clearTimeout(t);
    }
  }, [toast.show]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [statsRes, trendRes] = await Promise.all([
          fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/stats`),
          fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/trending`),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (trendRes.ok) setTrending(await trendRes.json());
      } catch (_) {
        showToast('Veriler yüklenirken hata oluştu.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const openNews = async (id) => {
    setNewsLoading(true);
    setSelectedNews({ id });
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/news/${id}`);
      if (res.ok) setSelectedNews(await res.json());
      else setSelectedNews(null);
    } catch (_) {
      showToast('Haber yüklenemedi.');
      setSelectedNews(null);
    } finally {
      setNewsLoading(false);
    }
  };

  const statCards = stats ? [
    { icon: '📰', label: 'Toplam Okuma', value: stats.articles_read ?? 0, color: '#6366f1' },
    { icon: '📅', label: 'Bu Hafta', value: stats.week_reads ?? 0, color: '#10b981' },
    { icon: '🎙️', label: 'Podcast', value: stats.podcasts_count ?? 0, color: '#f59e0b' },
    { icon: '🔖', label: 'Kaydedilen', value: stats.bookmarks_count ?? 0, color: '#ec4899' },
  ] : [];

  return (
    <>
    <div style={{ backgroundColor: '#020617', color: '#f1f5f9', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>

      {/* Toast */}
      <div style={{
        position: 'fixed', top: toast.show ? '30px' : '-80px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid #ef4444',
        backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', fontWeight: '600',
        transition: 'all 0.4s', opacity: toast.show ? 1 : 0, zIndex: 9999,
      }}>
        ⚠️ {toast.message}
      </div>

      {/* Header */}
      <div style={{ padding: isMobile ? '5rem 1.5rem 2rem' : '4rem 3rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <button
          onClick={() => navigate('/home')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '28px', padding: '8px 16px', borderRadius: '12px', fontWeight: '600' }}
        >
          ← Akışa Dön
        </button>
        <h1 style={{ fontSize: isMobile ? '2rem' : '3rem', fontWeight: '800', margin: 0, letterSpacing: '-1px', background: 'linear-gradient(to right, #ffffff, #cbd5e1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Dashboard
        </h1>
        <p style={{ color: '#94a3b8', marginTop: '8px', fontSize: '1.05rem' }}>Okuma alışkanlıkların ve kişisel içerik özeti.</p>
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '0 1.5rem 6rem' : '0 3rem 6rem' }}>

        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '4rem', fontSize: '1.2rem' }}>Yükleniyor...</p>
        ) : (
          <>
            {/* İstatistik Kartları */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '3rem' }}>
              {statCards.map(({ icon, label, value, color }) => (
                <div key={label} style={{
                  background: 'rgba(15,23,42,0.6)', border: `1px solid ${color}22`,
                  borderRadius: '20px', padding: '1.75rem', textAlign: 'center',
                  boxShadow: `0 4px 20px ${color}11`,
                }}>
                  <div style={{ fontSize: '2.2rem', marginBottom: '10px' }}>{icon}</div>
                  <div style={{ fontSize: '2.4rem', fontWeight: '900', color, lineHeight: 1 }}>{value}</div>
                  <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '6px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Favori Kategori */}
            {stats?.favorite_category && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(129,140,248,0.05))',
                border: '1px solid rgba(99,102,241,0.2)', borderRadius: '20px', padding: '1.5rem 2rem',
                marginBottom: '3rem', display: 'flex', alignItems: 'center', gap: '16px'
              }}>
                <span style={{ fontSize: '2rem' }}>🏆</span>
                <div>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>En Çok Okuduğun Kategori</p>
                  <p style={{ margin: '4px 0 0', color: '#818cf8', fontSize: '1.4rem', fontWeight: '900' }}>{stats.favorite_category}</p>
                </div>
              </div>
            )}

            {/* Trend Haberler */}
            {trending.length > 0 && (
              <div>
                <h2 style={{ color: 'white', fontSize: '1.5rem', fontWeight: '800', marginBottom: '1.5rem' }}>
                  🔥 Şu An Gündemde
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {trending.slice(0, 8).map((news, idx) => (
                    <div
                      key={news.id}
                      onClick={() => openNews(news.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '16px',
                        background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '16px', padding: '1.25rem 1.5rem', cursor: 'pointer', transition: 'all 0.2s',
                      }}
                      onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'}
                      onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                    >
                      <span style={{ fontSize: '1.4rem', fontWeight: '900', color: idx < 3 ? '#f59e0b' : '#334155', minWidth: '28px' }}>
                        {idx + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, color: 'white', fontWeight: '700', fontSize: '0.95rem', lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {news.title}
                        </p>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {news.category?.name && (
                            <span style={{ fontSize: '0.72rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {news.category.name}
                            </span>
                          )}
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(news.created_at).toLocaleDateString('tr-TR')}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>

    {/* Haber Modalı */}

    {selectedNews && (
      <div
        onClick={() => setSelectedNews(null)}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.88)', backdropFilter: 'blur(16px)', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'center', zIndex: 2000, padding: isMobile ? 0 : '2rem' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: 'rgba(10,15,30,0.99)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: isMobile ? '28px 28px 0 0' : '32px', padding: isMobile ? '2rem 1.5rem 2.5rem' : '2.75rem', width: '100%', maxWidth: '720px', maxHeight: isMobile ? '92vh' : '88vh', overflowY: 'auto', position: 'relative', boxShadow: '0 40px 100px rgba(0,0,0,0.7)' }}
        >
          <button
            onClick={() => setSelectedNews(null)}
            style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.07)', color: '#64748b', width: '38px', height: '38px', borderRadius: '50%', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >✕</button>

          {newsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px', color: '#475569', fontSize: '1.5rem' }}>⏳</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem', flexWrap: 'wrap', paddingRight: '3rem' }}>
                {selectedNews.category?.name && (
                  <span style={{ fontSize: '0.68rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '4px 10px', borderRadius: '8px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    {selectedNews.category.name}
                  </span>
                )}
                {selectedNews.created_at && (
                  <span style={{ fontSize: '0.75rem', color: '#334155' }}>
                    {new Date(selectedNews.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                )}
              </div>

              <h2 style={{ margin: '0 0 1.5rem', fontSize: isMobile ? '1.35rem' : '1.7rem', fontWeight: '900', color: 'white', lineHeight: '1.3' }}>
                {selectedNews.title}
              </h2>

              {selectedNews.summary && (
                <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: '18px', padding: '1.25rem', marginBottom: '1.5rem' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '0.62rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '1px' }}>AI Özet</p>
                  <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.95rem', lineHeight: '1.75' }}>{selectedNews.summary}</p>
                </div>
              )}

              {selectedNews.content && (
                <div style={{ color: '#94a3b8', fontSize: '1rem', lineHeight: '1.85', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' }}>
                  {selectedNews.content}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {selectedNews.source_url && (
                  <a
                    href={selectedNews.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, minWidth: '130px', padding: '13px 18px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: '#94a3b8', fontWeight: '700', fontSize: '0.88rem', textDecoration: 'none', textAlign: 'center', transition: '0.2s' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = 'white'; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#94a3b8'; }}
                  >
                    🔗 Kaynağa Git
                  </a>
                )}
                <button
                  onClick={() => { setSelectedNews(null); navigate(`/home?open=${selectedNews.id}`); }}
                  style={{ flex: 1, minWidth: '130px', padding: '13px 18px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: 'white', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer' }}
                >
                  🏠 Haber Akışında Aç
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
