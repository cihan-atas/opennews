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
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [userProcessing, setUserProcessing] = useState(null);
  // Bekleyen kaynaklar için admin'in seçtiği kategori (id bazlı override)
  const [pendingCat, setPendingCat] = useState({});

  // Yeni kaynak ekleme formu
  const [addForm, setAddForm] = useState({ url: '', title: '', category_id: '' });
  const [adding, setAdding] = useState(false);

  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);

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
      const [pendingRes, approvedRes, catRes, statsRes, usersRes] = await Promise.all([
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/pending`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/approved`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/categories/`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/admin/stats`),
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/admin/users`),
      ]);
      if (pendingRes.ok) setPending(await pendingRes.json());
      if (approvedRes.ok) setApproved(await approvedRes.json());
      if (catRes.ok) setCategories(await catRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
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
      const chosen = pendingCat[id];
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/rss/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ category_id: chosen ? parseInt(chosen) : null }),
      });
      if (res.ok) {
        const updated = await res.json();
        showToast('Kaynak onaylandı.');
        const item = pending.find(s => s.id === id);
        setPending(p => p.filter(s => s.id !== id));
        if (item) setApproved(a => [{ ...item, status: 'approved', category_id: updated.category_id, category: updated.category }, ...a]);
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

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/categories/`, {
        method: 'POST',
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories(c => [...c, created]);
        setAddForm(f => ({ ...f, category_id: String(created.id) }));
        setNewCatName('');
        setShowNewCat(false);
        showToast(`"${created.name}" kategorisi oluşturuldu.`);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Kategori oluşturulamadı.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleToggleAdmin = async (userId) => {
    setUserProcessing(userId);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/admin/users/${userId}/toggle-admin`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setUsers(us => us.map(u => u.id === userId ? { ...u, is_admin: updated.is_admin } : u));
        showToast(updated.is_admin ? 'Admin yetkisi verildi.' : 'Admin yetkisi kaldırıldı.');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'İşlem başarısız.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setUserProcessing(null);
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!window.confirm(`"${username}" kullanıcısını ve tüm verilerini kalıcı olarak silmek istediğine emin misin?`)) return;
    setUserProcessing(userId);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/admin/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        setUsers(us => us.filter(u => u.id !== userId));
        showToast('Kullanıcı silindi.');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Silinemedi.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setUserProcessing(null);
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
        <p style={{ color: '#94a3b8', marginTop: '8px', fontSize: '1.05rem' }}>İstatistikleri görüntüle, kullanıcıları ve topluluk RSS kaynaklarını yönet.</p>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '0 1.5rem 6rem' : '0 3rem 6rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '4rem', fontSize: '1.2rem' }}>Yükleniyor...</p>
        ) : (
          <>
            {/* Sistem İstatistikleri */}
            {stats && (
              <div style={{ marginBottom: '3rem' }}>
                <h2 style={{ margin: '0 0 1.25rem', color: 'white', fontSize: '1.4rem', fontWeight: '800' }}>📊 Sistem İstatistikleri</h2>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
                  {[
                    { label: 'Kullanıcı', value: stats.users, sub: `${stats.admins} admin`, color: '#818cf8' },
                    { label: 'Haber', value: stats.news, sub: `son 24s: ${stats.news_last_24h}`, color: '#10b981' },
                    { label: 'Podcast', value: stats.podcasts, sub: 'üretilen', color: '#f59e0b' },
                    { label: 'Bekleyen RSS', value: stats.pending_rss, sub: 'onay bekliyor', color: '#ef4444' },
                  ].map(c => (
                    <div key={c.label} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '1.1rem 1.25rem' }}>
                      <div style={{ fontSize: '1.9rem', fontWeight: '800', color: c.color, lineHeight: 1 }}>{c.value}</div>
                      <div style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '0.85rem', marginTop: '6px' }}>{c.label}</div>
                      <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>{c.sub}</div>
                    </div>
                  ))}
                </div>
                {stats.top_categories?.length > 0 && (
                  <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: '700' }}>En çok tıklanan:</span>
                    {stats.top_categories.map(tc => (
                      <span key={tc.name} style={{ fontSize: '0.75rem', fontWeight: '700', color: '#818cf8', background: 'rgba(99,102,241,0.12)', padding: '3px 10px', borderRadius: '7px' }}>
                        {tc.name} · {tc.clicks}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Kategori</label>
                    <button
                      type="button"
                      onClick={() => { setShowNewCat(v => !v); setNewCatName(''); }}
                      style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                    >
                      {showNewCat ? '← Mevcut seç' : '+ Yeni oluştur'}
                    </button>
                  </div>
                  {showNewCat ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Kategori adı"
                        value={newCatName}
                        onChange={e => setNewCatName(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleCreateCategory}
                        disabled={creatingCat || !newCatName.trim()}
                        style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: creatingCat || !newCatName.trim() ? 'rgba(99,102,241,0.3)' : '#6366f1', color: 'white', fontWeight: '700', cursor: creatingCat || !newCatName.trim() ? 'not-allowed' : 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                      >
                        {creatingCat ? '...' : 'Oluştur'}
                      </button>
                    </div>
                  ) : (
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
                  )}
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
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: '700' }}>Kategori:</span>
                          <select
                            value={pendingCat[src.id] !== undefined ? pendingCat[src.id] : (src.category_id ?? '')}
                            onChange={e => setPendingCat(p => ({ ...p, [src.id]: e.target.value }))}
                            style={{ ...inputStyle, width: 'auto', padding: '5px 10px', fontSize: '0.78rem', cursor: 'pointer' }}
                          >
                            <option value="">— Kategorisiz —</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
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

            {/* Kullanıcı Yönetimi */}
            <div style={{ marginTop: '3rem' }}>
              <h2 style={{ margin: '0 0 1.25rem', color: 'white', fontSize: '1.4rem', fontWeight: '800' }}>👥 Kullanıcılar ({users.length})</h2>
              {users.length === 0 ? (
                <div style={{ background: 'rgba(15,23,42,0.3)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '18px', padding: '2.5rem', textAlign: 'center' }}>
                  <p style={{ color: '#475569', margin: 0 }}>Kullanıcı bulunamadı.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {users.map(u => (
                    <div key={u.id} style={cardStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <p style={{ margin: 0, color: 'white', fontWeight: '700', fontSize: '0.95rem' }}>{u.username}</p>
                          {u.is_admin && (
                            <span style={{ fontSize: '0.68rem', fontWeight: '800', color: '#818cf8', background: 'rgba(99,102,241,0.12)', padding: '2px 8px', borderRadius: '6px' }}>ADMIN</span>
                          )}
                        </div>
                        <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.8rem' }}>{u.email}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button
                          onClick={() => handleToggleAdmin(u.id)}
                          disabled={userProcessing === u.id}
                          style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: '700', cursor: userProcessing === u.id ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: userProcessing === u.id ? 0.5 : 1 }}
                        >{u.is_admin ? 'Adminliği al' : 'Admin yap'}</button>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.username)}
                          disabled={userProcessing === u.id}
                          style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: '700', cursor: userProcessing === u.id ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: userProcessing === u.id ? 0.5 : 1 }}
                        >Sil</button>
                      </div>
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
