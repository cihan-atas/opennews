import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ show: true, message, type });

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast((p) => ({ ...p, show: false })), 2500);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      showToast("Bağlantı geçersiz, e-postadaki linki kullan.", "error");
      return;
    }
    if (password.length < 6) {
      showToast("Şifre en az 6 karakter olmalı.", "error");
      return;
    }
    if (password !== confirm) {
      showToast("Şifreler eşleşmiyor.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (response.ok) {
        showToast("Şifren güncellendi! Giriş ekranına yönlendiriliyorsun.", "success");
        setTimeout(() => navigate('/auth'), 1800);
      } else {
        const data = await response.json().catch(() => null);
        showToast(data?.detail || "Bağlantı geçersiz veya süresi dolmuş.", "error");
      }
    } catch (error) {
      showToast("Sunucuya bağlanılamadı.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const styles = {
    container: {
      position: 'absolute', top: 0, left: 0, margin: 0, padding: 0,
      width: '100vw', height: '100vh', overflow: 'hidden',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      backgroundColor: '#020617',
      backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(129, 140, 248, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(167, 139, 250, 0.1) 0%, transparent 50%)',
      fontFamily: "'Inter', sans-serif",
    },
    glassCard: {
      background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.1)', padding: '3rem',
      borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      width: '420px', maxWidth: 'calc(100vw - 2rem)', textAlign: 'center', boxSizing: 'border-box',
    },
    input: {
      width: '100%', padding: '14px 16px', borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.1)', backgroundColor: 'rgba(2, 6, 23, 0.5)',
      color: 'white', fontSize: '1rem', outline: 'none', transition: 'all 0.3s ease', boxSizing: 'border-box',
    },
    button: {
      width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
      background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
      color: 'white', fontWeight: 'bold', fontSize: '1rem', cursor: submitting ? 'wait' : 'pointer',
      marginTop: '1rem', boxShadow: '0 10px 15px -3px rgba(99, 102, 241, 0.3)', opacity: submitting ? 0.7 : 1,
    },
    toast: {
      position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
      color: toast.type === 'success' ? '#10b981' : '#ef4444',
      border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
      backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px',
      display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '600',
      boxShadow: '0 20px 40px rgba(0,0,0,0.4)', zIndex: 9999,
      transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', opacity: toast.show ? 1 : 0,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>
        <span>{toast.type === 'success' ? '✨' : '⚠️'}</span>
        {toast.message}
      </div>

      <div style={styles.glassCard}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: '700', color: 'white', margin: 0 }}>Yeni Şifre Belirle</h2>
          <p style={{ color: '#94a3b8', marginTop: '1.25rem', fontSize: '0.9rem' }}>
            Yeni şifreni gir ve onayla
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ textAlign: 'left' }}>
            <label style={{ color: '#cbd5e1', fontSize: '0.85rem', marginLeft: '4px', marginBottom: '6px', display: 'block' }}>Yeni Şifre</label>
            <input type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)} required style={styles.input} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <label style={{ color: '#cbd5e1', fontSize: '0.85rem', marginLeft: '4px', marginBottom: '6px', display: 'block' }}>Yeni Şifre (Tekrar)</label>
            <input type="password" placeholder="••••••••" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required style={styles.input} />
          </div>
          <button type="submit" disabled={submitting} style={styles.button}>
            {submitting ? 'Güncelleniyor…' : 'Şifreyi Güncelle'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '2rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          <span onClick={() => navigate('/auth')} style={{ color: '#818cf8', cursor: 'pointer', fontWeight: 'bold' }}>
            ← Giriş ekranına dön
          </span>
        </p>
      </div>
    </div>
  );
}

export default ResetPassword;
