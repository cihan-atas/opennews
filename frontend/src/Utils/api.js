// src/utils/api.js

export const fetchWithAuth = async (url, options = {}) => {
  let token = localStorage.getItem('token');
  
  // Varsayılan ayarları ve header'ları oluştur
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Token varsa Authorization header'ına ekle
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 1. Orijinal isteği atıyoruz
  let response = await fetch(url, { ...options, headers });

  // 2. Eğer token süresi dolmuşsa (401 hatası alırsak)[cite: 1]
  if (response.status === 401) {
    try {
      // 3. Arka planda sessizce yeni token almayı dene[cite: 1]
      // credentials: 'include' çok kritik! Tarayıcıdaki HttpOnly Refresh Cookie'yi backend'e taşır.
      const refreshResponse = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include' 
      });

      const data = refreshResponse.ok ? await refreshResponse.json().catch(() => null) : null;

      if (data && data.access_token) {
        // 4. Yeni bileti cebimize (localStorage) koyuyoruz
        localStorage.setItem('token', data.access_token);

        // 5. Başarısız olan o ilk isteği, YENİ biletle güncelleyip TEKRAR ATIYORUZ
        headers['Authorization'] = `Bearer ${data.access_token}`;
        response = await fetch(url, { ...options, headers });

      } else {
        // Refresh başarısız (ölü token, 5xx veya gövdede access_token yok) → kullanıcıyı çıkışa al.
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/auth';
      }
    } catch (error) {
      console.error("Token yenileme hatası:", error);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/auth';
    }
  }

  return response; // Her şey yolundaysa normal cevabı döndür
};