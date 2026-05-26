import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

// Web'deki toast deseninin RN karşılığı (2.2 sn sonra otomatik kapanır).
export function useToast() {
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ show: true, message, type });
  }, []);

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast((p) => ({ ...p, show: false })), 2200);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  return { toast, showToast };
}

export function Toast({ toast }) {
  const insets = useSafeAreaInsets();
  if (!toast.show) return null;
  const isSuccess = toast.type === 'success';
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 12 }]}>
      <View
        style={[
          styles.toast,
          {
            backgroundColor: isSuccess ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)',
            borderColor: isSuccess ? colors.success : colors.error,
          },
        ]}
      >
        <Text style={{ color: isSuccess ? colors.success : colors.error, fontWeight: '700', textAlign: 'center' }}>
          {isSuccess ? '✨ ' : '⚠️ '}{toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9999 },
  toast: { paddingVertical: 12, paddingHorizontal: 22, borderRadius: 16, borderWidth: 1, maxWidth: '90%' },
});
