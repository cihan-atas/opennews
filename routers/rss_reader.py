from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import models
from dependencies import db_dependency, user_dependency
from sqlalchemy.exc import IntegrityError
import feedparser
import concurrent.futures
from datetime import datetime, timezone
from worker import process_rss_article_tts_task
import services.ai as ai_service

router = APIRouter(prefix="/rss-reader", tags=["RSS Reader"])

# Bazı yayıncılar (Cloudflare vb.) feedparser'ın varsayılan User-Agent'ını
# bloklar ve boş besleme döndürür. Gerçek bir tarayıcı UA'sı ile istek atıyoruz.
FEED_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class ListCreate(BaseModel):
    name: str


class FeedAdd(BaseModel):
    url: str


class RssPodcastCreate(BaseModel):
    title: str
    content: str
    source_url: Optional[str] = None
    length: Optional[str] = "medium"  # short | medium | long


class RssTranslateRequest(BaseModel):
    text: str
    lang: str = "en"


class SaveArticleRequest(BaseModel):
    title: str
    link: str
    summary: Optional[str] = None
    feed_title: Optional[str] = None
    feed_url: Optional[str] = None
    published: Optional[str] = None


def _fetch_feed(url: str, feed_title: str) -> list[dict]:
    """Fetch and parse a single RSS feed, return article dicts."""
    try:
        parsed = feedparser.parse(url, agent=FEED_USER_AGENT)
        articles = []
        for entry in parsed.entries[:100]:
            pub = entry.get("published_parsed") or entry.get("updated_parsed")
            if pub:
                dt = datetime(*pub[:6], tzinfo=timezone.utc).isoformat()
            else:
                dt = None
            articles.append({
                "title": entry.get("title", "Başlık yok"),
                "link": entry.get("link", ""),
                "summary": entry.get("summary", ""),
                "published": dt,
                "feed_title": feed_title or parsed.feed.get("title", url),
                "feed_url": url,
            })
        return articles
    except Exception:
        return []


# ── List CRUD ──────────────────────────────────────────────────────────────────

@router.get("/lists")
def get_lists(db: db_dependency, current_user: user_dependency):
    lists = (
        db.query(models.UserRssList)
        .filter(models.UserRssList.user_id == current_user.id)
        .order_by(models.UserRssList.created_at)
        .all()
    )
    return [
        {
            "id": lst.id,
            "name": lst.name,
            "feed_count": len(lst.feeds),
            "feeds": [{"id": f.id, "url": f.url, "title": f.title} for f in lst.feeds],
        }
        for lst in lists
    ]


@router.post("/lists", status_code=status.HTTP_201_CREATED)
def create_list(body: ListCreate, db: db_dependency, current_user: user_dependency):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Liste adı boş olamaz.")
    lst = models.UserRssList(user_id=current_user.id, name=body.name.strip())
    db.add(lst)
    db.commit()
    db.refresh(lst)
    return {"id": lst.id, "name": lst.name, "feed_count": 0, "feeds": []}


@router.patch("/lists/{list_id}")
def rename_list(list_id: int, body: ListCreate, db: db_dependency, current_user: user_dependency):
    lst = db.query(models.UserRssList).filter(
        models.UserRssList.id == list_id,
        models.UserRssList.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Liste bulunamadı.")
    lst.name = body.name.strip()
    db.commit()
    return {"id": lst.id, "name": lst.name}


@router.delete("/lists/{list_id}", status_code=status.HTTP_200_OK)
def delete_list(list_id: int, db: db_dependency, current_user: user_dependency):
    lst = db.query(models.UserRssList).filter(
        models.UserRssList.id == list_id,
        models.UserRssList.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Liste bulunamadı.")
    db.delete(lst)
    db.commit()
    return {"message": "Liste silindi."}


# ── Feed CRUD ──────────────────────────────────────────────────────────────────

@router.post("/lists/{list_id}/feeds", status_code=status.HTTP_201_CREATED)
def add_feed(list_id: int, body: FeedAdd, db: db_dependency, current_user: user_dependency):
    lst = db.query(models.UserRssList).filter(
        models.UserRssList.id == list_id,
        models.UserRssList.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Liste bulunamadı.")

    url = str(body.url).strip()

    # Duplicate check
    existing = next((f for f in lst.feeds if f.url == url), None)
    if existing:
        raise HTTPException(status_code=409, detail="Bu kaynak zaten listede.")

    # Auto-detect feed title
    feed_title = None
    try:
        parsed = feedparser.parse(url, agent=FEED_USER_AGENT)
        feed_title = parsed.feed.get("title") or None
    except Exception:
        pass

    feed = models.UserRssFeed(list_id=list_id, url=url, title=feed_title)
    db.add(feed)
    db.commit()
    db.refresh(feed)
    return {"id": feed.id, "url": feed.url, "title": feed.title}


@router.delete("/lists/{list_id}/feeds/{feed_id}", status_code=status.HTTP_200_OK)
def remove_feed(list_id: int, feed_id: int, db: db_dependency, current_user: user_dependency):
    feed = db.query(models.UserRssFeed).join(models.UserRssList).filter(
        models.UserRssFeed.id == feed_id,
        models.UserRssFeed.list_id == list_id,
        models.UserRssList.user_id == current_user.id,
    ).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed bulunamadı.")
    db.delete(feed)
    db.commit()
    return {"message": "Feed kaldırıldı."}


# ── Articles (live fetch) ──────────────────────────────────────────────────────

@router.get("/lists/{list_id}/articles")
def get_articles(list_id: int, db: db_dependency, current_user: user_dependency):
    lst = db.query(models.UserRssList).filter(
        models.UserRssList.id == list_id,
        models.UserRssList.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Liste bulunamadı.")

    if not lst.feeds:
        return []

    # Fetch all feeds concurrently
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(_fetch_feed, f.url, f.title) for f in lst.feeds]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    articles = [item for sublist in results for item in sublist]
    articles.sort(key=lambda a: a["published"] or "", reverse=True)
    return articles


@router.get("/trending")
def get_rss_trending(db: db_dependency, current_user: user_dependency, limit: int = 12):
    """Kullanıcının tüm RSS listelerindeki beslemelerden en güncel makaleleri
    toplayıp tarihe göre sıralı 'RSS Gündemi' döndürür."""
    lists = (
        db.query(models.UserRssList)
        .filter(models.UserRssList.user_id == current_user.id)
        .all()
    )
    # Tüm listelerdeki benzersiz beslemeleri topla (aynı url birden çok listede olabilir)
    feeds = {}
    for lst in lists:
        for f in lst.feeds:
            feeds.setdefault(f.url, f.title)

    if not feeds:
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(_fetch_feed, url, title) for url, title in feeds.items()]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    articles = [item for sublist in results for item in sublist]
    # Link bazında tekilleştir
    seen = set()
    unique = []
    for a in articles:
        key = a.get("link") or a.get("title")
        if key and key not in seen:
            seen.add(key)
            unique.append(a)

    unique.sort(key=lambda a: a["published"] or "", reverse=True)
    return unique[:limit]


# ── RSS Podcast ────────────────────────────────────────────────────────────────

@router.post("/translate")
def translate_rss_article(body: RssTranslateRequest, db: db_dependency, current_user: user_dependency):
    if body.lang not in ("en", "tr"):
        raise HTTPException(status_code=400, detail="lang must be 'en' or 'tr'")
    from utils import translate_cached
    translated = translate_cached(db, body.text[:3000], body.lang)
    return {"translated": translated, "lang": body.lang}


@router.post("/podcast", status_code=status.HTTP_202_ACCEPTED)
def create_rss_podcast(body: RssPodcastCreate, db: db_dependency, current_user: user_dependency):
    existing = db.query(models.Podcast).filter(
        models.Podcast.user_id == current_user.id,
        models.Podcast.title == body.title,
        models.Podcast.news_id.is_(None),
    ).first()
    if existing:
        return {"status": "exists", "podcast_id": existing.id, "audio_url": existing.audio_url}

    length = body.length if body.length in ("short", "medium", "long") else "medium"
    process_rss_article_tts_task.delay(body.title, body.content, current_user.id, body.source_url, length)
    return {"status": "processing"}


# ── Saved RSS Articles ─────────────────────────────────────────────────────────

@router.post("/saved", status_code=status.HTTP_201_CREATED)
def save_article(body: SaveArticleRequest, db: db_dependency, current_user: user_dependency):
    """RSS listesinden bir makaleyi kaydeder. Aynı link zaten kayıtlıysa 409 döner."""
    existing = db.query(models.SavedRssArticle).filter(
        models.SavedRssArticle.user_id == current_user.id,
        models.SavedRssArticle.link == body.link,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Bu makale zaten kaydedilmiş.")

    article = models.SavedRssArticle(
        user_id=current_user.id,
        title=body.title,
        link=body.link,
        summary=body.summary,
        feed_title=body.feed_title,
        feed_url=body.feed_url,
        published=body.published,
    )
    db.add(article)
    db.commit()
    db.refresh(article)
    return {
        "id": article.id,
        "title": article.title,
        "link": article.link,
        "summary": article.summary,
        "feed_title": article.feed_title,
        "feed_url": article.feed_url,
        "published": article.published,
        "saved_at": article.saved_at,
    }


@router.get("/saved")
def get_saved_articles(
    db: db_dependency,
    current_user: user_dependency,
    page: int = 1,
    size: int = 20,
):
    """Kullanıcının kaydettiği RSS makalelerini sayfalı olarak döner."""
    offset = (page - 1) * size
    query = db.query(models.SavedRssArticle).filter(
        models.SavedRssArticle.user_id == current_user.id
    )
    total_count = query.count()
    items = query.order_by(models.SavedRssArticle.saved_at.desc()).offset(offset).limit(size).all()
    return {
        "total_count": total_count,
        "page": page,
        "size": size,
        "items": [
            {
                "id": a.id,
                "title": a.title,
                "link": a.link,
                "summary": a.summary,
                "feed_title": a.feed_title,
                "feed_url": a.feed_url,
                "published": a.published,
                "saved_at": a.saved_at,
            }
            for a in items
        ],
    }


@router.delete("/saved/{article_id}", status_code=status.HTTP_200_OK)
def delete_saved_article(article_id: int, db: db_dependency, current_user: user_dependency):
    """Kaydedilen RSS makalesini siler."""
    article = db.query(models.SavedRssArticle).filter(
        models.SavedRssArticle.id == article_id,
        models.SavedRssArticle.user_id == current_user.id,
    ).first()
    if not article:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    db.delete(article)
    db.commit()
    return {"message": "Makale kaydından silindi."}


@router.get("/podcast/check")
def check_rss_podcast(title: str, db: db_dependency, current_user: user_dependency):
    podcast = db.query(models.Podcast).filter(
        models.Podcast.user_id == current_user.id,
        models.Podcast.title == title,
        models.Podcast.news_id.is_(None),
    ).first()
    if not podcast:
        raise HTTPException(status_code=404, detail="Podcast henüz hazır değil.")
    return {"podcast_id": podcast.id, "audio_url": podcast.audio_url}
