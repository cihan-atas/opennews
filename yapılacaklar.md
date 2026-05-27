# Yapılacaklar — NewsFlow

> Bu dosya uygulamanın mevcut durumunu ve öncelikli geliştirme adımlarını özetler.
> Tamamlananlar için `özet.md`'ye bakın.

---

## 🔴 Yüksek Öncelik

### 1. Gerçek AI Provider'a Geçiş
Şu an `AI_PROVIDER=mock` — makale içeriği hiç işlenmeden özet olarak dönüyor. Kaliteli özetler için:

- **OpenAI** (en kolay): `OPENAI_API_KEY` al, `.env`'e ekle:
  ```
  AI_PROVIDER=openai
  EMBEDDING_PROVIDER=openai
  OPENAI_API_KEY=sk-...
  OPENAI_CHAT_MODEL=gpt-4o-mini
  OPENAI_EMBED_MODEL=text-embedding-3-small
  ```
- **Vertex AI (GCP)**: `gcp-service-account.json` credentials'ı yerleştir, `AI_PROVIDER=vertex` yap.

> Mock embedding'ler anlamsız vektörler üretiyor → "Benzer Haberler" önerileri çalışmıyor. OpenAI embedding'e geçişte DB'deki mevcut vektörler yeniden hesaplanmalı (`EMBEDDING_PROVIDER=openai` ile bir kez tüm haberleri re-embed et).

### 2. Cihazda Gerçek Test
Expo Web ile doğrulandı ama native davranışlar cihazda test edilmeli:
- [ ] iOS/Android cihazda veya emülatörde uygulama açılışı
- [ ] `expo-audio` ile ses oynatma (MiniPlayer)
- [ ] `expo-file-system` ile podcast indirme → Files app'te görünüyor mu?
- [ ] Push bildirim → Podcasts sekmesine yönleniyor mu?
- [ ] Theme toggle → tüm ekranlarda renk değişiyor mu?

---

## 🟡 Orta Öncelik

### 3. Tema Geçişi — Mobil ✅ TAMAMLANDI
Tüm ekranlar ve bileşenler `useTheme()` + `makeStyles(colors)` factory pattern'e geçirildi:
- [x] `HomeScreen.js`, `PodcastScreen.js`, `BookmarksScreen.js`, `RssReaderScreen.js`
- [x] `AuthScreen.js`, `OnboardingScreen.js`, `SettingsScreen.js`
- [x] `NewsDetailModal.js`, `MiniPlayer.js`, `Toast.js`
- [x] `RootNavigator.js`, `MainTabs.js` (navigation tema da reaktif)

### 4. Production'a Deploy
Mevcut deploy hedefi Cloud Run. Ücretsiz alternatifler:
- [ ] **Backend**: Fly.io (`fly launch`) veya Railway
- [ ] **DB**: Neon (pgvector destekli, ücretsiz tier) veya Supabase
- [ ] **Redis**: Upstash (ücretsiz tier)
- [ ] **Dosya depolama**: Cloudflare R2 (`STORAGE_PROVIDER=s3`, ücretsiz 10 GB)
- [ ] `.github/workflows/deploy.yml`'i yeni hedeflere göre yeniden yaz

### 5. EAS Build (Uygulama Mağazası)
- [ ] `eas.json` + `app.json` `bundleIdentifier`/`package` alanlarını doldur
- [ ] `eas build --platform android` ile APK/AAB oluştur
- [ ] iOS için `eas build --platform ios` (Apple Developer hesabı gerekiyor)
- [ ] Uygulama ikonu ve splash ekranını markaya göre güncelle (`assets/`)

---

## 🟢 Düşük Öncelik / İyileştirme

### 6. Refresh Token JTI Fix ✅ TAMAMLANDI
`routers/auth.py` — `handle_refresh_token_logic` içinde `jti: uuid4()` claim eklendi.
Her refresh token artık UUID ile benzersiz, aynı saniye çift login sorunsuz çalışır.

### 7. Admin RSS Onay Arayüzü
Kullanıcılar topluluk RSS önerebiliyor (`POST /rss/submit`) ama onay için `/rss/pending` endpoint'i var, UI yok.
- [ ] Basit bir admin sayfası veya Swagger üzerinden kullanım talimatı yaz
- [ ] Veya otomatik onay mantığı (URL geçerli mi, duplicate değil mi?) ekle

### 8. Web Frontend Geleceği
- [ ] Web frontend (`frontend/`) emekliye ayrılacak mı karar ver
- [ ] Emekliye ayrılmayacaksa theme toggle tüm bileşenlere (`News.jsx`, `Bookmarks.jsx` vb.) yayılmalı

### 9. Uçtan Uca Entegrasyon Testi
- [ ] Mevcut `test_e2e.js`'i güncel API'ye karşı çalıştır ve geçen/kalan testleri belgele
- [ ] Yeni endpoint'ler için (`/users/stats`, `/rss/submit`) test senaryosu yaz

---

## 📋 Mevcut Çalışma Ortamı (Yerel)

| Servis | Port | Durum |
|--------|------|-------|
| PostgreSQL (pgvector) | 5433 | Docker `news-and-podcast-db` |
| Redis | 6379 | Docker `news-and-podcast-redis` |
| FastAPI (Backend) | 8899 | `/tmp/newsflow_venv` uvicorn |
| Celery Worker | — | `scraper_queue,ai_queue` |
| React Web (Vite) | 5173 | `frontend/` |
| Expo Web | 9898 | `mobile/` |

> Not: Port çakışması nedeniyle standart portlar (`5432`, `8080`) kullanılamıyor. `monitoring-*` Docker container'ları bu portları işgal ediyor.
