import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../Utils/api';
import { useWindowSize } from '../Utils/useWindowSize';
import { useTheme } from '../contexts/ThemeContext';

function Sidebar({ isCollapsed = false, onToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { isMobile } = useWindowSize();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const dropdownRef = useRef(null);
  const accountBtnRef = useRef(null);

  // Close menu when sidebar toggles to prevent layout glitches
  useEffect(() => {
    setIsMenuOpen(false);
  }, [isCollapsed]);

  // Handle snapping shut on clicks outside dropdown and toggle button
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        isMenuOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        accountBtnRef.current &&
        !accountBtnRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMobile) setIsMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/me`);
        if (res.ok) {
          const data = await res.json();
          setUsername(data.full_name || data.username || 'Kullanıcı');
        }
      } catch (_) {}
    };
    fetchUser();
  }, []);

  const confirmLogout = () => {
    localStorage.removeItem('token');
    navigate('/auth');
  };

  const menuItems = [
    { name: 'Haber Akışı', path: '/home', icon: '🏠' },
    { name: 'Podcastlerim', path: '/podcasts', icon: '🎙️' },
    { name: 'Kaydedilenler', path: '/bookmarks', icon: '🔖' },
    { name: 'RSS Okuyucu', path: '/rss-reader', icon: '📡' },
  ];

  const styles = {
    sidebar: {
      width: isCollapsed ? '72px' : '280px', height: '100vh', position: 'fixed', left: 0, top: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRight: '1px solid rgba(255,255,255,0.05)',
      padding: isCollapsed ? '2rem 0.75rem' : '2rem 1.5rem',
      backdropFilter: 'blur(20px)', zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box',
      transform: isMobile ? (isMobileOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
      transition: 'transform 0.3s ease, width 0.3s ease, padding 0.3s ease',
      overflow: 'visible',
    },
    greetingBox: {
      background: 'rgba(255, 255, 255, 0.03)', padding: '14px 18px', borderRadius: '16px',
      marginBottom: '2rem', border: '1px solid rgba(255, 255, 255, 0.05)', 
      color: '#cbd5e1', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '10px'
    },
    logo: {
      fontSize: '1.6rem', fontWeight: '900', color: 'white', textDecoration: 'none',
      marginBottom: '3rem', display: 'block', paddingLeft: '0.5rem'
    },
    navItem: (isActive) => ({
      display: 'flex', alignItems: 'center', gap: isCollapsed ? 0 : '15px',
      padding: isCollapsed ? '14px 0' : '14px 20px',
      justifyContent: isCollapsed ? 'center' : 'flex-start',
      borderRadius: '16px', color: isActive ? 'white' : '#94a3b8',
      backgroundColor: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
      textDecoration: 'none', fontWeight: '700', marginBottom: '10px',
      transition: 'all 0.3s ease', border: isActive ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid transparent',
      whiteSpace: 'nowrap', overflow: 'hidden',
    }),
    accountBtn: {
      width: '100%', display: 'flex', alignItems: 'center',
      justifyContent: isCollapsed ? 'center' : 'space-between',
      padding: isCollapsed ? '16px 0' : '16px 20px',
      borderRadius: '16px', background: 'rgba(99, 102, 241, 0.1)',
      color: 'white', border: '1px solid rgba(99, 102, 241, 0.3)', cursor: 'pointer',
      fontWeight: 'bold', transition: 'all 0.3s ease',
      whiteSpace: 'nowrap', overflow: 'hidden',
    },
    dropdown: {
      position: 'absolute',
      bottom: 'calc(100% + 10px)', 
      left: 0,
      width: '100%',
      backgroundColor: 'rgba(30, 41, 59, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '16px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '5px',
      boxShadow: '0 -10px 30px rgba(0,0,0,0.5)', zIndex: 1001, boxSizing: 'border-box'
    },
    modalOverlay: {
      position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.85)',
      backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center',
      alignItems: 'center', zIndex: 9999
    }
  };

  return (
    <>
      {isMobile && !isMobileOpen && (
        <button
          onClick={() => setIsMobileOpen(true)}
          style={{ position: 'fixed', top: '20px', left: '20px', zIndex: 1001, background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px 14px', cursor: 'pointer', color: 'white', fontSize: '1.2rem', backdropFilter: 'blur(10px)', lineHeight: 1 }}
        >
          ☰
        </button>
      )}
      {isMobile && isMobileOpen && (
        <div onClick={() => setIsMobileOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.7)', backdropFilter: 'blur(4px)', zIndex: 999 }} />
      )}
      <aside style={styles.sidebar}>
        {isMobile && (
          <button onClick={() => setIsMobileOpen(false)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', zIndex: 1 }}>✕</button>
        )}
        {!isMobile && (
          <button
            onClick={onToggle}
            title={isCollapsed ? 'Genişlet' : 'Küçült'}
            style={{ position: 'absolute', top: '1.5rem', right: '-12px', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.4)', color: '#818cf8', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, boxShadow: '0 2px 8px rgba(0,0,0,0.4)', transition: 'all 0.2s' }}
          >
            {isCollapsed ? '›' : '‹'}
          </button>
        )}
        {!isCollapsed && (
          <div style={styles.greetingBox}>
            <span style={{ fontSize: '1.2rem' }}>👋</span>
            <span>Merhaba, <span style={{ color: '#818cf8', fontWeight: '800' }}>{username}</span></span>
          </div>
        )}

        <Link to="/home" style={{ ...styles.logo, textAlign: isCollapsed ? 'center' : 'left', paddingLeft: isCollapsed ? 0 : '0.5rem', marginBottom: isCollapsed ? '1.5rem' : '3rem' }}>
          🌐{!isCollapsed && ' NewsFlow'}
        </Link>
        
        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', marginBottom: '1rem' }}>
          {menuItems.map(item => (
            <Link key={item.path} to={item.path} onClick={() => isMobile && setIsMobileOpen(false)} title={isCollapsed ? item.name : ''} style={styles.navItem(location.pathname === item.path)}>
              <span style={{ fontSize: '1.3rem' }}>{item.icon}</span>
              {!isCollapsed && item.name}
            </Link>
          ))}
        </nav>

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '10px', width: '100%', padding: isCollapsed ? '12px 0' : '12px 16px', marginBottom: '8px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: '#94a3b8', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem', transition: '0.2s' }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
          onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
        >
          <span style={{ fontSize: '1rem' }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
          {!isCollapsed && (theme === 'dark' ? 'Açık Tema' : 'Koyu Tema')}
        </button>

        <div style={{ position: 'relative', marginTop: 0 }}>
          {isMenuOpen && (
            <div ref={dropdownRef} style={styles.dropdown}>
              <button title="Ayarlar" onClick={() => { navigate('/settings'); setIsMenuOpen(false); }} style={{ background: 'transparent', color: 'white', border: 'none', padding: '14px', textAlign: 'center', cursor: 'pointer', fontWeight: '600', borderRadius: '10px', transition: '0.2s', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '8px', alignItems: 'center' }} onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.05)'} onMouseOut={e => e.currentTarget.style.background='transparent'}>
                <span>⚙️</span> {!isCollapsed && <span>Ayarlar</span>}
              </button>
              <button title="Çıkış Yap" onClick={() => { setShowLogoutModal(true); setIsMenuOpen(false); }} style={{ background: 'transparent', color: '#ef4444', border: 'none', padding: '14px', textAlign: 'center', cursor: 'pointer', fontWeight: '600', borderRadius: '10px', transition: '0.2s', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '8px', alignItems: 'center' }} onMouseOver={e => e.currentTarget.style.background='rgba(239, 68, 68, 0.1)'} onMouseOut={e => e.currentTarget.style.background='transparent'}>
                <span>🚪</span> {!isCollapsed && <span>Çıkış Yap</span>}
              </button>
            </div>
          )}
          <button ref={accountBtnRef} onClick={() => setIsMenuOpen(!isMenuOpen)} title={isCollapsed ? 'Hesabım' : ''} style={styles.accountBtn}>
            {isCollapsed ? (
              <span style={{ fontSize: '1.2rem' }}>👤</span>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.2rem' }}>👤</span> Hesabım
                </div>
                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{isMenuOpen ? '▼' : '▲'}</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* SADECE METNİ VE RUHU GÜZELLEŞTİRİLMİŞ, ABARTISIZ MODAL */}
      {showLogoutModal && (
        <div style={styles.modalOverlay}>
          <div style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '3rem', borderRadius: '32px', textAlign: 'center', maxWidth: '420px', boxShadow: '0 30px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🚀</div>
            <h2 style={{ color: 'white', fontSize: '1.8rem', marginBottom: '10px', fontWeight: '800' }}>Hattan Ayrılıyor Musun?</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: '1.5', marginBottom: '2.5rem' }}>
              Kişisel haber akışını ve podcastlerini burada bırakıyorsun. Çıkış yapmak istediğine emin misin?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowLogoutModal(false)} 
                style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white', fontWeight: '600', cursor: 'pointer' }}
              >
                Akışa Dön
              </button>
              <button 
                onClick={confirmLogout} 
                style={{ flex: 1, padding: '14px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Evet, Çıkış Yap
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;