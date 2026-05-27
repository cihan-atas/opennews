# Proje Dönüşüm Özeti — Web → Mobil + GCP Bağımlılığını Azaltma + Yeni Özellikler

> Hedef: Mevcut React web uygulamasını **React Native (Expo)** native mobile'a taşımak, backend'i **sağlayıcı-bağımsız** hale getirmek ve her iki platformda kullanıcı deneyimini artıran yeni özellikler eklemek.

---

## ✅ Faz 0 — Git & Temizlik
- Proje kökünde temiz `git init` yapıldı.
- `.gitignore`: Expo girdileri (`mobile/node_modules`, `.expo/`, `*.keystore`) eklendi; `.env` ve GCP sırları ignore kapsamında doğrulandı.

---

## ✅ Faz 1A — Backend Auth Uyarlaması (mobil için)
Mobilde tarayıcı cookie'si olmadığı için refresh token mekanizması uyarlandı:
- `schemas.py` → `Token` şemasına opsiyonel `refresh_token` alanı eklendi.
- `routers/auth.py`: `X-Client: mobile` header'ı geldiğinde token'lar response body'de dönüyor. Web cookie davranışı korundu.

---

## ✅ Faz 1B–1E — Expo (React Native) Uygulaması → `mobile/`
Expo SDK 56 + React 19 + React Navigation v7.

| Katman | Dosya(lar) |
|---|---|
| Tema / config | `src/theme.js`, `src/config.js` |
| Token saklama | `src/api/storage.js` (`expo-secure-store`) |
| API katmanı | `src/api/client.js` (401→sessiz refresh→retry) |
| Context | `src/contexts/AuthContext.js`, `src/contexts/PlayerContext.js` |
| Navigation | `src/navigation/RootNavigator.js`, `MainTabs.js` |
| Ekranlar | `AuthScreen`, `OnboardingScreen`, `HomeScreen`, `PodcastScreen`, `BookmarksScreen`, `RssReaderScreen`, `SettingsScreen` |
| Bileşenler | `NewsDetailModal.js`, `MiniPlayer.js`, `Toast.js` |

---

## ✅ Faz 2 — GCP Bağımlılığını Azaltma → `services/`

| Servis | Dosya | Sağlayıcılar |
|---|---|---|
| AI metin | `services/ai.py` | `vertex` \| `openai` \| `mock` |
| Embedding | `services/embeddings.py` | `vertex` \| `openai` \| `mock` |
| TTS | `services/tts.py` | `google` \| `edge` (edge-tts, ücretsiz) |
| Depolama | `services/storage.py` | `gcs` \| `s3` \| `local` |

- `config.py`'ye provider seçim değişkenleri eklendi: `AI_PROVIDER`, `EMBEDDING_PROVIDER`, `TTS_PROVIDER`, `STORAGE_PROVIDER`.
- **Varsayılanlar GCP** — mevcut production deploy etkilenmez.
- OpenAI embedding `dimensions=768` ile mevcut `Vector(768)` şemasına uyuyor → DB migration gerekmez.

---

## ✅ Faz 3 — Yerel Geliştirme Ortamı Düzeltmeleri

### Port Çakışması Çözümü
`monitoring-*` Docker container'ları 5432, 8080, 8001 portlarını işgal ediyordu:
- **DB**: `pgvector/pgvector:pg16` → port **5433** (container: `news-and-podcast-db`)
- **API**: uvicorn → port **8899**
- `.env`: `DATABASE_URL` hostunu `db:5432` → `localhost:5433`; `CELERY_BROKER_URL`'i `redis://redis:6379/0` → `redis://localhost:6379/0`

### Mock Provider'lar (API key gerektirmez)
- `AI_PROVIDER=mock`: Article içeriğini doğrudan özetliyor, Vertex/OpenAI gerektirmez.
- `EMBEDDING_PROVIDER=mock`: Deterministik sin-bazlı 768-dim vektör üretir.
- `TTS_PROVIDER=edge`: Microsoft edge-tts, tamamen ücretsiz (`tr-TR-EmelNeural`).
- `STORAGE_PROVIDER=local`: `audio_files/` dizinine yazar, FastAPI `StaticFiles` ile `http://localhost:8899/audio/` üzerinden sunar.

### Başarıyla Test Edilen
- Celery worker (`scraper_queue`, `ai_queue`) ile haber çekimi ve özetleme çalışıyor.
- Podcast üretimi uçtan uca test edildi: `audio_files/podcasts/news_903.mp3` (772 KB).

---

## ✅ Faz 4 — 5 Yeni Özellik (Web + Mobil)

### 1. Push Bildirim Derin Bağlantısı (Mobil)
- `mobile/App.js`: `useNavigationContainerRef()` eklendi.
- `NavigationContainer ref={navigationRef}` bağlandı.
- `podcast_ready` bildirimlerine tıklanınca `MainTabs → Podcasts` sekmesine yönleniyor.

### 2. Podcast İndirme Butonu (Web + Mobil)
- **Web** (`AudioPlayer.jsx`): Float player'a `<a href={src} download>⬇</a>` butonu eklendi.
- **Web** (`Podcast.jsx`): Her podcast kartında da indirme ikonu.
- **Mobil** (`PodcastScreen.js`): `expo-file-system` ile `FileSystem.downloadAsync()`, ardından `expo-sharing` ile paylaş/kaydet.

### 3. Topluluk RSS Kaynakları (Web + Mobil)
- **Backend**: Zaten mevcut `/rss/approved` + `/rss/submit` endpoint'leri kullanıldı — sıfır backend değişikliği.
- **Web** (`RssReader.jsx`): Sol panel tab toggle ("📡 Listelerim" / "🌐 Topluluk"). Onaylı kaynaklar listesi, "+ Listeme Ekle" butonu, "Kaynak Öner" formu.
- **Mobil** (`RssReaderScreen.js`): Toolbar "🌐 Topluluk" butonu → sheet-style Modal ile aynı işlevler.

### 4. Kullanıcı İstatistikleri (Backend + Web + Mobil)
- **Backend** (`routers/users.py`): `GET /users/stats` endpoint'i eklendi → `articles_read`, `week_reads`, `podcasts_count`, `bookmarks_count`, `favorite_category`.
- **Web** (`Settings.jsx`): Profil bölümünün altına "📊 İstatistiklerim" kartı (4 sayaç + en sevilen kategori).
- **Mobil** (`SettingsScreen.js`): Profil bölümünün altına aynı istatistik kartı.

### 5. Koyu / Açık Tema Geçişi (Web + Mobil)
- **Web**:
  - `frontend/src/contexts/ThemeContext.jsx`: `ThemeProvider` + `useTheme()` hook. Tercih `localStorage`'a kaydedilir.
  - `frontend/src/index.css`: CSS custom properties (`:root[data-theme="dark"]` / `[data-theme="light"]`).
  - `Sidebar.jsx`: ☀️/🌙 toggle butonu eklendi.
  - `App.jsx`: `ThemeProvider` ile sarıldı.
- **Mobil**:
  - `mobile/src/contexts/ThemeContext.js`: `ThemeProvider` + `useTheme()`. Tercih `expo-secure-store`'a kaydedilir.
  - `mobile/src/theme.js`: `darkColors` + `lightColors` paleti. `export const colors = darkColors` geriye dönük uyumlu.
  - `SettingsScreen.js`: 🎨 Görünüm bölümü ile `Switch` toggle eklendi.
  - `App.js`: `ThemeProvider` sarmalayıcı + `<StatusBar style="auto" />`.

---

## 🔍 Doğrulama Sonuçları
- **Mobil (Faz 1):** 1014 modül, ~2.7 MB Hermes bundle — temiz derleme.
- **Backend auth (Faz 1A):** 12/12 kontrol geçti.
- **services/ (Faz 2):** 13/13 kontrol geçti.
- **Podcast üretimi (Faz 3):** Mock AI + edge-tts + local storage — uçtan uca başarılı.
- **Expo Web (Faz 4):** `http://localhost:9898` — 5 özellik web'de çalışıyor.

---

## 🚀 Çalıştırma

### Yerel Geliştirme (Docker olmadan, port çakışması varken)
```bash
# 1. Veritabanı (5433 portu — port çakışması varsa)
docker run -d --name news-and-podcast-db \
  -e POSTGRES_USER=utcibu -e POSTGRES_PASSWORD=mavi.elma135 -e POSTGRES_DB=news_and_podcast \
  -p 5433:5432 pgvector/pgvector:pg16

# 2. Redis
docker run -d --name news-and-podcast-redis -p 6379:6379 redis:7-alpine

# 3. Virtualenv & Backend
python3 -m venv /tmp/newsflow_venv
source /tmp/newsflow_venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8899 --reload
# Swagger: http://localhost:8899/docs

# 4. Celery Worker
source /tmp/newsflow_venv/bin/activate
celery -A worker worker --loglevel=info -Q scraper_queue,ai_queue

# 5. Frontend
cd frontend && npm install && npm run dev
# http://localhost:5173

# 6. Expo Web
cd mobile && npm install && npx expo start --web --port 9898
# http://localhost:9898
```

### Docker Compose (Standart — port çakışması yoksa)
```bash
docker compose up --build
# API: http://localhost:8080/docs
```

### Mobil Cihaz
```bash
cd mobile
# .env: EXPO_PUBLIC_API_URL=http://<LAN-IP>:8899  (localhost DEĞİL — cihaz erişemez)
npx expo start
```
