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
| AI metin | `services/ai.py` | `vertex` \| `gemini` \| `openai` \| `mock` |
| Embedding | `services/embeddings.py` | `vertex` \| `openai` \| `mock` |
| TTS | `services/tts.py` | `google` \| `edge` (edge-tts, ücretsiz) \| `polly` (Amazon Polly Burcu) |
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

## ✅ Faz 5 — Amazon Polly, Gemini Fonetik Çeviri ve Medya Oynatıcı Transkript Entegrasyonları (YENİ)

### 1. Amazon Polly Burcu Ses Entegrasyonu
- Türkçe ses motoru olarak Amazon Polly'nin yapay zekaya dayalı **neural** modeldeki **Burcu** sesi (`POLLY_VOICE_TR=Burcu`) entegre edildi. 
- [services/tts.py](file:///home/zeus/Desktop/AI-Powered-News-Bulletin-and-Podcast/services/tts.py) dosyasına `_polly_synthesize` fonksiyonu eklenerek AWS Polly entegrasyonu tamamlandı.

### 2. Doğrudan Gemini API ile Fonetik Çeviri & Groq Fallback
- Türkçe Polly sesinin İngilizce terimleri ve kısaltmaları okurken yaşadığı aksan problemlerini aşmak için **fonetik okunuş çevirisi** (`phonetize_english_for_tr_tts`) geliştirildi.
- Bu adım, genel AI sağlayıcı konfigürasyonundan bağımsız olarak doğrudan **Google Gemini API** (`gemini-2.5-flash`) kullanacak şekilde izole edildi.
- Gemini API'nin ücretsiz limitlerindeki (429 Rate Limit) veya 503 geçici kesintilerindeki hata durumlarını aşmak için:
  - **Retry (Yeniden Deneme):** Hata durumunda 2 saniye bekleyerek otomatik 1 kez yeniden deneme eklendi.
  - **Groq Fallback (Yedek):** Gemini'nin tamamen başarısız olması durumunda otomatik olarak **Groq API** (`llama-3.1-8b-instant`) tetiklenerek fonetik çeviri tamamlanır.
- Polly tek ses kullandığı için AI segmentasyon adımı baypas edildi. Bu sayede gereksiz bir AI çağrısı tasarrufu sağlandı.

### 3. Podcast Anlatım Uzunluğunun 20 Cümleye Çıkarılması
- [worker.py](file:///home/zeus/Desktop/AI-Powered-News-Bulletin-and-Podcast/worker.py) içerisindeki özetleme prompt'ları güncellenerek haberlerin 8-12 cümle yerine **18-20 cümle** uzunluğunda zengin anlatımlarla özetlenmesi sağlandı.

### 4. Web ve Mobil Oynatıcıya Transkript (Metin) Desteği
Haber dinlerken aynı anda yazılı metni takip etmeyi sağlayan transkript özelliği uçtan uca uygulandı:
- **`PlayerContext` (Web & Mobil):** Oynatılan parçanın veritabanındaki benzersiz `podcastId` kimliğini saklama özelliği eklendi.
- **Web (`AudioPlayer.jsx`):** Kontroller alanına modern bir **📝 Metin** butonu yerleştirildi. Tıklandığında panel yukarı genişleyerek backend'deki Groq Whisper STT servisi üzerinden dinamik olarak transkript üretir (ve DB'de cache'ler) ve kaydırılabilir şık bir panelde sunar.
- **Mobil (`MiniPlayer.js`):** Kontroller alanına eklenen **📝 Metin** butonu ile backend'den API aracılığıyla transkript istenir. Yüklenme sırasında `ActivityIndicator` animasyonu gösterilir ve metin `ScrollView` ile kaydırılabilir bir kutuda gösterilir.

### 5. Celery Kuyruk ve Scraper Kilitlenme Çözümü
- Haber yenileme butonlarının kilitlenmesi sorunu giderildi. Celery worker'ın `scraper_queue` kuyruğunu dinlememesi nedeniyle scraper görevleri askıda kalıyor ve Redis kilidi açılmıyordu. Celery worker komutuna her iki kuyruk da eklenerek bu sorun kökten çözüldü.

---

## ✅ Faz 6 — Kapsamlı İnceleme: Güvenlik Düzeltmeleri + 4 Yeni Özellik (YENİ)

Web + mobil + backend üç alanda detaylı kod incelemesi yapıldı; doğrulanan hatalar düzeltildi ve dört yeni özellik eklendi. Commit: `9281260`.

### A. Hata Düzeltmeleri
| # | Hata | Düzeltme |
|---|------|----------|
| A1 | Web `/admin` rotası herhangi bir oturum açmış kullanıcıya açıktı | `App.jsx`'e `AdminRoute` guard'ı — `/users/me` ile **backend doğrulamalı** `is_admin` kontrolü, admin değilse `/home`'a yönlendirir. Login'de kullanıcı `localStorage`'a yazılır, çıkışta temizlenir. |
| A2 | Logout cookie silinmiyordu (`set_cookie secure=True` ↔ `delete_cookie secure=False`) | `routers/auth.py` → `delete_cookie` `secure=True` |
| A3 | Mobil login sessizce boş kullanıcıyla başarılı olabiliyordu | `mobile/.../AuthContext.js` → `refreshUser` artık hata fırlatıyor; `login` + açılış yarım oturumu temizliyor |
| A4 | `/rss/approved` admin kontrolü yoktu | `routers/rss.py` → `_require_admin` eklendi |
| A5 | Fonetik dönüşümde her zaman başarısız olan Gemini denemesi (~2 sn gecikme + log kirliliği) | `services/ai.py` → Gemini denemesi kaldırıldı, doğrudan Groq |
| + | Web `api.js` refresh sertleştirme (gövdede `access_token` yoksa çıkış), MiniPlayer `play/seek/mute` `try/catch` | |

### B1. Gerçek Semantik Arama (Yerel Embedding)
- `.env` → `EMBEDDING_PROVIDER=local` (`paraphrase-multilingual-mpnet-base-v2`, 768-dim, ücretsiz, Türkçe).
- `scripts/reembed.py`: mevcut (mock) vektörleri gerçek modelle yeniden hesaplayan tek seferlik bakım scripti.
- ⚠️ Worker ortamında `sentence-transformers` kurulu olmalı; ardından `python -m scripts.reembed` çalıştırılmalı. (Kurulu değilse özetler Groq ile üretilir ama embedding üretimi atlanır → "Benzer Haberler"/semantik arama boş döner.)

### B2. Çoklu Haber "Bülten" Podcast'i (Web + Mobil)
- **Backend**: `worker.process_bulletin_tts_task` — seçilen haberlerin özetlerini tek bir akıcı bülten senaryosunda birleştirir, TTS ile sese çevirir, `Podcast`'e `news_id=None` ile kaydeder.
- **Endpoint**: `POST /news/bulletin` (otomatik veya `news_ids`/`category_id` ile) + `GET /news/bulletin/check?title=` polling.
- **Web** (`Home.jsx`) ve **Mobil** (`HomeScreen.js`): "🎙️ Bülten" / "Günlük Bülten Oluştur" butonu, üretilince MiniPlayer ile oynatılır.

### B3. Admin Paneli Genişletme (Web + Mobil)
- **Backend**: yeni `routers/admin.py` + ortak `dependencies.admin_dependency`:
  - `GET /admin/stats` (kullanıcı/haber/podcast sayıları, en çok tıklanan kategoriler, son 24s haber)
  - `GET /admin/users`, `POST /admin/users/{id}/toggle-admin`, `DELETE /admin/users/{id}` (kendini koruma kontrolleriyle)
- **Web** (`Admin.jsx`): istatistik kartları + kullanıcı yönetim tablosu.
- **Mobil** (`SettingsScreen.js`): `is_admin` ise görünen "🛠️ Yönetim" bölümü (istatistik özeti + bekleyen RSS onay/red).

### B4. Çeviri + Fonetik Cache
- **Çeviri (DB)**: yeni `TranslationCache` modeli + migration `e7a1b2c3d4e5`; `utils.translate_cached` — aynı metin+dil tekrar gelirse AI çağrısı yapılmaz. `news`/`rss` çeviri endpoint'lerine bağlandı.
- **Fonetik (modül içi)**: `services/ai.py phonetize_english_for_tr_tts` sonuçları modül seviyesinde cache'lenir.

> Not: Faz 5'teki "Gemini fonetik + retry/fallback" mantığı bu fazda kaldırıldı (mevcut key bu modeli desteklemiyordu, her seferinde 429 dönüyordu). Artık doğrudan Groq + cache kullanılıyor.

---

## ✅ Faz 7 — 4 Yeni Özellik: Şifre Sıfırlama, Read Later, Podcast Kuyruğu, Semantik Arama Aktivasyonu (YENİ)

İnceleme + kullanıcı önceliklendirmesiyle dört özellik backend + web + mobil üç katmanda eklendi. Commit: `7b2c7cc`.

### 1. Şifre Sıfırlama Akışı
Şu ana kadar yalnızca in-app şifre değiştirme (`PUT /users/change-password`) vardı; "şifremi unuttum" akışı eklendi.
- **Backend**: `models.PasswordResetToken` (tek kullanımlık, 1 saat geçerli) + migration `ca743bf08dbc`.
  - `POST /auth/forgot-password`: e-posta kayıtlı olsun olmasın **her zaman 200** (hesap enumeration önleme); kullanıcı varsa `secrets.token_urlsafe(32)` token üretir, eski kullanılmamış token'ları siler.
  - `POST /auth/reset-password`: token geçerli/süresi dolmamış/kullanılmamış mı kontrol → yeni şifre + token `used=True` + kullanıcının **tüm refresh token'ları silinir** (tüm oturumlar kapanır).
  - `services/email.py`: SMTP yapılandırılmışsa (`config.py` `SMTP_*`) e-posta gönderir, değilse reset linkini **server log'una yazar** (dev modu — SMTP'siz test edilebilir).
- **Web**: `Auth.jsx`'e "Şifremi unuttum?" linki + e-posta formu; yeni `ResetPassword.jsx` sayfası + public `/reset-password?token=` route.
- **Mobil**: `AuthScreen.js`'e forgot-password formu (toast geri bildirimli).

### 2. Sonra Oku (Read Later) Listesi
Kalıcı favori (bookmark) dışında, ayrı bir okuma kuyruğu.
- **Backend**: `models.ReadLaterItem` (UserBookmark deseni) + aynı migration; `routers/read_later.py` (`GET /read-later/`, `POST/DELETE /read-later/{news_id}`, `GET /read-later/check/{news_id}`).
- **Web**: yeni `ReadLater.jsx` sayfası + Sidebar "📑 Sonra Oku" + `/read-later` route; Home detay modalına "📑 Sonra Oku" butonu.
- **Mobil**: yeni `ReadLaterScreen.js` + MainTabs "Sonra" sekmesi (`time-outline`) + NewsDetailModal butonu.

### 3. Arama Geçmişi (client-side, backend yok)
- **Web** (`Home.jsx`): aramalar `localStorage`'da `searchHistory` (son 8, tekrarsız); arama kutusu focus olunca öneri dropdown, tıkla-arat, tek tek ✕ ile sil.
- **Mobil** (`HomeScreen.js`): aynı mantık `expo-secure-store` ile (projede AsyncStorage yok; tema da SecureStore kullanıyor).

### 4. Podcast Kuyruğu + Hız Hafızası
- **`PlayerContext` (Web & Mobil)**: tek-track'ten **kuyruk** modeline genişletildi — `setQueue(tracks, startIndex)`, `playNext/playPrev`, `hasNext/hasPrev`. `setTrack` geriye uyumlu korundu.
- **Web (`AudioPlayer.jsx`)**: oynatma hızı `localStorage`'da kalıcı (track değişse de korunur), parça bitince **otomatik sonraki** (`onEnded`), floating modda ⏮/⏭ butonları.
- **Mobil (`MiniPlayer.js`)**: `expo-audio` `didJustFinish` ile otomatik sonraki, hız `expo-secure-store` + modül cache (remount'ta korunur), ⏮/⏭ butonları.
- **Web (`Podcast.jsx`) + Mobil (`PodcastScreen.js`)**: "▶ Tümünü Sırayla Çal" butonu — tüm kütüphaneyi kuyruğa alır.

### 5. Semantik Aramanın Aktive Edilmesi (Faz 6 B1'in tamamlanması)
- venv'e `sentence-transformers 5.5.1` kuruldu. **Not:** `pip install sentence-transformers` doğrudan CUDA torch wheel'lerini çekip ağ hatası veriyordu; önce **CPU-only torch** kuruldu: `pip install torch --index-url https://download.pytorch.org/whl/cpu`.
- `python -m scripts.reembed` çalıştı: **166/166 haber** `paraphrase-multilingual-mpnet-base-v2` ile yeniden embed edildi. Artık "Benzer Haberler" ve `/news/?search=` gerçek anlamsal sonuç döndürüyor.

---

## 🔍 Doğrulama Sonuçları
- **Mobil (Faz 1):** 1014 modül, ~2.7 MB Hermes bundle — temiz derleme.
- **Backend auth (Faz 1A):** 12/12 kontrol geçti.
- **services/ (Faz 2):** 13/13 kontrol geçti.
- **Podcast üretimi (Faz 3):** Mock AI + edge-tts + local storage — uçtan uca başarılı.
- **Expo Web (Faz 4):** `http://localhost:8081` — 5 özellik web'de çalışıyor.
- **Polly & Gemini TTS (Faz 5):** CERT-In -> "Sörtin" şeklinde doğru fonetik ses ve transkript üretimi sağlandı.
- **Yetki & Admin (Faz 6):** TestClient ile doğrulandı — admin (`cihan@cihan.com`) `/admin/stats`, `/admin/users`, `/rss/approved` → 200; normal user (`cihan@atas.com`) → 403. Çeviri cache round-trip doğrulandı (2. çağrı DB'den). Web `npm run build` temiz; mobil dosyalar babel-parse temiz. Migration `e7a1b2c3d4e5` uygulandı.
- **Canlı çalıştırma (Faz 6):** Web (5173), Expo Web (9898), Backend (8090), Celery worker, Redis ve DB birlikte ayağa kaldırıldı — hepsi HTTP 200. (Embedding üretimi yalnızca `sentence-transformers` kurulu değilse atlanır.)
- **Faz 7:** Şifre sıfırlama akışı DB üzerinden uçtan uca test edildi (token üretimi → dev e-posta log → şifre değişimi → tek kullanımlık token). Yeni route'lar (`/auth/forgot-password`, `/auth/reset-password`, `/read-later/*`) app'e kayıtlı. Web `vite build` temiz (41 modül). Değişen 8 mobil dosya babel-parse temiz. Migration `ca743bf08dbc` uygulandı. `reembed` 166/166 haber — cosine_distance sorgusu sıralı sonuç döndürdü. ⚠️ Native cihaz testi (kuyruk auto-next, hız hafızası) ve prod SMTP henüz yapılmadı.

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

# 3. Virtualenv & Backend (frontend/.env ve mobile/.env → http://localhost:8090)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Semantik arama için (EMBEDDING_PROVIDER=local): sentence-transformers gerekir (requirements.txt'te var)
python -m uvicorn main:app --host 0.0.0.0 --port 8090 --reload
# Swagger: http://localhost:8090/docs

# 4. Celery Worker (Mutlaka iki kuyruğu da dinlemelidir!)
source venv/bin/activate
python -m celery -A worker.celery_app worker --loglevel=info --concurrency=2 -Q ai_queue,scraper_queue

# 4b. (İlk kurulumda / mock'tan local'e geçişte) embedding'leri yeniden üret
python -m scripts.reembed

# 5. Frontend (Web)
cd frontend && npm install && npm run dev
# http://localhost:5173

# 6. Mobil Uygulama (Expo Web)
cd mobile && npm install && npx expo start --web --port 9898
# http://localhost:9898
```

### Docker Compose (Standart — port çakışması yoksa)
```bash
docker compose up --build
# API: http://localhost:8080/docs
```
