import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { usePlayer } from '../contexts/PlayerContext';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { apiFetch } from '../api/client';

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Arka planda / sessiz modda çalsın (uygulama açılışında bir kez).
setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});

// track.src değiştiğinde dıştaki MiniPlayer key={src} ile bunu remount eder →
// useAudioPlayer her zaman geçerli bir URL ile (null değil) oluşturulur.
function ActivePlayer({ track, onClose }) {
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(track.src);
  const status = useAudioPlayerStatus(player);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // --- TRANSCRIPT ACTIONS & STATE ---
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState(null);

  const fetchTranscript = async () => {
    if (!track.podcastId) return;
    setLoadingTranscript(true);
    setTranscriptError(null);
    try {
      const res = await apiFetch(`/podcast/${track.podcastId}/transcript`);
      if (res.ok) {
        const data = await res.json();
        setTranscriptText(data.transcript || 'Transkript bulunamadı.');
      } else {
        setTranscriptError('Transkript yüklenemedi.');
      }
    } catch (e) {
      setTranscriptError('Bağlantı hatası.');
    } finally {
      setLoadingTranscript(false);
    }
  };

  const toggleTranscript = () => {
    const nextVal = !showTranscript;
    setShowTranscript(nextVal);
    if (nextVal && !transcriptText) {
      fetchTranscript();
    }
  };

  useEffect(() => {
    setTranscriptText('');
    setShowTranscript(false);
    setTranscriptError(null);
  }, [track.podcastId]);

  useEffect(() => {
    if (track.autoPlay) {
      try { player.play(); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duration = status?.duration || 0;
  const currentTime = status?.currentTime || 0;
  const playing = status?.playing;
  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  const togglePlay = () => { playing ? player.pause() : player.play(); };
  const skip = (secs) => {
    const target = Math.max(0, duration ? Math.min(duration, currentTime + secs) : currentTime + secs);
    player.seekTo(target);
  };
  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    player.setPlaybackRate(SPEEDS[next]);
  };
  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    player.muted = next;
  };
  const close = () => { try { player.pause(); } catch (_) {} onClose(); };

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 64 }]}>
      <View style={styles.header}>
        <View style={styles.icon}><Text style={{ fontSize: 16 }}>🎙️</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{track.title || 'Sesli Özet'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            AI Podcast{track.category ? ` • ${track.category}` : ''}
          </Text>
        </View>
        <Pressable onPress={close} hitSlop={10} style={styles.closeBtn}>
          <Text style={{ color: colors.textDim, fontSize: 14 }}>✕</Text>
        </Pressable>
      </View>

      {/* Transcript Text Box */}
      {showTranscript && (
        <View style={styles.transcriptBox}>
          {loadingTranscript ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="small" color={colors.primaryLight} />
              <Text style={styles.loaderText}>Yazıya dökülüyor (Groq Whisper)...</Text>
            </View>
          ) : transcriptError ? (
            <Text style={styles.errorText}>⚠️ {transcriptError}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled={true}>
              <Text style={styles.transcriptText}>{transcriptText}</Text>
            </ScrollView>
          )}
        </View>
      )}

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => skip(-15)} hitSlop={8}><Text style={styles.ctrlText}>⟪15</Text></Pressable>
        <Pressable onPress={togglePlay} style={styles.playBtn}>
          <Text style={{ color: colors.white, fontSize: 16 }}>{playing ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable onPress={() => skip(15)} hitSlop={8}><Text style={styles.ctrlText}>15⟫</Text></Pressable>
        <Pressable onPress={cycleSpeed} style={styles.speedBtn}>
          <Text style={styles.speedText}>{SPEEDS[speedIdx]}×</Text>
        </Pressable>
        <Pressable
          onPress={toggleMute}
          style={[styles.speedBtn, isMuted && { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.35)' }]}
          hitSlop={8}
        >
          <Text style={[styles.speedText, isMuted && { color: '#f87171' }]}>{isMuted ? '🔇' : '🔊'}</Text>
        </Pressable>

        {/* Transcript Toggle Button */}
        {track.podcastId && (
          <Pressable 
            onPress={toggleTranscript} 
            style={[
              styles.transcriptToggleBtn, 
              showTranscript && { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.35)' }
            ]}
          >
            <Text style={[styles.transcriptToggleText, showTranscript && { color: colors.primaryLight }]}>📝 Metin</Text>
          </Pressable>
        )}

        <View style={{ flex: 1 }} />
        <Text style={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</Text>
      </View>
    </View>
  );
}

export default function MiniPlayer() {
  const { track, clearTrack } = usePlayer();
  if (!track?.src) return null;
  return <ActivePlayer key={track.src} track={track} onClose={clearTrack} />;
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: {
    position: 'absolute', left: 12, right: 12,
    backgroundColor: 'rgba(8,12,24,0.98)',
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)',
    borderRadius: radius.lg, padding: 14, zIndex: 9999,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  icon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.white, fontSize: 13, fontWeight: '700' },
  subtitle: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.primaryLight },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctrlText: { color: colors.textMuted, fontWeight: '800', fontSize: 12 },
  playBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  speedBtn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: 'rgba(99,102,241,0.35)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9 },
  speedText: { color: colors.primaryLight, fontWeight: '800', fontSize: 12 },
  time: { color: colors.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  transcriptBox: {
    backgroundColor: 'rgba(2, 6, 23, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  loaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  loaderText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    fontSize: 12,
    paddingVertical: 10,
  },
  transcriptText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
  },
  transcriptToggleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 4,
  },
  transcriptToggleText: {
    color: colors.textMuted,
    fontWeight: '800',
    fontSize: 12,
  },
});
