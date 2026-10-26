# OpenNews — AI Destekli Haber Bülteni & Podcast Platformu

> Gerçek zamanlı haber akışını yapay zeka ile özetleyen, sesli podcast'e dönüştüren ve hem web hem mobil üzerinden sunan tam yığın (full-stack), bulut-yerel (cloud-native) bir uygulama.

---

## 🎯 Proje Özeti

OpenNews, 100+ RSS kaynağından otomatik olarak haber toplayan; her haberi bir **LLM (Büyük Dil Modeli)** ile Türkçe özetleyen; bu özetleri **metinden-sese (TTS)** dönüştürerek kişiselleştirilmiş podcast üreten; ve **vektör tabanlı anlamsal arama** ile içerik keşfi sağlayan bir platformdur.

Uygulama; React tabanlı bir **web istemcisi**, React Native (Expo) tabanlı bir **mobil uygulama** ve FastAPI tabanlı **asenkron bir backend**'den oluşur. Tüm yapay zeka ve altyapı bağımlılıkları **sağlayıcı-bağımsız (provider-agnostic)** bir servis katmanı arkasına soyutlanmıştır; böylece ücretli bulut servisleri (GCP) ile ücretsiz alternatifler (Groq, Edge TTS, yerel embedding, R2/MinIO) arasında tek bir ayar değişikliğiyle geçiş yapılabilir.

---

## ✨ Öne Çıkan Özellikler

| Özellik | Açıklama |
|---|---|
| **Gerçek Zamanlı Haber Akışı** | 100+ Türkçe RSS kaynağı, 22 ana + 192 alt kategori; uygulama açılışında ve talep üzerine otomatik toplama |
| **AI Özetleme** | LLM ile 8–12 cümlelik, sesli anlatıma optimize edilmiş Türkçe özetler |
| **Podcast Üretimi** | AI özetlerinin TTS ile MP3'e dönüştürülmesi; bulut/yerel depolama, imzalı URL ile yayın |
| **Anlamsal Arama** | pgvector + 768 boyutlu embedding ile kosinüs benzerliği üzerinden arama |
| **Benzer Haberler** | Embedding benzerliğine dayalı "ilgini çekebilir" önerileri |
| **Gündem / Trend** | Son 24 saatte tıklanma aktivitesine göre öne çıkan haberler |
| **Kişisel RSS Okuyucu** | Kullanıcının kendi RSS beslemelerini ekleyip listelemesi, herhangi bir makaleden podcast üretmesi |
| **Topluluk RSS** | Kullanıcıların yeni kaynak önermesi, admin onay/red akışı |
| **Çoklu Haber Bülteni** | Birden fazla haberden tek bir birleşik podcast üretimi |
| **Podcast Kuyruğu** | Sırayla otomatik oynatma, hız hafızası, ⏮/⏭ kontrolleri |
| **Podcast Transkripti** | Konuşmadan metne (STT) ile altyazı, veritabanı önbellekli |
| **Çeviri (TR↔EN)** | LLM ile içerik çevirisi, kalıcı önbellekli |
| **AI Geri Bildirimi** | Her özet için olumlu/olumsuz oylama |
| **Akıllı Kategori Önerisi** | Bir kategoride 5 tıklamadan sonra ilgi alanına ekleme önerisi |
| **Auth & Güvenlik** | JWT erişim + döndürülen refresh token, bcrypt, şifre sıfırlama (e-posta), admin panel |
| **Sonra Oku & Yer İmleri** | Makale kaydetme ve oturumlar arası senkron yönetim |
| **Koyu/Açık Tema** | Web ve mobilde kalıcı tema tercihi |
| **Çevrimdışı Algılama** | Mobilde bağlantı durumu bandı |

---

## 🏗️ Mimari

```
┌─────────────────┐     ┌─────────────────┐
│   React Web     │     │  React Native   │
│   (Vite)        │     │  (Expo)         │
└────────┬────────┘     └────────┬────────┘
         │      REST + JWT       │
         └───────────┬───────────┘
                     ▼
            ┌──────────────────┐
            │   FastAPI API    │  ← 11 router, global hata yakalama, CORS
            └────────┬─────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌────────┐ ┌──────────────┐
│ PostgreSQL   │ │ Redis  │ │ Celery       │
│ + pgvector   │ │(broker)│ │ Workers      │
│ (16 tablo)   │ └────────┘ │ scraper_queue│
└──────────────┘            │ ai_queue (4x)│
                            └──────┬───────┘
                                   ▼
              ┌────────────────────────────────────┐
              │   Sağlayıcı-Bağımsız Servis Katmanı │
              │   services/ai.py    (LLM)           │
              │   services/embeddings.py            │
              │   services/tts.py   (TTS)           │
              │   services/storage.py               │
              │   services/stt.py / email / push    │
              └────────────────────────────────────┘
```

### Asenkron İş Akışı

```
Açılış / POST /news/refresh
        ▼
run_scraper_task ──▶ scraper_queue (eşzamanlılık=1, URL yarışını önler)
        │   feedparser ile RSS parse → BeautifulSoup ile içerik çıkarımı
        │   source_url UNIQUE + .scraper_seen_urls.json ile tekilleştirme
        ▼
auto_generate_summaries_and_embeddings_task ──▶ ai_queue
        │   ├─ LLM ile özet
        │   └─ 768-dim embedding (anlamsal arama + benzer haberler)
        ▼
Kullanıcı podcast isteği:
process_news_and_tts_task ──▶ ai_queue
        ├─ LLM ile podcast senaryosu  ├─ TTS ile MP3
        ├─ Fonetik EN→TR okunuş düzeltme   └─ Depolamaya yükle + DB kaydı
```

---

## 🛠️ Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| **Backend API** | FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 |
| **Kimlik Doğrulama** | JWT (python-jose), bcrypt (passlib), HttpOnly refresh token rotasyonu |
| **Veritabanı** | PostgreSQL 16, pgvector eklentisi, Alembic migration'ları |
| **Görev Kuyruğu** | Celery 5.3, Redis (message broker) |
| **AI — Özetleme/Çeviri** | Sağlayıcı-bağımsız: Groq (Llama 3.x / Llama 4), Gemini, OpenAI, Vertex AI, OpenRouter, NVIDIA NIM |
| **AI — Embedding** | Yerel `sentence-transformers` (multilingual, 768-dim) veya Vertex/OpenAI |
| **AI — Ses (TTS)** | Google TTS, Amazon Polly (Neural), Microsoft Edge TTS |
| **AI — Konuşmadan Metne (STT)** | Groq Whisper (large-v3-turbo) |
| **Depolama** | Google Cloud Storage / S3-uyumlu (Cloudflare R2, MinIO) / yerel disk |
| **Web Frontend** | React 19, React Router 7, Vite, Context API |
| **Mobil** | React Native (Expo SDK 56), React Navigation v7, expo-secure-store, expo-audio |
| **Altyapı** | Docker, Docker Compose, Fly.io / Cloud Run uyumlu |
| **Dil** | Python 3.11, JavaScript (ES2022) |

---

## 🤖 Yapay Zeka Mühendisliği Detayları

Proje, gerçek bir LLM uygulamasında karşılaşılan **maliyet, hız ve limit** kısıtlarını çözmeye odaklanmış çok katmanlı bir yapay zeka tasarımı içerir:

- **Model seviyelendirme (tiering):** Yüksek hacimli haber özetleri için hızlı/ucuz model (`llama-3.1-8b-instant`, 14.4K istek/gün); düşük hacimli ama kaliteli işler (podcast senaryosu, çeviri) için güçlü model (`llama-4-scout-17b`).
- **Fonetik dönüşüm:** Türkçe TTS'in yabancı terimleri yanlış okumasını engellemek için EN→TR okunuş çevirisi (LLM tabanlı, modül-içi önbellekli).
- **Önbellekleme:** Çeviriler veritabanında (`TranslationCache`), embedding'ler kalıcı pgvector kolonunda, transkriptler DB'de saklanır — tekrar maliyeti sıfırlanır.
- **Anlamsal arama:** Haber başlık + içeriğinden üretilen 768 boyutlu vektörler üzerinde kosinüs mesafesiyle arama ve "benzer haberler" önerisi.
- **Tam soyutlama:** Tüm AI çağrıları `services/` altındaki tek bir arayüzden geçer; `AI_PROVIDER`, `EMBEDDING_PROVIDER`, `TTS_PROVIDER`, `STORAGE_PROVIDER` ortam değişkenleriyle sağlayıcı anında değiştirilebilir. `mock` sağlayıcılar API anahtarı olmadan geliştirme imkânı verir.

---

## 🗄️ Veri Modeli

SQLAlchemy ile tanımlı **16 tablo**: `users`, `news`, `podcasts`, `categories`, `refresh_tokens`, `user_clicks`, `user_rss_lists`, `user_rss_feeds`, `community_rss_sources`, `summary_feedback`, `user_bookmarks`, `push_tokens`, `translation_cache`, `saved_rss_articles`, `password_reset_tokens`, `read_later_items`.

**Önemli tasarım kararları:**
- `news.source_url` → `UNIQUE`: veritabanı seviyesinde tekrarlı toplamayı engeller.
- `news.embedding` → `Vector(768)`: pgvector ile anlamsal arama.
- Podcast ses dosyaları kalıcı saklanmaz; her istekte süreli **imzalı URL** üretilir.
- Tüm zaman damgaları UTC (`timezone=True`).
- Refresh token'lar hash'lenmiş saklanır ve her kullanımda döndürülür (rotation).

---

## 📂 Proje Yapısı

```
.
├── main.py / config.py / database.py / dependencies.py
├── models.py / schemas.py / utils.py
├── worker.py                # Celery uygulaması + tüm asenkron görevler
├── scraper.py               # feedparser + BeautifulSoup RSS toplayıcı
├── feeds_catalog.py         # 100+ RSS kaynağı kataloğu
├── routers/                 # 11 router (auth, news, podcast, users,
│                            #   categories, bookmarks, feed, rss,
│                            #   rss_reader, admin, read_later)
├── services/                # Sağlayıcı-bağımsız katman
│   └── ai / embeddings / tts / stt / storage / email / push
├── alembic/                 # Veritabanı migration'ları
├── scripts/                 # reembed, reset_db, validate_feeds
├── frontend/                # React 19 + Vite web istemcisi
├── mobile/                  # React Native (Expo) mobil uygulaması
└── docker-compose.yml       # Çok servisli konteyner orkestrasyonu
```

---

## 🔌 Başlıca API Uç Noktaları

- **`/auth`** — kayıt, giriş, token yenileme, çıkış, şifre sıfırlama
- **`/news`** — sayfalı akış, arama, trend, ilgili haberler, çeviri, tıklama takibi, geri bildirim, bülten podcast
- **`/podcast`** — listeleme, üretim (Celery'e kuyruklanır), silme
- **`/rss-reader`** — kişisel listeler, beslemeler, makale podcast'i, gündem
- **`/rss`** — topluluk kaynağı önerisi ve admin onayı
- **`/admin`** — istatistikler, kullanıcı yönetimi, RSS onay akışı
- **`/users`, `/bookmarks`, `/read-later`, `/categories`, `/feed.xml`**

Tam etkileşimli dokümantasyon FastAPI'nin otomatik Swagger UI'ı (`/docs`) ile sağlanır.

---

## 💡 Bu Projede Sergilenen Yetkinlikler

- **Tam yığın geliştirme:** Python/FastAPI backend + React web + React Native mobil tek bir API üzerinde paylaşımlı.
- **Asenkron sistem tasarımı:** Celery + Redis ile kuyruk ayrımı, eşzamanlılık kontrolü ve hata-toleranslı (checkpoint) toplama.
- **Uygulamalı LLM mühendisliği:** Prompt tasarımı, model seviyelendirme, önbellekleme, maliyet/limit optimizasyonu, RAG benzeri anlamsal arama.
- **Vektör veritabanı:** pgvector ile embedding üretimi ve benzerlik araması.
- **Soyutlama & taşınabilirlik:** Tüm üçüncü parti bağımlılıkları (AI, TTS, depolama) değiştirilebilir arayüzler arkasına alma.
- **Güvenlik:** JWT + refresh rotasyonu, bcrypt, imzalı URL, enumeration-önleyici şifre sıfırlama, admin yetki guard'ları, non-root konteyner.
- **DevOps:** Docker Compose çok servisli orkestrasyon, Alembic migration'ları, bulut dağıtımına hazır yapı.

---

## 🚀 Çalıştırma (Özet)

```bash
# Bağımlılıklar: PostgreSQL (pgvector) + Redis
docker run -d --name db -p 5433:5432 pgvector/pgvector:pg16 ...
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Backend
python -m uvicorn main:app --port 8090 --reload          # /docs

# Celery (her iki kuyruğu da dinler)
celery -A worker.celery_app worker -Q ai_queue,scraper_queue --concurrency=2

# Web
cd frontend && npm run dev                                # :5173

# Mobil (Expo)
cd mobile && npx expo start
```

Detaylı kurulum, ortam değişkenleri ve dağıtım için `README.md`'ye bakınız.
