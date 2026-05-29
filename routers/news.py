from fastapi import APIRouter, Depends, HTTPException, status
from typing_extensions import Optional
from pydantic import BaseModel
import schemas, models
from dependencies import db_dependency, user_dependency
from utils import get_embedding
import services.ai as ai_service
from worker import run_scraper_task, process_bulletin_tts_task
from datetime import datetime, timezone, timedelta
from sqlalchemy import func
import logging

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/news",
    tags=["News"]
)

@router.get("/", response_model=schemas.NewsPagination)
def get_news(
    db: db_dependency,
    current_user: user_dependency,
    page: int = 1,
    size: int = 10,
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    interests_only: bool = False,
):
    query = db.query(models.News)

    # İlgi alanlarına göre filtrele
    if interests_only and current_user.interests:
        interest_ids = [cat.id for cat in current_user.interests]
        query = query.filter(models.News.category_id.in_(interest_ids))

    # Tek kategori filtresi
    if category_id:
        query = query.filter(models.News.category_id == category_id)

    if search:
        try:
            # 1. Query vektörünü alıyoruz (Vertex AI). Embedding'i olan haberler arasında cosine similarity ile semantic search
            query_vector = get_embedding(search, task_type="retrieval_query")

            # 2. Vektör sorgusunu hazırlıyoruz
            # .all() DEĞİL, sadece sorgu tanımını yapıyoruz
            vector_query = (
                query
                .filter(models.News.embedding.isnot(None))
                .order_by(models.News.embedding.cosine_distance(query_vector))
            )
            
            # 3. TOPLAM SAYI: Veritabanına sadece kaç tane olduğunu soruyoruz (Ağır veri çekmiyoruz)
            total_count = vector_query.count()
            
            # 4. PAGINATION: Sadece ihtiyacımız olan miktarda haberi çekiyoruz
            # Limit ve Offset doğrudan SQL'e dönüşür.
            items = (
                vector_query
                .offset((page - 1) * size)
                .limit(size)
                .all()
            )
            
        except Exception as e:
            logger.error(f"Semantic Search hatası: {e}")
            # Vertex AI patlarsa klasik LIKE aramasına düşüyoruz
            query = query.filter(models.News.title.contains(search))
            total_count = query.count()
            items = (
                query
                .order_by(models.News.created_at.desc())
                .offset((page - 1) * size)
                .limit(size)
                .all()
            )
    else:
        total_count = query.count()
        items = query.order_by(models.News.published_at.desc().nullslast(), models.News.created_at.desc()).offset((page - 1) * size).limit(size).all()

    return {
        "items": items,
        "total_count": total_count,
        "page": page,
        "size": size,
    }

@router.post("/", response_model=schemas.NewsDetailOut, status_code=status.HTTP_201_CREATED)
def create_news(news: schemas.NewsCreate, db: db_dependency, current_user: user_dependency):
    """
    ### CIHAN (AI & Data Pipeline):
    - **Scraping:** Kazıdığın haberleri bu endpoint ile sisteme yükleyebilirsin.
    - **Automation:** Bu endpoint'e veri geldiği an, arka planda otomatik olarak 'Celery Task' tetiklenir.
    - **Pipeline:** Celery; Gemini ile özetleme ve Google TTS ile seslendirme süreçlerini sıraya alır.
    
    ### Teknik Detay:
    - `.delay()` kullanımı sayesinde API cevabı bekletmez, işi Redis üzerinden Worker'a paslar.
    """
    new_news = models.News(**news.dict())
    db.add(new_news)
    db.commit()
    db.refresh(new_news)
    return new_news

@router.post("/{news_id}/click")
def track_news_click(news_id: int, current_user: user_dependency, db: db_dependency):
    """
    ### BURAK (Frontend):
    - **DİKKAT:** Kullanıcı bir habere tıkladığı an bu endpoint'i TETİKLE.
    - **Akıllı Sistem:** Arka planda kullanıcının hangi kategoriye kaç kere tıkladığını sayıyorum.
    - **Öneri:** Eğer yanıtın içinde `suggestion` objesi gelirse (Null değilse), bu kullanıcı 5 tıkı geçti demektir. 
    - **Aksiyon:** Ekranda "Bu kategori (Örn: Spor) ilgini çekiyor gibi, ekleyelim mi?" diye bir pop-up çıkar.
    """

    # 1. Haberi bul ki kategorisini öğrenelim
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")

    # 2. Bu kullanıcının bu kategori için bir click kaydı var mı?
    click_record = db.query(models.UserClick).filter(
        models.UserClick.user_id == current_user.id,
        models.UserClick.category_id == news.category_id
    ).first()

    if click_record:
        click_record.click_count += 1
    else:
        # İlk defa tıklıyorsa yeni kayıt aç
        click_record = models.UserClick(
            user_id=current_user.id,
            category_id=news.category_id,
            click_count=1
        )
        db.add(click_record)

    db.commit()

    # 3. Öneri Mantığı: 5 tık olduysa ve daha önce önermediysek (Örn: Limit=5)
    if click_record.click_count >= 5 and not click_record.is_suggested:
        is_already_interest = any(cat.id == news.category_id for cat in current_user.interests)
        if not is_already_interest:
            # Öneriyi gönderiyoruz ve 'is_suggested'ı True yapıyoruz ki bir daha darlamayalım.
            click_record.is_suggested = True
            db.commit()
            return {
                "suggestion": {
                    "id": news.category_id,
                    "name": news.category.name,
                    "message": f"{news.category.name} kategorisine olan ilginin farkındayız!"
                }
            }

    return {"suggestion": None, "message": "Click tracked."}

@router.post("/refresh", status_code=status.HTTP_202_ACCEPTED)
def refresh_news(current_user: user_dependency):
    # Scraper başlamadan önce Redis flag'ini biz set ediyoruz.
    # Böylece frontend ilk polling'de zaten "processing" görür, race condition olmaz.
    import redis as _redis
    from config import settings as _cfg
    _redis.from_url(_cfg.CELERY_BROKER_URL).set("scraper_running", "1", ex=3600)
    run_scraper_task.delay()
    return {"status": "processing"}


class BulletinRequest(BaseModel):
    news_ids: Optional[list[int]] = None   # Belirli haberler; verilmezse otomatik seçim
    category_id: Optional[int] = None      # Otomatik seçimde kategori filtresi
    limit: int = 5                         # Otomatik seçimde haber sayısı


@router.post("/bulletin", status_code=status.HTTP_202_ACCEPTED)
def create_bulletin(body: BulletinRequest, db: db_dependency, current_user: user_dependency):
    """Birden çok haberi tek bir 'günlük bülten' podcast'inde birleştirir.

    news_ids verilirse onları, yoksa (opsiyonel kategori filtresiyle) en güncel
    haberleri kullanır. Üretim asenkron; istemci dönen `title` ile
    GET /news/bulletin/check?title=... üzerinden durumu izler."""
    if body.news_ids:
        news_ids = body.news_ids[:10]
    else:
        q = db.query(models.News.id).order_by(models.News.published_at.desc().nullslast())
        if body.category_id:
            q = q.filter(models.News.category_id == body.category_id)
        limit = max(2, min(body.limit, 10))
        news_ids = [r.id for r in q.limit(limit).all()]

    if len(news_ids) < 2:
        raise HTTPException(status_code=400, detail="Bülten için en az 2 haber gerekiyor.")

    title = f"Günlük Bülten — {datetime.now(timezone.utc).astimezone().strftime('%d.%m.%Y %H:%M')}"
    process_bulletin_tts_task.delay(news_ids, current_user.id, title)
    return {"status": "processing", "title": title, "count": len(news_ids)}


@router.get("/bulletin/check", response_model=schemas.PodcastOut)
def check_bulletin(title: str, db: db_dependency, current_user: user_dependency):
    """Bülten podcast'i hazır mı? Hazırsa Podcast'i döner, değilse 404."""
    podcast = (
        db.query(models.Podcast)
        .filter(models.Podcast.user_id == current_user.id, models.Podcast.title == title)
        .order_by(models.Podcast.created_at.desc())
        .first()
    )
    if not podcast:
        raise HTTPException(status_code=404, detail="Bülten henüz hazır değil.")
    return podcast


@router.get("/trending", response_model=list[schemas.NewsListOut])
def get_trending_news(db: db_dependency, current_user: user_dependency, limit: int = 10):
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = (
        db.query(models.UserClick.category_id, func.sum(models.UserClick.click_count).label("total"))
        .filter(models.UserClick.last_click_at >= since)
        .group_by(models.UserClick.category_id)
        .order_by(func.sum(models.UserClick.click_count).desc())
        .limit(5)
        .all()
    )
    hot_category_ids = [r.category_id for r in rows]

    if not hot_category_ids:
        return (
            db.query(models.News)
            .order_by(models.News.published_at.desc().nullslast())
            .limit(limit)
            .all()
        )

    items = (
        db.query(models.News)
        .filter(models.News.category_id.in_(hot_category_ids))
        .order_by(models.News.published_at.desc().nullslast())
        .limit(limit)
        .all()
    )
    return items


@router.get("/{news_id}/related", response_model=list[schemas.NewsListOut])
def get_related_news(news_id: int, db: db_dependency, current_user: user_dependency, limit: int = 5):
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news or news.embedding is None:
        return []
    related = (
        db.query(models.News)
        .filter(models.News.id != news_id, models.News.embedding.isnot(None))
        .order_by(models.News.embedding.cosine_distance(news.embedding))
        .limit(limit)
        .all()
    )
    return related


@router.get("/{news_id}", response_model=schemas.NewsDetailOut)
def get_news_detail(news_id: int, db: db_dependency, current_user: user_dependency):
    """
    ### BURAK (Frontend):
    - Haberin tüm detaylarını (tam metin, özet, resim vb.) buradan çekersin.
    - Habere tıklandığı an bu endpoint ile birlikte 'POST /news/{id}/click' endpoint'ini de tetiklemeyi unutma!
    """
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="News not found!")
    return news

@router.post("/{news_id}/feedback")
def submit_summary_feedback(news_id: int, rating: str, db: db_dependency, current_user: user_dependency):
    if rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating 'up' veya 'down' olmalı.")
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")

    existing = db.query(models.SummaryFeedback).filter(
        models.SummaryFeedback.news_id == news_id,
        models.SummaryFeedback.user_id == current_user.id,
    ).first()

    if existing:
        existing.rating = rating
    else:
        existing = models.SummaryFeedback(news_id=news_id, user_id=current_user.id, rating=rating)
        db.add(existing)
    db.commit()
    return {"message": "Geri bildirim kaydedildi.", "rating": rating}


@router.get("/{news_id}/feedback/mine")
def get_my_feedback(news_id: int, db: db_dependency, current_user: user_dependency):
    fb = db.query(models.SummaryFeedback).filter(
        models.SummaryFeedback.news_id == news_id,
        models.SummaryFeedback.user_id == current_user.id,
    ).first()
    return {"rating": fb.rating if fb else None}


@router.get("/{news_id}/translate")
def translate_news(news_id: int, db: db_dependency, current_user: user_dependency, lang: str = "en"):
    if lang not in ("en", "tr"):
        raise HTTPException(status_code=400, detail="lang must be 'en' or 'tr'")
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")
    text = news.summary or news.content[:3000]
    from utils import translate_cached
    translated = translate_cached(db, text, lang)
    return {"translated": translated, "lang": lang}


@router.get("/refresh/status")
def get_refresh_status():
    """
    - Scraper worker ayrı bir proseste çalıştığı için is_currently_scraping global'i
      API prosesinde her zaman False görünürdü. Düzeltme: Redis shared flag kullanıyoruz.
      POST /refresh flag'i set eder, scraper bitince finally bloğu flag'i siler.
    """
    import redis as _redis
    from config import settings as _cfg
    r = _redis.from_url(_cfg.CELERY_BROKER_URL)
    is_running = r.exists("scraper_running")
    return {"status": "processing" if is_running else "idle"}