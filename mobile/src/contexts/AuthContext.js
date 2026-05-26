import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../config';
import { apiFetch, setUnauthorizedHandler } from '../api/client';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../api/storage';
import { registerForPushNotifications, sendTokenToServer, removeTokenFromServer } from '../api/notifications';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);     // auth bayrağı (access token)
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const pushTokenRef = useRef(null);

  // Uygulama açılışında saklı token'ı oku.
  useEffect(() => {
    (async () => {
      try {
        const stored = await getAccessToken();
        if (stored) {
          setToken(stored);
          await refreshUser();
        }
      } finally {
        setBootstrapping(false);
      }
    })();
    // refreshUser stabil (useCallback) — bağımlılık eklemeye gerek yok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // client.js refresh başarısız olursa bizi çıkışa zorlasın.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch('/users/me');
      if (res.ok) setUser(await res.json());
    } catch (_) {}
  }, []);

  // FastAPI /auth/login OAuth2PasswordRequestForm bekler → form-urlencoded.
  const login = useCallback(async (identifier, password) => {
    const body = new URLSearchParams();
    body.append('username', identifier);
    body.append('password', password);

    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Client': 'mobile',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      let detail = 'Giriş başarısız.';
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }

    const data = await res.json();
    await setTokens(data.access_token, data.refresh_token);
    setToken(data.access_token);
    await refreshUser();

    // Push token kaydet (hata login'i engellemez)
    try {
      const pt = await registerForPushNotifications();
      pushTokenRef.current = pt;
      await sendTokenToServer(pt);
    } catch (_) {}
  }, [refreshUser]);

  const register = useCallback(async (username, email, password) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
      body: JSON.stringify({ username, email, password }),
    });
    if (!res.ok) {
      let detail = 'Kayıt başarısız.';
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    // Kayıt sonrası otomatik giriş.
    await login(email, password);
  }, [login]);

  const logout = useCallback(async () => {
    // Push token'ı sunucudan sil
    try { await removeTokenFromServer(pushTokenRef.current); } catch (_) {}

    try {
      const refresh = await getRefreshToken();
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'mobile',
          ...(refresh ? { 'X-Refresh-Token': refresh } : {}),
        },
      });
    } catch (_) {}
    await clearTokens();
    pushTokenRef.current = null;
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, user, bootstrapping, isAuthenticated: !!token, login, register, logout, refreshUser, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
