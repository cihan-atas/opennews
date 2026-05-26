import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import { colors, radius } from '../theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const { toast, showToast } = useToast();

  const [allCategories, setAllCategories] = useState([]);
  const [selected, setSelected] = useState([]);
  const [pw, setPw] = useState({ old_password: '', new_password: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user?.interests) setSelected(user.interests.map((i) => i.id));
    (async () => {
      try {
        const res = await apiFetch('/categories/');
        if (res.ok) setAllCategories(await res.json());
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
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        <Text style={styles.h1}>Ayarlar</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Profil Bilgileri</Text>
          <Text style={styles.fieldLabel}>KULLANICI ADI</Text>
          <Text style={styles.fieldValue}>{user?.username || '—'}</Text>
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>E-POSTA</Text>
          <Text style={styles.fieldValue}>{user?.email || '—'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔐 Güvenlik</Text>
          <TextInput style={styles.input} placeholder="Mevcut Şifre" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.old_password} onChangeText={(t) => setPw({ ...pw, old_password: t })} />
          <TextInput style={styles.input} placeholder="Yeni Şifre" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.new_password} onChangeText={(t) => setPw({ ...pw, new_password: t })} />
          <TextInput style={styles.input} placeholder="Yeni Şifre (Tekrar)" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.confirm} onChangeText={(t) => setPw({ ...pw, confirm: t })} />
          <Pressable onPress={changePassword} disabled={savingPw} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{savingPw ? 'İşleniyor…' : 'Şifreyi Güncelle'}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎯 Haber Tercihleri</Text>
          <View style={styles.chips}>
            {allCategories.map((cat) => {
              const on = selected.includes(cat.id);
              return (
                <Pressable key={cat.id} onPress={() => toggle(cat.id)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={{ color: on ? colors.white : colors.textMuted, fontWeight: '600', fontSize: 13 }}>{cat.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={updateInterests} disabled={!canUpdateInterests}
            style={[styles.outlineBtn, !canUpdateInterests && { borderColor: colors.border }]}>
            <Text style={{ color: canUpdateInterests ? colors.primaryLight : colors.textDim, fontWeight: '700' }}>
              {savingInterests ? 'Kaydediliyor…' : 'Kategorileri Kaydet'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.section, { borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)' }]}>
          <Text style={[styles.sectionTitle, { color: colors.error }]}>⚠️ Tehlike Bölgesi</Text>
          <Text style={{ color: colors.textMuted, lineHeight: 21, marginBottom: 16 }}>
            Hesabını sildiğinde haber akışın, podcastlerin ve tüm verilerin kalıcı olarak silinecektir.
          </Text>
          <Pressable onPress={() => setShowDelete(true)} style={styles.dangerBtn}>
            <Text style={{ color: colors.error, fontWeight: '700' }}>Hesabımı Kalıcı Olarak Sil</Text>
          </Pressable>
        </View>

        <Pressable onPress={logout} style={[styles.outlineBtn, { marginTop: 8 }]}>
          <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>⚠️</Text>
            <Text style={styles.modalTitle}>Veda Mı Ediyoruz?</Text>
            <Text style={styles.modalText}>Tüm verilerin kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misin?</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable onPress={() => setShowDelete(false)} disabled={deleting} style={[styles.modalBtn, { borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>Vazgeç</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} disabled={deleting} style={[styles.modalBtn, { backgroundColor: colors.error }]}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>{deleting ? 'Siliniyor…' : 'Evet, Sil'}</Text>
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
});
