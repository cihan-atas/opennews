import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { useWindowSize } from './Utils/useWindowSize';
import Home from './components/Home';
import Podcast from './components/Podcast';
import Settings from './components/Settings';
import Auth from './components/Auth';
import Onboarding from './components/Onboarding';
import Bookmarks from './components/Bookmarks';
import RssReader from './components/RssReader';
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

function GlobalPlayer() {
  const { track, clearTrack } = usePlayer();
  const navigate = useNavigate();
  const { isMobile } = useWindowSize();
  if (!track) return null;
  return (
    <AudioPlayer
      src={track.src}
      title={track.title}
      categoryName={track.category}
      onClose={clearTrack}
      onNavigate={() => navigate('/podcasts')}
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
            <Route path="/podcasts" element={<Podcast />} />
            <Route path="/bookmarks" element={<Bookmarks />} />
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
