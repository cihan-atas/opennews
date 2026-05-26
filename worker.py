import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from celery import Celery
from config import settings
from utils import upload_to_gcs, get_embedding
import services.ai as ai_service
import services.tts as tts_service
import services.push as push_service
from database import SessionLocal
import models
import time

CELERY_BROKER_URL = settings.CELERY_BROKER_URL

celery_app = Celery("tasks", broker=CELERY_BROKER_URL)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)

@celery_app.task(name="process_news_and_tts", queue="ai_queue")
def process_news_and_tts_task(news_id: int, user_id: int):
    db = SessionLocal()
    tmp_path = f"/tmp/news_{news_id}.mp3"
    try:
        # 1. DB'den haberi çek
        news = db.query(models.News).filter(models.News.id == news_id).first()
        if not news:
            print(f"[Worker] News {news_id} bulunamadı, görev iptal edildi.")
            return {"status": "error", "message": f"News {news_id} not found"}

        print(f"[Worker] Haber bulundu: '{news.title}' — AI ile özetleniyor...")

        # 2. Özetle (sağlayıcı .env'den: vertex/openai)
        prompt = (
            "Aşağıdaki haberi Türkçe olarak kapsamlı bir podcast özeti olarak hazırla. "
            "Haberin tüm önemli detaylarını, bağlamını ve sonuçlarını kapsayan 8-12 cümlelik akıcı bir anlatı oluştur. "
            "Podcast için sesli okunacağından doğal bir konuşma diliyle yaz, "
            "madde işareti veya başlık kullanma:\n\n"
            f"{news.content}"
        )
        summary = ai_service.generate(prompt)

        # Özeti News tablosuna kaydet
        news.summary = summary
        db.commit()
        print(f"[Worker] Özet oluşturuldu ve kaydedildi ({len(summary.split())} kelime).")

        # Embedding üret ve kaydet (başlık + içerik)
        print("[Worker] Embedding üretiliyor...")
        embedding_text = f"{news.title}\n\n{news.content}"
        news.embedding = get_embedding(embedding_text, task_type="retrieval_document")
        db.commit()
        print("[Worker] Embedding kaydedildi.")

        # 3. TTS ile .mp3 üret (sağlayıcı .env'den: google/edge)
        print("[Worker] TTS ile ses üretiliyor...")
        audio_bytes = tts_service.synthesize(summary)
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
        )
        db.add(podcast)
        db.commit()
        print(f"[Worker] Podcast kaydedildi — ID: {podcast.id}, süre: {duration_seconds}s")

        # Push bildirim gönder (kullanıcının kayıtlı token'ları varsa)
        _notify_user(db, user_id, news.title)

        return {"status": "success", "news_id": news_id, "audio_url": audio_url}

    except Exception as e:
        db.rollback()
        print(f"[Worker] HATA — news_id={news_id}: {e}")
        return {"status": "error", "message": str(e)}

    finally:
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
        unprocessed_news = db.query(models.News).filter(
            (models.News.summary.is_(None)) | (models.News.embedding.is_(None))
        ).order_by(models.News.created_at.desc()).limit(500).all()

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
                        "Aşağıdaki haberi Türkçe olarak kapsamlı bir podcast özeti olarak hazırla. "
                        "Haberin tüm önemli detaylarını, bağlamını ve sonuçlarını kapsayan 8-12 cümlelik akıcı bir anlatı oluştur. "
                        "Podcast için sesli okunacağından doğal bir konuşma diliyle yaz, "
                        "madde işareti veya başlık kullanma:\n\n"
                        f"{news.content}"
                    )
                    news.summary = ai_service.generate(prompt)
                    db.commit()

                # 2. Eğer semantik arama embedding'i yoksa onu da aradan çıkart reis
                if news.embedding is None:
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
def process_rss_article_tts_task(title: str, content: str, user_id: int, source_url: str = None):
    """RSS makale metnini Gemini ile Türkçeye özetler, TTS ile sese çevirir ve kaydeder."""
    import hashlib
    tmp_key = hashlib.md5(f"{title}{user_id}".encode()).hexdigest()[:12]
    tmp_path = f"/tmp/rss_{tmp_key}.mp3"
    db = SessionLocal()
    try:
        prompt = (
            "Aşağıdaki haberi Türkçe olarak kapsamlı bir podcast özeti olarak hazırla. "
            "Haberin tüm önemli detaylarını, bağlamını ve sonuçlarını kapsayan 8-12 cümlelik akıcı bir anlatı oluştur. "
            "Podcast için sesli okunacağından doğal bir konuşma diliyle yaz, "
            "madde işareti veya başlık kullanma:\n\n"
            f"Başlık: {title}\n\nİçerik: {content[:3000]}"
        )
        summary = ai_service.generate(prompt)

        audio_bytes = tts_service.synthesize(summary)
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

        _notify_user(db, user_id, title)

        return {"status": "success", "podcast_id": podcast.id}

    except Exception as e:
        db.rollback()
        print(f"[Worker] RSS TTS HATA: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        db.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


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
