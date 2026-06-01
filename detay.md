# AI Kullanım Detayları

## Mevcut Konfigürasyon
```
AI_PROVIDER      = groq
TTS_PROVIDER     = polly
EMBEDDING_PROVIDER = mock
GEMINI_MODEL     = gemini-2.5-flash-lite  (tüm kotaları doldu, etkisiz)
```

---

## Özellik Bazlı AI Kullanımı

### 1. Haber Özeti (Akış Kartları)
**Ne yapar:** Scraper yeni haber çektiğinde arka planda otomatik çalışır. Her haberin `content` alanından 3-4 cümlelik kısa bir özet üretir. Bu özet haber kartında ve haber modalında gösterilir.

**Model:** `llama-3.1-8b-instant` (Groq)
**Limit:** 14.400 istek/gün — scraper her çalıştığında en fazla 500 haber işlenir
**Tetikleyici:** `auto_generate_summaries_and_embeddings` Celery görevi, scraper biter bitmez zincir halinde çalışır
**Kod:** `worker.py` → `auto_generate_summaries_and_embeddings_task()`

**İyileştirme fırsatları:**
- Şu an tüm haberler Türkçe özetleniyor; İngilizce kaynak haber varsa özet yine Türkçe çıkıyor (bu istenen davranış)
- Kategori bazlı farklı özet tonu denenebilir (spor haberi vs. ekonomi haberi)
- `llama-3.1-8b` yerine `llama-3.3-70b-versatile` kullanılırsa kalite artar ama limit aynı 14.400

---

### 2. Podcast TTS Senaryosu (Haber Akışı)
**Ne yapar:** Kullanıcı haber akışında bir habere "Podcast Oluştur" dediğinde tetiklenir. Haberin `content` alanından 10-12 cümlelik, sesli okunmak için optimize edilmiş uzun bir senaryo üretir. Bu senaryo **haber kartında gösterilmez**, yalnızca TTS ses dosyası üretmek için kullanılır.

**Model:** `llama-4-scout-17b-16e-instruct` (Groq, `quality=True`)
**Limit:** 1.000 istek/gün — bu limit aşağıdaki 3. ve 5. özelliklerle **paylaşılır**
**Tetikleyici:** `process_news_and_tts` Celery görevi
**Kod:** `worker.py` → `process_news_and_tts_task()`

**İyileştirme fırsatları:**
- Gemini 2.0-flash (1.500/gün) kullanılabilir ama mevcut key bu modeli desteklemiyor; ai.google.dev'den yeni key alınırsa etkinleştirilebilir
- Senaryo tonu kişiselleştirilebilir (kullanıcı tercihi: resmi / samimi / haber ajansı tarzı)
- Çok haberli "bülten" podcastı: birden fazla haberi tek senaryoda birleştirip tek audio üretilebilir

---

### 3. RSS Podcast TTS Senaryosu (RSS Okuyucu)
**Ne yapar:** Kullanıcı RSS okuyucusunda bir makaleye "Podcast Oluştur" dediğinde tetiklenir. 2. özellikle tamamen aynı işi yapar; tek fark kaynak RSS makalesidir ve üretilen podcast `news_id=None` olarak kaydedilir.

**Model:** `llama-4-scout-17b-16e-instruct` (Groq, `quality=True`)
**Limit:** 2. özellikle **aynı 1.000 istek/gün havuzunu** kullanır — ikisi birden tüketir
**Tetikleyici:** `process_rss_article_tts` Celery görevi
**Kod:** `worker.py` → `process_rss_article_tts_task()`

**İyileştirme fırsatları:**
- 2. özellikle aynıdır

---

### 4. Fonetik Dönüşüm (İngilizce → Türkçe Okunuş)
**Ne yapar:** Polly TTS ile ses üretmeden önce çalışır. Metindeki "OpenAI" → "Open Ey-Ay", "GitHub" → "Githab", "API" → "Ey-Pi-Ay" gibi dönüşümler yapar. Böylece Türkçe ses motoru yabancı kelimeleri doğal okuyabilir.

**Model:** Gemini 2.5-flash-lite dene → **429 (limit=0 veya kota doldu)** → `llama-4-scout-17b-16e-instruct` fallback (Groq)
**Limit:** Gemini neredeyse her zaman başarısız; pratikte Groq 1.000/gün havuzundan yiyor
**Tetikleyici:** Her podcast oluştururken `tts.synthesize_segmented()` → `ai.phonetize_english_for_tr_tts()`
**Kod:** `services/ai.py` → `phonetize_english_for_tr_tts()`, `services/tts.py` → `synthesize_segmented()`

**Sorun:** Gemini denemesi her seferinde başarısız oluyor ama kod yine de deniyor → gereksiz gecikme + hata logu.

**İyileştirme fırsatları:**
- Gemini denemesini tamamen kaldır, direkt Groq kullan → podcast oluşturma ~2 sn hızlanır, log temizlenir
- Mevcut key yerine ai.google.dev'den standart key alınırsa Gemini 2.0-flash (1.500/gün) aktif edilebilir
- Fonetik dönüşüm sonuçları bir sözlüğe (dict) cache'lenebilir: aynı metin tekrar geldiğinde AI çağrısı yapılmaz

---

### 5. İçerik Çevirisi (TR ↔ EN)
**Ne yapar:** Web ve mobil RSS okuyucusunda "Çevir" butonuna basıldığında makale metnini Türkçe'ye veya İngilizce'ye çevirir. Maksimum 3.000 karakter alır.

**Model:** `llama-4-scout-17b-16e-instruct` (Groq, `quality=True`)
**Limit:** 2., 3. ve 4. özelliklerle **aynı 1.000 istek/gün havuzunu** kullanır
**Tetikleyici:** `POST /news/translate` ve `POST /rss/translate` endpoint'leri
**Kod:** `routers/news.py:264`, `routers/rss_reader.py:203`, `services/ai.py` → `translate()`

**İyileştirme fırsatları:**
- Çeviri sonuçları DB'ye cache'lenebilir (aynı makale tekrar çevrilirse AI çağrısı yapılmaz)
- 3.000 karakter sınırı artırılabilir (şu an uzun makalelerin sonu kesilir)

---

### 6. TR/EN Dil Segmentasyonu (Sadece Edge/Google TTS)
**Ne yapar:** Metni Türkçe ve İngilizce bloklara böler. Örneğin "GitHub hesabını hackledi" → `[{text:"GitHub", lang:"en"}, {text:" hesabını hekledi.", lang:"tr"}]`. Her blok kendi sesine okutulur.

**Model:** `llama-3.3-70b-versatile` (Groq, her zaman bu model)
**Limit:** 14.400 istek/gün
**Durum:** **`TTS_PROVIDER=polly` olduğundan şu an hiç çalışmıyor** — Polly için bu adım kod tarafından atlanıyor
**Kod:** `services/ai.py` → `segment_for_tts()`

**İyileştirme fırsatları:**
- Polly'de de çift ses kullanılabilir (Türkçe → Burcu, İngilizce → Joanna) ama SSML gerektirir
- Şu an Polly tek ses (Burcu) ile tüm metni okuyor; fonetik dönüşüm bunu telafi ediyor

---

### 7. Semantik Arama Embedding'i
**Ne yapar:** Her haberden 768 boyutlu bir vektör üretir. Bu vektör `/news/search?semantic=true` sorgularında kullanılır — kelime eşleşmesi yerine anlam benzerliğiyle arama yapar.

**Model:** Mock mod — deterministik sin() bazlı vektör, API çağrısı yok
**Durum:** **Gerçek embedding yok** — arama sonuçları anlamsız, semantik özellik devre dışı sayılır
**Kod:** `services/embeddings.py` → `_mock_embed()`, `utils.py` → `get_embedding()`

**İyileştirme fırsatları:**
- `EMBEDDING_PROVIDER=local` yapılırsa `paraphrase-multilingual-mpnet-base-v2` modeli indirilir (~420 MB), tamamen ücretsiz, Türkçe dahil 50+ dil
- Hiç API key gerektirmez, tek seferlik indirme

---

## Günlük Limit Özeti

```
┌─────────────────────────────────────┬───────────────────────────────────────┐
│ Havuz                               │ Günlük Limit                          │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ llama-3.1-8b-instant (Groq)         │ 14.400 istek/gün                      │
│  → Haber özetleri (bulk)            │                                       │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ llama-4-scout-17b (Groq, quality)   │ 1.000 istek/gün  ← DAR BOĞAZ         │
│  → Podcast TTS senaryosu            │                                       │
│  → RSS Podcast TTS senaryosu        │ Bu üç özellik aynı 1.000'i paylaşır. │
│  → Fonetik dönüşüm (fallback)       │ Birlikte günde ~333 podcast yapılabilir│
│  → İçerik çevirisi                  │                                       │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ llama-3.3-70b-versatile (Groq)      │ 14.400 istek/gün                      │
│  → TR/EN segmentasyon               │ (şu an kullanılmıyor, Polly aktif)    │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ Gemini 2.5-flash-lite               │ 20 istek/gün (limit=0 modelleri de var)│
│  → Fonetik dönüşüm (ilk deneme)     │ Pratikte her seferinde başarısız      │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ AWS Polly (Burcu, Neural)           │ Ücretli — ~$16/1M karakter            │
│  → Ses sentezi                      │ Ücretsiz tier: 5M karakter/ay (1 yıl) │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ Embedding (Mock)                    │ Sınırsız (API yok)                    │
│  → Semantik arama vektörü           │ Ama sonuçlar anlamsız                 │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

---

## Hızlı İyileştirme Önerileri (Öncelik Sırasıyla)

1. **Fonetik Gemini denemesini kaldır** — `phonetize_english_for_tr_tts()` içindeki Gemini döngüsü silinsin, direkt Groq'a gitsin. Podcast oluşturma ~2 sn hızlanır, log temizlenir. (30 dk)

2. **Embedding'i local moda al** — `.env`'de `EMBEDDING_PROVIDER=local` yap. Semantik arama gerçek anlamda çalışmaya başlar. İlk çalıştırmada ~420 MB model indirilir, sonraki çalışmalarda cache'den gelir. (5 dk)

3. **Quality limiti genişlet** — ai.google.dev'den yeni key al (standart, ücretsiz). `gemini-2.0-flash` ile 1.500 istek/gün daha kazanılır. Mevcut Groq 1.000 + Gemini 1.500 = 2.500 quality istek/gün. (15 dk)

4. **Çeviri cache'i** — Çevrilen makaleler DB'ye kaydedilsin; aynı makale tekrar çevrilirse AI çağrısı yapılmasın. (2-3 saat)
