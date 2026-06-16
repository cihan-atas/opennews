import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator, Linking, Share, Animated, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { apiFetch } from '../api/client';
import { usePlayer } from '../contexts/PlayerContext';
import { useToast, Toast } from './Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

// Web Home.jsx haber-detay modalının portu. Hem Home hem Bookmarks kullanır.
export default function NewsDetailModal({ newsId, visible, onClose }) {
  const insets = useSafeAreaInsets();
  const { track, setTrack } = usePlayer();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [activeId, setActiveId] = useState(newsId);
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [related, setRelated] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [podcastStatus, setPodcastStatus] = useState('idle'); // idle | processing | ready
  const [showLengthPicker, setShowLengthPicker] = useState(false);
  const [lang, setLang] = useState('orig'); // görünüm: 'orig' | 'tr' | 'en'
  const [translated, setTranslated] = useState(null);
  const [translatedContent, setTranslatedContent] = useState(null);
  const [translatedLang, setTranslatedLang] = useState(null);
  const [translating, setTranslating] = useState(false);

  const pollRef = useRef(null);

  // Aşağı çekince kapatma — kartın HER yerinden (içerik en üstteyken aşağı sürükle)
  const translateY = useRef(new Animated.Value(0)).current;
  const scrollOffset = useRef(0);
  useEffect(() => { if (visible) translateY.setValue(0); }, [visible, translateY]);
  const panResponder = useRef(
    PanResponder.create({
      // Sadece içerik en üstteyken VE aşağı doğru çekilirken devral (yoksa normal scroll)
      onMoveShouldSetPanResponder: (_, g) => scrollOffset.current <= 0 && g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { translateY.setValue(Math.max(0, g.dy)); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 1.1) {
          Animated.timing(translateY, { toValue: 800, duration: 200, useNativeDriver: true }).start(() => onClose());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => { setActiveId(newsId); }, [newsId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const loadNews = useCallback(async (id) => {
    setLoading(true);
    setNews(null); setRelated([]); setFeedback(null);
    setTranslated(null); setTranslatedContent(null); setTranslatedLang(null); setLang('orig'); setPodcastStatus('idle'); setShowLengthPicker(false);
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
      // Podcast varsa sadece durumu işaretle; oynatıcıyı otomatik ele geçirme
      // (modal açılışında setTrack çağırmak gereksiz re-render/flicker'a yol açıyordu).
      if (podRes.ok) {
        await podRes.json();
        setPodcastStatus('ready');
      }
      if (bmRes.ok) setBookmarked((await bmRes.json()).bookmarked);
      if (relRes.ok) setRelated(await relRes.json());
      if (fbRes.ok) setFeedback((await fbRes.json()).rating);
    } catch (_) {
      showToast('Haber yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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

  const handleTranslate = async (mode) => {
    setLang(mode);
    if (mode === 'orig') return;           // orijinali göster
    if (translatedLang === mode) return;   // zaten getirilmiş
    setTranslating(true);
    try {
      const res = await apiFetch(`/news/${activeId}/translate?lang=${mode}`);
      if (res.ok) {
        const data = await res.json();
        setTranslated(data.summary ?? null);
        setTranslatedContent(data.content ?? null);
        setTranslatedLang(mode);
      }
    } catch (_) { showToast('Çeviri başarısız.', 'error'); setLang('orig'); }
    finally { setTranslating(false); }
  };

  const generatePodcast = async (length = 'medium') => {
    if (!news || podcastStatus === 'processing') return;
    setShowLengthPicker(false);
    setPodcastStatus('processing');
    showToast('Podcast üretimi başladı…');
    try {
      const res = await apiFetch(`/podcast/generate/${activeId}?length=${length}`, { method: 'POST' });
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
            setTrack(data.audio_url, news.title, news.category?.name, true, data.id);
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
      setTrack(data.audio_url, news.title, news.category?.name, true, data.id);
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

  const summaryText = lang === 'orig' ? news?.summary : (translated ?? news?.summary);
  const contentText = lang === 'orig' ? news?.content : (translatedContent ?? news?.content);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom, transform: [{ translateY }] }]} {...panResponder.panHandlers}>
          <Toast toast={toast} />
          <View style={styles.handleRow}>
            <View style={styles.grabZone}>
              <View style={styles.grabber} />
            </View>
            <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
              <Text style={{ color: colors.text, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          {loading || !news ? (
            <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 60 }} />
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
              onScroll={(e) => { scrollOffset.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              {!!news.category?.name && <Text style={styles.category}>{news.category.name}</Text>}
              <Text style={styles.title}>{news.title}</Text>

              {/* Dil seçimi: Orijinal / TR / EN (haberin orijinal diline göre çevirir) */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {!!news.lang && <Text style={{ color: colors.textFaint, fontSize: 11, fontWeight: '700' }}>Orijinal: {news.lang.toUpperCase()}</Text>}
                <View style={styles.langToggle}>
                  {[{ c: 'orig', l: 'Orijinal' }, { c: 'tr', l: '🇹🇷 TR' }, { c: 'en', l: '🇬🇧 EN' }].map(({ c, l }) => (
                    <Pressable key={c} onPress={() => handleTranslate(c)} disabled={translating}
                      style={[styles.langBtn, lang === c && { backgroundColor: colors.primarySoft }]}>
                      <Text style={{ color: lang === c ? colors.primaryLight : colors.textFaint, fontWeight: '800', fontSize: 12 }}>{l}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {!!news.summary && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryHeader}>
                    <Text style={styles.summaryLabel}>AI ÖZET</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
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

              <Text style={styles.content}>{translating ? 'Çevriliyor…' : contentText}</Text>

              <View style={styles.actions}>
                {podcastStatus === 'idle' && !showLengthPicker && (
                  <Pressable onPress={() => setShowLengthPicker(true)} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>🎙 Podcast Oluştur</Text>
                  </Pressable>
                )}
                {podcastStatus === 'idle' && showLengthPicker && (
                  <View style={{ width: '100%', gap: 8 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>🎙 Podcast süresi seç:</Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { key: 'short', label: '30sn-1dk' },
                        { key: 'medium', label: '1-2dk' },
                        { key: 'long', label: '2-4dk' },
                      ].map((opt) => (
                        <Pressable key={opt.key} onPress={() => generatePodcast(opt.key)}
                          style={{ flex: 1, minWidth: 80, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{opt.label}</Text>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => setShowLengthPicker(false)} style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                        <Text style={{ color: colors.textDim, fontWeight: '700' }}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
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
                  <Text style={{ color: colors.text, fontWeight: '700' }}>↑ Paylaş</Text>
                </Pressable>

                {!!news.source_url && (
                  <Pressable onPress={() => Linking.openURL(news.source_url)} style={[styles.outlineBtn, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                    <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>Kaynağa Git →</Text>
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
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '94%', borderWidth: 1, borderColor: colors.border },
  handleRow: { position: 'relative', minHeight: 40, justifyContent: 'center' },
  grabZone: { paddingVertical: 12, alignItems: 'center' },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.textDim, opacity: 0.6 },
  closeBtn: { position: 'absolute', right: 14, top: 6, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  category: { color: colors.primaryLight, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 8, marginBottom: 20 },
  summaryCard: { backgroundColor: 'rgba(99,102,241,0.06)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.15)', borderRadius: radius.md, padding: 16, marginBottom: 20 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  summaryLabel: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  langToggle: { flexDirection: 'row', backgroundColor: colors.inputBg, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7 },
  fbBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  summaryText: { color: '#cbd5e1', lineHeight: 24, fontSize: 15 },
  content: { color: '#cbd5e1', lineHeight: 26, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28, alignItems: 'center' },
  primaryBtn: { backgroundColor: colors.primary, paddingVertical: 13, paddingHorizontal: 22, borderRadius: radius.md },
  primaryBtnText: { color: colors.white, fontWeight: '700' },
  outlineBtn: { borderWidth: 1, borderColor: colors.border, paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md },
  relatedHeader: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  relatedCard: { backgroundColor: colors.chip, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: 16, marginBottom: 12 },
  relatedCat: { color: colors.primaryLight, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 },
  relatedTitle: { color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
});
