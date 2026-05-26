# Proje Dönüşüm Özeti — Web → Mobil + GCP Bağımlılığını Azaltma

> Hedef: Mevcut React web uygulamasını **React Native (Expo)** native mobile'a taşımak ve backend'i **sağlayıcı-bağımsız** hale getirerek GCP bağımlılığını azaltmak. Backend (FastAPI) korunur, web frontend (`frontend/`) korunur, mobil `mobile/` olarak eklenir.

---

## ✅ Yapılanlar

### Faz 0 — Git & Temizlik
- Proje kökünde temiz `git init` yapıldı (üst `~/Desktop/.git` deposuna dokunulmadı).
- `.gitignore` güncellendi: Expo girdileri (`mobile/node_modules`, `.expo/`, `*.keystore`, `google-services.json`, `GoogleService-Info.plist`) eklendi.
- Sırların (`.env`, `gcp-service-account.json`) zaten ignore kapsamında olduğu doğrulandı.

### Faz 1A — Backend Auth Uyarlaması (mobil için)
Mobilde tarayıcı cookie'si olmadığı için refresh token mekanizması uyarlandı:
- `schemas.py` → `Token` şemasına opsiyonel `refresh_token` alanı eklendi.
- `routers/auth.py`:
  - `/auth/login` ve `/auth/refresh`, `X-Client: mobile` header'ı geldiğinde refresh token'ı **response body'de** döndürüyor.
  - `/auth/refresh` ve `/auth/logout` artık cookie **veya** `X-Refresh-Token` header'ından okuyor.
  - **Web davranışı (HttpOnly cookie) korundu** — geriye dönük uyumlu.

### Faz 1B–1E — Expo (React Native) Uygulaması → `mobile/`
Expo SDK 56 + React 19 + React Navigation v7.

| Katman | Dosya(lar) |
|---|---|
| Tema / config | `src/theme.js`, `src/config.js` (`EXPO_PUBLIC_API_URL`) |
| Token saklama | `src/api/storage.js` (`expo-secure-store`) |
| API katmanı | `src/api/client.js` (`fetchWithAuth` portu: 401→sessiz refresh→retry) |
| Context | `src/contexts/AuthContext.js`, `src/contexts/PlayerContext.js` |
| Navigation | `src/navigation/RootNavigator.js` (auth-flow), `MainTabs.js` (bottom tabs) |
| Ekranlar | `AuthScreen`, `OnboardingScreen`, `HomeScreen`, `PodcastScreen`, `BookmarksScreen`, `RssReaderScreen`, `SettingsScreen` |
| Bileşenler | `NewsDetailModal.js` (paylaşılan haber detayı), `MiniPlayer.js` (`expo-audio` floating player), `Toast.js` |

- Web'deki tarayıcı bağımlılıkları RN karşılıklarına çevrildi: `localStorage`→`expo-secure-store`, `react-router-dom`→React Navigation, HTML5 audio→`expo-audio`, `navigator.share`→RN `Share`, `navigator.clipboard`→`expo-clipboard`.
- Web'de yarım kalan **tıklama-takibi + kategori öneri** akışı mobilde uçtan uca bağlandı (`/news/{id}/click` → öneri popup).
- Mevcut ~40 endpoint'lik API kontratı korundu.

### Faz 2 — GCP Bağımlılığını Azaltma → `services/`
Backend artık GCP SDK'larını doğrudan çağırmıyor; her şey sağlayıcı-bağımsız katmandan geçiyor.

| Servis | Dosya | Sağlayıcılar |
|---|---|---|
| AI metin (özet/çeviri) | `services/ai.py` | `vertex` (Gemini 2.5 Flash) \| `openai` (gpt-4o-mini) |
| Embedding (768-dim) | `services/embeddings.py` | `vertex` (text-embedding-005) \| `openai` (text-embedding-3-small, `dimensions=768`) |
| TTS | `services/tts.py` | `google` \| `edge` (edge-tts, ücretsiz) |
| Depolama | `services/storage.py` | `gcs` \| `s3` (Cloudflare R2 / MinIO, boto3) |

- `utils.py` fonksiyonları services'e delege ediyor (çağrı siteleri değişmedi); `worker.py` (özet+TTS), `routers/news.py` + `routers/rss_reader.py` (çeviri) services üzerinden geçiyor.
- `config.py`'ye provider seçim değişkenleri eklendi (`AI_PROVIDER`, `EMBEDDING_PROVIDER`, `TTS_PROVIDER`, `STORAGE_PROVIDER`) — **varsayılanlar GCP**, mevcut deploy aynen çalışır.
- `requirements.txt`'e `openai`, `edge-tts`, `boto3` eklendi.
- **Kritik kazanım:** OpenAI embedding `dimensions=768` ile mevcut `Vector(768)` şemasına uyuyor → **DB migration / re-embed gerekmez**.

---

## 🔍 Doğrulama Sonuçları
- **Mobil:** Tüm uygulama Metro ile temiz derlendi — **1014 modül, ~2.7 MB Hermes bundle**.
- **Backend auth (Faz 1A):** Yerel Postgres'e karşı **12/12** kontrol geçti (register, mobil login→body token, web login→null+cookie, mobil refresh rotasyonu, `/users/me`).
- **services/ (Faz 2):** **13/13** kontrol geçti (varsayılanlar GCP, 4 servisin doğru dispatch'i, translate prompt'u).

---

## ⏳ Yapılacaklar (TODO)

### Mobil
- [ ] **Cihazda/emülatörde gerçek E2E test** — bu ortamda cihaz yoktu; derleme doğru ama runtime davranışı (ses oynatma, navigasyon, modal'lar) cihazda denenmeli.
- [ ] **EAS Build** ile App Store / Play Store derlemeleri (iOS için Mac gerekmez).
- [ ] Push bildirimleri (Expo Notifications) — web'de ertelenmişti.
- [ ] Uygulama ikonları/splash görselini markaya göre güncelle.

### GCP'den Tam Çıkış (Faz 2 devamı)
- [ ] `.env`'de sağlayıcıları çevir + anahtarları gir:
  `AI_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai` (+`OPENAI_API_KEY`), `TTS_PROVIDER=edge`, `STORAGE_PROVIDER=s3` (+`S3_*`).
- [ ] `edge-tts`'i gerçek ağda doğrula (sandbox'ta Microsoft endpoint 403 verdi — ortamsal).
- [ ] OpenAI sağlayıcılarını gerçek anahtarla uçtan uca dene.
- [ ] **Hosting taşıma:** Cloud Run → Fly.io / Railway; `.github/workflows/deploy.yml` yeniden yazılmalı.
- [ ] **DB taşıma:** Cloud SQL → Neon / Supabase (pgvector destekli).

### Backend İyileştirme (opsiyonel)
- [ ] **Refresh token `jti` fix:** JWT `sub`+`exp` deterministik olduğundan aynı saniyede çift login/refresh `refresh_tokens` unique çakışması (500) yaratabilir. Token'a rastgele `jti` claim'i eklenerek kapatılabilir.

### Karar Bekleyen
- [ ] Web frontend (`frontend/`) şimdilik korunuyor; ileride emekliye ayrılacak mı?

---

## 🚀 Çalıştırma

### Backend (yerel)
```bash
docker compose up --build          # api + db(pgvector) + redis + worker'lar
# Swagger: http://localhost:8080/docs
```

### Mobil
```bash
cd mobile
cp .env.example .env               # EXPO_PUBLIC_API_URL=http://<LAN-IP>:8080  (localhost DEĞİL)
npm install
npx expo start                     # Expo Go ile telefonda aç, veya emülatör
```
> Mobil cihaz `localhost`'a erişemez; backend'in çalıştığı makinenin LAN IP'sini kullan (`hostname -I`).
