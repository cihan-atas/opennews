import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator, Linking, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { apiFetch } from '../api/client';
import { usePlayer } from '../contexts/PlayerContext';
import { useToast, Toast } from './Toast';
import { colors, radius } from '../theme';

// Web Home.jsx haber-detay modalının portu. Hem Home hem Bookmarks kullanır.
export default function NewsDetailModal({ newsId, visible, onClose }) {
  const insets = useSafeAreaInsets();
  const { track, setTrack } = usePlayer();
  const { toast, showToast } = useToast();

  const [activeId, setActiveId] = useState(newsId);
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [related, setRelated] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [podcastStatus, setPodcastStatus] = useState('idle'); // idle | processing | ready
  const [lang, setLang] = useState('tr');
  const [translated, setTranslated] = useState(null);
  const [translating, setTranslating] = useState(false);

  const pollRef = useRef(null);

  useEffect(() => { setActiveId(newsId); }, [newsId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const loadNews = useCallback(async (id) => {
    setLoading(true);
    setNews(null); setRelated([]); setFeedback(null);
    setTranslated(null); setLang('tr'); setPodcastStatus('idle');
    try {
      const [detailRes, podRes, bmRes, relRes, fbRes] = await Promise.all([
        apiFetch(`/news/${id}`),
        apiFetch(`/podcast/by-news/${id}`),
        apiFetch(`/bookmarks/check/${id}`),
        apiFetch(`/news/${id}/related`),
        apiFetch(`/news/${id}/feedback/mine`),
      ]);

      let detail = null;
      if (detailRes.ok) { detail = await detailRes.json(); setNews(detail); }
      if (podRes.ok) {
        const pod = await podRes.json();
        setPodcastStatus('ready');
        setTrack(pod.audio_url, detail?.title, detail?.category?.name, false);
      }
      if (bmRes.ok) setBookmarked((await bmRes.json()).bookmarked);
      if (relRes.ok) setRelated(await relRes.json());
      if (fbRes.ok) setFeedback((await fbRes.json()).rating);
    } catch (_) {
      showToast('Haber yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [setTrack, showToast]);

  useEffect(() => {
    if (visible && activeId) loadNews(activeId);
    return stopPolling;
  }, [visible, activeId, loadNews, stopPolling]);

  const toggleBookmark = async () => {
    try {
      const res = await apiFetch(`/bookmarks/${activeId}`, { method: bookmarked ? 'DELETE' : 'POST' });
      if (res.ok) {
        setBookmarked((p) => !p);
        showToast(bookmarked ? 'Kaydedilenlerden kaldırıldı.' : 'Kaydedildi! 🔖');
      }
    } catch (_) { showToast('İşlem başarısız.', 'error'); }
  };

  const submitFeedback = async (rating) => {
    try {
      const res = await apiFetch(`/news/${activeId}/feedback?rating=${rating}`, { method: 'POST' });
      if (res.ok) {
        setFeedback((prev) => (prev === rating ? null : rating));
        showToast(rating === 'up' ? 'Teşekkürler! 👍' : 'Geri bildirim alındı 👎');
      }
    } catch (_) {}
  };

  const handleTranslate = async (target) => {
    if (target === 'tr') { setLang('tr'); return; }
    if (lang === target && translated) return;
    setLang(target);
    setTranslating(true);
    try {
      const res = await apiFetch(`/news/${activeId}/translate?lang=${target}`);
      if (res.ok) setTranslated((await res.json()).translated);
    } catch (_) { showToast('Çeviri başarısız.', 'error'); setLang('tr'); }
    finally { setTranslating(false); }
  };

  const generatePodcast = async () => {
    if (!news || podcastStatus === 'processing') return;
    setPodcastStatus('processing');
    showToast('Podcast üretimi başladı…');
    try {
      const res = await apiFetch(`/podcast/generate/${activeId}`, { method: 'POST' });
      if (!res.ok) { setPodcastStatus('idle'); return; }
      // Hazır olana kadar polling (web ile aynı: 3 sn).
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const p = await apiFetch(`/podcast/by-news/${activeId}`);
          if (p.ok) {
            const data = await p.json();
            stopPolling();
            setPodcastStatus('ready');
            setTrack(data.audio_url, news.title, news.category?.name, true);
            showToast('Podcast hazır! 🎧');
          }
        } catch (_) {}
      }, 3000);
    } catch (_) { setPodcastStatus('idle'); }
  };

  const playExisting = async () => {
    const p = await apiFetch(`/podcast/by-news/${activeId}`);
    if (p.ok) {
      const data = await p.json();
      setTrack(data.audio_url, news.title, news.category?.name, true);
    }
  };

  const handleShare = async () => {
    if (!news) return;
    const url = news.source_url || '';
    try {
      await Share.share({ message: `${news.title}\n${url}`, url });
    } catch (_) {
      await Clipboard.setStringAsync(url);
      showToast('Bağlantı panoya kopyalandı!');
    }
  };

  const summaryText = lang === 'en' && translated ? translated : news?.summary;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
          <Toast toast={toast} />
          <View style={styles.handleRow}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={{ color: colors.textDim, fontSize: 22 }}>✕</Text>
            </Pressable>
          </View>

          {loading || !news ? (
            <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 60 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
              {!!news.category?.name && <Text style={styles.category}>{news.category.name}</Text>}
              <Text style={styles.title}>{news.title}</Text>

              {!!news.summary && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryHeader}>
                    <Text style={styles.summaryLabel}>AI ÖZET</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <View style={styles.langToggle}>
                        {[{ c: 'tr', l: '🇹🇷' }, { c: 'en', l: '🇬🇧' }].map(({ c, l }) => (
                          <Pressable key={c} onPress={() => handleTranslate(c)} disabled={translating}
                            style={[styles.langBtn, lang === c && { backgroundColor: colors.primarySoft }]}>
                            <Text style={{ color: lang === c ? colors.primaryLight : colors.textFaint, fontWeight: '800', fontSize: 12 }}>{l}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable onPress={() => submitFeedback('up')} style={[styles.fbBtn, feedback === 'up' && { borderColor: colors.success }]}>
                        <Text>👍</Text>
                      </Pressable>
                      <Pressable onPress={() => submitFeedback('down')} style={[styles.fbBtn, feedback === 'down' && { borderColor: colors.error }]}>
                        <Text>👎</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text style={styles.summaryText}>{translating ? 'Çevriliyor…' : summaryText}</Text>
                </View>
              )}

              <Text style={styles.content}>{news.content}</Text>

              <View style={styles.actions}>
                {podcastStatus === 'idle' && (
                  <Pressable onPress={generatePodcast} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>🎙 Podcast Oluştur</Text>
                  </Pressable>
                )}
                {podcastStatus === 'processing' && <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>🎧 Hazırlanıyor…</Text>}
                {podcastStatus === 'ready' && (
                  <Pressable onPress={playExisting} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>{track ? '🎧 Oynat' : '🎧 Dinle'}</Text>
                  </Pressable>
                )}

                <Pressable onPress={toggleBookmark} style={[styles.outlineBtn, bookmarked && { borderColor: colors.primaryLight }]}>
                  <Text style={{ color: bookmarked ? colors.primaryLight : colors.textMuted, fontWeight: '600' }}>
                    {bookmarked ? '🔖 Kaydedildi' : '🔖 Kaydet'}
                  </Text>
                </Pressable>

                <Pressable onPress={handleShare} style={styles.outlineBtn}>
                  <Text style={{ color: colors.textMuted, fontWeight: '600' }}>↑ Paylaş</Text>
                </Pressable>

                {!!news.source_url && (
                  <Pressable onPress={() => Linking.openURL(news.source_url)} style={styles.outlineBtn}>
                    <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Kaynağa Git →</Text>
                  </Pressable>
                )}
              </View>

              {related.length > 0 && (
                <View style={{ marginTop: 28 }}>
                  <Text style={styles.relatedHeader}>Benzer Haberler</Text>
                  {related.map((r) => (
                    <Pressable key={r.id} onPress={() => setActiveId(r.id)} style={styles.relatedCard}>
                      {!!r.category?.name && <Text style={styles.relatedCat}>{r.category.name}</Text>}
                      <Text style={styles.relatedTitle}>{r.title}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '94%', borderWidth: 1, borderColor: colors.border },
  handleRow: { alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 4 },
  closeBtn: { padding: 8 },
  category: { color: colors.primaryLight, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: colors.white, fontSize: 26, fontWeight: '800', marginTop: 8, marginBottom: 20 },
  summaryCard: { backgroundColor: 'rgba(99,102,241,0.06)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.15)', borderRadius: radius.md, padding: 16, marginBottom: 20 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  summaryLabel: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  langToggle: { flexDirection: 'row', backgroundColor: 'rgba(2,6,23,0.5)', borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7 },
  fbBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  summaryText: { color: '#cbd5e1', lineHeight: 24, fontSize: 15 },
  content: { color: '#cbd5e1', lineHeight: 26, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28, alignItems: 'center' },
  primaryBtn: { backgroundColor: colors.primary, paddingVertical: 13, paddingHorizontal: 22, borderRadius: radius.md },
  primaryBtnText: { color: colors.white, fontWeight: '700' },
  outlineBtn: { borderWidth: 1, borderColor: colors.border, paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md },
  relatedHeader: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  relatedCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 16, marginBottom: 12 },
  relatedCat: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 },
  relatedTitle: { color: colors.white, fontWeight: '700', fontSize: 15, lineHeight: 20 },
});
