import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  // --- TOAST SİSTEMİ (BOZMADAN EKLENDİ) ---
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        setToast((prev) => ({ ...prev, show: false }));
      }, 2000); // Tam 2 saniye sonra kapanır
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLogin) {
      const formData = new FormData();
      formData.append('username', username);
      formData.append('password', password);

      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
          method: 'POST',
          body: formData,
          credentials: 'include', 
        });

        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('token', data.access_token);
          
          const userResponse = await fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
          });
          const userData = await userResponse.json();
          localStorage.setItem('user', JSON.stringify(userData));

          if (userData.interests && userData.interests.length > 0) {
            navigate('/home');
          } else {
            navigate('/onboarding');
          }
        } else {
          showToast("Giriş başarısız! Bilgilerini kontrol et.", "error");
        }
      } catch (error) {
        showToast("Sunucuya bağlanılamadı.", "error");
      }
    } else {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password }),
        });

        if (response.ok) {
          showToast("Kayıt başarılı! Şimdi giriş yapabilirsin.", "success");
          setIsLogin(true);
        } else {
          const errorData = await response.json();
          showToast(errorData.detail || "Kayıt sırasında bir hata oluştu.", "error");
        }
      } catch (error) {
        showToast("Bağlantı hatası yaşandı.", "error");
      }
    }
  };

  // Senin çok beğendiğin o başarılı tasarım objeleri
  const styles = {
    container: {
      position: 'absolute', top: 0, left: 0, margin: 0, padding: 0, // Çerçeveyi yok eden sihirli dokunuş
      width: '100vw', height: '100vh', overflow: 'hidden', // Ekrandan taşmasını engeller
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
      color: 'white', fontSize: '1rem', outline: 'none', transition: 'all 0.3s ease',
    },
    button: {
      width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
      background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
      color: 'white', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
      marginTop: '1rem', boxShadow: '0 10px 15px -3px rgba(99, 102, 241, 0.3)',
      transition: 'transform 0.2s',
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
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>
        <span>{toast.type === 'success' ? '✨' : '⚠️'}</span>
        {toast.message}
      </div>

      <div style={styles.glassCard}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: '700', color: 'white', margin: 0 }}>
            {isLogin ? 'Hoş Geldiniz' : 'Aramıza Katıl'}
          </h2>
          <p style={{ color: '#94a3b8', marginTop: '1.25rem', fontSize: '0.9rem' }}>
            {isLogin ? 'Kişiselleştirilmiş haber bültenin ve podcastlerin burada' : 'Kişisel haber akışını oluşturmaya başla'}
          </p>
        </div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ textAlign: 'left' }}>
            <label style={{ color: '#cbd5e1', fontSize: '0.85rem', marginLeft: '4px', marginBottom: '6px', display: 'block' }}>Kullanıcı Adı</label>
            <input
              type="text"
              placeholder={isLogin ? "Kullanıcı adın" : "Yeni kullanıcı adın"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={styles.input}
            />
          </div>
          
          {!isLogin && (
            <div style={{ textAlign: 'left' }}>
              <label style={{ color: '#cbd5e1', fontSize: '0.85rem', marginLeft: '4px', marginBottom: '6px', display: 'block' }}>E-posta Adresi</label>
              <input
                type="email"
                placeholder="ornek@mail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={styles.input}
              />
            </div>
          )}
          
          <div style={{ textAlign: 'left' }}>
            <label style={{ color: '#cbd5e1', fontSize: '0.85rem', marginLeft: '4px', marginBottom: '6px', display: 'block' }}>Şifre</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={styles.input}
            />
          </div>
          
          <button
            type="submit"
            style={styles.button}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; e.currentTarget.style.boxShadow = 'none'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(99, 102, 241, 0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(99, 102, 241, 0.3)'; }}
          >
            {isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '2rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          {isLogin ? 'Hesabın yok mu?' : 'Zaten üye misin?'} 
          <span onClick={() => setIsLogin(!isLogin)} style={{ color: '#818cf8', cursor: 'pointer', marginLeft: '8px', fontWeight: 'bold' }}>
            {isLogin ? 'Kayıt Ol' : 'Giriş Yap'}
          </span>
        </p>
      </div>
    </div>
  );
}

export default Auth;