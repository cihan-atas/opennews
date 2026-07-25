from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import models
from dependencies import db_dependency, user_dependency
from sqlalchemy.exc import IntegrityError
import concurrent.futures
from datetime import datetime, timezone
from worker import process_rss_article_tts_task, baseline_rss_rule_task
import services.ai as ai_service
import services.rss as rss_service

router = APIRouter(prefix="/rss-reader", tags=["RSS Reader"])


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
    """Tek bir RSS beslemesini çeker. Gövde services/rss.py'ye taşındı —
    worker de aynı fonksiyonu kullanıyor (bkz. evaluate_rss_notifications)."""
    return rss_service.fetch_feed(url, feed_title)


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
    feed_title = rss_service.fetch_feed_title(url)

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


# ── Bildirim kuralları ─────────────────────────────────────────────────────────
#
# Bir RSS listesine birden fazla kural bağlanabilir. Değerlendirme worker'da,
# Celery Beat'in 5 dakikalık tick'inde yapılır (worker.evaluate_rss_notifications).

# "Hemen" modunda beslemeler bu sıklıkta yoklanır. Gerçek push yok — RSS'i biz
# yokluyoruz; 15 dk sunucuya ve yayıncılara saygılı bir denge.
IMMEDIATE_INTERVAL_MINUTES = 15
# Aralık serbest ama 15 dakikanın katı olmalı: beslemeler zaten 15 dk'dan sık
# yoklanmıyor, ara değerler bir şey kazandırmadan yayıncıya yük bindirirdi.
INTERVAL_STEP_MINUTES = 15
MIN_INTERVAL_MINUTES = 15
MAX_INTERVAL_MINUTES = 1440      # 24 saat
VALID_SCOPES = ("all", "selected")
VALID_MODES = ("immediate", "interval")
VALID_GROUPINGS = ("digest", "individual")


class NotificationRuleCreate(BaseModel):
    name: str
    scope: str = "all"                          # all | selected
    feed_ids: Optional[list[int]] = None        # scope="selected" ise zorunlu
    mode: str = "immediate"                     # immediate | interval
    interval_minutes: Optional[int] = None      # mode="interval" ise zorunlu
    grouping: str = "digest"                    # digest | individual
    enabled: bool = True


class NotificationRuleUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    feed_ids: Optional[list[int]] = None
    mode: Optional[str] = None
    interval_minutes: Optional[int] = None
    grouping: Optional[str] = None
    enabled: Optional[bool] = None


def _validate_rule(scope: str, mode: str, grouping: str,
                   interval_minutes: Optional[int], feed_ids: Optional[list[int]]) -> None:
    if scope not in VALID_SCOPES:
        raise HTTPException(status_code=400, detail="Geçersiz kapsam.")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail="Geçersiz zamanlama modu.")
    if grouping not in VALID_GROUPINGS:
        raise HTTPException(status_code=400, detail="Geçersiz gruplama.")
    if scope == "selected" and not feed_ids:
        raise HTTPException(status_code=400, detail="En az bir besleme seçmelisin.")
    if mode == "interval":
        if (not isinstance(interval_minutes, int)
                or interval_minutes % INTERVAL_STEP_MINUTES != 0
                or not (MIN_INTERVAL_MINUTES <= interval_minutes <= MAX_INTERVAL_MINUTES)):
            raise HTTPException(
                status_code=400,
                detail="Aralık 15 dakikanın katı olmalı (en az 15 dk, en çok 24 saat).",
            )


def _own_list_or_404(db, list_id: int, user_id: int) -> models.UserRssList:
    lst = db.query(models.UserRssList).filter(
        models.UserRssList.id == list_id,
        models.UserRssList.user_id == user_id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Liste bulunamadı.")
    return lst


def _own_rule_or_404(db, rule_id: int, user_id: int) -> models.RssNotificationRule:
    rule = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.id == rule_id,
        models.RssNotificationRule.user_id == user_id,
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Bildirim kuralı bulunamadı.")
    return rule


def _resolve_feed_ids(lst: models.UserRssList, feed_ids: Optional[list[int]]) -> list[int]:
    """Seçilen beslemelerin gerçekten bu listeye ait olduğunu doğrular.

    Kural OLUŞTURULMADAN ÖNCE çağrılmalı — aksi halde doğrulama patlasa bile
    kural satırı commit edilmiş olur ve kullanıcıda hiç çalışmayan ölü bir kural kalır.
    """
    valid_ids = {f.id for f in lst.feeds}
    chosen = [fid for fid in (feed_ids or []) if fid in valid_ids]
    if not chosen:
        raise HTTPException(status_code=400, detail="Seçilen beslemeler bu listeye ait değil.")
    return chosen


def _set_rule_feeds(db, rule: models.RssNotificationRule, chosen: list[int]) -> None:
    """Kuralın kapsadığı beslemeleri değiştirir (id'ler doğrulanmış olmalı)."""
    db.query(models.RssNotificationRuleFeed).filter(
        models.RssNotificationRuleFeed.rule_id == rule.id
    ).delete(synchronize_session=False)
    for fid in chosen:
        db.add(models.RssNotificationRuleFeed(rule_id=rule.id, feed_id=fid))


def _serialize_rule(rule: models.RssNotificationRule) -> dict:
    effective = (IMMEDIATE_INTERVAL_MINUTES if rule.mode == "immediate"
                 else rule.interval_minutes)
    return {
        "id": rule.id,
        "list_id": rule.list_id,
        "name": rule.name,
        "enabled": rule.enabled,
        "scope": rule.scope,
        "feed_ids": [rf.feed_id for rf in rule.feeds],
        "mode": rule.mode,
        "interval_minutes": rule.interval_minutes,
        "effective_interval_minutes": effective,
        "grouping": rule.grouping,
        "last_checked_at": rule.last_checked_at.isoformat() if rule.last_checked_at else None,
        # last_checked_at NULL → baseline görevi henüz bitmedi, kural değerlendirilmez.
        "ready": rule.last_checked_at is not None,
    }


@router.get("/lists/{list_id}/notification-rules")
def get_notification_rules(list_id: int, db: db_dependency, current_user: user_dependency):
    _own_list_or_404(db, list_id, current_user.id)
    rules = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.list_id == list_id,
        models.RssNotificationRule.user_id == current_user.id,
    ).order_by(models.RssNotificationRule.created_at).all()
    return [_serialize_rule(r) for r in rules]


@router.post("/lists/{list_id}/notification-rules", status_code=status.HTTP_201_CREATED)
def create_notification_rule(list_id: int, body: NotificationRuleCreate,
                             db: db_dependency, current_user: user_dependency):
    lst = _own_list_or_404(db, list_id, current_user.id)
    if not lst.feeds:
        raise HTTPException(status_code=400, detail="Bu listede besleme yok.")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Kural adı boş olamaz.")
    _validate_rule(body.scope, body.mode, body.grouping, body.interval_minutes, body.feed_ids)

    # Besleme sahipliği kural yazılmadan ÖNCE doğrulanır.
    chosen_feeds = _resolve_feed_ids(lst, body.feed_ids) if body.scope == "selected" else []

    rule = models.RssNotificationRule(
        user_id=current_user.id,
        list_id=list_id,
        name=body.name.strip(),
        enabled=body.enabled,
        scope=body.scope,
        mode=body.mode,
        interval_minutes=body.interval_minutes if body.mode == "interval" else None,
        grouping=body.grouping,
        last_checked_at=None,       # baseline bitene kadar değerlendirilmez
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    if chosen_feeds:
        _set_rule_feeds(db, rule, chosen_feeds)
        db.commit()

    # Baseline'ı arka planda al: mevcut makaleler "görüldü" işaretlenir ama bildirim
    # gönderilmez. Senkron yapsak 10 beslemeyi çekmek isteği ~20 sn bekletirdi.
    baseline_rss_rule_task.delay(rule.id)

    db.refresh(rule)
    return _serialize_rule(rule)


@router.patch("/notification-rules/{rule_id}")
def update_notification_rule(rule_id: int, body: NotificationRuleUpdate,
                             db: db_dependency, current_user: user_dependency):
    rule = _own_rule_or_404(db, rule_id, current_user.id)

    scope = body.scope if body.scope is not None else rule.scope
    mode = body.mode if body.mode is not None else rule.mode
    grouping = body.grouping if body.grouping is not None else rule.grouping
    interval = body.interval_minutes if body.interval_minutes is not None else rule.interval_minutes
    feed_ids = body.feed_ids if body.feed_ids is not None else [rf.feed_id for rf in rule.feeds]

    _validate_rule(scope, mode, grouping, interval, feed_ids)
    chosen_feeds = _resolve_feed_ids(rule.rss_list, feed_ids) if scope == "selected" else []

    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail="Kural adı boş olamaz.")
        rule.name = body.name.strip()
    if body.enabled is not None:
        rule.enabled = body.enabled

    rule.scope = scope
    rule.mode = mode
    rule.grouping = grouping
    rule.interval_minutes = interval if mode == "interval" else None

    if chosen_feeds:
        _set_rule_feeds(db, rule, chosen_feeds)
    else:
        db.query(models.RssNotificationRuleFeed).filter(
            models.RssNotificationRuleFeed.rule_id == rule.id
        ).delete(synchronize_session=False)

    db.commit()
    db.refresh(rule)
    return _serialize_rule(rule)


@router.delete("/notification-rules/{rule_id}", status_code=status.HTTP_200_OK)
def delete_notification_rule(rule_id: int, db: db_dependency, current_user: user_dependency):
    rule = _own_rule_or_404(db, rule_id, current_user.id)
    db.delete(rule)          # rule_feeds ve seen_articles CASCADE ile gider
    db.commit()
    return {"message": "Bildirim kuralı silindi."}


def _parse_stamp(value: str):
    """Bildirimdeki batch_at damgasını çözer.

    Uygulama datetime.isoformat() gönderir ("...+00:00"). Elle test ederken
    Postgres'in metin biçimi de ("... +00", boşluklu) kullanılabildiği için
    o varyantlar da kabul ediliyor.
    """
    if not value:
        return None
    candidate = value.strip().replace(" ", "T")
    # "+00" gibi iki haneli ofseti "+00:00" yap
    if len(candidate) > 3 and candidate[-3] in "+-" and candidate[-3:].count(":") == 0:
        candidate = f"{candidate}:00"
    try:
        return datetime.fromisoformat(candidate)
    except (TypeError, ValueError):
        return None


@router.get("/notification-batch/{rule_id}")
def get_notification_batch(rule_id: int, at: str, db: db_dependency, current_user: user_dependency):
    """Bir özet bildiriminde gönderilen makalelerin tamamı.

    Özet bildirimine tıklanınca kullanıcı sadece listeye düşüyordu ve bildirimdeki
    haberleri yüzlerce makale arasında bulmak zordu. Bildirim, gönderim damgasını
    (batch_at) taşıyor; burada o damgayla tam olarak aynı parti geri veriliyor.
    """
    rule = _own_rule_or_404(db, rule_id, current_user.id)

    stamp = _parse_stamp(at)
    if stamp is None:
        raise HTTPException(status_code=400, detail="Geçersiz zaman damgası.")

    rows = (
        db.query(models.RssSeenArticle)
        .filter(
            models.RssSeenArticle.rule_id == rule.id,
            models.RssSeenArticle.notified_at == stamp,
        )
        .order_by(models.RssSeenArticle.published.desc().nulls_last())
        .all()
    )
    return {
        "rule_id": rule.id,
        "rule_name": rule.name,
        "list_id": rule.list_id,
        "count": len(rows),
        # Alan adları canlı RSS makaleleriyle aynı → mobilde aynı kart bileşeni
        # ve makale detayı (podcast oluşturma dahil) değişmeden çalışır.
        "articles": [
            {
                "id": r.id,
                "title": r.title,
                "link": r.link,
                "summary": r.summary,
                "feed_title": r.feed_title,
                "feed_url": r.feed_url,
                "published": r.published,
            }
            for r in rows
        ],
    }


@router.get("/notified-articles/{article_id}")
def get_notified_article(article_id: int, db: db_dependency, current_user: user_dependency):
    """Bildirime tıklanınca açılacak makale. RSS makaleleri DB'de tutulmadığı için
    bildirim anındaki anlık görüntü rss_seen_articles'tan okunur."""
    article = (
        db.query(models.RssSeenArticle)
        .join(models.RssNotificationRule)
        .filter(
            models.RssSeenArticle.id == article_id,
            models.RssNotificationRule.user_id == current_user.id,
        )
        .first()
    )
    if not article:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    return {
        "id": article.id,
        "title": article.title,
        "link": article.link,
        "summary": article.summary,
        "feed_title": article.feed_title,
        "feed_url": article.feed_url,
        "published": article.published,
        "list_id": article.rule.list_id,
    }
