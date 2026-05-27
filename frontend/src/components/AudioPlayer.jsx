import { useState, useEffect, useRef, useCallback } from 'react';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Reusable custom audio player.
 *
 * Props:
 *   src          – audio URL (changing it reloads the player)
 *   title        – shown in floating mode header
 *   categoryName – shown as subtitle in floating mode
 *   onClose      – if provided, renders an ✕ button
 *   onNavigate   – if provided, renders a "Kütüphane →" button
 *   floating     – if true renders position:fixed at bottom-center
 *   isMobile     – passed down from parent for responsive offsets
 */
function AudioPlayer({ src, title, categoryName, onClose, onNavigate, floating = false, isMobile = false, autoPlay = false }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(2); // default 1×
  const speed = SPEEDS[speedIdx];
  const [isMuted, setIsMuted] = useState(false);

  // ── Drag state for floating mode ──
  const [dragPos, setDragPos] = useState(null); // { x, y } when user has dragged
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const wrapRef = useRef(null);

  const handleDragStart = useCallback((clientX, clientY) => {
    if (!floating || !wrapRef.current) return;
    isDragging.current = true;
    const rect = wrapRef.current.getBoundingClientRect();
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
    document.body.style.userSelect = 'none';
  }, [floating]);

  const handleDragMove = useCallback((clientX, clientY) => {
    if (!isDragging.current) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 100, clientX - dragOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 60, clientY - dragOffset.current.y));
    setDragPos({ x: newX, y: newY });
  }, []);

  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (!floating) return;
    const onMouseMove = (e) => handleDragMove(e.clientX, e.clientY);
    const onTouchMove = (e) => { if (e.touches[0]) handleDragMove(e.touches[0].clientX, e.touches[0].clientY); };
    const onEnd = () => handleDragEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [floating, handleDragMove, handleDragEnd]);

  // Reset drag position when src changes (new track)
  useEffect(() => { setDragPos(null); }, [src]);

  // Stop audio on unmount so no orphaned playback continues
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, []);

  // Reload when src changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    if (src && audioRef.current) {
      audioRef.current.load();
      audioRef.current.playbackRate = SPEEDS[speedIdx];
      if (autoPlay) audioRef.current.play().catch(() => {});
    }
  }, [src]);

  // Sync speed to audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speedIdx]);

  // Sync mute state
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isMuted;
  }, [isMuted]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    const onTime   = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => { if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration); };
    const onPlay   = () => setIsPlaying(true);
    const onPause  = () => setIsPlaying(false);
    const onEnded  = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onLoaded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onLoaded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    isPlaying ? audioRef.current.pause() : audioRef.current.play().catch(() => {});
  };

  const skip = (secs) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + secs));
  };

  const seek = (e) => {
    if (!duration || !audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  const cycleSpeed = () => setSpeedIdx(i => (i + 1) % SPEEDS.length);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  // Build wrapper style: if user has dragged, use absolute positioning via top/left
  const baseFloating = {
    position: 'fixed',
    width: isMobile ? 'calc(100% - 2rem)' : '460px',
    background: 'rgba(8, 12, 24, 0.97)',
    backdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
    borderRadius: '22px',
    padding: '16px 20px',
    zIndex: 9999,
    boxShadow: '0 28px 56px -12px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)',
    transition: isDragging.current ? 'none' : 'box-shadow 0.3s',
  };

  const wrapStyle = floating
    ? dragPos
      ? { ...baseFloating, left: `${dragPos.x}px`, top: `${dragPos.y}px` }
      : { ...baseFloating, bottom: '24px', ...(isMobile ? { left: '50%', transform: 'translateX(-50%)' } : { right: '32px' }) }
    : {
        width: '100%',
        background: 'rgba(2, 6, 23, 0.5)',
        border: '1px solid rgba(99, 102, 241, 0.12)',
        borderRadius: '16px',
        padding: '14px 16px',
        boxSizing: 'border-box',
      };

  const iconBtn = {
    background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer',
    fontSize: '0.65rem', fontWeight: '800', padding: '6px 8px', borderRadius: '8px',
    transition: '0.2s', letterSpacing: '-0.5px',
  };

  return (
    <div 
      ref={wrapRef} 
      style={{ ...wrapStyle, cursor: floating ? (isDragging.current ? 'grabbing' : 'grab') : 'default' }}
      onMouseDown={(e) => { 
        if (floating && e.target.tagName !== 'BUTTON' && !e.target.closest('button') && !e.target.closest('.no-drag')) {
          handleDragStart(e.clientX, e.clientY); 
        }
      }}
      onTouchStart={(e) => { 
        if (floating && e.target.tagName !== 'BUTTON' && !e.target.closest('button') && !e.target.closest('.no-drag') && e.touches[0]) {
          handleDragStart(e.touches[0].clientX, e.touches[0].clientY); 
        }
      }}
    >
      <audio ref={audioRef} src={src} style={{ display: 'none' }} />

      {/* Header — only in floating mode */}
      {floating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '40px', height: '40px', flexShrink: 0,
            background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
            borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem',
            boxShadow: isPlaying ? '0 0 18px rgba(99,102,241,0.55)' : 'none',
            transition: 'box-shadow 0.4s ease',
          }}>🎙️</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'white', fontSize: '0.8rem', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: '2px' }}>
              {title || 'Sesli Özet'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '0.6rem', fontWeight: '800', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.8px' }}>AI Podcast</span>
              {categoryName && (
                <><span style={{ color: '#1e293b', fontSize: '0.6rem' }}>•</span>
                <span style={{ fontSize: '0.6rem', color: '#475569' }}>{categoryName}</span></>
              )}
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#475569', width: '26px', height: '26px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', transition: 'all 0.2s', flexShrink: 0 }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#ef4444'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#475569'; }}
            >✕</button>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div
        className="no-drag"
        onClick={seek}
        style={{ position: 'relative', height: '20px', display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: '10px' }}
      >
        <div
          style={{ width: '100%', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', position: 'relative', transition: 'height 0.15s' }}
          onMouseOver={e => e.currentTarget.style.height = '5px'}
          onMouseOut={e => e.currentTarget.style.height = '3px'}
        >
          <div style={{
            height: '100%', borderRadius: '2px', position: 'relative',
            background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
            width: `${progress}%`,
            transition: 'width 0.1s linear',
          }}>
            <div style={{ position: 'absolute', right: '-5px', top: '50%', transform: 'translateY(-50%)', width: '10px', height: '10px', borderRadius: '50%', background: 'white', boxShadow: '0 0 8px rgba(99,102,241,0.8)' }} />
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {/* −10s */}
        <button onClick={() => skip(-10)} title="10 saniye geri" style={iconBtn}
          onMouseOver={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseOut={e => e.currentTarget.style.color = '#64748b'}
        >⟪ 10</button>

        {/* Play/Pause */}
        <button onClick={togglePlay}
          style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isPlaying ? '1rem' : '0.9rem', paddingLeft: isPlaying ? 0 : '4px', boxShadow: '0 4px 14px rgba(99,102,241,0.45)', transition: 'transform 0.15s', flexShrink: 0 }}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(0.9)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >{isPlaying ? '⏸' : '▶'}</button>

        {/* +10s */}
        <button onClick={() => skip(10)} title="10 saniye ileri" style={iconBtn}
          onMouseOver={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseOut={e => e.currentTarget.style.color = '#64748b'}
        >10 ⟫</button>

        {/* Speed */}
        <button
          onClick={cycleSpeed}
          title="Oynatma hızı"
          style={{
            background: speed !== 1 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${speed !== 1 ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)'}`,
            color: speed !== 1 ? '#818cf8' : '#64748b',
            cursor: 'pointer', fontSize: '0.65rem', fontWeight: '800', padding: '5px 9px',
            borderRadius: '8px', transition: '0.2s', letterSpacing: '0.3px', minWidth: '38px',
          }}
          onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.color = '#818cf8'; }}
          onMouseOut={e => {
            e.currentTarget.style.borderColor = speed !== 1 ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = speed !== 1 ? '#818cf8' : '#64748b';
          }}
        >{speed === 1 ? '1× ' : `${speed}×`}</button>

        {/* Mute/Unmute */}
        <button
          onClick={() => setIsMuted(m => !m)}
          title={isMuted ? "Sesi aç" : "Sesi kapat"}
          style={{ ...iconBtn, fontSize: '0.8rem', padding: '5px 7px', marginLeft: '4px' }}
          onMouseOver={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseOut={e => e.currentTarget.style.color = '#64748b'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Time */}
        <span style={{ color: '#475569', fontSize: '0.68rem', fontFamily: 'monospace', letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
          {formatTime(currentTime)}<span style={{ color: '#1e293b' }}> / </span>{formatTime(duration)}
        </span>

        {/* İndir */}
        {floating && src && (
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="no-drag"
            title="Podcast'i İndir"
            style={{ ...iconBtn, fontSize: '0.8rem', padding: '5px 7px', marginLeft: '4px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            onMouseOver={e => e.currentTarget.style.color = '#94a3b8'}
            onMouseOut={e => e.currentTarget.style.color = '#64748b'}
          >⬇</a>
        )}

        {/* Kütüphane → */}
        {onNavigate && (
          <button onClick={onNavigate}
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)', color: '#6366f1', cursor: 'pointer', fontSize: '0.62rem', fontWeight: '700', padding: '5px 10px', borderRadius: '8px', transition: '0.2s', whiteSpace: 'nowrap', marginLeft: '4px' }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.18)'; e.currentTarget.style.color = '#818cf8'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; e.currentTarget.style.color = '#6366f1'; }}
          >Kütüphane →</button>
        )}
      </div>
    </div>
  );
}

export default AudioPlayer;

