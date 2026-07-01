<div align="center">

<img src="assets/brand/opennews-banner.png" alt="OpenNews" width="600" />

# OpenNews

**Yapay zekâ destekli haber bülteni & podcast platformu — web + mobil**

Onlarca kaynaktan Türkçe haberleri toplar, yapay zekâ ile özetler ve tek tuşla **sesli podcast**'e dönüştürür. Çok sağlayıcılı mimari ve **kendi anahtarını getir (BYOK)** yaklaşımıyla tek bir servise bağımlı değildir.

<br/>

[![Release](https://img.shields.io/github/v/release/cihan-atas/opennews?style=flat-square&color=6366f1)](https://github.com/cihan-atas/opennews/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/cihan-atas/opennews?style=flat-square)](https://github.com/cihan-atas/opennews/commits)
![Platform](https://img.shields.io/badge/platform-web%20%7C%20android-informational?style=flat-square)

<br/>

![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Expo](https://img.shields.io/badge/Expo-React_Native-000020?style=flat-square&logo=expo&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_+_pgvector-336791?style=flat-square&logo=postgresql&logoColor=white)
![Celery](https://img.shields.io/badge/Celery-37814A?style=flat-square&logo=celery&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)

</div>

---

## 🚀 Neden OpenNews?

- 🧠 **Tek sağlayıcıya bağımlı değil.** Yapay zekâ, seslendirme, depolama ve embedding katmanları ayrı ayrı seçilebilir sağlayıcılarla soyutlanmıştır — biri kapanırsa Ayarlar'dan diğerine geçersin.
- 🔑 **Kendi anahtarını getir (BYOK).** Her kullanıcı kendi API anahtarını girer; girmeyen sistem varsayılanına düşer. Sahibin faturası şişmez.
- 💸 **Ücretsiz yığınla çalışır.** Groq (metin), Edge TTS (seslendirme), yerel depolama ile sıfır maliyetle ayağa kalkar.
- 🎙️ **Metinden sese uçtan uca.** Haber → özet → doğal Türkçe anlatı → MP3, arka planda Celery ile.
- 📱 **Web + Mobil.** React web arayüzü ve Expo (React Native) Android uygulaması, aynı API.

---

## ✨ Özellikler

**Haber & Keşif**
- 130+ RSS kaynağından otomatik Türkçe haber akışı (açılışta ve istek üzerine)
- Sesli anlatıma uygun yapay zekâ özetleri
- Semantik arama & "benzer haberler" (pgvector — opsiyonel)
- Trend haberler (son 24 saat, tıklanmaya göre)
- Kategori arama, ilgi alanı önerisi

**Podcast**
- Tek haberden podcast (kısa / orta / uzun süre seçeneği)
- Günün gündeminden birleşik **bülten** podcast'i
- Kişisel RSS okuyucudaki makalelerden podcast
- Podcast transkripti (STT) ve dışarıdan ses → metin

**Kişiselleştirme & Topluluk**
- Kaydedilenler + sonra oku kuyruğu
- Kişisel RSS listeleri
- Topluluk kaynak önerileri (arama çubuğuyla) + admin onayı
- Push bildirim (mobil): podcast hazır olduğunda

**Ayarlar (BYOK)**
- Kategorilere ayrılmış API anahtarları ekranı (web + mobil)
- Her anahtar için "nasıl alınır?" bilgilendirme butonu

---

## 🧩 Sağlayıcılar & BYOK

Her katman `services/` altında sağlayıcı-bağımsız arayüzle soyutlanmıştır. Aktif sağlayıcı `.env` veya kullanıcı Ayarlar'ından seçilir; anahtarlar kullanıcıya özeldir.

| Katman | Ayar | Seçenekler |
|---|---|---|
| **Yapay Zekâ (metin)** | `AI_PROVIDER` | `groq` ⭐, `gemini`, `openai`, `openrouter`, `nvidia`, `mock` |
| **Seslendirme (TTS)** | `TTS_PROVIDER` | `edge` (ücretsiz) ⭐, `polly`, `google` |
| **Depolama** | `STORAGE_PROVIDER` | `local` ⭐, `gcs`, `s3` (R2/MinIO/AWS) |
| **Embedding** | `EMBEDDING_PROVIDER` | `none` ⭐, `local`, `openai`, `vertex` |
| **STT** | `STT_PROVIDER` | `groq` (Whisper) |

**Okuma sırası:** kullanıcının kendi anahtarı → sistem `.env` varsayılanı. Podcast görevleri, isteği yapan kullanıcının anahtarlarıyla çalışır (`services/settings_store.py`).

> **Not (Groq, 2026):** Eski Llama/Qwen modelleri kullanımdan kaldırıldığı için varsayılanlar güncel `openai/gpt-oss-20b` (hızlı) ve `openai/gpt-oss-120b` (kalite) modellerine geçirilmiştir.

---

## 🏗️ Mimari

```
        ┌────────────┐        ┌─────────────┐
        │  Web (Vite)│        │ Mobil (Expo)│
        │  React 19  │        │ React Native│
        └──────┬─────┘        └──────┬──────┘
               └───────────┬──────────┘   JSON / JWT
                           ▼
                  ┌──────────────────┐
                  │  FastAPI (api)   │
                  └───────┬──────────┘
             enqueue      │            read/write
            ┌─────────────┼────────────────────┐
            ▼             ▼                     ▼
     ┌────────────┐  ┌──────────┐       ┌──────────────┐
     │   Redis    │◀▶│  Celery  │──────▶│ PostgreSQL   │
     │  (broker)  │  │ worker(s)│       │ + pgvector   │
     └────────────┘  └────┬─────┘       └──────────────┘
                          │  (kullanıcının anahtarlarıyla)
          ┌───────────────┼──────────────┬──────────────┐
          ▼               ▼              ▼              ▼
      AI sağlayıcı    TTS sağlayıcı   Depolama       Embedding
```

**Kuyruklar:** `scraper_queue` (RSS toplama) · `ai_queue` (özet, embedding, TTS, bülten). Görevler `worker.py` içinde.

---

## 🛠️ Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| **API** | FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 |
| **Kimlik** | JWT (python-jose), bcrypt, rotasyonlu refresh token |
| **Veritabanı** | PostgreSQL 16 + pgvector, Alembic |
| **Kuyruk** | Celery + Redis |
| **Web** | React 19, React Router 7, Vite 8 |
| **Mobil** | Expo (React Native), expo-secure-store |
| **AI/TTS/STT** | Groq, Gemini/Vertex, OpenAI, OpenRouter, NVIDIA NIM, AWS Polly, Edge TTS, Groq Whisper |
| **Depolama** | Yerel disk, GCS, S3-uyumlu |
| **Dağıtım** | Docker Compose (geliştirme) · venv + systemd (sunucu) |

---

## ⚡ Kurulum

### Seçenek A — Docker Compose (geliştirme)

```bash
git clone https://github.com/cihan-atas/opennews.git
cd opennews
cp .env.example .env          # değerleri düzenle
docker compose up -d --build  # db, redis, api, scraper-worker, ai-worker, frontend
```

Arayüz: `http://localhost:5173` · API/Swagger: `http://localhost:8090/docs`

### Seçenek B — venv + systemd (sunucu)

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # düzenle (Redis çalışır olmalı)
# systemd servisleri:
sudo systemctl restart newsapp-api newsapp-worker
sudo journalctl -u newsapp-api -f
```

> Tablolar açılışta otomatik oluşur (`create_all`); temiz kurulumda migration şart değildir.

---

## 🔧 Ortam Değişkenleri

`.env` yalnızca **altyapı** ve **sistem varsayılanları** içindir — API anahtarları zorunlu değildir, kullanıcılar kendi anahtarını Ayarlar'dan girer.

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/news_and_podcast
SECRET_KEY=çok-uzun-rastgele-anahtar
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:8090

AI_PROVIDER=groq            # groq | gemini | openai | openrouter | nvidia | mock
TTS_PROVIDER=edge           # edge | polly | google
STORAGE_PROVIDER=local      # local | gcs | s3
EMBEDDING_PROVIDER=none     # none | local | openai | vertex
```

Tam liste için `config.py` ve `.env.example`'a bakın.

---

## 📱 Mobil Uygulama

`mobile/` altında bir **Expo (React Native)** uygulaması vardır. API adresi `EXPO_PUBLIC_API_URL` ile ayarlanır.

```bash
cd mobile && npm install
npx expo start                # geliştirme
```

**Yerel APK derleme** (Android SDK + JDK 17):

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# → mobile/android/app/build/outputs/apk/release/app-release.apk
```

Hazır APK için [Releases](https://github.com/cihan-atas/opennews/releases) sayfasına bakın.

---

## 📂 Proje Yapısı

```
opennews/
├── main.py              # FastAPI app, router kayıtları, açılış olayları
├── models.py            # SQLAlchemy modelleri (17 tablo)
├── config.py            # Ayarlar + tüm sağlayıcı varsayılanları
├── worker.py            # Celery app + asenkron görevler
├── scraper.py           # RSS toplayıcı  ·  feeds_catalog.py  # 130+ kaynak
├── routers/             # auth, news, podcast, users, settings, admin, ...
├── services/            # ai, tts, stt, storage, embeddings, email, push,
│                        # settings_store (BYOK: kullanıcı→.env çözümleme)
├── alembic/             # Migrasyonlar
├── frontend/            # React 19 + Vite web arayüzü
├── mobile/              # Expo React Native uygulaması
└── docker-compose.yml
```

---

## 🔌 API Özeti

Tam ve etkileşimli dokümantasyon: `http://localhost:8090/docs` (Swagger).

| Grup | Örnek uçlar |
|---|---|
| `/auth` | `register`, `login`, `refresh`, `logout` |
| `/news` | `/`, `/trending`, `/{id}/related`, `/{id}/translate`, `/refresh`, `/bulletin` |
| `/podcast` | `/generate/{news_id}`, `/by-news/{news_id}`, `/{id}/audio`, `/{id}/transcript` |
| `/settings` | `GET` (şema + kullanıcının durumu), `PUT` (kullanıcının anahtarları) — **BYOK** |
| `/users` | `/me`, `/interests`, `/stats`, `/change-password` |
| `/bookmarks`, `/read-later`, `/rss-reader`, `/rss`, `/admin`, `/categories`, `/feed.xml` | — |

---

## 🗺️ Yol Haritası

- [ ] iOS build (Expo) ve TestFlight dağıtımı
- [ ] Web arayüzünde BYOK ayarları için görsel iyileştirmeler
- [ ] Çok sesli / diyalog tarzı podcast (birden çok konuşmacı)
- [ ] Kullanıcı bazlı sağlayıcı kullanım/kota göstergesi
- [ ] Otomatik günlük bülten zamanlaması (cron)
- [ ] İngilizce arayüz + çoklu dil desteği

Öneri ve istekler için [issue açabilirsiniz](https://github.com/cihan-atas/opennews/issues).

---

## 🤝 Katkı

Katkılar memnuniyetle karşılanır!

1. Repoyu fork'layın ve bir dal açın: `git checkout -b feature/harika-ozellik`
2. Değişikliklerinizi yapın; commit mesajlarını açıklayıcı ve **Türkçe** yazın (`feat:`, `fix:`, `docs:` önekleriyle).
3. Push'layıp bir Pull Request açın; ne yaptığınızı ve nedenini kısaca açıklayın.

**İpuçları:** Yeni bir sağlayıcı eklerken ilgili `services/*.py` dosyasındaki sağlayıcı-bağımsız arayüzü takip edin; sırasız/gizli değerler için `config.py` + `settings_store` şemasına anahtar ekleyin. Gizli bilgileri (`.env`, servis hesabı JSON'u) **asla** commit'lemeyin.

---

## 📄 Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır — ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.

---

## 🔒 Güvenlik

- `.env` ve `gcp-service-account.json` sürüm kontrolüne **girmez** (`.gitignore`).
- API anahtarları kullanıcı bazlı `user_settings` tablosunda tutulur; `GET /settings` gizli anahtarların **değerini döndürmez**, yalnızca "ayarlı mı" bilgisini verir.
- Refresh token'lar veritabanında saklanır ve her kullanımda rotasyona tabidir.
- Ses dosyaları imzalı/gecici URL ile sunulur.
- Güvenlik açığı bildirimi için lütfen özel bir issue veya doğrudan iletişim kullanın.

<div align="center"><sub>OpenNews · yapay zekâ ile haber & podcast</sub></div>
