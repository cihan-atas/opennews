import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';

export default function Admin() {
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  // Yeni kaynak ekleme formu
  const [addForm, setAddForm] = useState({ url: '', title: '', category_id: '' });
  const [adding, setAdding] = useState(false);

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
      const [pendingRes, approvedRes, catRes] = await Promise.all([
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/pending`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/approved`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/categories/`),
      ]);
      if (pendingRes.ok) setPending(await pendingRes.json());
      if (approvedRes.ok) setApproved(await approvedRes.json());
      if (catRes.ok) setCategories(await catRes.json());
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
        const item = pending.find(s => s.id === id);
        setPending(p => p.filter(s => s.id !== id));
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
        showToast('Kaynak reddedildi.');
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

  const handleAdminAdd = async (e) => {
    e.preventDefault();
    if (!addForm.url.trim()) return;
    setAdding(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/admin/add`, {
        method: 'POST',
        body: JSON.stringify({
          url: addForm.url.trim(),
          title: addForm.title.trim() || null,
          category_id: addForm.category_id ? parseInt(addForm.category_id) : null,
        }),
      });
      if (res.ok) {
        const newSource = await res.json();
        setApproved(a => [newSource, ...a]);
        setAddForm({ url: '', title: '', category_id: '' });
        showToast('Kaynak eklendi ve yayında!');
      } else {
        const err = await res.json();
        showToast(err.detail || 'Eklenemedi.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setAdding(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(15,23,42,0.8)',
    color: '#f1f5f9', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box',
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
        transition: 'all 0.4s', opacity: toast.show ? 1 : 0, zIndex: 9999, whiteSpace: 'nowrap',
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
        <p style={{ color: '#94a3b8', marginTop: '8px', fontSize: '1.05rem' }}>Topluluk RSS kaynaklarını yönet ve doğrudan ekle.</p>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '0 1.5rem 6rem' : '0 3rem 6rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '4rem', fontSize: '1.2rem' }}>Yükleniyor...</p>
        ) : (
          <>
            {/* Admin: Doğrudan Kaynak Ekleme */}
            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '20px', padding: '1.75rem 2rem', marginBottom: '3rem' }}>
              <h2 style={{ margin: '0 0 1.5rem', color: 'white', fontSize: '1.3rem', fontWeight: '800' }}>➕ Yeni Onaylı Kaynak Ekle</h2>
              <form onSubmit={handleAdminAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>RSS URL *</label>
                    <input
                      type="url"
                      required
                      placeholder="https://example.com/feed.xml"
                      value={addForm.url}
                      onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Başlık (görünen isim)</label>
                    <input
                      type="text"
                      placeholder="örn. TechCrunch Türkçe"
                      value={addForm.title}
                      onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ maxWidth: isMobile ? '100%' : '50%' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Kategori</label>
                  <select
                    value={addForm.category_id}
                    onChange={e => setAddForm(f => ({ ...f, category_id: e.target.value }))}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="">— Kategori seç —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={adding || !addForm.url.trim()}
                    style={{ padding: '10px 28px', borderRadius: '12px', border: 'none', background: adding || !addForm.url.trim() ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white', fontWeight: '700', cursor: adding || !addForm.url.trim() ? 'not-allowed' : 'pointer', fontSize: '0.9rem', transition: '0.2s' }}
                  >
                    {adding ? 'Ekleniyor...' : '✓ Onaylı Olarak Ekle'}
                  </button>
                </div>
              </form>
            </div>

            {/* Bekleyen Kaynaklar */}
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
                        {src.title && (
                          <p style={{ margin: '0 0 2px', color: 'white', fontWeight: '700', fontSize: '0.95rem' }}>{src.title}</p>
                        )}
                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#818cf8', fontWeight: src.title ? '400' : '700', fontSize: '0.85rem', wordBreak: 'break-all', textDecoration: 'none' }}
                          onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {src.url}
                        </a>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {src.category && (
                            <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.12)', padding: '2px 8px', borderRadius: '6px' }}>{src.category}</span>
                          )}
                          <span style={{ color: '#475569', fontSize: '0.75rem' }}>{src.created_at ? new Date(src.created_at).toLocaleString('tr-TR') : ''}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button
                          onClick={() => handleApprove(src.id)}
                          disabled={processing === src.id}
                          style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: '700', cursor: processing === src.id ? 'not-allowed' : 'pointer', fontSize: '0.88rem', opacity: processing === src.id ? 0.5 : 1, transition: '0.2s' }}
                          onMouseOver={e => { if (processing !== src.id) e.currentTarget.style.background = 'rgba(16,185,129,0.25)'; }}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(16,185,129,0.15)'}
                        >✓ Onayla</button>
                        <button
                          onClick={() => handleReject(src.id)}
                          disabled={processing === src.id}
                          style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: '700', cursor: processing === src.id ? 'not-allowed' : 'pointer', fontSize: '0.88rem', opacity: processing === src.id ? 0.5 : 1, transition: '0.2s' }}
                          onMouseOver={e => { if (processing !== src.id) e.currentTarget.style.background = 'rgba(239,68,68,0.22)'; }}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
                        >✕ Reddet</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Onaylı Kaynaklar */}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                        <span style={{ color: '#10b981', fontSize: '1rem', flexShrink: 0 }}>✓</span>
                        <div style={{ minWidth: 0 }}>
                          {src.title && <p style={{ margin: '0 0 2px', color: 'white', fontWeight: '700', fontSize: '0.9rem' }}>{src.title}</p>}
                          <a href={src.url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#64748b', fontSize: '0.8rem', wordBreak: 'break-all', textDecoration: 'none' }}
                            onMouseOver={e => e.currentTarget.style.color = '#818cf8'}
                            onMouseOut={e => e.currentTarget.style.color = '#64748b'}
                          >
                            {src.url}
                          </a>
                        </div>
                      </div>
                      {src.category && (
                        <span style={{ fontSize: '0.72rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.12)', padding: '3px 10px', borderRadius: '7px', flexShrink: 0 }}>{src.category}</span>
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
