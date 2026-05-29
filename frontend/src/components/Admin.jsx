import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';

export default function Admin() {
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null); // id of item being processed

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ show: true, message, type });
  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast(p => ({ ...p, show: false })), 2500);
      return () => clearTimeout(t);
    }
  }, [toast.show]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/pending`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/approved`),
      ]);
      if (pendingRes.ok) setPending(await pendingRes.json());
      if (approvedRes.ok) setApproved(await approvedRes.json());
    } catch (_) {
      showToast('Veriler yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleApprove = async (id) => {
    setProcessing(id);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/${id}/approve`, { method: 'POST' });
      if (res.ok) {
        showToast('Kaynak onaylandı.');
        setPending(p => p.filter(s => s.id !== id));
        const item = pending.find(s => s.id === id);
        if (item) setApproved(a => [{ ...item, status: 'approved' }, ...a]);
      } else {
        showToast('İşlem başarısız.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id) => {
    setProcessing(id);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/${id}/reject`, { method: 'POST' });
      if (res.ok) {
        showToast('Kaynak reddedildi.', 'success');
        setPending(p => p.filter(s => s.id !== id));
      } else {
        showToast('İşlem başarısız.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const cardStyle = {
    background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '18px', padding: '1.25rem 1.5rem',
    display: 'flex', flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: '12px',
  };

  return (
    <div style={{ backgroundColor: '#020617', color: '#f1f5f9', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>

      {/* Toast */}
      <div style={{
        position: 'fixed', top: toast.show ? '30px' : '-80px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: toast.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
        color: toast.type === 'success' ? '#10b981' : '#ef4444',
        border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
        backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', fontWeight: '600',
        transition: 'all 0.4s', opacity: toast.show ? 1 : 0, zIndex: 9999,
      }}>
        {toast.type === 'success' ? '✓' : '⚠️'} {toast.message}
      </div>

      {/* Header */}
      <div style={{ padding: isMobile ? '5rem 1.5rem 2rem' : '4rem 3rem 2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <button
          onClick={() => navigate('/home')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '28px', padding: '8px 16px', borderRadius: '12px', fontWeight: '600' }}
        >
          ← Akışa Dön
        </button>
        <h1 style={{ fontSize: isMobile ? '2rem' : '3rem', fontWeight: '800', margin: 0, letterSpacing: '-1px', background: 'linear-gradient(to right, #ffffff, #cbd5e1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🛠️ Admin Paneli
        </h1>
        <p style={{ color: '#94a3b8', marginTop: '8px', fontSize: '1.05rem' }}>Topluluk tarafından gönderilen RSS kaynaklarını yönet.</p>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '0 1.5rem 6rem' : '0 3rem 6rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '4rem', fontSize: '1.2rem' }}>Yükleniyor...</p>
        ) : (
          <>
            {/* Bekleyen kaynaklar */}
            <div style={{ marginBottom: '3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.25rem' }}>
                <h2 style={{ margin: 0, color: 'white', fontSize: '1.4rem', fontWeight: '800' }}>⏳ Bekleyen Kaynaklar</h2>
                {pending.length > 0 && (
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: '900' }}>
                    {pending.length}
                  </span>
                )}
              </div>

              {pending.length === 0 ? (
                <div style={{ background: 'rgba(15,23,42,0.3)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '18px', padding: '2.5rem', textAlign: 'center' }}>
                  <p style={{ color: '#475569', margin: 0 }}>Bekleyen kaynak yok.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {pending.map(src => (
                    <div key={src.id} style={cardStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#818cf8', fontWeight: '700', fontSize: '0.95rem', wordBreak: 'break-all', textDecoration: 'none' }}
                          onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {src.url}
                        </a>
                        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.78rem' }}>
                          {src.created_at ? new Date(src.created_at).toLocaleString('tr-TR') : '—'}
                          {src.category_id && ` · Kategori #${src.category_id}`}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button
                          onClick={() => handleApprove(src.id)}
                          disabled={processing === src.id}
                          style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: '700', cursor: processing === src.id ? 'not-allowed' : 'pointer', fontSize: '0.88rem', transition: '0.2s', opacity: processing === src.id ? 0.5 : 1 }}
                          onMouseOver={e => { if (processing !== src.id) e.currentTarget.style.background = 'rgba(16,185,129,0.25)'; }}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(16,185,129,0.15)'}
                        >✓ Onayla</button>
                        <button
                          onClick={() => handleReject(src.id)}
                          disabled={processing === src.id}
                          style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: '700', cursor: processing === src.id ? 'not-allowed' : 'pointer', fontSize: '0.88rem', transition: '0.2s', opacity: processing === src.id ? 0.5 : 1 }}
                          onMouseOver={e => { if (processing !== src.id) e.currentTarget.style.background = 'rgba(239,68,68,0.22)'; }}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
                        >✕ Reddet</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Onaylı kaynaklar */}
            <div>
              <h2 style={{ margin: '0 0 1.25rem', color: 'white', fontSize: '1.4rem', fontWeight: '800' }}>✅ Onaylı Kaynaklar ({approved.length})</h2>
              {approved.length === 0 ? (
                <div style={{ background: 'rgba(15,23,42,0.3)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '18px', padding: '2.5rem', textAlign: 'center' }}>
                  <p style={{ color: '#475569', margin: 0 }}>Henüz onaylı kaynak yok.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {approved.map(src => (
                    <div key={src.id} style={{ ...cardStyle, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                        <span style={{ color: '#10b981', fontSize: '0.9rem' }}>✓</span>
                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#cbd5e1', fontSize: '0.9rem', wordBreak: 'break-all', textDecoration: 'none' }}
                          onMouseOver={e => e.currentTarget.style.color = '#818cf8'}
                          onMouseOut={e => e.currentTarget.style.color = '#cbd5e1'}
                        >
                          {src.url}
                        </a>
                      </div>
                      {src.category_id && (
                        <span style={{ color: '#64748b', fontSize: '0.78rem', flexShrink: 0 }}>Kategori #{src.category_id}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
