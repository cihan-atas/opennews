import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { groupCategories } from '../utils/categoryTree';

export default function OnboardingScreen() {
  const { refreshUser } = useAuth();
  const { toast, showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/categories/');
        if (res.ok) setCategories(await res.json());
      } catch (_) {
        showToast('Kategoriler yüklenemedi.', 'error');
      }
    })();
  }, [showToast]);

  const toggle = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleFinish = async () => {
    if (selectedIds.length < 2) {
      showToast('Devam etmek için en az 2 kategori seçmelisin!', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/users/interests', {
        method: 'POST',
        body: JSON.stringify({ category_ids: selectedIds }),
      });
      if (res.ok) {
        await refreshUser(); // interests dolunca RootNavigator otomatik Main'e geçer
      } else {
        showToast('Ayarların kaydedilemedi.', 'error');
      }
    } catch (_) {
      showToast('Bağlantı hatası yaşandı.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = selectedIds.length >= 2 && !submitting;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Toast toast={toast} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Seni Neler Heyecanlandırır?</Text>
        <Text style={styles.subtitle}>En az 2 ilgi alanı seçerek dünyanı oluştur.</Text>

        {categories.length === 0 ? (
          <ActivityIndicator color={colors.primaryLight} style={{ marginTop: 40 }} />
        ) : (
          groupCategories(categories).map((group) => (
            <View key={group.id} style={{ marginBottom: 18 }}>
              <Text style={{ color: colors.primaryLight, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                {group.name}
              </Text>
              <View style={styles.chips}>
                {[group, ...group.children].map((cat) => {
                  const selected = selectedIds.includes(cat.id);
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => toggle(cat.id)}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={{ color: selected ? colors.white : colors.textMuted, fontWeight: '600' }}>
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={handleFinish}
          disabled={!canSubmit}
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
        >
          <Text style={{ color: canSubmit ? colors.white : colors.textDim, fontWeight: '700', fontSize: 16 }}>
            {submitting ? 'Hazırlanıyor…' : 'Dünyamı Oluştur'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 24, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 16 },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: 10, marginBottom: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlpha,
  },
  chipSelected: { borderColor: colors.primaryLight, backgroundColor: colors.primarySoft },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  button: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 16, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#1e293b' },
});
