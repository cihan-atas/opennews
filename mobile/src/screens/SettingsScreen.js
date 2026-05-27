import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import { useTheme } from '../contexts/ThemeContext';
import { darkColors as colors, radius } from '../theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const { toast, showToast } = useToast();
  const { theme, colors: themeColors, toggleTheme } = useTheme();

  const [allCategories, setAllCategories] = useState([]);
  const [selected, setSelected] = useState([]);
  const [pw, setPw] = useState({ old_password: '', new_password: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (user?.interests) setSelected(user.interests.map((i) => i.id));
    (async () => {
      try {
        const [catRes, statsRes] = await Promise.all([
          apiFetch('/categories/'),
          apiFetch('/users/stats'),
        ]);
        if (catRes.ok) setAllCategories(await catRes.json());
        if (statsRes.ok) setStats(await statsRes.json());
      } catch (_) {}
    })();
  }, [user]);

  const toggle = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const changePassword = async () => {
    if (pw.new_password !== pw.confirm) { showToast('Yeni şifreler eşleşmiyor!', 'error'); return; }
    setSavingPw(true);
    try {
      const res = await apiFetch('/users/change-password', {
        method: 'PUT',
        body: JSON.stringify({ old_password: pw.old_password, new_password: pw.new_password }),
      });
      if (res.ok) {
        showToast('Şifreniz güncellendi.');
        setPw({ old_password: '', new_password: '', confirm: '' });
      } else {
        showToast((await res.json()).detail || 'Hata oluştu.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setSavingPw(false); }
  };

  const updateInterests = async () => {
    if (selected.length < 2) { showToast('En az 2 kategori seçmelisin!', 'error'); return; }
    setSavingInterests(true);
    try {
      const res = await apiFetch('/users/interests', {
        method: 'POST',
        body: JSON.stringify({ category_ids: selected }),
      });
      if (res.ok) { showToast('İlgi alanların güncellendi!'); await refreshUser(); }
      else showToast('Güncellenemedi.', 'error');
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setSavingInterests(false); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch('/users/me', { method: 'DELETE' });
      await logout(); // token temizlenir → RootNavigator Auth ekranına döner
    } catch (_) {
      setDeleting(false);
      setShowDelete(false);
      showToast('Hesap silinirken bir hata oluştu.', 'error');
    }
  };

  const canUpdateInterests = selected.length >= 2 && !savingInterests;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, backgroundColor: themeColors.bg }]}>
      <Toast toast={toast} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        <Text style={[styles.h1, { color: themeColors.text }]}>Ayarlar</Text>

        {stats && (
          <View style={[styles.section, { backgroundColor: themeColors.surfaceAlpha, borderColor: themeColors.borderSoft }]}>
            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>📊 İstatistiklerim</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {[
                { label: 'Toplam Haber', value: stats.articles_read, icon: '📰' },
                { label: 'Bu Hafta', value: stats.week_reads, icon: '📅' },
                { label: 'Podcast', value: stats.podcasts_count, icon: '🎙️' },
                { label: 'Kaydedilen', value: stats.bookmarks_count, icon: '🔖' },
              ].map((item) => (
                <View key={item.label} style={styles.statCard}>
                  <Text style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</Text>
                  <Text style={styles.statValue}>{item.value}</Text>
                  <Text style={[styles.statLabel, { color: themeColors.textDim }]}>{item.label}</Text>
                </View>
              ))}
            </View>
            {stats.favorite_category && (
              <Text style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 12 }}>
                En çok okuduğun: <Text style={{ color: themeColors.primaryLight, fontWeight: '700' }}>{stats.favorite_category}</Text>
              </Text>
            )}
          </View>
        )}

        <View style={[styles.section, { backgroundColor: themeColors.surfaceAlpha, borderColor: themeColors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>🎨 Görünüm</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: '600' }}>
                {theme === 'dark' ? '🌙 Koyu Tema' : '☀️ Açık Tema'}
              </Text>
              <Text style={{ color: themeColors.textFaint, fontSize: 13, marginTop: 2 }}>
                {theme === 'dark' ? 'Karanlık arayüz aktif' : 'Aydınlık arayüz aktif'}
              </Text>
            </View>
            <Switch
              value={theme === 'light'}
              onValueChange={toggleTheme}
              trackColor={{ false: 'rgba(99,102,241,0.3)', true: themeColors.primary }}
              thumbColor={themeColors.white}
            />
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: themeColors.surfaceAlpha, borderColor: themeColors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>👤 Profil Bilgileri</Text>
          <Text style={[styles.fieldLabel, { color: themeColors.textDim }]}>KULLANICI ADI</Text>
          <Text style={[styles.fieldValue, { color: themeColors.text }]}>{user?.username || '—'}</Text>
          <Text style={[styles.fieldLabel, { marginTop: 14, color: themeColors.textDim }]}>E-POSTA</Text>
          <Text style={[styles.fieldValue, { color: themeColors.text }]}>{user?.email || '—'}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: themeColors.surfaceAlpha, borderColor: themeColors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>🔐 Güvenlik</Text>
          <TextInput style={[styles.input, { borderColor: themeColors.border, color: themeColors.text }]} placeholder="Mevcut Şifre" placeholderTextColor={themeColors.textFaint}
            secureTextEntry value={pw.old_password} onChangeText={(t) => setPw({ ...pw, old_password: t })} />
          <TextInput style={[styles.input, { borderColor: themeColors.border, color: themeColors.text }]} placeholder="Yeni Şifre" placeholderTextColor={themeColors.textFaint}
            secureTextEntry value={pw.new_password} onChangeText={(t) => setPw({ ...pw, new_password: t })} />
          <TextInput style={[styles.input, { borderColor: themeColors.border, color: themeColors.text }]} placeholder="Yeni Şifre (Tekrar)" placeholderTextColor={themeColors.textFaint}
            secureTextEntry value={pw.confirm} onChangeText={(t) => setPw({ ...pw, confirm: t })} />
          <Pressable onPress={changePassword} disabled={savingPw} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{savingPw ? 'İşleniyor…' : 'Şifreyi Güncelle'}</Text>
          </Pressable>
        </View>

        <View style={[styles.section, { backgroundColor: themeColors.surfaceAlpha, borderColor: themeColors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>🎯 Haber Tercihleri</Text>
          <View style={styles.chips}>
            {allCategories.map((cat) => {
              const on = selected.includes(cat.id);
              return (
                <Pressable key={cat.id} onPress={() => toggle(cat.id)} style={[styles.chip, on && styles.chipOn, { borderColor: themeColors.border }]}>
                  <Text style={{ color: on ? themeColors.white : themeColors.textMuted, fontWeight: '600', fontSize: 13 }}>{cat.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={updateInterests} disabled={!canUpdateInterests}
            style={[styles.outlineBtn, !canUpdateInterests && { borderColor: themeColors.border }]}>
            <Text style={{ color: canUpdateInterests ? themeColors.primaryLight : themeColors.textDim, fontWeight: '700' }}>
              {savingInterests ? 'Kaydediliyor…' : 'Kategorileri Kaydet'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.section, { borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)' }]}>
          <Text style={[styles.sectionTitle, { color: themeColors.error }]}>⚠️ Tehlike Bölgesi</Text>
          <Text style={{ color: themeColors.textMuted, lineHeight: 21, marginBottom: 16 }}>
            Hesabını sildiğinde haber akışın, podcastlerin ve tüm verilerin kalıcı olarak silinecektir.
          </Text>
          <Pressable onPress={() => setShowDelete(true)} style={styles.dangerBtn}>
            <Text style={{ color: themeColors.error, fontWeight: '700' }}>Hesabımı Kalıcı Olarak Sil</Text>
          </Pressable>
        </View>

        <Pressable onPress={logout} style={[styles.outlineBtn, { marginTop: 8 }]}>
          <Text style={{ color: themeColors.textMuted, fontWeight: '700' }}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: themeColors.card }]}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>⚠️</Text>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Veda Mı Ediyoruz?</Text>
            <Text style={[styles.modalText, { color: themeColors.textMuted }]}>Tüm verilerin kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misin?</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable onPress={() => setShowDelete(false)} disabled={deleting} style={[styles.modalBtn, { borderWidth: 1, borderColor: themeColors.border }]}>
                <Text style={{ color: themeColors.text, fontWeight: '700' }}>Vazgeç</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} disabled={deleting} style={[styles.modalBtn, { backgroundColor: themeColors.error }]}>
                <Text style={{ color: themeColors.white, fontWeight: '700' }}>{deleting ? 'Siliniyor…' : 'Evet, Sil'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.white, fontSize: 28, fontWeight: '900', marginBottom: 20 },
  section: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, padding: 22, marginBottom: 18 },
  sectionTitle: { color: colors.white, fontSize: 18, fontWeight: '800', marginBottom: 16 },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  fieldValue: { color: colors.white, fontSize: 18, fontWeight: '600', marginTop: 6 },
  input: { backgroundColor: 'rgba(2,6,23,0.5)', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 12, color: colors.white, marginBottom: 12 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: colors.white, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(15,23,42,0.3)' },
  chipOn: { borderColor: colors.primaryLight, backgroundColor: colors.primarySoft },
  outlineBtn: { borderWidth: 2, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
  dangerBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: radius.xl, padding: 28, width: '100%', maxWidth: 420 },
  modalTitle: { color: colors.white, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  modalText: { color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.sm, alignItems: 'center' },
  statCard: {
    flex: 1, minWidth: '42%', backgroundColor: 'rgba(99,102,241,0.06)',
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.15)', borderRadius: radius.md,
    padding: 16, alignItems: 'center',
  },
  statValue: { color: colors.primaryLight, fontSize: 26, fontWeight: '900', lineHeight: 30 },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
});
