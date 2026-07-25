import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet, Switch, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import Collapsible from '../components/Collapsible';
import IntervalStepper, { INTERVAL_MIN } from '../components/IntervalStepper';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme';
import { groupCategories } from '../utils/categoryTree';

// Bir alanın show_when koşulu mevcut seçime göre görünür mü?
function fieldVisible(field, draft) {
  const cond = field.show_when;
  if (!cond) return true;
  return (cond.in || []).includes(draft[cond.field]);
}

// Her kullanıcıya açık (BYOK): API anahtarları & sağlayıcılar (kategorilere ayrılmış).
// MODÜL DÜZEYİNDE tanımlı → kimliği sabit, TextInput'lar her tuşta remount olmaz
// (klavye kapanma hatasını önler). Şema backend'den (GET /settings) gelir.
function ApiKeysManagerMobile({ colors, styles, showToast }) {
  const [groups, setGroups] = useState([]);
  const [draft, setDraft] = useState({});
  const [secretSet, setSecretSet] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/settings');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const initial = {}; const secrets = {};
      (data.groups || []).forEach((g) => g.fields.forEach((f) => {
        initial[f.key] = f.secret ? '' : (f.value ?? '');
        if (f.secret) secrets[f.key] = !!f.is_set;
      }));
      setGroups(data.groups || []);
      setDraft(initial);
      setSecretSet(secrets);
    } catch (_) {
      showToast('API ayarları yüklenemedi.', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const setVal = (key, value) => setDraft((p) => ({ ...p, [key]: value }));

  const save = async () => {
    setSaving(true);
    const values = {};
    groups.forEach((g) => g.fields.forEach((f) => {
      if (!fieldVisible(f, draft)) return;
      const v = draft[f.key] ?? '';
      if (f.secret) { if (v !== '') values[f.key] = v; }
      else { values[f.key] = v; }
    }));
    try {
      const res = await apiFetch('/settings', { method: 'PUT', body: JSON.stringify({ values }) });
      if (!res.ok) throw new Error();
      showToast('API ayarları kaydedildi.');
      await load();
    } catch (_) { showToast('Kaydedilemedi.', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
        <Text style={{ color: colors.textDim }}>API ayarları yükleniyor…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>🔑 API Anahtarları & Sağlayıcılar</Text>
      <Text style={{ color: colors.textDim, fontSize: 13, marginBottom: 18, lineHeight: 19 }}>
        Kendi anahtarlarını gir — podcast'lerin senin anahtarlarınla üretilir. Her kategoride bir
        sağlayıcı seç ve sadece onun anahtarını gir. Boş bıraktıkların sistem varsayılanına düşer.
        Kırmızı ZORUNLU kategoriler podcast için gereklidir; diğerleri opsiyoneldir.
      </Text>

      {groups.map((g) => (
        <View key={g.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{g.icon} {g.title}</Text>
            <Text style={{
              fontSize: 10, fontWeight: '800', letterSpacing: 0.5, overflow: 'hidden',
              color: g.required ? '#fca5a5' : colors.textDim,
              backgroundColor: g.required ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.12)',
              borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
            }}>{g.required ? 'ZORUNLU' : 'OPSİYONEL'}</Text>
          </View>
          {!!g.note && <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17 }}>{g.note}</Text>}

          {g.fields.filter((f) => fieldVisible(f, draft)).map((f) => (
            <View key={f.key} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: '700' }}>
                  {f.label}{f.required ? ' *' : ''}
                  {f.secret && secretSet[f.key] ? '  ● kayıtlı' : ''}
                </Text>
                {!!f.help && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => Alert.alert(
                      `${f.label} — nasıl alınır?`,
                      f.help + (f.help_url ? `\n\n${f.help_url}` : ''),
                      f.help_url
                        ? [{ text: 'Aç', onPress: () => Linking.openURL(f.help_url) }, { text: 'Kapat', style: 'cancel' }]
                        : [{ text: 'Tamam' }],
                    )}
                    style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.primaryLight, fontSize: 11, fontWeight: '800' }}>i</Text>
                  </Pressable>
                )}
              </View>
              {f.type === 'select' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(f.options || []).map((o) => {
                    const on = (draft[f.key] ?? '') === o.value;
                    return (
                      <Pressable key={o.value} onPress={() => setVal(f.key, o.value)}
                        style={[styles.chip, on && styles.chipOn, { borderColor: colors.border }]}>
                        <Text style={{ color: on ? colors.white : colors.textMuted, fontWeight: '600', fontSize: 12 }}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, marginBottom: 0 }]}
                  value={draft[f.key] ?? ''}
                  onChangeText={(t) => setVal(f.key, t)}
                  secureTextEntry={f.type === 'password'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={f.secret && secretSet[f.key] ? '•••••••• (değiştirmek için yaz)' : ''}
                  placeholderTextColor={colors.textFaint}
                />
              )}
              {!!f.help && <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 4 }}>{f.help}</Text>}
            </View>
          ))}
        </View>
      ))}

      <Pressable onPress={save} disabled={saving} style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>{saving ? 'Kaydediliyor…' : 'API Ayarlarını Kaydet'}</Text>
      </Pressable>
    </View>
  );
}

export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const { toast, showToast } = useToast();
  const { theme, colors, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [allCategories, setAllCategories] = useState([]);
  const [selected, setSelected] = useState([]);
  // Hangi konu grubu açık — Collapsible'ın kendi state'inde tutulamaz, çünkü
  // üst bölüm katlanınca çocuklar unmount olur ve durum sıfırlanırdı.
  const [openGroups, setOpenGroups] = useState({});

  // Gündem bildirimi (haber gündemi + tüm RSS beslemeleri) — kullanıcı başına tek kural.
  const [trend, setTrend] = useState(null);
  const [trendSaving, setTrendSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/rss-reader/trending-notification');
        if (res.ok) setTrend(await res.json());
      } catch (_) { /* sessiz: bölüm yüklenmezse gizli kalır */ }
    })();
  }, []);

  const saveTrend = async () => {
    if (!trend) return;
    setTrendSaving(true);
    try {
      const res = await apiFetch('/rss-reader/trending-notification', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: trend.enabled,
          mode: trend.mode,
          interval_minutes: trend.mode === 'interval' ? (trend.interval_minutes || INTERVAL_MIN) : null,
          grouping: trend.grouping,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '');
      }
      setTrend(await res.json());
      showToast('Gündem bildirimi kaydedildi.');
    } catch (e) {
      showToast(e?.message || 'Kaydedilemedi.', 'error');
    } finally { setTrendSaving(false); }
  };
  const [pw, setPw] = useState({ old_password: '', new_password: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stats, setStats] = useState(null);
  const [adminStats, setAdminStats] = useState(null);

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

      // Admin istatistiği (panel butonundaki bekleyen sayısı için)
      if (user?.is_admin) {
        try {
          const aStatsRes = await apiFetch('/admin/stats');
          if (aStatsRes.ok) setAdminStats(await aStatsRes.json());
        } catch (_) {}
      }
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
    <View style={[styles.container, { paddingTop: insets.top + 12, backgroundColor: colors.bg }]}>
      <Toast toast={toast} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        <Text style={[styles.h1, { color: colors.text }]}>Ayarlar</Text>

        {stats && (
          <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>📊 İstatistiklerim</Text>
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
                  <Text style={[styles.statLabel, { color: colors.textDim }]}>{item.label}</Text>
                </View>
              ))}
            </View>
            {stats.favorite_category && (
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 12 }}>
                En çok okuduğun: <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>{stats.favorite_category}</Text>
              </Text>
            )}
          </View>
        )}

        {/* Yönetim — yalnızca admin */}
        {user?.is_admin && (
          <Pressable
            onPress={() => navigation.navigate('Admin')}
            style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 4 }]}>🛠️ Admin Paneli</Text>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>
                İstatistikler, kaynak ekleme, bekleyen RSS onayı ve kullanıcı yönetimi
                {adminStats?.pending_rss ? ` · ${adminStats.pending_rss} bekleyen` : ''}
              </Text>
            </View>
            <Text style={{ color: colors.primaryLight, fontSize: 22, fontWeight: '800', marginLeft: 12 }}>›</Text>
          </Pressable>
        )}

        {/* API Anahtarları — herkes kendi anahtarını girer */}
        <ApiKeysManagerMobile colors={colors} styles={styles} showToast={showToast} />

        <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🎨 Görünüm</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
                {theme === 'dark' ? '🌙 Koyu Tema' : '☀️ Açık Tema'}
              </Text>
              <Text style={{ color: colors.textFaint, fontSize: 13, marginTop: 2 }}>
                {theme === 'dark' ? 'Karanlık arayüz aktif' : 'Aydınlık arayüz aktif'}
              </Text>
            </View>
            <Switch
              value={theme === 'light'}
              onValueChange={toggleTheme}
              trackColor={{ false: 'rgba(99,102,241,0.3)', true: colors.primary }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>👤 Profil Bilgileri</Text>
          <Text style={[styles.fieldLabel, { color: colors.textDim }]}>KULLANICI ADI</Text>
          <Text style={[styles.fieldValue, { color: colors.text }]}>{user?.username || '—'}</Text>
          <Text style={[styles.fieldLabel, { marginTop: 14, color: colors.textDim }]}>E-POSTA</Text>
          <Text style={[styles.fieldValue, { color: colors.text }]}>{user?.email || '—'}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🔐 Güvenlik</Text>
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="Mevcut Şifre" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.old_password} onChangeText={(t) => setPw({ ...pw, old_password: t })} />
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="Yeni Şifre" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.new_password} onChangeText={(t) => setPw({ ...pw, new_password: t })} />
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="Yeni Şifre (Tekrar)" placeholderTextColor={colors.textFaint}
            secureTextEntry value={pw.confirm} onChangeText={(t) => setPw({ ...pw, confirm: t })} />
          <Pressable onPress={changePassword} disabled={savingPw} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{savingPw ? 'İşleniyor…' : 'Şifreyi Güncelle'}</Text>
          </Pressable>
        </View>

        {trend && (
          <Collapsible
            title="🔥 Gündem Bildirimi"
            titleStyle={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}
            colors={colors}
            badge={trend.enabled ? (
              <View style={styles.countBadge}><Text style={styles.countBadgeText}>açık</Text></View>
            ) : null}
            containerStyle={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}
            headerStyle={{ marginBottom: 0 }}
          >
            <View style={{ marginTop: 14 }}>
              <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
                Haber gündemi ve tüm RSS beslemelerinden derlenen gündem için bildirim.
                Liste bazındaki kurallardan bağımsızdır.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Bildirim gönder</Text>
                <Switch
                  value={!!trend.enabled}
                  onValueChange={(v) => setTrend((p) => ({ ...p, enabled: v }))}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {trend.enabled && (
                <>
                  <Text style={styles.trendLabel}>Ne zaman?</Text>
                  <View style={styles.trendChipRow}>
                    {[{ k: 'immediate', l: 'Hemen (~15 dk)' }, { k: 'interval', l: 'Aralıklı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setTrend((p) => ({ ...p, mode: o.k }))}
                        style={[styles.trendChip, trend.mode === o.k && styles.trendChipOn]}>
                        <Text style={{ color: trend.mode === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {trend.mode === 'interval' && (
                    <View style={{ marginTop: 8 }}>
                      <IntervalStepper
                        value={trend.interval_minutes || INTERVAL_MIN}
                        onChange={(v) => setTrend((p) => ({ ...p, interval_minutes: v }))}
                        colors={colors}
                      />
                    </View>
                  )}

                  <Text style={styles.trendLabel}>Nasıl gelsin?</Text>
                  <View style={styles.trendChipRow}>
                    {[{ k: 'digest', l: 'Tek özet' }, { k: 'individual', l: 'Her makale ayrı' }].map((o) => (
                      <Pressable key={o.k} onPress={() => setTrend((p) => ({ ...p, grouping: o.k }))}
                        style={[styles.trendChip, trend.grouping === o.k && styles.trendChipOn]}>
                        <Text style={{ color: trend.grouping === o.k ? colors.primaryLight : colors.textFaint, fontSize: 12, fontWeight: '700' }}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {trend.configured && !trend.ready && (
                    <Text style={{ color: '#fbbf24', fontSize: 11, marginTop: 10 }}>
                      ⏳ İlk tarama sürüyor — bittikten sonraki yeni haberler bildirilecek.
                    </Text>
                  )}
                </>
              )}

              <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 12, lineHeight: 16 }}>
                Sessiz saatlerde bildirim gönderilmez; biriken haberler aralık bitince
                tek özet olarak gelir. Aralıklı modda yeni haber yoksa da haber verilir.
              </Text>

              <Pressable onPress={saveTrend} disabled={trendSaving}
                style={[styles.outlineBtn, { marginTop: 16 }]}>
                <Text style={{ color: colors.primaryLight, fontWeight: '700' }}>
                  {trendSaving ? 'Kaydediliyor…' : 'Gündem Bildirimini Kaydet'}
                </Text>
              </Pressable>
            </View>
          </Collapsible>
        )}

        <Collapsible
          title="🎯 Haber Tercihleri"
          titleStyle={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}
          colors={colors}
          badge={selected.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{selected.length}</Text>
            </View>
          ) : null}
          containerStyle={[styles.section, { backgroundColor: colors.surfaceAlpha, borderColor: colors.borderSoft }]}
          headerStyle={{ marginBottom: 0 }}
        >
          <View style={{ marginTop: 14 }}>
            {groupCategories(allCategories).map((group) => {
              const groupIds = [group, ...group.children].map((c) => c.id);
              const groupSelected = groupIds.filter((id) => selected.includes(id)).length;
              return (
                <Collapsible
                  key={group.id}
                  open={!!openGroups[group.id]}
                  onToggle={(v) => setOpenGroups((p) => ({ ...p, [group.id]: v }))}
                  title={group.name}
                  titleStyle={{ color: colors.primaryLight, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}
                  colors={colors}
                  badge={groupSelected > 0 ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{groupSelected}</Text>
                    </View>
                  ) : null}
                  containerStyle={{ marginBottom: 14 }}
                >
                  <View style={[styles.chips, { marginTop: 8 }]}>
                    {[group, ...group.children].map((cat) => {
                      const on = selected.includes(cat.id);
                      return (
                        <Pressable key={cat.id} onPress={() => toggle(cat.id)} style={[styles.chip, on && styles.chipOn, { borderColor: colors.border }]}>
                          <Text style={{ color: on ? colors.white : colors.textMuted, fontWeight: '600', fontSize: 13 }}>{cat.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Collapsible>
              );
            })}
            <Pressable onPress={updateInterests} disabled={!canUpdateInterests}
              style={[styles.outlineBtn, !canUpdateInterests && { borderColor: colors.border }]}>
              <Text style={{ color: canUpdateInterests ? colors.primaryLight : colors.textDim, fontWeight: '700' }}>
                {savingInterests ? 'Kaydediliyor…' : 'Kategorileri Kaydet'}
              </Text>
            </Pressable>
          </View>
        </Collapsible>

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
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>⚠️</Text>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Veda Mı Ediyoruz?</Text>
            <Text style={[styles.modalText, { color: colors.textMuted }]}>Tüm verilerin kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misin?</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable onPress={() => setShowDelete(false)} disabled={deleting} style={[styles.modalBtn, { borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Vazgeç</Text>
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

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 28, fontWeight: '900', marginBottom: 20 },
  section: { backgroundColor: colors.surfaceAlpha, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, padding: 22, marginBottom: 18 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 16 },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  fieldValue: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 6 },
  input: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 12, color: colors.text, marginBottom: 12 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: colors.white, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlpha },
  chipOn: { borderColor: colors.primaryLight, backgroundColor: colors.primarySoft },
  // Katlanmış bölümde içeriği görmeden kaç seçim olduğunu gösteren sayaç
  countBadge: {
    backgroundColor: colors.primarySoft, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 1, minWidth: 20, alignItems: 'center',
  },
  countBadgeText: { color: colors.primaryLight, fontSize: 11, fontWeight: '800' },
  // Gündem bildirimi formu
  trendLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  trendChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  trendChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 12 },
  trendChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLight },
  outlineBtn: { borderWidth: 2, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
  dangerBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: radius.xl, padding: 28, width: '100%', maxWidth: 420 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 12 },
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
