import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from celery import Celery
from config import settings
from utils import upload_to_gcs, get_embedding, embeddings_enabled, delete_from_gcs
import services.ai as ai_service
import services.tts as tts_service
import services.push as push_service
import services.rss as rss_service
from services import settings_store
from database import SessionLocal
import models
import time
from datetime import datetime, timedelta, timezone as _tz

CELERY_BROKER_URL = settings.CELERY_BROKER_URL

celery_app = Celery("tasks", broker=CELERY_BROKER_URL)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)

# Celery Beat — newsapp-beat.service tarafından çalıştırılır.
# Tick 5 dakikada bir; hangi kuralın sırası geldiğine görev kendisi karar verir
# (kural başına aralık farklı olduğu için beat'e tek tek yazmıyoruz).
celery_app.conf.beat_schedule = {
    "evaluate-rss-notifications": {
        "task": "evaluate_rss_notifications",
        "schedule": 300.0,
        "options": {"queue": "notify_queue"},
    },
    "prune-rss-seen-articles": {
        "task": "prune_rss_seen_articles",
        "schedule": 86400.0,
        "options": {"queue": "notify_queue"},
    },
}

# Podcast uzunluk seçenekleri: kullanıcının seçtiği süreye göre senaryo cümle aralığı.
# (Polly Burcu ~140 kelime/dk, Türkçe cümle ~13-15 kelime varsayımıyla.)
PODCAST_LENGTHS = {
    "short":  (6, 9, "30 saniye–1 dakika"),
    "medium": (13, 18, "1–2 dakika"),
    "long":   (26, 36, "2–4 dakika"),
}


def _length_range(length: str):
    lo, hi, _label = PODCAST_LENGTHS.get(length or "medium", PODCAST_LENGTHS["medium"])
    return lo, hi


# Kullanıcı başına tutulacak en fazla aktif (ses dosyası olan) podcast sayısı.
MAX_ACTIVE_PODCASTS = 20


def _enforce_podcast_cap(db, user_id: int, limit: int = MAX_ACTIVE_PODCASTS) -> None:
    """Kullanıcının aktif podcast sayısı limiti aşarsa en eskilerin ses dosyasını siler
    ve kaydı arşivler (is_archived=True). Kayıt listede kalır; kullanıcı haberine gidip
    yeniden oluşturabilir."""
    try:
        active = (
            db.query(models.Podcast)
            .filter(models.Podcast.user_id == user_id, models.Podcast.is_archived == False)  # noqa: E712
            .order_by(models.Podcast.created_at.desc())
            .all()
        )
        for old in active[limit:]:
            try:
                if old.audio_url:
                    delete_from_gcs(old.audio_url)
            except Exception as e:
                print(f"[Cap] Ses dosyası silinemedi (podcast {old.id}): {e}")
            old.is_archived = True
            old.transcript = None  # yer kaplamasın; yeniden oluşturulunca tekrar üretilir
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Cap] Podcast üst sınırı uygulanırken hata: {e}")

@celery_app.task(name="process_news_and_tts", queue="ai_queue")
def process_news_and_tts_task(news_id: int, user_id: int, length: str = "medium"):
    db = SessionLocal()
    tmp_path = f"/tmp/news_{news_id}.mp3"
    news = None                      # hata bildiriminde başlık için (henüz çekilmemiş olabilir)
    _uctx = settings_store.user_context(user_id); _uctx.__enter__()  # kullanıcının kendi anahtarları
    try:
        # 1. DB'den haberi çek
        news = db.query(models.News).filter(models.News.id == news_id).first()
        if not news:
            print(f"[Worker] News {news_id} bulunamadı, görev iptal edildi.")
            return {"status": "error", "message": f"News {news_id} not found"}

        print(f"[Worker] Haber bulundu: '{news.title}' — AI ile özetleniyor...")

        # 2a. Kısa görüntü özeti (news feed kartları için) — yoksa üret
        if not news.summary:
            short_prompt = (
                "Aşağıdaki haberi Türkçe olarak kısa bir haber özeti olarak hazırla.\n\n"
                "KURALLAR:\n"
                "1. Haberin en önemli bilgisini aktaran 3-4 cümlelik özlü bir özet yaz.\n"
                "2. Madde işareti veya başlık kullanma, düz metin olsun.\n\n"
                f"İçerik:\n{news.content}"
            )
            news.summary = ai_service.generate(short_prompt)
            db.commit()
            print(f"[Worker] Kısa özet kaydedildi ({len(news.summary.split())} kelime).")

        # 2b. Podcast TTS senaryosu (uzun, ses için) — ayrı üretilir, DB'ye kaydedilmez
        lo, hi = _length_range(length)
        print(f"[Worker] Podcast uzunluğu: {length} → {lo}-{hi} cümle hedefi")
        tts_prompt = (
            "Aşağıdaki haberi Türkçe olarak akıcı bir haber anlatımı şeklinde hazırla.\n\n"
            "KURALLAR:\n"
            f"1. Haberin tüm önemli detaylarını, bağlamını ve sonuçlarını kapsayan {lo}-{hi} cümlelik akıcı bir anlatı oluştur. "
            "Hedeflenen cümle sayısına olabildiğince yaklaş; içerik kısaysa arka plan ve bağlam ekleyerek zenginleştir.\n"
            "2. Sesli okunacağından doğal bir konuşma diliyle yaz, madde işareti veya başlık kullanma.\n"
            "3. Asla 'Bu podcast'te', 'Bu bölümde', 'Bugün size', 'Hoş geldiniz' gibi sunucu ifadeleri veya program girişleri kullanma. Doğrudan haberi anlatmaya başla.\n"
            "4. İngilizce marka, şirket ve teknik terimlere Türkçe ek getirirken kelimenin okunuşunu baz al (örn: Google'de değil Google'da; OpenAI'ye değil OpenAI'ya; API'ye; GitHub'a).\n"
            "5. Bu ekleri mutlaka kesme işareti (') ile ayır (örn: Google'da, OpenAI'ın, API'lar).\n\n"
            f"İçerik:\n{news.content}"
        )
        summary = ai_service.generate(tts_prompt, quality=True)
        if not summary or not summary.strip():
            print("[Worker] Senaryo boş döndü → kısa özete düşülüyor.")
            summary = news.summary or (news.content or "")[:1200]
        print(f"[Worker] TTS senaryosu oluşturuldu ({len(summary.split())} kelime).")

        # Embedding üret ve kaydet (başlık + içerik) — kapalıysa atla
        if embeddings_enabled():
            print("[Worker] Embedding üretiliyor...")
            embedding_text = f"{news.title}\n\n{news.content}"
            news.embedding = get_embedding(embedding_text, task_type="retrieval_document")
            db.commit()
            print("[Worker] Embedding kaydedildi.")

        # 3. Metni Türkçe/İngilizce segmentlere böl
        print("[Worker] Dil segmentasyonu yapılıyor...")
        segments = ai_service.segment_for_tts(summary)
        print(f"[Worker] {len(segments)} segment — TR/EN çift ses ile sentezleniyor...")

        # 4. TTS ile .mp3 üret
        audio_bytes = tts_service.synthesize_segmented(segments)
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)
        print(f"[Worker] Ses dosyası oluşturuldu: {tmp_path}")

        # 4. GCS Frankfurt bucket'ına yükle
        destination_blob = f"podcasts/news_{news_id}.mp3"
        audio_url = upload_to_gcs(tmp_path, destination_blob)
        print(f"[Worker] GCS'ye yüklendi: {audio_url}")

        # 5. Duration hesapla (yaklaşık 150 kelime/dakika)
        word_count = len(summary.split())
        duration_seconds = max(1, int(word_count / 150 * 60))

        # 6. Podcast tablosuna kaydet
        podcast = models.Podcast(
            title=news.title,
            audio_url=audio_url,
            user_id=user_id,
            duration=duration_seconds,
            news_id=news_id,
            source_url=news.source_url,
        )
        db.add(podcast)
        db.commit()
        print(f"[Worker] Podcast kaydedildi — ID: {podcast.id}, süre: {duration_seconds}s")
        _enforce_podcast_cap(db, user_id)

        # Push bildirim gönder (kullanıcının kayıtlı token'ları varsa)
        _notify_user(db, user_id, news.title)

        return {"status": "success", "news_id": news_id, "audio_url": audio_url}

    except Exception as e:
        db.rollback()
        print(f"[Worker] HATA — news_id={news_id}: {e}")
        _notify_failure(db, user_id, news.title if news else "", str(e))
        return {"status": "error", "message": str(e)}

    finally:
        _uctx.__exit__(None, None, None)
        db.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@celery_app.task(name="auto_generate_summaries_and_embeddings", queue="ai_queue")
def auto_generate_summaries_and_embeddings_task():
    """
    - Scraper bittiği an tetiklenir. Veritabanında özeti ve embedding'i olmayan 
      taze haberleri en güncelden başlayarak maksimum 500 adet olacak şekilde çeker.
    """
    db = SessionLocal()
    try:
        # 🎯 UTKU (Kurşun Geçirmez Jüri Ayarı): Ağ kopmalarını önlemek için yükü 500 ile kesip en tazeden sıralıyoruz.
        # Embedding kapalıysa yalnızca özeti eksik olanları seç (embedding hep None kalacağı için
        # aksi halde her turda tüm haberler boşuna yeniden taranır).
        if embeddings_enabled():
            missing = (models.News.summary.is_(None)) | (models.News.embedding.is_(None))
        else:
            missing = models.News.summary.is_(None)
        unprocessed_news = db.query(models.News).filter(missing).order_by(
            models.News.created_at.desc()
        ).limit(500).all()

        if not unprocessed_news:
            print("[AI Pipeline] Özetlenecek eksik haber bulunamadı.")
            return {"status": "success", "message": "All news are already processed."}

        print(f"[AI Pipeline] {len(unprocessed_news)} adet taze haber özet zincirine alınıyor...")

        for news in unprocessed_news:
            try:
                # 1. Eğer özeti yoksa AI ile üret (sağlayıcı .env'den)
                if not news.summary:
                    print(f"[AI Pipeline] '{news.title[:50]}' için özet üretiliyor...")
                    prompt = (
                        "Aşağıdaki haberi Türkçe olarak kısa bir haber özeti olarak hazırla. "
                        "Haberin en önemli bilgisini aktaran 3-4 cümlelik özlü bir özet yaz. "
                        "Madde işareti veya başlık kullanma, düz metin olsun:\n\n"
                        f"{news.content}"
                    )
                    news.summary = ai_service.generate(prompt)
                    db.commit()

                # 2. Eğer semantik arama embedding'i yoksa onu da aradan çıkart reis
                if embeddings_enabled() and news.embedding is None:
                    print(f"[AI Pipeline] '{news.title[:50]}' için vektör embedding üretiliyor...")
                    embedding_text = f"{news.title}\n\n{news.content}"
                    news.embedding = get_embedding(embedding_text, task_type="retrieval_document")
                    db.commit()

            except Exception as inner_e:
                db.rollback()
                print(f"[AI Pipeline] Haber işlenirken pürüz çıktı ({news.id}): {inner_e}")
                continue

        return {"status": "success", "processed_count": len(unprocessed_news)}
    except Exception as e:
        print(f"[AI Pipeline] Kritik zincir hatası: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

@celery_app.task(name="process_rss_article_tts", queue="ai_queue")
def process_rss_article_tts_task(title: str, content: str, user_id: int, source_url: str = None, length: str = "medium"):
    """RSS makale metnini Türkçeye özetler, TTS ile sese çevirir ve kaydeder."""
    import hashlib
    tmp_key = hashlib.md5(f"{title}{user_id}".encode()).hexdigest()[:12]
    tmp_path = f"/tmp/rss_{tmp_key}.mp3"
    db = SessionLocal()
    _uctx = settings_store.user_context(user_id); _uctx.__enter__()  # kullanıcının kendi anahtarları
    try:
        lo, hi = _length_range(length)
        prompt = (
            "Aşağıdaki haberi Türkçe olarak akıcı bir haber anlatımı şeklinde hazırla.\n\n"
            "KURALLAR:\n"
            f"1. Haberin tüm önemli detaylarını, bağlamını ve sonuçlarını kapsayan {lo}-{hi} cümlelik akıcı bir anlatı oluştur. "
            "Hedeflenen cümle sayısına olabildiğince yaklaş; içerik kısaysa arka plan ve bağlam ekleyerek zenginleştir.\n"
            "2. Sesli okunacağından doğal bir konuşma diliyle yaz, madde işareti veya başlık kullanma.\n"
            "3. Asla 'Bu podcast'te', 'Bu bölümde', 'Bugün size', 'Hoş geldiniz' gibi sunucu ifadeleri veya program girişleri kullanma. Doğrudan haberi anlatmaya başla.\n"
            "4. İngilizce marka, şirket ve teknik terimlere Türkçe ek getirirken kelimenin okunuşunu baz al (örn: Google'de değil Google'da; OpenAI'ye değil OpenAI'ya; API'ye; GitHub'a).\n"
            "5. Bu ekleri mutlaka kesme işareti (') ile ayır (örn: Google'da, OpenAI'ın, API'lar).\n\n"
            f"Başlık: {title}\n\nİçerik: {content[:3000]}"
        )
        summary = ai_service.generate(prompt, quality=True)
        if not summary or not summary.strip():
            print("[Worker] RSS senaryosu boş döndü → ham içeriğe düşülüyor.")
            summary = (content or "")[:1200]
        segments = ai_service.segment_for_tts(summary)

        audio_bytes = tts_service.synthesize_segmented(segments)
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        destination_blob = f"podcasts/rss_{tmp_key}.mp3"
        audio_url = upload_to_gcs(tmp_path, destination_blob)

        word_count = len(summary.split())
        duration_seconds = max(1, int(word_count / 150 * 60))

        podcast = models.Podcast(
            title=title,
            audio_url=audio_url,
            user_id=user_id,
            duration=duration_seconds,
            news_id=None,
            source_url=source_url,
        )
        db.add(podcast)
        db.commit()
        print(f"[Worker] RSS Podcast kaydedildi — ID: {podcast.id}")
        _enforce_podcast_cap(db, user_id)

        _notify_user(db, user_id, title)

        return {"status": "success", "podcast_id": podcast.id}

    except Exception as e:
        db.rollback()
        print(f"[Worker] RSS TTS HATA: {e}")
        _notify_failure(db, user_id, title, str(e))
        return {"status": "error", "message": str(e)}
    finally:
        _uctx.__exit__(None, None, None)
        db.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@celery_app.task(name="process_bulletin_tts", queue="ai_queue")
def process_bulletin_tts_task(news_ids: list, user_id: int, title: str):
    """Birden çok haberi tek bir akıcı 'bülten' senaryosunda birleştirip tek audio üretir.

    Mevcut tek-haber podcast akışını (process_news_and_tts_task) yeniden kullanır; fark,
    birden çok haberin özetini tek bir senaryoda birleştirmesi ve podcast'i news_id=None
    olarak kaydetmesidir (RSS podcast'i gibi)."""
    import hashlib
    tmp_key = hashlib.md5(f"bulletin{user_id}{title}".encode()).hexdigest()[:12]
    tmp_path = f"/tmp/bulletin_{tmp_key}.mp3"
    db = SessionLocal()
    _uctx = settings_store.user_context(user_id); _uctx.__enter__()  # kullanıcının kendi anahtarları
    try:
        news_items = (
            db.query(models.News)
            .filter(models.News.id.in_(news_ids))
            .all()
        )
        # İstenen sırayı koru
        order = {nid: i for i, nid in enumerate(news_ids)}
        news_items.sort(key=lambda n: order.get(n.id, 1e9))
        if not news_items:
            return {"status": "error", "message": "Bülten için haber bulunamadı."}

        # Her haber için özet (yoksa üret), tek bir bütün metin halinde topla
        parts = []
        for n in news_items:
            if not n.summary:
                short_prompt = (
                    "Aşağıdaki haberi Türkçe, 2-3 cümlelik düz metin bir özet olarak yaz "
                    "(madde işareti/başlık yok):\n\n" + n.content
                )
                try:
                    n.summary = ai_service.generate(short_prompt)
                    db.commit()
                except Exception as e:
                    print(f"[Bulletin] Özet üretilemedi (news {n.id}): {e}")
            parts.append(f"- {n.title}\n{n.summary or n.content[:500]}")

        joined = "\n\n".join(parts)
        bulletin_prompt = (
            "Aşağıda günün haber başlıkları ve kısa özetleri var. Bunları tek bir akıcı, "
            "Türkçe haber bülteni senaryosu haline getir.\n\n"
            "KURALLAR:\n"
            "1. Kısa bir karşılama cümlesiyle başla (örn. 'Günün öne çıkan haberlerine geçiyoruz.').\n"
            "2. Her haberi 2-3 cümleyle, aralarında doğal geçişlerle ('Bir diğer gelişme...', "
            "'Öte yandan...') anlat.\n"
            "3. Sesli okunacağından doğal konuşma diliyle yaz; madde işareti veya başlık kullanma.\n"
            "4. Kısa bir kapanış cümlesiyle bitir.\n"
            "5. İngilizce marka/terimlere Türkçe ek getirirken okunuşu baz al ve kesme işaretiyle ayır "
            "(örn. Google'da, OpenAI'ın, API'lar).\n\n"
            f"Haberler:\n{joined}"
        )
        script = ai_service.generate(bulletin_prompt, quality=True)
        if not script or not script.strip():
            print("[Bulletin] Senaryo boş döndü → birleştirilmiş özetlere düşülüyor.")
            script = joined
        print(f"[Bulletin] Senaryo üretildi ({len(script.split())} kelime, {len(news_items)} haber).")

        segments = ai_service.segment_for_tts(script)
        audio_bytes = tts_service.synthesize_segmented(segments)
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        destination_blob = f"podcasts/bulletin_{tmp_key}.mp3"
        audio_url = upload_to_gcs(tmp_path, destination_blob)

        word_count = len(script.split())
        duration_seconds = max(1, int(word_count / 150 * 60))

        podcast = models.Podcast(
            title=title,
            audio_url=audio_url,
            user_id=user_id,
            duration=duration_seconds,
            news_id=None,
            source_url=None,
        )
        db.add(podcast)
        db.commit()
        print(f"[Bulletin] Podcast kaydedildi — ID: {podcast.id}")
        _enforce_podcast_cap(db, user_id)

        _notify_user(db, user_id, title)
        return {"status": "success", "podcast_id": podcast.id}

    except Exception as e:
        db.rollback()
        print(f"[Bulletin] HATA: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        _uctx.__exit__(None, None, None)
        db.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


# Teknik hata metinlerini kullanıcının anlayacağı sebebe çevirir.
_ERROR_HINTS = (
    ("UnrecognizedClientException", "Seslendirme anahtarı geçersiz. Ayarlar → Seslendirme'den sağlayıcıyı kontrol et."),
    ("InvalidSignatureException", "Seslendirme anahtarı geçersiz. Ayarlar → Seslendirme'den sağlayıcıyı kontrol et."),
    ("AccessDenied", "Seslendirme servisi erişimi reddetti. Anahtarın yetkilerini kontrol et."),
    ("invalid_api_key", "Yapay zeka anahtarı geçersiz. Ayarlar → Yapay Zeka'dan kontrol et."),
    ("Invalid API Key", "Yapay zeka anahtarı geçersiz. Ayarlar → Yapay Zeka'dan kontrol et."),
    ("rate limit", "Sağlayıcı hız sınırına takıldı. Birazdan tekrar dene."),
    ("429", "Sağlayıcı hız sınırına takıldı. Birazdan tekrar dene."),
    ("timed out", "Sağlayıcıya ulaşılamadı (zaman aşımı). Tekrar dene."),
    ("Connection", "Sağlayıcıya ulaşılamadı. İnternet/servis durumunu kontrol et."),
)


def _humanize_error(err: str) -> str:
    for needle, hint in _ERROR_HINTS:
        if needle.lower() in (err or "").lower():
            return hint
    return "Beklenmeyen bir hata oldu. Ayarlardaki anahtarları kontrol et."


def _notify_failure(db, user_id: int, title: str, err: str) -> None:
    """Podcast üretilemediğinde kullanıcıyı sebebiyle birlikte uyarır.

    Önce sessizce başarısız oluyordu: kullanıcı butona basıyor, hiçbir şey
    olmuyor, neden olmadığını göremiyordu.
    """
    try:
        tokens = [t.token for t in db.query(models.PushToken).filter(
            models.PushToken.user_id == user_id).all()]
        if not tokens:
            return
        push_service.send(
            tokens,
            title="🎙️ Podcast oluşturulamadı",
            body=f"{(title or '')[:60]} — {_humanize_error(err)}",
            data={"type": "podcast_failed", "reason": _humanize_error(err)},
        )
    except Exception as exc:
        print(f"[Worker] Hata bildirimi gönderilemedi: {exc}")


def _notify_user(db, user_id: int, news_title: str) -> None:
    """Kullanıcının kayıtlı push token'larına podcast hazır bildirimi gönderir."""
    try:
        tokens = db.query(models.PushToken).filter(models.PushToken.user_id == user_id).all()
        token_values = [t.token for t in tokens]
        if token_values:
            push_service.send(
                token_values,
                title="Podcast hazır! 🎙️",
                body=news_title[:80],
                data={"type": "podcast_ready"},
            )
    except Exception as e:
        print(f"[Worker] Push bildirim gönderilemedi: {e}")


@celery_app.task(name="run_scraper", queue="scraper_queue")
def run_scraper_task():
    import sys
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from scraper import scrape_to_db
    try:
        result = scrape_to_db()
        
        # Scraper başarıyla bittiği an, arka planda özetleme görevini zincirle tetikle!
        auto_generate_summaries_and_embeddings_task.delay()
        
        return {"status": "success", **result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# RSS BİLDİRİM KURALLARI
# ══════════════════════════════════════════════════════════════════════════════

IMMEDIATE_INTERVAL_MINUTES = 15      # routers/rss_reader.py ile aynı olmalı
MAX_INDIVIDUAL_PER_RUN = 5           # bozuk besleme telefonu boğmasın
SEEN_RETENTION_DAYS = 30


TRENDING_NEWS_LIMIT = 10
TRENDING_HOURS = 24
# Gündem "en güncel olanlar" demek; tüm beslemelerin tamamı değil. Sınırsız
# bırakınca ilk baseline 3500+ makale yazıyor ve her tur ağırlaşıyordu.
TRENDING_MAX_ARTICLES = 40


def _rule_feeds(rule) -> list:
    """Kuralın kapsadığı beslemeler.

    all      → listenin tümü
    selected → yalnızca seçilenler
    trending → kullanıcının TÜM listelerindeki benzersiz beslemeler (Gündem)
    """
    if rule.scope == "trending":
        return []          # Gündem beslemeleri _collect_trending'de toplanır
    if rule.scope == "selected":
        selected = {rf.feed_id for rf in rule.feeds}
        return [f for f in rule.rss_list.feeds if f.id in selected]
    return list(rule.rss_list.feeds)


def _news_trending_articles(db, user_id: int) -> list:
    """Haber gündemi (/news/trending mantığı) → makale sözlükleri.

    Son 24 saatte en çok tıklanan kategorilerden haberler; tıklama verisi yoksa
    en yeni haberler. RSS makaleleriyle aynı alan adlarına çevrilir ki
    _store_new_articles ve bildirim tıklama akışı değişmeden çalışsın.
    """
    from sqlalchemy import func

    since = datetime.now(_tz.utc) - timedelta(hours=TRENDING_HOURS)
    hot = (
        db.query(models.UserClick.category_id)
        .filter(models.UserClick.last_click_at >= since)
        .group_by(models.UserClick.category_id)
        .order_by(func.sum(models.UserClick.click_count).desc())
        .limit(5)
        .all()
    )
    hot_ids = [r.category_id for r in hot]

    q = db.query(models.News)
    if hot_ids:
        q = q.filter(models.News.category_id.in_(hot_ids))
    rows = q.order_by(models.News.published_at.desc().nulls_last()).limit(TRENDING_NEWS_LIMIT).all()

    return [
        {
            "title": n.title,
            "link": n.source_url,          # benzersiz → tekilleştirme anahtarı
            "summary": n.summary,
            "feed_title": "Haber Gündemi",
            "feed_url": None,
            "published": n.published_at.isoformat() if n.published_at else None,
        }
        for n in rows
    ]


def _collect_trending(db, rule) -> list:
    """Gündem kuralının kaynakları: haber gündemi + tüm RSS beslemeleri."""
    articles = list(_news_trending_articles(db, rule.user_id))

    # Kullanıcının tüm listelerindeki benzersiz beslemeler (aynı url birden
    # fazla listede olabilir) — routers/rss_reader.get_rss_trending ile aynı mantık.
    lists = db.query(models.UserRssList).filter(
        models.UserRssList.user_id == rule.user_id).all()
    feeds = {}
    for lst in lists:
        for f in lst.feeds:
            feeds.setdefault(f.url, f.title)

    rss_articles = []
    for url, title in feeds.items():
        rss_articles.extend(rss_service.fetch_feed(url, title))

    # Link bazında tekilleştir (aynı yazı birden çok listede olabilir),
    # en yeniden eskiye sırala ve gündem sayısıyla sınırla.
    seen_links = set()
    unique = []
    for a in rss_articles:
        key = a.get("link") or a.get("title")
        if key and key not in seen_links:
            seen_links.add(key)
            unique.append(a)
    unique.sort(key=lambda a: a.get("published") or "", reverse=True)

    articles.extend(unique[:TRENDING_MAX_ARTICLES])
    return articles


def _parse_hhmm(value: str, fallback: str) -> tuple:
    """'23:00' → (23, 0). Bozuk girdide fallback'e düşer."""
    try:
        hh, mm = str(value).strip().split(":")
        hh, mm = int(hh), int(mm)
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return hh, mm
    except Exception:
        pass
    hh, mm = fallback.split(":")
    return int(hh), int(mm)


def _in_quiet_hours(user_id: int) -> bool:
    """Kullanıcının sessiz saat aralığında mıyız?

    Ayarlar kullanıcı bazında (Ayarlar → Bildirimler), settings_store üzerinden
    okunur; kullanıcı girmemişse config.py varsayılanı kullanılır.
    Gece yarısını aşan aralıklar (23:00-08:00) desteklenir.
    """
    with settings_store.user_context(user_id):
        enabled = str(settings_store.settings.QUIET_HOURS_ENABLED).lower()
        if enabled in ("false", "0", "hayır", "kapalı", "off", "none"):
            return False
        start_raw = settings_store.settings.QUIET_HOURS_START
        end_raw = settings_store.settings.QUIET_HOURS_END

    sh, sm = _parse_hhmm(start_raw, "23:00")
    eh, em = _parse_hhmm(end_raw, "08:00")

    now = datetime.now().time()          # sunucu yerel saati (Europe/Istanbul)
    start_minutes = sh * 60 + sm
    end_minutes = eh * 60 + em
    now_minutes = now.hour * 60 + now.minute

    if start_minutes == end_minutes:
        return False
    if start_minutes < end_minutes:      # ör. 01:00-06:00
        return start_minutes <= now_minutes < end_minutes
    return now_minutes >= start_minutes or now_minutes < end_minutes   # ör. 23:00-08:00


def _send_rule_notification(db, rule, new_rows: list, batch_stamp) -> None:
    """Kuralın gruplama tercihine göre bildirim(ler)i gönderir.

    batch_stamp: bu partideki tüm satırlara yazılacak notified_at. Özet
    bildirimine tıklanınca partinin makaleleri bu damgayla geri bulunur
    (bkz. GET /rss-reader/notification-batch/{rule_id}).
    """
    tokens = [t.token for t in db.query(models.PushToken).filter(
        models.PushToken.user_id == rule.user_id).all()]
    if not tokens:
        print(f"[Bildirim] Kural {rule.id}: kayıtlı cihaz yok, atlanıyor.")
        return

    # Gündem kuralında liste yok (list_id NULL) → rss_list None olur.
    list_name = rule.rss_list.name if rule.rss_list else "Gündem"
    # Kullanıcı birden fazla kural kurabildiği için hangisinin tetiklendiği
    # bildirimden anlaşılmalı — başlıkta kuralın kendi adı geçiyor.
    rule_name = rule.name or list_name

    if rule.grouping == "individual":
        for row in new_rows[:MAX_INDIVIDUAL_PER_RUN]:
            feed = row.feed_title or list_name
            push_service.send(
                tokens,
                title=f"📡 {rule_name} · {feed}"[:100],
                body=row.title[:120],
                data={"type": "rss_article", "article_id": row.id,
                      "list_id": rule.list_id, "rule_id": rule.id},
            )
        print(f"[Bildirim] Kural {rule.id}: {min(len(new_rows), MAX_INDIVIDUAL_PER_RUN)} ayrı bildirim.")
    else:
        count = len(new_rows)
        first = new_rows[0].title[:100] if new_rows else ""
        push_service.send(
            tokens,
            title=f"📡 {rule_name}: {count} yeni haber"[:100],
            body=first,
            data={
                "type": "rss_digest",
                "list_id": rule.list_id,
                "rule_id": rule.id,
                # Tıklanınca tam olarak bu partinin makaleleri açılsın diye.
                "batch_at": batch_stamp.isoformat(),
                "count": count,
            },
            badge=count,
        )
        print(f"[Bildirim] Kural {rule.id}: {count} haber tek özette gönderildi.")


def _send_no_news_notification(db, rule) -> None:
    """Aralıklı kuralda yeni haber çıkmadıysa 'şu an yok' bildirimi.

    Kullanıcı aralıklı bir kural kurduğunda sessizliği arıza sanıyordu; aralığın
    sonunda kuralın çalıştığını görmek istiyor. "Hemen" modunda gönderilmez —
    orada bildirim yalnızca yeni haber geldiğinde anlamlı.
    """
    tokens = [t.token for t in db.query(models.PushToken).filter(
        models.PushToken.user_id == rule.user_id).all()]
    if not tokens:
        return

    push_service.send(
        tokens,
        title=f"📡 {rule.name or (rule.rss_list.name if rule.rss_list else 'Gündem')}"[:100],
        body="Şu an yeni haber yok.",
        data={"type": "rss_none", "list_id": rule.list_id, "rule_id": rule.id},
    )
    print(f"[Bildirim] Kural {rule.id}: yeni haber yok bildirimi gönderildi.")


def _collect_articles(rule, db=None) -> list:
    """Kuralın kaynaklarından makaleleri toplar (Redis cache'li)."""
    if rule.scope == "trending":
        return _collect_trending(db, rule)
    articles = []
    for feed in _rule_feeds(rule):
        articles.extend(rss_service.fetch_feed(feed.url, feed.title))
    return articles


def _store_new_articles(db, rule, articles: list, mark_notified: bool):
    """Görülmemiş makaleleri rss_seen_articles'a yazar ve yeni satırları döner.

    mark_notified=True → satır "kapanmış" sayılır, bildirim kuyruğuna girmez.
    Baseline bunu kullanır: kural kurulduğu andaki mevcut arşiv bildirilmez.
    mark_notified=False → notified_at NULL kalır, bir sonraki turda bildirilir
    (sessiz saatte biriken haberler bu şekilde bekletilir).
    """
    if not articles:
        return []

    hashes = {}
    for a in articles:
        link = (a.get("link") or "").strip()
        if not link:
            continue
        hashes.setdefault(rss_service.link_hash(link), a)

    if not hashes:
        return []

    known = {
        h for (h,) in db.query(models.RssSeenArticle.link_hash).filter(
            models.RssSeenArticle.rule_id == rule.id,
            models.RssSeenArticle.link_hash.in_(list(hashes.keys())),
        ).all()
    }

    now = datetime.now(_tz.utc)
    fresh = []
    for h, a in hashes.items():
        if h in known:
            continue
        row = models.RssSeenArticle(
            rule_id=rule.id,
            link_hash=h,
            link=a.get("link", ""),
            title=a.get("title") or "Başlık yok",
            summary=a.get("summary"),
            feed_title=a.get("feed_title"),
            feed_url=a.get("feed_url"),
            published=a.get("published"),
            seen_at=now,
            notified_at=now if mark_notified else None,
        )
        db.add(row)
        fresh.append(row)

    db.commit()
    for row in fresh:
        db.refresh(row)

    # En yeni önce — özet bildiriminde ilk başlık en tazesi olsun.
    fresh.sort(key=lambda r: r.published or "", reverse=True)
    return fresh


@celery_app.task(name="baseline_rss_rule", queue="notify_queue")
def baseline_rss_rule_task(rule_id: int):
    """Yeni kural için başlangıç durumu: mevcut makaleler 'görüldü' işaretlenir
    ama BİLDİRİM GÖNDERİLMEZ. Olmasaydı kullanıcı ilk turda yüzlerce eski
    makalenin bildirimini yerdi.

    last_checked_at bu görev bitince dolar; evaluate yalnızca dolu olanları işler.
    """
    db = SessionLocal()
    try:
        rule = db.query(models.RssNotificationRule).filter(
            models.RssNotificationRule.id == rule_id).first()
        if not rule:
            return {"status": "error", "message": f"Kural {rule_id} bulunamadı"}

        articles = _collect_articles(rule, db)
        # mark_notified=True: bunlar kural kurulmadan önce zaten yayınlanmış
        # makaleler. NULL bıraksaydık ilk turda hepsi "bekleyen" sayılır ve
        # kullanıcı yüzlerce eski haberin bildirimini yerdi.
        rows = _store_new_articles(db, rule, articles, mark_notified=True)
        rule.last_checked_at = datetime.now(_tz.utc)
        db.commit()
        print(f"[Bildirim] Kural {rule.id} baseline: {len(rows)} makale işaretlendi.")
        return {"status": "success", "baseline": len(rows)}
    except Exception as e:
        db.rollback()
        print(f"[Bildirim] Baseline hatası (kural {rule_id}): {e}")
        return {"status": "error", "message": str(e)}
    finally:
        db.close()


@celery_app.task(name="evaluate_rss_notifications", queue="notify_queue")
def evaluate_rss_notifications_task():
    """Beat tarafından 5 dakikada bir çağrılır. Sırası gelen kuralları değerlendirir."""
    db = SessionLocal()
    checked = notified = 0
    try:
        rules = db.query(models.RssNotificationRule).filter(
            models.RssNotificationRule.enabled.is_(True),
            models.RssNotificationRule.last_checked_at.isnot(None),   # baseline bitmiş olmalı
        ).all()

        now = datetime.now(_tz.utc)
        for rule in rules:
            interval = (IMMEDIATE_INTERVAL_MINUTES if rule.mode == "immediate"
                        else (rule.interval_minutes or IMMEDIATE_INTERVAL_MINUTES))
            if rule.last_checked_at + timedelta(minutes=interval) > now:
                continue      # sırası gelmedi

            checked += 1
            try:
                articles = _collect_articles(rule, db)
                quiet = _in_quiet_hours(rule.user_id)
                # Sessiz saatte makaleler kaydedilir ama bildirilmez; notified_at
                # NULL kalır, sessiz saat bitince aşağıdaki sorgu onları toplar.
                new_rows = _store_new_articles(db, rule, articles, mark_notified=False)

                if quiet:
                    print(f"[Bildirim] Kural {rule.id}: sessiz saat, {len(new_rows)} haber bekletildi.")
                else:
                    pending = db.query(models.RssSeenArticle).filter(
                        models.RssSeenArticle.rule_id == rule.id,
                        models.RssSeenArticle.notified_at.is_(None),
                    ).order_by(models.RssSeenArticle.published.desc().nulls_last()).all()

                    if pending:
                        # Damga gönderimden ÖNCE üretilir: özet bildirimi bu
                        # damgayı taşır, tıklanınca parti onunla geri bulunur.
                        stamp = datetime.now(_tz.utc)
                        _send_rule_notification(db, rule, pending, stamp)
                        for row in pending:
                            row.notified_at = stamp
                        notified += 1
                    elif rule.mode == "interval":
                        # Aralıklı kuralda her turda haber ver; boş tur da bilgidir.
                        _send_no_news_notification(db, rule)
                        notified += 1

                rule.last_checked_at = datetime.now(_tz.utc)
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"[Bildirim] Kural {rule.id} değerlendirilemedi: {e}")

        return {"status": "success", "checked": checked, "notified": notified}
    finally:
        db.close()


@celery_app.task(name="prune_rss_seen_articles", queue="notify_queue")
def prune_rss_seen_articles_task():
    """Eski görülme kayıtlarını siler — tablo sınırsız büyümesin."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(_tz.utc) - timedelta(days=SEEN_RETENTION_DAYS)
        deleted = db.query(models.RssSeenArticle).filter(
            models.RssSeenArticle.seen_at < cutoff
        ).delete(synchronize_session=False)
        db.commit()
        print(f"[Bildirim] {deleted} eski görülme kaydı silindi.")
        return {"status": "success", "deleted": deleted}
    finally:
        db.close()
