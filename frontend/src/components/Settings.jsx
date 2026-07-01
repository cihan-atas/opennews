import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';
import { groupCategories } from '../Utils/categoryTree';

// Bir alanın show_when koşulu, mevcut seçim değerlerine göre sağlanıyor mu?
function fieldVisible(field, draft) {
  const cond = field.show_when;
  if (!cond) return true;
  return (cond.in || []).includes(draft[cond.field]);
}

// Admin'e özel: API anahtarları & sağlayıcı ayarları (kategorilere ayrılmış).
// Şema backend'den (GET /admin/settings) gelir; yalnızca değişen alanlar PUT edilir.
function ApiKeysManager({ isMobile, showToast }) {
  const [groups, setGroups] = useState([]);
  const [draft, setDraft] = useState({});          // key -> düzenlenmiş değer
  const [secretSet, setSecretSet] = useState({});  // key -> gizli anahtar kayıtlı mı
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/settings`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const initial = {};
      const secrets = {};
      (data.groups || []).forEach(g => g.fields.forEach(f => {
        initial[f.key] = f.secret ? '' : (f.value ?? '');   // gizli alan boş başlar
        if (f.secret) secrets[f.key] = !!f.is_set;
      }));
      setGroups(data.groups || []);
      setDraft(initial);
      setSecretSet(secrets);
    } catch (_) {
      showToast('API ayarları yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const setVal = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    // Payload: görünür alanları gönder. Gizli alanlarda yalnızca kullanıcı yeni değer
    // yazdıysa (boş değilse) gönder — boş = "dokunma".
    const values = {};
    groups.forEach(g => g.fields.forEach(f => {
      if (!fieldVisible(f, draft)) return;
      const v = draft[f.key] ?? '';
      if (f.secret) { if (v !== '') values[f.key] = v; }
      else { values[f.key] = v; }
    }));
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error();
      showToast('API ayarları kaydedildi.', 'success');
      await load();
    } catch (_) {
      showToast('Kaydedilemedi.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const s = {
    section: { background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '28px', padding: isMobile ? '1.5rem' : '2.5rem', gridColumn: isMobile ? 'auto' : 'span 2' },
    group: { marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
    groupHead: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' },
    badgeReq: { fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.5px', color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '3px 8px' },
    badgeOpt: { fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.5px', color: '#94a3b8', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '8px', padding: '3px 8px' },
    note: { color: '#94a3b8', fontSize: '0.85rem', margin: '4px 0 16px', lineHeight: 1.5 },
    label: { display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: '6px' },
    help: { color: '#64748b', fontSize: '0.72rem', marginTop: '4px' },
    input: { width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(2,6,23,0.5)', color: 'white', outline: 'none', boxSizing: 'border-box' },
    field: { marginBottom: '14px' },
  };

  if (loading) return <div style={s.section}><p style={{ color: '#94a3b8' }}>API ayarları yükleniyor…</p></div>;

  return (
    <div style={s.section}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.6rem' }}>🔑 API Anahtarları & Sağlayıcılar</h3>
      <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 0, marginBottom: '2rem' }}>
        Kendi anahtarlarını gir — podcast'lerin senin anahtarlarınla üretilir. Her kategoride bir sağlayıcı seç ve <strong style={{ color: '#cbd5e1' }}>sadece onun</strong> anahtarını gir.
        Boş bıraktığın alanlar sistemin varsayılanına düşer. Kırmızı <span style={{ color: '#fca5a5' }}>ZORUNLU</span> kategoriler podcast için gereklidir; diğerleri opsiyoneldir.
      </p>

      {groups.map(g => (
        <div key={g.id} style={s.group}>
          <div style={s.groupHead}>
            <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{g.icon} {g.title}</span>
            <span style={g.required ? s.badgeReq : s.badgeOpt}>{g.required ? 'ZORUNLU' : 'OPSİYONEL'}</span>
          </div>
          {g.note && <p style={s.note}>{g.note}</p>}

          {g.fields.filter(f => fieldVisible(f, draft)).map(f => (
            <div key={f.key} style={s.field}>
              <label style={s.label}>
                {f.label}{f.required ? ' *' : ''}
                {f.help && (
                  <span
                    title={f.help}
                    onClick={() => { if (f.help_url) window.open(f.help_url, '_blank', 'noopener'); else alert(f.help); }}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', border: '1px solid #818cf8', color: '#818cf8', fontSize: '0.65rem', fontWeight: 800, marginLeft: '8px', cursor: 'pointer' }}
                  >i</span>
                )}
                {f.secret && secretSet[f.key] && <span style={{ color: '#34d399', fontWeight: 600, marginLeft: '8px', fontSize: '0.72rem' }}>● kayıtlı</span>}
              </label>
              {f.type === 'select' ? (
                <select style={s.input} value={draft[f.key] ?? ''} onChange={e => setVal(f.key, e.target.value)}>
                  {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  style={s.input}
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={draft[f.key] ?? ''}
                  placeholder={f.secret && secretSet[f.key] ? '•••••••• (değiştirmek için yaz)' : ''}
                  autoComplete="off"
                  onChange={e => setVal(f.key, e.target.value)}
                />
              )}
              {f.help && <div style={s.help}>{f.help}</div>}
            </div>
          ))}
        </div>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ width: '100%', maxWidth: '400px', padding: '14px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)', color: 'white', fontWeight: 'bold', cursor: saving ? 'not-allowed' : 'pointer', boxShadow: '0 10px 20px -5px rgba(99, 102, 241, 0.3)' }}
      >
        {saving ? 'Kaydediliyor…' : 'API Ayarlarını Kaydet'}
      </button>
    </div>
  );
}

function Settings() {
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [allCategories, setAllCategories] = useState([]);
  const groupedCategories = useMemo(() => groupCategories(allCategories), [allCategories]);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [isPasswordUpdating, setIsPasswordUpdating] = useState(false);
  const [isInterestsUpdating, setIsInterestsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Şifre State'leri
  const [passwordData, setPasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: ''
  });

  // --- HESAP SİLME STATE'İ (YENİ EKLENDİ) ---
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [stats, setStats] = useState(null);

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

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const userRes = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/me`);
      if (userRes.ok) {
        const userData = await userRes.json();
        setUsername(userData.username);
        setEmail(userData.email);
        setIsAdmin(!!userData.is_admin);
        setSelectedInterests(userData.interests.map(i => i.id));
      }

      const catRes = await fetch(`${import.meta.env.VITE_API_URL}/categories/`);
      if (catRes.ok) {
        const catData = await catRes.json();
        setAllCategories(catData);
      }

      const statsRes = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/stats`);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (_) {
      showToast("Veriler yüklenirken bir sorun oluştu.", "error");
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwordData.new_password !== passwordData.confirm_password) {
      showToast("Yeni şifreler eşleşmiyor!", "error");
      return;
    }
    setIsPasswordUpdating(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/change-password`, {
        method: 'PUT',
        body: JSON.stringify({
          old_password: passwordData.old_password,
          new_password: passwordData.new_password,
          new_password_confirm: passwordData.confirm_password
        })
      });
      if (res.ok) {
        showToast("Şifreniz başarıyla güncellendi.", "success");
        setPasswordData({ old_password: '', new_password: '', confirm_password: '' });
      } else {
        const err = await res.json();
        showToast(err.detail || "Hata oluştu.", "error");
      }
    } catch (_) { showToast("Bağlantı hatası.", "error"); }
    finally { setIsPasswordUpdating(false); }
  };

  const handleUpdateInterests = async () => {
    if (selectedInterests.length < 2) {
      showToast("En az 2 kategori seçmelisin!", "error");
      return;
    }
    setIsInterestsUpdating(true);
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/interests`, {
        method: 'POST',
        body: JSON.stringify({ category_ids: selectedInterests })
      });
      if (res.ok) showToast("İlgi alanların güncellendi!", "success");
      else showToast("Güncellenemedi.", "error");
    } catch (_) { showToast("Bağlantı hatası.", "error"); }
    finally { setIsInterestsUpdating(false); }
  };

  const toggleCategory = (id) => {
    setSelectedInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // --- HESAP SİLME İŞLEMİ (YENİ EKLENDİ) ---
  const confirmDeleteAccount = async () => {
    setIsDeleting(true);
    const token = localStorage.getItem('token');
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      localStorage.removeItem('token');
      navigate('/auth');
    } catch (_) {
      setIsDeleting(false);
      setShowDeleteModal(false);
      showToast("Hesap silinirken bir hata oluştu.", "error");
    }
  };

  const styles = {
    container: { backgroundColor: '#020617', color: '#f1f5f9', minHeight: '100vh', fontFamily: "'Inter', sans-serif" },
    main: { maxWidth: '1100px', margin: '0 auto', padding: '4rem 2rem' },
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '30px' },
    section: { 
      background: 'rgba(15, 23, 42, 0.6)', 
      border: '1px solid rgba(255,255,255,0.05)', 
      borderRadius: '28px', 
      padding: '3rem', 
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center'
    },
    input: { 
      width: '100%', maxWidth: '400px', padding: '14px 18px', borderRadius: '14px', marginBottom: '15px', 
      border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(2, 6, 23, 0.5)', color: 'white', 
      outline: 'none', transition: 'all 0.3s',
    },
    button: { 
      width: '100%', maxWidth: '400px', padding: '14px', borderRadius: '14px', border: 'none', 
      background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)', color: 'white', fontWeight: 'bold', 
      cursor: 'pointer', boxShadow: '0 10px 20px -5px rgba(99, 102, 241, 0.3)', transition: 'all 0.3s'
    },
    chip: (isSelected) => ({ padding: '10px 20px', margin: '5px', borderRadius: '14px', cursor: 'pointer', border: '1px solid', borderColor: isSelected ? '#818cf8' : 'rgba(255,255,255,0.1)', backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.3)', color: isSelected ? '#fff' : '#94a3b8', fontSize: '0.9rem', transition: 'all 0.2s' }),
    toast: { position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)', backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: toast.type === 'success' ? '#10b981' : '#ef4444', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`, backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px', zIndex: 10000, transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', opacity: toast.show ? 1 : 0 },
    
    // MODAL STİLLERİ
    modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
    modalBox: (borderColor) => ({ background: 'rgba(15, 23, 42, 0.95)', border: `1px solid ${borderColor}`, padding: '3rem', borderRadius: '32px', maxWidth: '440px', textAlign: 'center', boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.5)', position: 'relative' })
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}><span>{toast.type === 'success' ? '✨' : '⚠️'}</span> {toast.message}</div>
      
      <div style={styles.main}>
        <h1 style={{ fontSize: isMobile ? '2rem' : '3rem', fontWeight: '900', marginBottom: '3rem', letterSpacing: '-1.5px', textAlign: 'left' }}>Ayarlar</h1>
        
        <div style={styles.grid}>
          {/* PROFİL BİLGİSİ */}
          <div style={{ ...styles.section, gridColumn: isMobile ? 'auto' : 'span 2', alignItems: 'flex-start', textAlign: 'left' }}>
            <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.6rem' }}>👤 Profil Bilgileri</h3>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '1.5rem' : '60px', width: '100%' }}>
              <div><label style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase' }}>Kullanıcı Adı</label><p style={{ margin: '8px 0', fontSize: '1.3rem', fontWeight: '600' }}>{username}</p></div>
              <div><label style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase' }}>E-posta Adresi</label><p style={{ margin: '8px 0', fontSize: '1.3rem', fontWeight: '600' }}>{email}</p></div>
            </div>
          </div>

          {/* API ANAHTARLARI (herkes kendi anahtarını girer) */}
          <ApiKeysManager isMobile={isMobile} showToast={showToast} />

          {/* İSTATİSTİKLER */}
          {stats && (
            <div style={{ ...styles.section, gridColumn: isMobile ? 'auto' : 'span 2', alignItems: 'flex-start', textAlign: 'left' }}>
              <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.6rem' }}>📊 İstatistiklerim</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: '16px', width: '100%' }}>
                {[
                  { label: 'Toplam Haber', value: stats.articles_read, icon: '📰' },
                  { label: 'Bu Hafta', value: stats.week_reads, icon: '📅' },
                  { label: 'Podcast', value: stats.podcasts_count, icon: '🎙️' },
                  { label: 'Kaydedilen', value: stats.bookmarks_count, icon: '🔖' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '16px', padding: '20px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>{item.icon}</div>
                    <div style={{ fontSize: '2rem', fontWeight: '900', color: '#818cf8', lineHeight: 1 }}>{item.value}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '6px' }}>{item.label}</div>
                  </div>
                ))}
              </div>
              {stats.favorite_category && (
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '16px' }}>
                  En çok okuduğun kategori: <span style={{ color: '#818cf8', fontWeight: '700' }}>{stats.favorite_category}</span>
                </p>
              )}
            </div>
          )}

          {/* ŞİFRE DEĞİŞTİRME */}
          <div style={styles.section}>
            <h3 style={{ margin: '0 0 2rem 0', fontSize: '1.6rem' }}>🔐 Güvenlik</h3>
            <form onSubmit={handlePasswordChange} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <input type="password" placeholder="Mevcut Şifre" required style={styles.input} value={passwordData.old_password} onChange={e => setPasswordData({...passwordData, old_password: e.target.value})} />
              <input type="password" placeholder="Yeni Şifre" required style={styles.input} value={passwordData.new_password} onChange={e => setPasswordData({...passwordData, new_password: e.target.value})} />
              <input type="password" placeholder="Yeni Şifre (Tekrar)" required style={styles.input} value={passwordData.confirm_password} onChange={e => setPasswordData({...passwordData, confirm_password: e.target.value})} />
              <button type="submit" disabled={isPasswordUpdating} style={styles.button}>
                {isPasswordUpdating ? 'İşleniyor...' : 'Şifreyi Güncelle'}
              </button>
            </form>
          </div>

          {/* İLGİ ALANLARI */}
          <div style={styles.section}>
            <h3 style={{ margin: '0 0 2rem 0', fontSize: '1.6rem' }}>🎯 Haber Tercihleri</h3>
            <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
              {groupedCategories.map(group => (
                <div key={group.id} style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ color: '#818cf8', fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{group.name}</span>
                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {[group, ...group.children].map(cat => (
                      <div key={cat.id} onClick={() => toggleCategory(cat.id)} style={styles.chip(selectedInterests.includes(cat.id))}>{cat.name}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            {/* 🔥 GÖRSEL OLARAK DA DEVRE DIŞI KALAN YENİ BUTON */}
            <button 
              onClick={handleUpdateInterests} 
              disabled={isInterestsUpdating || selectedInterests.length < 2} 
              style={{ 
                ...styles.button, 
                background: 'transparent', 
                border: selectedInterests.length < 2 ? '2px solid rgba(255,255,255,0.1)' : '2px solid #6366f1', 
                color: selectedInterests.length < 2 ? '#64748b' : '#818cf8', 
                cursor: selectedInterests.length < 2 ? 'not-allowed' : 'pointer',
                boxShadow: 'none',
                transition: 'all 0.3s'
              }}
              onMouseOver={e => { if(selectedInterests.length >= 2 && !isInterestsUpdating) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)' }}
              onMouseOut={e => { if(selectedInterests.length >= 2 && !isInterestsUpdating) e.currentTarget.style.background = 'transparent' }}
            >
              {isInterestsUpdating ? 'Kaydediliyor...' : 'Kategorileri Kaydet'}
            </button>
          </div>

          {/* YENİ: TEHLİKE BÖLGESİ (HESAP SİLME) */}
          <div style={{ ...styles.section, gridColumn: isMobile ? 'auto' : 'span 2', borderColor: 'rgba(239, 68, 68, 0.2)', backgroundColor: 'rgba(239, 68, 68, 0.05)', alignItems: 'center' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.6rem', color: '#ef4444' }}>⚠️ Tehlike Bölgesi</h3>
            <p style={{ color: '#94a3b8', marginBottom: '2rem', maxWidth: '600px', fontSize: '1.05rem', lineHeight: '1.6' }}>
              Hesabını sildiğinde haber akışın, podcastlerin ve tüm verilerin <strong>kalıcı olarak</strong> silinecektir. Bu işlem geri alınamaz.
            </p>
            <button 
              onClick={() => setShowDeleteModal(true)} 
              style={{ padding: '14px 32px', borderRadius: '14px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.3s' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              Hesabımı Kalıcı Olarak Sil
            </button>
          </div>
        </div>
      </div>

      {/* --- HESAP SİLME ONAY MODALI --- */}
      {showDeleteModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox('rgba(239, 68, 68, 0.3)')}>
            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>⚠️</div>
            <h2 style={{ color: 'white', fontSize: '1.8rem', marginBottom: '10px', fontWeight: '800' }}>Veda Mı Ediyoruz?</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: '1.6', marginBottom: '2rem' }}>
              Hesabını sildiğinde tüm verilerin <strong>kalıcı olarak</strong> silinecek. Bu işlem geri alınamaz. Emin misin?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowDeleteModal(false)} 
                disabled={isDeleting} 
                style={{ flex: 1, padding: '14px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                Vazgeç
              </button>
              <button 
                onClick={confirmDeleteAccount} 
                disabled={isDeleting} 
                style={{ flex: 1, padding: '14px', borderRadius: '14px', border: 'none', background: '#ef4444', color: 'white', fontWeight: 'bold', cursor: isDeleting ? 'not-allowed' : 'pointer', boxShadow: '0 10px 20px -5px rgba(239, 68, 68, 0.4)' }}
              >
                {isDeleting ? 'Siliniyor...' : 'Evet, Hesabımı Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;