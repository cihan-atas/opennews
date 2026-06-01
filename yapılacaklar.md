# Yapılacaklar — NewsFlow

> Bu dosya uygulamanın mevcut durumunu ve öncelikli geliştirme adımlarını özetler.
> Tamamlananlar için `özet.md`'ye bakın.

---

## 🔴 Yüksek Öncelik

### 1. Gerçek AI Provider & Semantik Arama ✅ TAMAMLANDI
Aktif stack artık: `AI_PROVIDER=groq`, `EMBEDDING_PROVIDER=local` (`paraphrase-multilingual-mpnet-base-v2`), `TTS_PROVIDER=polly`, `STORAGE_PROVIDER=local`.
- [x] Groq ile gerçek özetleme (mock'tan çıkıldı).
- [x] `sentence-transformers 5.5.1` venv'e kuruldu (önce CPU-only torch — CUDA wheel'leri ağ hatası veriyordu).
- [x] `python -m scripts.reembed` çalıştı → 166/166 haber yeniden embed edildi → semantik arama ve "Benzer Haberler" aktif.

### 2. Cihazda Gerçek Test (HÂLÂ AÇIK)
Expo Web ile doğrulandı ama native davranışlar gerçek cihaz/emülatörde test edilmeli:
- [ ] iOS/Android cihazda veya emülatörde uygulama açılışı
- [ ] `expo-audio` ile ses oynatma (MiniPlayer)
- [ ] **Podcast kuyruğu**: "Tümünü Sırayla Çal" → parça bitince otomatik sonraki (`didJustFinish`); ⏮/⏭ butonları
- [ ] **Hız hafızası**: hız değiştir → uygulamayı yeniden aç → korunuyor mu? (SecureStore)
- [ ] `expo-file-system` ile podcast indirme → Files app'te görünüyor mu?
- [ ] Push bildirim → Podcasts sekmesine yönleniyor mu?
- [ ] Theme toggle → tüm ekranlarda renk değişiyor mu?
- [ ] **Şifre sıfırlama**: AuthScreen forgot formu → e-posta isteği (linkin açılması web'de)

### 3. Şifre Sıfırlama için Gerçek SMTP (YENİ)
Şifre sıfırlama akışı kodda hazır ama SMTP yapılandırılmadığı için reset linki şu an yalnızca **server log'una** yazılıyor (dev modu).
- [ ] `.env`'e `SMTP_HOST/PORT/USER/PASSWORD` ekle (ör. Gmail app password veya ücretsiz bir SMTP servisi)
- [ ] Gerçek e-posta teslimini doğrula

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

### 7. Admin RSS Onay Arayüzü (KISMEN)
Kullanıcılar topluluk RSS önerebiliyor (`POST /rss/submit`); onay için `/rss/pending` endpoint'i var.
- [x] Mobil `SettingsScreen` "🛠️ Yönetim" bölümünde bekleyen RSS onay/red UI'si (Faz 6).
- [ ] Web Admin panelinde de bekleyen RSS onay arayüzü (şu an web Admin'de RSS doğrudan ekleme + onaylı liste var, pending onay akışı eksik).
- [ ] Veya otomatik onay mantığı (URL geçerli mi, duplicate değil mi?) ekle.

### 8. Web Frontend Teması ✅ TAMAMLANDI
- [x] `ThemeContext` + `Sidebar.jsx` ☀️/🌙 toggle + `index.css` `[data-theme="light"]` mevcut ve çalışıyor.
- [ ] (Opsiyonel) Web frontend uzun vadede emekliye ayrılacak mı karar ver — şu an aktif ve `vite build` temiz.

### 9. Uçtan Uca Entegrasyon Testi
- [ ] Mevcut `test_e2e.js`'i güncel API'ye karşı çalıştır ve geçen/kalan testleri belgele
- [ ] Yeni endpoint'ler için test senaryosu yaz: `/users/stats`, `/rss/submit`, `/admin/*`, **`/auth/forgot-password` + `/auth/reset-password`**, **`/read-later/*`**
- [ ] Not: `test_e2e.js` ve `test_podcast.js` artık `.gitignore`'da (düz metin parola içeriyorlardı)

---

## 📋 Mevcut Çalışma Ortamı (Yerel)

| Servis | Port | Durum |
|--------|------|-------|
| PostgreSQL (pgvector) | 5433 | Docker `news-and-podcast-db` |
| Redis | 6379 | Docker `news-and-podcast-redis` |
| FastAPI (Backend) | 8090 | proje kökü `venv/` uvicorn |
| Celery Worker | — | `scraper_queue,ai_queue` |
| React Web (Vite) | 5173 | `frontend/` |
| Expo Web | 9898 | `mobile/` |

> Not (2026-06-01): DB 5433'te (`5432` monitoring container'da). Backend 8090 portunda; venv proje kökünde (`/tmp/newsflow_venv` değil). `sentence-transformers` + CPU torch venv'e kuruldu.

> Not: Port çakışması nedeniyle standart portlar (`5432`, `8080`) kullanılamıyor. `monitoring-*` Docker container'ları bu portları işgal ediyor.
