import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Toast } from '../components/Toast';
import { radius } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { apiFetch } from '../api/client';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { toast, showToast } = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [isLogin, setIsLogin] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isForgot) {
        const res = await apiFetch('/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        if (!res.ok) throw new Error('İstek gönderilemedi.');
        showToast('Eğer e-posta kayıtlıysa sıfırlama bağlantısı gönderildi.', 'success');
        setIsForgot(false);
        setIsLogin(true);
      } else if (isLogin) {
        // RootNavigator, login sonrası interests durumuna göre otomatik yönlendirir.
        await login(username.trim(), password);
      } else {
        await register(username.trim(), email.trim(), password);
      }
    } catch (e) {
      showToast(e.message || 'Bir hata oluştu.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Toast toast={toast} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>{isForgot ? 'Şifreni Sıfırla' : isLogin ? 'Hoş Geldiniz' : 'Aramıza Katıl'}</Text>
            <Text style={styles.subtitle}>
              {isForgot
                ? 'Kayıtlı e-postanı gir, sıfırlama bağlantısını gönderelim'
                : isLogin
                ? 'Kişiselleştirilmiş haber bültenin ve podcastlerin burada'
                : 'Kişisel haber akışını oluşturmaya başla'}
            </Text>

            {!isForgot && (
              <>
                <Text style={styles.label}>Kullanıcı Adı{isLogin ? ' veya E-posta' : ''}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={isLogin ? 'Kullanıcı adın' : 'Yeni kullanıcı adın'}
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                />
              </>
            )}

            {(!isLogin || isForgot) && (
              <>
                <Text style={styles.label}>E-posta Adresi</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ornek@mail.com"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
              </>
            )}

            {!isForgot && (
              <>
                <Text style={styles.label}>Şifre</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textFaint}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </>
            )}

            {isLogin && !isForgot && (
              <Pressable onPress={() => setIsForgot(true)} style={{ alignSelf: 'flex-end', marginTop: 12 }}>
                <Text style={styles.switchLink}>Şifremi unuttum?</Text>
              </Pressable>
            )}

            <Pressable
              onPress={handleSubmit}
              disabled={busy}
              style={({ pressed }) => [styles.button, (busy || pressed) && { opacity: 0.85 }]}
            >
              <Text style={styles.buttonText}>
                {busy ? 'Lütfen bekle…' : isForgot ? 'Bağlantı Gönder' : isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
              </Text>
            </Pressable>

            {isForgot ? (
              <View style={styles.switchRow}>
                <Pressable onPress={() => { setIsForgot(false); setIsLogin(true); }}>
                  <Text style={styles.switchLink}>← Giriş ekranına dön</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.switchRow}>
                <Text style={{ color: colors.textMuted }}>
                  {isLogin ? 'Hesabın yok mu?' : 'Zaten üye misin?'}
                </Text>
                <Pressable onPress={() => setIsLogin((p) => !p)}>
                  <Text style={styles.switchLink}>{isLogin ? 'Kayıt Ol' : 'Giriş Yap'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: 'rgba(15,23,42,0.7)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 28,
  },
  title: { fontSize: 30, fontWeight: '800', color: colors.white, textAlign: 'center' },
  subtitle: { color: colors.textMuted, textAlign: 'center', marginTop: 12, marginBottom: 24, fontSize: 14 },
  label: { color: '#cbd5e1', fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: 'rgba(2,6,23,0.5)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: colors.white,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 24 },
  switchLink: { color: colors.primaryLight, fontWeight: '700' },
});
