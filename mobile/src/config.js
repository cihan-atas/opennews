// API taban adresi.
// Mobil cihaz "localhost"a erişemez → geliştirmede makinenin LAN IP'sini kullan.
// mobile/.env içine:  EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
// Expo, EXPO_PUBLIC_ önekli değişkenleri derleme anında process.env'e enjekte eder.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
