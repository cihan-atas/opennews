import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme';
import { groupCategories } from '../utils/categoryTree';

export default function AdminScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);

  const [processing, setProcessing] = useState(null);     // pending rss id
  const [userProcessing, setUserProcessing] = useState(null);
  const [rssCat, setRssCat] = useState({});               // { [id]: category_id } onay override

  // Yeni onaylı kaynak ekleme
  const [addForm, setAddForm] = useState({ url: '', title: '', category_id: null });
  const [adding, setAdding] = useState(false);
  // Yeni kategori
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, catRes, pendingRes, approvedRes] = await Promise.all([
        apiFetch('/admin/stats'),
        apiFetch('/admin/users'),
        apiFetch('/categories/'),
        apiFetch('/rss/pending'),
        apiFetch('/rss/approved'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (catRes.ok) setCategories(await catRes.json());
      if (pendingRes.ok) setPending(await pendingRes.json());
      if (approvedRes.ok) setApproved(await approvedRes.json());
    } catch (_) {
      showToast('Veriler yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleApprove = async (id) => {
    setProcessing(id);
    try {
      const chosen = rssCat[id];
      const src = pending.find((s) => s.id === id);
      const catId = chosen !== undefined ? chosen : (src ? src.category_id : null);
      const res = await apiFetch(`/rss/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ category_id: catId ?? null }),
      });
      if (res.ok) {
        const updated = await res.json();
        showToast('Kaynak onaylandı.');
        setPending((p) => p.filter((s) => s.id !== id));
        if (src) setApproved((a) => [{ ...src, category_id: updated.category_id, category: updated.category }, ...a]);
      } else {
        showToast('İşlem başarısız.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setProcessing(null); }
  };

  const handleReject = async (id) => {
    setProcessing(id);
    try {
      const res = await apiFetch(`/rss/${id}/reject`, { method: 'POST' });
      if (res.ok) { setPending((p) => p.filter((s) => s.id !== id)); showToast('Kaynak reddedildi.'); }
      else showToast('İşlem başarısız.', 'error');
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setProcessing(null); }
  };

  const handleAdd = async () => {
    if (!addForm.url.trim()) return;
    setAdding(true);
    try {
      const res = await apiFetch('/rss/admin/add', {
        method: 'POST',
        body: JSON.stringify({
          url: addForm.url.trim(),
          title: addForm.title.trim() || null,
          category_id: addForm.category_id,
        }),
      });
      if (res.ok) {
        const src = await res.json();
        setApproved((a) => [src, ...a]);
        setAddForm({ url: '', title: '', category_id: null });
        showToast('Kaynak eklendi ve yayında!');
      } else {
        showToast((await res.json()).detail || 'Eklenemedi.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setAdding(false); }
  };

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const res = await apiFetch('/categories/', {
        method: 'POST',
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories((c) => [...c, created]);
        setAddForm((f) => ({ ...f, category_id: created.id }));
        setNewCatName('');
        showToast(`"${created.name}" kategorisi oluşturuldu.`);
      } else {
        showToast((await res.json()).detail || 'Kategori oluşturulamadı.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setCreatingCat(false); }
  };

  const handleToggleAdmin = async (id) => {
    setUserProcessing(id);
    try {
      const res = await apiFetch(`/admin/users/${id}/toggle-admin`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setUsers((us) => us.map((u) => (u.id === id ? { ...u, is_admin: updated.is_admin } : u)));
        showToast(updated.is_admin ? 'Admin yetkisi verildi.' : 'Admin yetkisi kaldırıldı.');
      } else {
        showToast((await res.json().catch(() => ({}))).detail || 'İşlem başarısız.', 'error');
      }
    } catch (_) { showToast('Bağlantı hatası.', 'error'); }
    finally { setUserProcessing(null); }
  };

  const handleDeleteUser = (id, username) => {
    Alert.alert(
      'Kullanıcıyı sil',
      `"${username}" kullanıcısını ve tüm verilerini kalıcı olarak silmek istediğine emin misin?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive', onPress: async () => {
            setUserProcessing(id);
            try {
              const res = await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
              if (res.ok) { setUsers((us) => us.filter((u) => u.id !== id)); showToast('Kullanıcı silindi.'); }
              else showToast((await res.json().catch(() => ({}))).detail || 'Silinemedi.', 'error');
            } catch (_) { showToast('Bağlantı hatası.', 'error'); }
            finally { setUserProcessing(null); }
          },
        },
      ],
    );
  };

  const CatChip = ({ cat, active, onPress }) => (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, { color: active ? colors.primaryLight : colors.textDim }]}>{cat.name}</Text>
    </Pressable>
  );

  // Ana kategori -> alt kategori gruplu, kaydırılabilir kategori seçici.
  const CatPicker = ({ selectedId, onSelect }) => (
    <View style={{ maxHeight: 200 }}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {groupCategories(categories).map((group) => (
          <View key={group.id} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.primaryLight, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 }}>{group.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[group, ...group.children].map((cat) => (
                <CatChip key={cat.id} cat={cat} active={selectedId === cat.id}
                  onPress={() => onSelect(selectedId === cat.id ? null : cat.id)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Toast toast={toast} />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>← Geri</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>🛠️ Admin Paneli</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primaryLight} size="large" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>

          {/* İstatistikler */}
          {stats && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Sistem İstatistikleri</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {[
                  { label: 'Kullanıcı', value: stats.users, sub: `${stats.admins} admin` },
                  { label: 'Haber', value: stats.news, sub: `24s: ${stats.news_last_24h}` },
                  { label: 'Podcast', value: stats.podcasts, sub: 'üretilen' },
                  { label: 'Bekleyen RSS', value: stats.pending_rss, sub: 'onay bekliyor' },
                ].map((c) => (
                  <View key={c.label} style={styles.statCard}>
                    <Text style={styles.statValue}>{c.value}</Text>
                    <Text style={styles.statLabel}>{c.label}</Text>
                    <Text style={styles.statSub}>{c.sub}</Text>
                  </View>
                ))}
              </View>
              {stats.top_categories?.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center' }}>
                  <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: '700' }}>En çok tıklanan:</Text>
                  {stats.top_categories.map((tc) => (
                    <View key={tc.name} style={styles.tag}>
                      <Text style={styles.tagText}>{tc.name} · {tc.clicks}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Yeni onaylı kaynak ekle */}
          <View style={[styles.section, { borderColor: colors.primaryLight }]}>
            <Text style={styles.sectionTitle}>➕ Yeni Onaylı Kaynak Ekle</Text>
            <TextInput
              style={styles.input}
              placeholder="https://example.com/feed.xml"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="url"
              value={addForm.url}
              onChangeText={(v) => setAddForm((f) => ({ ...f, url: v }))}
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="Başlık (görünen isim, opsiyonel)"
              placeholderTextColor={colors.textFaint}
              value={addForm.title}
              onChangeText={(v) => setAddForm((f) => ({ ...f, title: v }))}
            />
            <Text style={styles.fieldLabel}>Kategori</Text>
            <CatPicker selectedId={addForm.category_id}
              onSelect={(id) => setAddForm((f) => ({ ...f, category_id: id }))} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <TextInput
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                placeholder="+ Yeni kategori adı"
                placeholderTextColor={colors.textFaint}
                value={newCatName}
                onChangeText={setNewCatName}
              />
              <Pressable onPress={handleCreateCategory} disabled={creatingCat || !newCatName.trim()}
                style={[styles.smallBtn, { opacity: (creatingCat || !newCatName.trim()) ? 0.4 : 1 }]}>
                <Text style={styles.smallBtnText}>{creatingCat ? '…' : 'Oluştur'}</Text>
              </Pressable>
            </View>
            <Pressable onPress={handleAdd} disabled={adding || !addForm.url.trim()}
              style={[styles.primaryBtn, { opacity: (adding || !addForm.url.trim()) ? 0.4 : 1 }]}>
              <Text style={styles.primaryBtnText}>{adding ? 'Ekleniyor…' : '✓ Onaylı Olarak Ekle'}</Text>
            </Pressable>
          </View>

          {/* Bekleyen kaynaklar */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⏳ Bekleyen Kaynaklar ({pending.length})</Text>
            {pending.length === 0 ? (
              <Text style={{ color: colors.textDim, fontSize: 13 }}>Bekleyen kaynak yok.</Text>
            ) : (
              pending.map((src) => (
                <View key={src.id} style={styles.itemRow}>
                  {!!src.title && <Text style={styles.itemTitle}>{src.title}</Text>}
                  <Text style={styles.itemUrl} numberOfLines={1}>{src.url}</Text>
                  <Text style={styles.fieldLabel}>Kategori</Text>
                  <CatPicker
                    selectedId={rssCat[src.id] !== undefined ? rssCat[src.id] : src.category_id}
                    onSelect={(id) => setRssCat((p) => ({ ...p, [src.id]: id }))} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <Pressable onPress={() => handleApprove(src.id)} disabled={processing === src.id}
                      style={[styles.approveBtn, { opacity: processing === src.id ? 0.5 : 1 }]}>
                      <Text style={styles.approveText}>✓ Onayla</Text>
                    </Pressable>
                    <Pressable onPress={() => handleReject(src.id)} disabled={processing === src.id}
                      style={[styles.rejectBtn, { opacity: processing === src.id ? 0.5 : 1 }]}>
                      <Text style={styles.rejectText}>✕ Reddet</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Onaylı kaynaklar */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✅ Onaylı Kaynaklar ({approved.length})</Text>
            {approved.length === 0 ? (
              <Text style={{ color: colors.textDim, fontSize: 13 }}>Henüz onaylı kaynak yok.</Text>
            ) : (
              approved.map((src) => (
                <View key={src.id} style={styles.itemRow}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      {!!src.title && <Text style={styles.itemTitle}>{src.title}</Text>}
                      <Text style={styles.itemUrl} numberOfLines={1}>{src.url}</Text>
                    </View>
                    {!!src.category && <View style={styles.tag}><Text style={styles.tagText}>{src.category}</Text></View>}
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Kullanıcı yönetimi */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👥 Kullanıcılar ({users.length})</Text>
            {users.map((u) => (
              <View key={u.id} style={styles.itemRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.itemTitle}>{u.username}</Text>
                  {u.is_admin && <View style={styles.tag}><Text style={styles.tagText}>ADMIN</Text></View>}
                </View>
                <Text style={styles.itemUrl}>{u.email}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <Pressable onPress={() => handleToggleAdmin(u.id)} disabled={userProcessing === u.id || u.id === user?.id}
                    style={[styles.toggleBtn, { opacity: (userProcessing === u.id || u.id === user?.id) ? 0.4 : 1 }]}>
                    <Text style={styles.toggleText}>{u.is_admin ? 'Adminliği al' : 'Admin yap'}</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteUser(u.id, u.username)} disabled={userProcessing === u.id || u.id === user?.id}
                    style={[styles.rejectBtn, { flex: 0, paddingHorizontal: 18, opacity: (userProcessing === u.id || u.id === user?.id) ? 0.4 : 1 }]}>
                    <Text style={styles.rejectText}>Sil</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: 'rgba(99,102,241,0.12)' },
  h1: { fontSize: 24, fontWeight: '800' },
  section: { backgroundColor: c.surfaceAlpha, borderColor: c.borderSoft, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionTitle: { color: c.text, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  statCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, minWidth: '46%', flexGrow: 1 },
  statValue: { color: c.primaryLight, fontSize: 22, fontWeight: '800' },
  statLabel: { color: c.text, fontWeight: '700', fontSize: 13, marginTop: 4 },
  statSub: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  tag: { backgroundColor: 'rgba(99,102,241,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { color: c.primaryLight, fontSize: 11, fontWeight: '800' },
  input: { backgroundColor: c.bg, borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 14 },
  fieldLabel: { color: c.textFaint, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 6, textTransform: 'uppercase' },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipActive: { backgroundColor: 'rgba(99,102,241,0.25)' },
  chipText: { fontSize: 11, fontWeight: '800' },
  primaryBtn: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: c.white, fontWeight: '800', fontSize: 14 },
  smallBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  smallBtnText: { color: c.white, fontWeight: '700', fontSize: 13 },
  itemRow: { borderTopWidth: 1, borderTopColor: c.borderSoft, paddingVertical: 12 },
  itemTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
  itemUrl: { color: c.textDim, fontSize: 12, marginTop: 2 },
  approveBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center' },
  approveText: { color: '#10b981', fontWeight: '700' },
  rejectBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: 'rgba(239,68,68,0.12)', alignItems: 'center' },
  rejectText: { color: '#ef4444', fontWeight: '700' },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: 'rgba(99,102,241,0.15)', alignItems: 'center' },
  toggleText: { color: c.primaryLight, fontWeight: '700' },
});
