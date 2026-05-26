// fetchWithAuth'un React Native portu (frontend/src/Utils/api.js).
// Fark: refresh token cookie yerine X-Refresh-Token header'ı ile gider,
// access/refresh token expo-secure-store'da saklanır.
import { API_URL } from '../config';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './storage';

// 401 → refresh başarısız olursa AuthContext'i çıkışa zorlamak için kayıtlı callback.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

let refreshPromise = null;

// Eşzamanlı 401'lerde tek bir refresh isteği atılsın diye paylaşılan promise.
async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refresh = await getRefreshToken();
    if (!refresh) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'mobile',
          'X-Refresh-Token': refresh,
        },
      });
      if (!res.ok) return false;
      const data = await res.json();
      await setTokens(data.access_token, data.refresh_token);
      return true;
    } catch (_) {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const token = await getAccessToken();

  const buildHeaders = (accessToken) => ({
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
    ...(options.headers || {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  });

  let response = await fetch(url, { ...options, headers: buildHeaders(token) });

  if (response.status === 401) {
    const ok = await refreshAccessToken();
    if (ok) {
      const newToken = await getAccessToken();
      response = await fetch(url, { ...options, headers: buildHeaders(newToken) });
    } else {
      await clearTokens();
      if (onUnauthorized) onUnauthorized();
    }
  }

  return response;
}

// JSON gövdesini güvenli çözen yardımcı.
export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}
