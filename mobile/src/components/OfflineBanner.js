import { useEffect, useState, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const translateY = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected || !state.isInternetReachable;
      setIsOffline((prev) => {
        if (prev && !offline) setWasOffline(true);
        return offline;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isOffline) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    } else if (wasOffline) {
      // Bağlantı gelince 1.5 saniye "Bağlandı" göster, sonra yukarı kaydır
      const timer = setTimeout(() => {
        Animated.timing(translateY, { toValue: -60, useNativeDriver: true, duration: 300 }).start(() =>
          setWasOffline(false)
        );
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isOffline, wasOffline]);

  if (!isOffline && !wasOffline) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY }], backgroundColor: isOffline ? '#b45309' : '#065f46' }]}>
      <Text style={styles.text}>
        {isOffline ? '📡 İnternet bağlantısı yok' : '✓ Bağlantı yeniden kuruldu'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
