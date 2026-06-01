import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { fetchWithAuth } from './Utils/api';
import Sidebar from './components/Sidebar';
import { useWindowSize } from './Utils/useWindowSize';
import Home from './components/Home';
import Podcast from './components/Podcast';
import Settings from './components/Settings';
import Auth from './components/Auth';
import ResetPassword from './components/ResetPassword';
import Onboarding from './components/Onboarding';
import Bookmarks from './components/Bookmarks';
import ReadLater from './components/ReadLater';
import RssReader from './components/RssReader';
import Dashboard from './components/Dashboard';
import Admin from './components/Admin';
import AudioPlayer from './components/AudioPlayer';
import { PlayerProvider, usePlayer } from './contexts/PlayerContext';
import { ThemeProvider } from './contexts/ThemeContext';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/auth" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const token = localStorage.getItem('token');
  if (token) {
    return <Navigate to="/home" replace />;
  }
  return children;
}

// Admin-only rota koruması. Önce localStorage'daki kullanıcıyı hızlıca okur, ardından
// /users/me ile backend'den doğrular (yetkili kaynak). Admin değilse /home'a yönlendirir.
function AdminRoute({ children }) {
  const cached = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();
  // null = doğrulanıyor, true/false = sonuç
  const [allowed, setAllowed] = useState(cached?.is_admin === true ? true : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/users/me`);
        if (!res.ok) throw new Error('unauth');
        const data = await res.json();
        localStorage.setItem('user', JSON.stringify(data));
        if (!cancelled) setAllowed(!!data.is_admin);
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', color: 'var(--muted, #94a3b8)' }}>
        Yetki kontrol ediliyor…
      </div>
    );
  }
  if (!allowed) return <Navigate to="/home" replace />;
  return children;
}

function GlobalPlayer() {
  const { track, clearTrack, playNext, playPrev, hasNext, hasPrev } = usePlayer();
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  if (!track) return null;
  return (
    <AudioPlayer
      src={track.src}
      title={track.title}
      categoryName={track.category}
      podcastId={track.podcastId}
      onClose={clearTrack}
      onNavigate={() => navigate('/podcasts')}
      onNext={hasNext ? playNext : undefined}
      onPrev={hasPrev ? playPrev : undefined}
      onEnded={hasNext ? playNext : undefined}
      floating
      autoPlay={track.autoPlay}
      isMobile={isMobile}
    />
  );
}

function AppLayout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { isMobile } = useWindowSize();
  const sidebarWidth = isSidebarCollapsed ? '72px' : '280px';

  return (
    <div style={{
      backgroundColor: 'var(--bg, #020617)', minHeight: '100vh', width: '100%',
      position: 'relative', top: 0, left: 0, margin: 0, padding: 0,
      display: 'flex', overflowX: 'hidden'
    }}>
      <Sidebar isCollapsed={isSidebarCollapsed} onToggle={() => setIsSidebarCollapsed(p => !p)} />

      <div style={{
        marginLeft: isMobile ? 0 : sidebarWidth,
        transition: 'margin-left 0.3s ease',
        flex: 1,
        display: 'flex', flexDirection: 'column', minHeight: '100vh',
        minWidth: 0
      }}>
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="/podcasts" element={<Podcast />} />
            <Route path="/bookmarks" element={<Bookmarks />} />
            <Route path="/read-later" element={<ReadLater />} />
            <Route path="/rss-reader" element={<RssReader />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </main>
      </div>

      <GlobalPlayer />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
    <PlayerProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth"
            element={
              <PublicRoute>
                <Auth />
              </PublicRoute>
            }
          />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route 
            path="/onboarding" 
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="*" 
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </BrowserRouter>
    </PlayerProvider>
    </ThemeProvider>
  );
}

export default App;
