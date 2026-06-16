import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, FlatList, Modal, StyleSheet, ActivityIndicator, Linking, ScrollView, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { apiFetch } from '../api/client';
import { usePlayer } from '../contexts/PlayerContext';
import { useToast, Toast } from '../components/Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

export default function PodcastScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { track, setTrack, setQueue, clearTrack } = usePlayer();

  const handlePlayAll = () => {
    const playable = podcasts.filter((pod) => !pod.is_archived);
    if (playable.length === 0) { showToast('Çalınabilir podcast yok.', 'error'); return; }
    const tracks = playable.map((pod) => ({
      src: pod.audio_url,
      title: pod.title,
      category: pod.news_id ? 'Akış' : 'RSS',
      podcastId: pod.id,
    }));
    setQueue(tracks, 0);
    showToast(`${tracks.length} podcast sırayla çalınıyor...`);
  };
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [transcriptModal, setTranscriptModal] = useState({ show: false, text: '', loading: false });

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const fetchPodcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/podcast/?page=${page}&size=${pageSize}`);
      if (res.ok) {
        const data = await res.json();
        setPodcasts(data.items || []);
        setTotalCount(data.total_count || 0);
      }
    } catch (_) {
      showToast('Kütüphane yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, showToast]);

  useEffect(() => { fetchPodcasts(); }, [fetchPodcasts]);
  // Sekmeye her dönüşte güncelle (yeni oluşturulan podcast anında görünsün)
  useFocusEffect(useCallback(() => { fetchPodcasts(); }, [fetchPodcasts]));

  const handlePlayToggle = (pod) => {
    if (track?.src === pod.audio_url) {
      clearTrack();
      showToast('Podcast kapatıldı.');
    } else {
      setTrack(pod.audio_url, pod.title, pod.news_id ? 'Akış' : 'RSS', true, pod.id);
      showToast('Podcast oynatılıyor…');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/podcast/${toDelete}`, { method: 'DELETE' });
      if (res.ok) {
        const removed = podcasts.find((p) => p.id === toDelete);
        if (removed && track?.src === removed.audio_url) clearTrack();
        setPodcasts((prev) => prev.filter((p) => p.id !== toDelete));
        setTotalCount((p) => p - 1);
        showToast('Podcast kaldırıldı.');
      } else {
        showToast('Silme başarısız.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası.', 'error');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const handleTranscriptPress = async (podcastId) => {
    setTranscriptModal({ show: true, text: '', loading: true });
    try {
      const res = await apiFetch(`/podcast/${podcastId}/transcript`);
      if (res.ok) {
        const data = await res.json();
        setTranscriptModal({ show: true, text: data.transcript || '', loading: false });
      } else {
        setTranscriptModal({ show: false, text: '', loading: false });
        showToast('Transkrip alınamadı.', 'error');
      }
    } catch (_) {
      setTranscriptModal({ show: false, text: '', loading: false });
      showToast('Bağlantı hatası.', 'error');
    }
  };

  const handleDownload = useCallback(async (pod) => {
    if (downloading) return;
    setDownloading(pod.id);
    try {
      const safeName = pod.title.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.mp3';
      const dest = FileSystem.cacheDirectory + safeName;
      const { uri } = await FileSystem.downloadAsync(pod.audio_url, dest);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'audio/mpeg', dialogTitle: pod.title });
      } else {
        showToast('Paylaşım bu cihazda desteklenmiyor.', 'error');
      }
    } catch (e) {
      showToast('İndirme başarısız.', 'error');
    } finally {
      setDownloading(null);
    }
  }, [downloading, showToast]);

  const renderItem = ({ item: pod }) => {
    const isCurrent = track?.src === pod.audio_url;
    return (
      <View style={[styles.card, isCurrent && { borderColor: 'rgba(99,102,241,0.4)' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
          <View style={[styles.icon, { backgroundColor: isCurrent ? colors.success : colors.primary }]}>
            <Text style={{ fontSize: 20 }}>{isCurrent ? '🔊' : '🎙️'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {pod.is_archived && <Text style={[styles.badge, { color: colors.error }]}>🗑 Silindi</Text>}
              <Text style={styles.badge}>{pod.news_id ? '📡 Akış' : '📰 RSS'}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>{pod.title}</Text>
            <Text style={styles.cardDate}>{new Date(pod.created_at).toLocaleDateString('tr-TR')}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {pod.is_archived ? (
            <>
              {pod.news_id ? (
                <Pressable onPress={() => navigation.navigate('Home', { openNewsId: pod.news_id })} style={[styles.playBtn, { backgroundColor: colors.primary }]}>
                  <Text style={styles.playBtnText}>🔁 Yeniden Oluştur</Text>
                </Pressable>
              ) : !!pod.source_url && (
                <Pressable onPress={() => Linking.openURL(pod.source_url)} style={styles.navBtn}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>🔗 Kaynak</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Pressable
                onPress={() => handlePlayToggle(pod)}
                style={[styles.playBtn, { backgroundColor: isCurrent ? '#dc2626' : colors.primary }]}
              >
                <Text style={styles.playBtnText}>{isCurrent ? '✕ Kapat' : '▶ Oynat'}</Text>
              </Pressable>
              {!!pod.source_url && (
                <Pressable onPress={() => Linking.openURL(pod.source_url)} style={styles.navBtn}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>🔗 Kaynak</Text>
                </Pressable>
              )}
              <Pressable onPress={() => handleTranscriptPress(pod.id)} style={styles.navBtn}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>📝 Transkrip</Text>
              </Pressable>
              <Pressable
                onPress={() => handleDownload(pod)}
                disabled={downloading === pod.id}
                style={styles.dlBtn}
              >
                <Text style={{ color: downloading === pod.id ? colors.textDim : colors.success, fontWeight: '600' }}>
                  {downloading === pod.id ? '⏳' : '⬇'}
                </Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => setToDelete(pod.id)} style={styles.trashBtn}>
            <Text style={{ fontSize: 16 }}>🗑️</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />
      <View style={styles.header}>
        <Text style={styles.title}>Podcast Kütüphanem</Text>
        <Text style={styles.subtitle}>Yapay zeka ile üretilen kişisel ses dosyaların.</Text>
        {podcasts.length > 1 && (
          <Pressable onPress={handlePlayAll} style={styles.playAllBtn}>
            <Text style={styles.playAllText}>▶ Tümünü Sırayla Çal</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
      ) : podcasts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 48 }}>🎙️</Text>
          <Text style={{ color: colors.textDim, fontSize: 16, marginTop: 12 }}>Henüz bir podcast üretilmemiş.</Text>
        </View>
      ) : (
        <FlatList
          data={podcasts}
          keyExtractor={(p) => String(p.id)}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPodcasts} tintColor={colors.primaryLight} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pager}>
                <Pressable disabled={page === 1} onPress={() => setPage((p) => p - 1)} style={[styles.pageBtn, page === 1 && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>←</Text>
                </Pressable>
                <Text style={{ color: colors.textMuted }}>Sayfa {page}/{totalPages}</Text>
                <Pressable disabled={page === totalPages} onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, page === totalPages && { opacity: 0.3 }]}>
                  <Text style={styles.pageBtnText}>→</Text>
                </Pressable>
              </View>
            ) : null
          }
        />
      )}

      <Modal
        visible={transcriptModal.show}
        transparent
        animationType="slide"
        onRequestClose={() => setTranscriptModal({ show: false, text: '', loading: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { borderColor: 'rgba(99,102,241,0.3)', maxHeight: '75%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[styles.modalTitle, { textAlign: 'left', marginTop: 0 }]}>📝 Transkrip</Text>
              <Pressable onPress={() => setTranscriptModal({ show: false, text: '', loading: false })}>
                <Text style={{ color: colors.textMuted, fontSize: 20 }}>✕</Text>
              </Pressable>
            </View>
            {transcriptModal.loading ? (
              <ActivityIndicator color={colors.primaryLight} style={{ paddingVertical: 24 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={{ color: colors.textMuted, lineHeight: 24, fontSize: 14 }}>
                  {transcriptModal.text || 'Transkrip bulunamadı.'}
                </Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>⚠️</Text>
            <Text style={styles.modalTitle}>Kaseti Çöpe At?</Text>
            <Text style={styles.modalText}>Bu kaydı kütüphaneden kalıcı olarak silmek üzeresin.</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable onPress={() => setToDelete(null)} disabled={deleting} style={[styles.modalBtn, styles.modalCancel]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Vazgeç</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} disabled={deleting} style={[styles.modalBtn, { backgroundColor: colors.error }]}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>{deleting ? 'Siliniyor…' : 'Sil'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.textMuted, marginTop: 6 },
  playAllBtn: { alignSelf: 'flex-start', marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 18 },
  playAllText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', marginTop: 80 },
  card: {
    backgroundColor: colors.surfaceAlpha,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    padding: 18,
  },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badge: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginVertical: 4 },
  cardDate: { color: colors.textDim, fontSize: 12 },
  playBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.sm },
  playBtnText: { color: colors.white, fontWeight: '700' },
  navBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceAlpha,
  },
  dlBtn: { padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: 'rgba(16,185,129,0.06)' },
  trashBtn: { marginLeft: 'auto', padding: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
  pageBtn: { backgroundColor: colors.surfaceAlpha, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
  pageBtnText: { color: colors.white, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: radius.xl, padding: 28, width: '100%', maxWidth: 420 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  modalText: { color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.sm, alignItems: 'center' },
  modalCancel: { borderWidth: 1, borderColor: colors.border },
});
