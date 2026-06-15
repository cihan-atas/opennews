// API taban adresi.
// Mobil cihaz "localhost"a erişemez → production sunucu adresi varsayılan.
// EXPO_PUBLIC_API_URL ile override edilebilir (yerel geliştirmede LAN IP).
// NOT: EAS build .env'i her zaman okumaz; bu yüzden varsayılan canlı sunucudur.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://129.159.13.148:8090').replace(/\/+$/, '');
