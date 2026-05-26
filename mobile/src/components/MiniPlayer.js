import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { usePlayer } from '../contexts/PlayerContext';
import { colors, radius } from '../theme';

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

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => skip(-10)} hitSlop={8}><Text style={styles.ctrlText}>⟪10</Text></Pressable>
        <Pressable onPress={togglePlay} style={styles.playBtn}>
          <Text style={{ color: colors.white, fontSize: 16 }}>{playing ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable onPress={() => skip(10)} hitSlop={8}><Text style={styles.ctrlText}>10⟫</Text></Pressable>
        <Pressable onPress={cycleSpeed} style={styles.speedBtn}>
          <Text style={styles.speedText}>{SPEEDS[speedIdx]}×</Text>
        </Pressable>
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

const styles = StyleSheet.create({
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
});
