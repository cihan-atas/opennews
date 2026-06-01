import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';

function ReadLater() {
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNews, setSelectedNews] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ show: true, message, type });
  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast(p => ({ ...p, show: false })), 2000);
      return () => clearTimeout(t);
    }
  }, [toast.show]);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  useEffect(() => { fetchItems(); }, [page]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/read-later/?page=${page}&size=${pageSize}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotalCount(data.total_count || 0);
      }
    } catch (_) {
      showToast("Liste yüklenirken hata oluştu.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (newsId, e) => {
    e.stopPropagation();
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/read-later/${newsId}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(prev => prev.filter(b => b.news_id !== newsId));
        setTotalCount(p => p - 1);
        showToast("Listeden kaldırıldı.", "success");
      }
    } catch (_) { showToast("İşlem başarısız.", "error"); }
  };

  const styles = {
    container: { color: '#f1f5f9', fontFamily: "'Inter', sans-serif", width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '0 2rem', boxSizing: 'border-box' },
    toast: {
      position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
      color: toast.type === 'success' ? '#10b981' : '#ef4444', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
      backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', fontWeight: '600',
      transition: 'all 0.5s', opacity: toast.show ? 1 : 0, zIndex: 9999,
    },
    card: {
      background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px',
      padding: '1.75rem', cursor: 'pointer', transition: 'all 0.3s ease', position: 'relative',
    },
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '3rem' },
    pageBtn: (active) => ({ padding: '8px 16px', borderRadius: '12px', border: 'none', backgroundColor: active ? '#6366f1' : 'rgba(30,41,59,0.5)', color: 'white', cursor: 'pointer', fontWeight: active ? '700' : '400', transition: '0.3s' }),
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>{toast.message}</div>

      <div style={{ padding: isMobile ? '5rem 0 2.5rem' : '2rem 0 2.5rem' }}>
        <h1 style={{ fontSize: isMobile ? '2rem' : '3rem', fontWeight: '900', margin: 0, color: 'white' }}>Sonra Oku</h1>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginTop: '10px' }}>
          {totalCount > 0 ? `${totalCount} haber okuma kuyruğunda` : 'Okuma kuyruğun boş.'}
        </p>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '5rem' }}>Yükleniyor...</p>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '8rem', color: '#475569' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📑</div>
          <p style={{ fontSize: '1.2rem' }}>Okuma kuyruğun henüz boş.</p>
          <p style={{ fontSize: '0.9rem', marginTop: '8px' }}>Haber detayında "Sonra Oku" butonuna basarak buraya ekleyebilirsiniz.</p>
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            {items.map(b => (
              <div key={b.id} onClick={() => setSelectedNews(b.news)} style={styles.card}
                onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'none'; }}
              >
                {b.news?.category?.name && (
                  <span style={{ fontSize: '0.7rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase' }}>{b.news.category.name}</span>
                )}
                <h3 style={{ margin: '12px 0', fontSize: '1.2rem', color: 'white', fontWeight: '800', lineHeight: '1.4' }}>{b.news?.title || 'Başlık yok'}</h3>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '16px' }}>{b.news?.summary || ''}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#475569', fontSize: '0.75rem' }}>
                    {new Date(b.added_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}
                  </span>
                  <button
                    onClick={(e) => handleRemove(b.news_id, e)}
                    style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', transition: '0.2s' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Kaldır
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '2rem 0 6rem' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...styles.pageBtn(false), opacity: page === 1 ? 0.3 : 1 }}>←</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1).map(p => (
                <button key={p} onClick={() => setPage(p)} style={styles.pageBtn(page === p)}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...styles.pageBtn(false), opacity: page === totalPages ? 0.3 : 1 }}>→</button>
            </div>
          )}
        </>
      )}

      {selectedNews && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(16px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.1)', padding: isMobile ? '2rem 1.5rem' : '4rem', borderRadius: '40px', maxWidth: '900px', width: '90%', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setSelectedNews(null)} style={{ position: 'absolute', top: '35px', right: '35px', background: 'transparent', border: 'none', color: '#64748b', fontSize: '2.2rem', cursor: 'pointer' }}>✖</button>
            {selectedNews.category?.name && (
              <span style={{ fontSize: '0.75rem', fontWeight: '900', color: '#818cf8', textTransform: 'uppercase', display: 'block', marginBottom: '16px' }}>{selectedNews.category.name}</span>
            )}
            <h2 style={{ fontSize: isMobile ? '1.8rem' : '2.6rem', fontWeight: '900', color: 'white', marginBottom: '30px', paddingRight: '3rem' }}>{selectedNews.title}</h2>
            <div style={{ lineHeight: '1.9', color: '#cbd5e1', fontSize: '1.1rem', whiteSpace: 'pre-wrap' }}>{selectedNews.content || selectedNews.summary}</div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2rem' }}>
              <button
                onClick={() => { setSelectedNews(null); navigate(`/home?open=${selectedNews.id}`); }}
                style={{ padding: '14px 22px', borderRadius: '16px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '0.95rem' }}
              >
                🏠 Akışta Aç
              </button>
              {selectedNews.source_url && (
                <a href={selectedNews.source_url} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '14px 22px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', textDecoration: 'none', fontWeight: '600' }}>
                  Kaynağa Git →
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReadLater;
