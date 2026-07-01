<p align="center">
  <img src="assets/brand/opennews-banner.png" alt="OpenNews" width="560" />
</p>

<h1 align="center">OpenNews</h1>

<p align="center"><em>Yapay zekâ destekli haber bülteni &amp; podcast platformu — web + mobil</em></p>

<p align="center">
<img src="https://img.shields.io/badge/FastAPI-0.124-009688?style=flat&logo=fastapi" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react" />
<img src="https://img.shields.io/badge/Expo-React_Native-000020?style=flat&logo=expo" />
<img src="https://img.shields.io/badge/PostgreSQL-16+pgvector-336791?style=flat&logo=postgresql" />
<img src="https://img.shields.io/badge/Celery-5.3-37814A?style=flat&logo=celery" />
<img src="https://img.shields.io/badge/Redis-broker-DC382D?style=flat&logo=redis" />
<img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=flat&logo=python" />
</p>

---

OpenNews; onlarca RSS kaynağından **Türkçe haberleri otomatik toplar**, her haberi bir yapay zekâ modeliyle **özetler**, dilediğin haberi ya da günün gündemini **sesli podcast'e** dönüştürür ve bunların hepsini bir **React web arayüzü** ile bir **Expo (React Native) mobil uygulaması** üzerinden sunar.

Öne çıkan tasarım kararı: **çok sağlayıcılı + BYOK.** Yapay zekâ, seslendirme, depolama ve embedding katmanları tek bir sağlayıcıya bağlı değildir; her katman için farklı sağlayıcı seçilebilir ve **her kullanıcı kendi API anahtarını** uygulamanın Ayarlar ekranından girebilir (girmeyen kullanıcı sistemin `.env` varsayılanına düşer).

---

## İçindekiler

1. [Özellikler](#özellikler)
2. [Sağlayıcılar (çok-sağlayıcılı & BYOK)](#sağlayıcılar-çok-sağlayıcılı--byok)
3. [Mimari](#mimari)
4. [Teknoloji Yığını](#teknoloji-yığını)
5. [Kurulum](#kurulum)
6. [Ortam Değişkenleri](#ortam-değişkenleri)
7. [Mobil Uygulama](#mobil-uygulama)
8. [Proje Yapısı](#proje-yapısı)
9. [API Özeti](#api-özeti)
10. [Yapay Zekâ Boru Hattı](#yapay-zekâ-boru-hattı)
11. [Veritabanı](#veritabanı)
12. [Operasyon & Geliştirme](#operasyon--geliştirme)
13. [Güvenlik Notları](#güvenlik-notları)

---

## Özellikler

| Özellik | Açıklama |
|---|---|
| **Gerçek zamanlı haber akışı** | `feeds_catalog.py` içinde 130+ RSS kaynağı, çok sayıda kategori; açılışta ve istek üzerine otomatik toplanır |
| **Yapay zekâ özetleme** | Her haber için sesli anlatıma uygun akıcı Türkçe özet (varsayılan sağlayıcı: Groq) |
| **Tek haber podcast'i** | Seçilen haber TTS ile MP3'e dönüştürülür; süre seçeneği kısa/orta/uzun |
| **Günlük bülten** | Birden çok haber tek akıcı bülten senaryosunda birleştirilip tek ses dosyası olarak üretilir |
| **Podcast transkripti (STT)** | Üretilen sesi Groq Whisper ile metne çevirme; ayrıca dışarıdan ses yükleyip yazıya dökme |
| **Semantik arama & benzer haberler** | pgvector embedding ile kosinüs benzerliği (embedding katmanı opsiyonel/kapatılabilir) |
| **Trend haberler** | Son 24 saatte tıklanmaya göre öne çıkanlar |
| **Kişisel RSS okuyucu** | Kendi RSS listelerini oluştur, herhangi bir makaleden podcast üret |
| **Topluluk kaynakları** | Kullanıcılar RSS kaynağı önerir, admin onaylar; arama çubuğuyla kaynak/kategori bulma |
| **Kaydedilenler & sonra oku** | Makaleleri favorilere ekleme ve okuma kuyruğu |
| **İlgi alanları & öneri** | Kişiselleştirilmiş akış; bir kategoride 5 tıklamadan sonra ilgi alanı önerisi; kategori arama |
| **BYOK API anahtarları** | Her kullanıcı kendi AI/TTS/depolama/e-posta anahtarlarını Ayarlar'dan girer; anahtar yoksa `.env`'e düşer |
| **Push bildirim** | Podcast hazır olduğunda mobil push (Expo) |
| **Web + Mobil** | Responsive React web arayüzü ve Expo React Native mobil uygulaması |

---

## Sağlayıcılar (çok-sağlayıcılı & BYOK)

Her katman `services/` altında sağlayıcı-bağımsız bir arayüzle soyutlanmıştır. Aktif sağlayıcı `.env`/Ayarlar'dan seçilir; anahtarlar kullanıcıya özeldir.

| Katman | Ayar | Seçenekler | Not |
|---|---|---|---|
| **Yapay Zekâ (metin)** | `AI_PROVIDER` | `groq` (öneri, ücretsiz), `gemini`, `openai`, `openrouter`, `nvidia`, `mock` | Podcast senaryosu & özet |
| **Seslendirme (TTS)** | `TTS_PROVIDER` | `edge` (ücretsiz, anahtarsız), `polly` (AWS), `google` | |
| **Depolama** | `STORAGE_PROVIDER` | `local` (anahtarsız), `gcs`, `s3` (R2/MinIO/AWS) | Ses dosyaları |
| **Embedding** | `EMBEDDING_PROVIDER` | `none` (kapalı), `local`, `openai`, `vertex` | Semantik arama; düşük RAM için `none` |
| **STT** | `STT_PROVIDER` | `groq` (Whisper) | Transkript |

> **Groq model notu (2026):** Groq eski Llama/Qwen modellerini (llama-3.1-8b-instant, llama-3.3-70b-versatile, llama-4-scout, qwen3-32b) kullanımdan kaldırmaktadır. Varsayılanlar güncel `openai/gpt-oss-20b` (hızlı/bulk) ve `openai/gpt-oss-120b` (kalite) modellerine geçirilmiştir.

**BYOK akışı:** Kullanıcı **Ayarlar → 🔑 API Anahtarları**'ndan bir kategoride sağlayıcı seçer ve yalnızca onun anahtarını girer. Podcast görevleri o kullanıcının anahtarlarıyla çalışır (`services/settings_store.py` → `user_context`). Girilmeyen alanlar sistemin `.env` değerine düşer.

---

## Mimari

```
        ┌────────────┐        ┌────────────┐
        │  Web (Vite)│        │ Mobil (Expo)│
        │  React 19  │        │ React Native│
        └──────┬─────┘        └──────┬─────┘
               │  HTTPS/HTTP JSON     │
               └───────────┬──────────┘
                           ▼
                  ┌──────────────────┐
                  │  FastAPI (api)   │  :8090
                  │  JWT auth        │
                  └───────┬──────────┘
             enqueue      │            read/write
            ┌─────────────┼──────────────────┐
            ▼             ▼                   ▼
     ┌────────────┐  ┌──────────┐     ┌──────────────┐
     │   Redis    │  │ Celery    │     │ PostgreSQL   │
     │  (broker)  │◀▶│ worker(s) │────▶│ + pgvector   │
     └────────────┘  └────┬──────┘     └──────────────┘
                          │  kullanıcının anahtarlarıyla
              ┌───────────┼─────────────┬───────────────┐
              ▼           ▼             ▼               ▼
         AI sağlayıcı  TTS sağlayıcı  Depolama      Embedding
        (Groq/Gemini) (Edge/Polly)  (local/GCS/S3)  (opsiyonel)
```

**Kuyruklar:** `scraper_queue` (RSS toplama, tekil) ve `ai_queue` (özet, embedding, TTS, bülten, RSS podcast). Görevler `worker.py` içinde tanımlıdır.

---

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| **API** | FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 |
| **Kimlik** | JWT (python-jose), bcrypt (passlib), rotasyonlu refresh token |
| **Veritabanı** | PostgreSQL 16 + pgvector, Alembic |
| **Görev kuyruğu** | Celery 5.3 + Redis |
| **Web** | React 19, React Router 7, Vite 8 |
| **Mobil** | Expo (React Native), expo-secure-store, EAS/yerel APK |
| **AI/TTS/STT** | Groq, Google Gemini/Vertex, OpenAI, OpenRouter, NVIDIA NIM, AWS Polly, Edge TTS, Groq Whisper |
| **Depolama** | Yerel disk, Google Cloud Storage, S3-uyumlu (Cloudflare R2 / MinIO / AWS) |
| **Dağıtım** | Docker Compose (geliştirme) · venv + systemd (sunucu) |

---

## Kurulum

### Seçenek A — Docker Compose (geliştirme)

```bash
git clone https://github.com/cihan-atas/opennews.git
cd opennews
cp .env.example .env          # değerleri düzenle (aşağıya bak)
docker compose up -d --build
# Servisler: db, redis, api (:8090), scraper-worker, ai-worker, frontend (:5173)
```

Migrasyonlar (gerekirse):
```bash
docker compose exec api alembic upgrade head
```

> Tablolar açılışta `create_all` ile de oluşturulur; temiz kurulumda migration şart değildir.

### Seçenek B — venv + systemd (production sunucu)

Bu depo bir Oracle/Ubuntu sunucusunda **Docker'sız**, venv + systemd ile çalışmaktadır:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt          # sunucu için requirements.server.txt
cp .env.example .env                      # düzenle
# Redis kurulu ve çalışır olmalı (CELERY_BROKER_URL=redis://127.0.0.1:6379/0)
```

systemd servisleri (`newsapp-api`, `newsapp-worker`) uygulamayı çalıştırır:

```bash
sudo systemctl restart newsapp-api newsapp-worker
sudo systemctl status  newsapp-api newsapp-worker
sudo journalctl -u newsapp-api -f        # canlı log
```

`ExecStart` uvicorn'u `main:app --host 0.0.0.0 --port 8090` ile, worker'ı
`celery -A worker.celery_app worker -Q ai_queue,scraper_queue` ile başlatır.

---

## Ortam Değişkenleri

`.env` yalnızca **altyapı** ve **sistem varsayılanları** içindir. API anahtarları artık zorunlu değildir — kullanıcılar kendi anahtarlarını Ayarlar'dan girebilir. Minimum:

```env
# Veritabanı
DATABASE_URL=postgresql://user:pass@localhost:5432/news_and_podcast
POSTGRES_USER=user
POSTGRES_PASSWORD=pass
POSTGRES_DB=news_and_podcast

# Güvenlik
SECRET_KEY=çok-uzun-rastgele-bir-anahtar

# Celery / Redis
CELERY_BROKER_URL=redis://127.0.0.1:6379/0

# Arayüz
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:8090

# Sağlayıcı seçimi (varsayılan)
AI_PROVIDER=groq            # groq | gemini | openai | openrouter | nvidia | mock
TTS_PROVIDER=edge           # edge | polly | google
STORAGE_PROVIDER=local      # local | gcs | s3
EMBEDDING_PROVIDER=none     # none | local | openai | vertex

# (Opsiyonel) sistem geneli yedek anahtarlar — kullanıcı girmezse kullanılır
# GROQ_API_KEY=...
# GEMINI_API_KEY=...
# AWS_ACCESS_KEY_ID=... / AWS_SECRET_ACCESS_KEY=...
```

Tüm anahtarların tam listesi ve varsayılanları için `config.py` ve `.env.example`'a bakın.

---

## Mobil Uygulama

`mobile/` altında bir **Expo (React Native)** uygulaması vardır. API adresi `mobile/src/config.js` (veya `EXPO_PUBLIC_API_URL`) ile ayarlanır.

```bash
cd mobile
npm install
npx expo start            # geliştirme (Expo Go / emülatör)
```

**Yerel APK derleme** (bulut/EAS olmadan, Android SDK + JDK 17 ile):

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# Çıktı: mobile/android/app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

Alternatif olarak bulut derleme: `eas build -p android --profile preview` (Expo hesabı gerekir).

---

## Proje Yapısı

```
opennews/
├── main.py                # FastAPI app, CORS, açılış olayları, router kayıtları
├── models.py              # SQLAlchemy modelleri (17 tablo)
├── schemas.py             # Pydantic şemaları
├── config.py              # Ayarlar (.env okur, tüm sağlayıcı varsayılanları)
├── database.py            # DB engine + session
├── dependencies.py        # Ortak bağımlılıklar (db, user, admin)
├── worker.py              # Celery app + tüm asenkron görevler
├── scraper.py             # RSS toplayıcı (feedparser + BeautifulSoup)
├── feeds_catalog.py       # 130+ RSS kaynağı + kategorileri
│
├── routers/               # auth, news, podcast, users, categories, bookmarks,
│                          # feed, rss, rss_reader, admin, read_later, settings
│
├── services/              # Sağlayıcı-bağımsız servisler:
│   ├── ai.py              #   metin üretimi (groq/gemini/openai/openrouter/nvidia/mock)
│   ├── tts.py             #   seslendirme (edge/polly/google)
│   ├── stt.py             #   konuşmadan metne (Groq Whisper)
│   ├── storage.py         #   depolama (local/gcs/s3)
│   ├── embeddings.py      #   embedding (none/local/openai/vertex)
│   ├── email.py           #   SMTP (şifre sıfırlama)
│   ├── push.py            #   Expo push bildirim
│   └── settings_store.py  #   BYOK: kullanıcı→.env çözümleme + ayar şeması
│
├── alembic/               # Veritabanı migrasyonları
├── frontend/              # React 19 + Vite web arayüzü (src/components, contexts)
├── mobile/                # Expo React Native uygulaması (src/screens, api, contexts)
└── docker-compose.yml     # Geliştirme yığını
```

---

## API Özeti

Tam ve etkileşimli dokümantasyon: `http://<host>:8090/docs` (Swagger).

| Grup | Örnek uçlar |
|---|---|
| **Auth** `/auth` | `register`, `login`, `refresh`, `logout` |
| **Haberler** `/news` | `/` (arama/kategori/ilgi), `/trending`, `/{id}`, `/{id}/related`, `/{id}/translate`, `/refresh`, `/{id}/click`, `/{id}/feedback`, `/bulletin`, `/bulletin/check` |
| **Podcast** `/podcast` | `/`, `/generate/{news_id}`, `/by-news/{news_id}`, `/{id}/audio`, `/{id}/transcript`, `/transcribe`, `DELETE /{id}` |
| **Ayarlar (BYOK)** `/settings` | `GET` (şema + kullanıcının durumu), `PUT` (kullanıcının anahtarlarını kaydet) |
| **Kullanıcı** `/users` | `/me`, `/interests`, `/stats`, `/change-password` |
| **Kaydedilenler** `/bookmarks`, `/read-later` | ekle / listele / sil |
| **RSS okuyucu** `/rss-reader` | listeler, feed ekleme, makale çekme, makaleden podcast |
| **Topluluk RSS** `/rss` | `submit`, `community`, `pending`, `approve` |
| **Admin** `/admin` | `stats`, `users`, admin yetkisi/silme |
| **Diğer** | `/categories/`, `/feed.xml` |

---

## Yapay Zekâ Boru Hattı

```
1) TOPLA  (run_scraper_task, scraper_queue)
   feedparser + BeautifulSoup → içerik çıkarımı
   source_url UNIQUE + .scraper_seen_urls.json ile tekilleştirme
   her haberde ara kayıt (çökmede veri kaybı yok)

2) ÖZETLE + EMBED  (auto_generate_summaries_and_embeddings_task, ai_queue)
   AI_PROVIDER ile Türkçe özet → News.summary
   EMBEDDING_PROVIDER açıksa vektör → News.embedding (pgvector)

3) PODCAST  (process_news_and_tts_task / bülten / RSS — kullanıcı tetikler)
   with user_context(user_id):        # kullanıcının kendi anahtarları
     senaryo (AI) → dil segmentasyonu → TTS (MP3)
   depolama (local/GCS/S3) → Podcast satırı → push bildirim
```

---

## Veritabanı

17 tablo; öne çıkanlar:

- `users`, `categories`, `user_interests` (M2M)
- `news` (`source_url` UNIQUE, `embedding` `Vector` — pgvector; açılışta eklenti otomatik kurulur)
- `podcasts` (`audio_url` kalıcı; erişim imzalı/gecici URL ile), `translation_cache`
- `user_settings` (**BYOK** — kullanıcı bazlı key/value anahtar deposu)
- `user_clicks`, `user_bookmarks`, `read_later_items`, `summary_feedback`
- `user_rss_lists`, `user_rss_feeds`, `saved_rss_articles`, `community_rss_sources`
- `refresh_tokens`, `password_reset_tokens`, `push_tokens`

---

## Operasyon & Geliştirme

**systemd (sunucu):**
```bash
sudo systemctl restart newsapp-api newsapp-worker
sudo journalctl -u newsapp-worker -n 50 --no-pager
```

**Docker (geliştirme):**
```bash
docker compose up -d --build api ai-worker scraper-worker frontend
docker compose logs -f ai-worker
```

**Migrasyon (model değişince):**
```bash
alembic revision --autogenerate -m "değişiklik"
alembic upgrade head
```

**Scraper'ı elle çalıştırma:** `python scraper.py`

---

## Güvenlik Notları

- `gcp-service-account.json` ve `.env` **asla** versiyon kontrolüne girmez (`.gitignore`).
- API anahtarları kullanıcı bazlı `user_settings` tablosunda tutulur; `GET /settings` gizli anahtarların değerini **döndürmez**, yalnızca "ayarlı mı" (`is_set`) bilgisini verir.
- Refresh token'lar veritabanında saklanır ve her kullanımda rotasyona tabidir.
- Ses dosyaları GCS/S3'te imzalı/gecici URL ile sunulur (kalıcı public link değil).
- CORS `FRONTEND_URL` ile denetlenir.
```
