"""Akış (haber kategorisi) bildirim kuralları.

RSS tarafındaki liste-başına-kural yapısının kategori karşılığı: kullanıcı
"Bilim için saatlik özet", "Ekonomi için anında" gibi ayrı kurallar tanımlar.

Depolama ve değerlendirme RSS kurallarıyla ortak (models.RssNotificationRule,
scope="category"); böylece sessiz saatler, gruplama, tekilleştirme ve bildirime
tıklayınca parti listesi bedavaya geliyor.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

import models
import schemas
from dependencies import db_dependency, user_dependency
from worker import baseline_rss_rule_task

router = APIRouter(prefix="/notifications", tags=["Notifications"])

IMMEDIATE_INTERVAL_MINUTES = 15
INTERVAL_STEP_MINUTES = 15
MIN_INTERVAL_MINUTES = 15
MAX_INTERVAL_MINUTES = 1440
VALID_MODES = ("immediate", "interval")
VALID_GROUPINGS = ("digest", "individual")


class CategoryRuleCreate(BaseModel):
    category_id: int
    name: Optional[str] = None          # boşsa kategori adı kullanılır
    mode: str = "immediate"
    interval_minutes: Optional[int] = None
    grouping: str = "digest"
    enabled: bool = True


class CategoryRuleUpdate(BaseModel):
    name: Optional[str] = None
    mode: Optional[str] = None
    interval_minutes: Optional[int] = None
    grouping: Optional[str] = None
    enabled: Optional[bool] = None


def _validate(mode: str, grouping: str, interval_minutes: Optional[int]) -> None:
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail="Geçersiz zamanlama modu.")
    if grouping not in VALID_GROUPINGS:
        raise HTTPException(status_code=400, detail="Geçersiz gruplama.")
    if mode == "interval":
        if (not isinstance(interval_minutes, int)
                or interval_minutes % INTERVAL_STEP_MINUTES != 0
                or not (MIN_INTERVAL_MINUTES <= interval_minutes <= MAX_INTERVAL_MINUTES)):
            raise HTTPException(
                status_code=400,
                detail="Aralık 15 dakikanın katı olmalı (en az 15 dk, en çok 24 saat).",
            )


def _own_rule_or_404(db, rule_id: int, user_id: int):
    rule = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.id == rule_id,
        models.RssNotificationRule.user_id == user_id,
        models.RssNotificationRule.scope == "category",
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Bildirim kuralı bulunamadı.")
    return rule


def _serialize(rule) -> dict:
    return {
        "id": rule.id,
        "category_id": rule.category_id,
        "category_name": rule.category.name if rule.category else None,
        "name": rule.name,
        "enabled": rule.enabled,
        "mode": rule.mode,
        "interval_minutes": rule.interval_minutes,
        "effective_interval_minutes": (IMMEDIATE_INTERVAL_MINUTES if rule.mode == "immediate"
                                       else rule.interval_minutes),
        "grouping": rule.grouping,
        # last_checked_at NULL → ilk tarama sürüyor, kural henüz değerlendirilmiyor
        "ready": rule.last_checked_at is not None,
    }


@router.get("/category-rules")
def list_category_rules(db: db_dependency, current_user: user_dependency):
    rules = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.user_id == current_user.id,
        models.RssNotificationRule.scope == "category",
    ).order_by(models.RssNotificationRule.created_at).all()
    return [_serialize(r) for r in rules]


@router.post("/category-rules", status_code=status.HTTP_201_CREATED)
def create_category_rule(body: CategoryRuleCreate,
                         db: db_dependency, current_user: user_dependency):
    _validate(body.mode, body.grouping, body.interval_minutes)

    category = db.query(models.NewsCategory).filter(
        models.NewsCategory.id == body.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Kategori bulunamadı.")

    existing = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.user_id == current_user.id,
        models.RssNotificationRule.scope == "category",
        models.RssNotificationRule.category_id == body.category_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Bu kategori için zaten bir kural var.")

    rule = models.RssNotificationRule(
        user_id=current_user.id,
        list_id=None,
        category_id=body.category_id,
        name=(body.name or category.name).strip(),
        scope="category",
        enabled=body.enabled,
        mode=body.mode,
        interval_minutes=body.interval_minutes if body.mode == "interval" else None,
        grouping=body.grouping,
        last_checked_at=None,          # baseline bitene kadar değerlendirilmez
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    # Mevcut haberler "görüldü" işaretlenir, bildirim gitmez.
    baseline_rss_rule_task.delay(rule.id)
    return _serialize(rule)


@router.patch("/category-rules/{rule_id}")
def update_category_rule(rule_id: int, body: CategoryRuleUpdate,
                         db: db_dependency, current_user: user_dependency):
    rule = _own_rule_or_404(db, rule_id, current_user.id)

    mode = body.mode if body.mode is not None else rule.mode
    grouping = body.grouping if body.grouping is not None else rule.grouping
    interval = body.interval_minutes if body.interval_minutes is not None else rule.interval_minutes
    _validate(mode, grouping, interval)

    if body.name is not None and body.name.strip():
        rule.name = body.name.strip()
    if body.enabled is not None:
        rule.enabled = body.enabled
    rule.mode = mode
    rule.grouping = grouping
    rule.interval_minutes = interval if mode == "interval" else None

    db.commit()
    db.refresh(rule)
    return _serialize(rule)


@router.delete("/category-rules/{rule_id}", status_code=status.HTTP_200_OK)
def delete_category_rule(rule_id: int, db: db_dependency, current_user: user_dependency):
    rule = _own_rule_or_404(db, rule_id, current_user.id)
    db.delete(rule)      # seen_articles CASCADE ile gider
    db.commit()
    return {"message": "Bildirim kuralı silindi."}


# ── Gündem kuralları (Akış gündemi / RSS gündemi) ──────────────────────────────
#
# İki ayrı kural: biri haber tablosundaki gündemi, diğeri tüm RSS beslemelerinden
# derlenen gündemi izler. Ayarlar'da iki sekme olarak yönetilirler.

TRENDING_KINDS = {"news": "trending_news", "rss": "trending_rss"}
TRENDING_NAMES = {"trending_news": "Akış Gündemi", "trending_rss": "RSS Gündemi"}


class TrendingRuleUpsert(BaseModel):
    enabled: bool = True
    mode: str = "interval"
    interval_minutes: Optional[int] = 180
    grouping: str = "digest"


def _trending_scope(kind: str) -> str:
    scope = TRENDING_KINDS.get(kind)
    if not scope:
        raise HTTPException(status_code=400, detail="Geçersiz gündem türü (news | rss).")
    return scope


@router.get("/trending/{kind}")
def get_trending_rule(kind: str, db: db_dependency, current_user: user_dependency):
    """Gündem bildirim ayarı. Hiç kurulmadıysa kapalı varsayılan döner."""
    scope = _trending_scope(kind)
    rule = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.user_id == current_user.id,
        models.RssNotificationRule.scope == scope,
    ).first()

    if not rule:
        return {
            "kind": kind, "configured": False, "enabled": False,
            "mode": "interval", "interval_minutes": 180,
            "effective_interval_minutes": 180, "grouping": "digest", "ready": False,
        }
    return {
        "kind": kind,
        "configured": True,
        "enabled": rule.enabled,
        "mode": rule.mode,
        "interval_minutes": rule.interval_minutes,
        "effective_interval_minutes": (IMMEDIATE_INTERVAL_MINUTES if rule.mode == "immediate"
                                       else rule.interval_minutes),
        "grouping": rule.grouping,
        "ready": rule.last_checked_at is not None,
    }


@router.put("/trending/{kind}")
def upsert_trending_rule(kind: str, body: TrendingRuleUpsert,
                         db: db_dependency, current_user: user_dependency):
    scope = _trending_scope(kind)
    _validate(body.mode, body.grouping, body.interval_minutes)

    rule = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.user_id == current_user.id,
        models.RssNotificationRule.scope == scope,
    ).first()
    created = rule is None

    if created:
        rule = models.RssNotificationRule(
            user_id=current_user.id,
            list_id=None,
            category_id=None,
            name=TRENDING_NAMES[scope],
            scope=scope,
            last_checked_at=None,
        )
        db.add(rule)

    rule.enabled = body.enabled
    rule.mode = body.mode
    rule.interval_minutes = body.interval_minutes if body.mode == "interval" else None
    rule.grouping = body.grouping
    db.commit()
    db.refresh(rule)

    if created:
        baseline_rss_rule_task.delay(rule.id)

    return get_trending_rule(kind, db, current_user)


NEWS_SCOPES = ("category", "trending_news")


def _parse_stamp(value: str):
    """Bildirimdeki batch_at damgasını çözer (RSS tarafıyla aynı kurallar)."""
    if not value:
        return None
    candidate = value.strip().replace(" ", "T")
    if len(candidate) > 3 and candidate[-3] in "+-" and candidate[-3:].count(":") == 0:
        candidate = f"{candidate}:00"
    try:
        return datetime.fromisoformat(candidate)
    except (TypeError, ValueError):
        return None


@router.get("/batch/{rule_id}")
def get_news_notification_batch(rule_id: int, at: str,
                                db: db_dependency, current_user: user_dependency):
    """Akış özet bildirimindeki haberlerin tamamı.

    Bildirim anlık görüntüsü (rss_seen_articles) yalnızca başlık/link tutuyor;
    Akış ekranı normal haber kartını ve podcast akışını kullanabilsin diye
    haberler source_url üzerinden news tablosundan geri okunur.
    """
    rule = db.query(models.RssNotificationRule).filter(
        models.RssNotificationRule.id == rule_id,
        models.RssNotificationRule.user_id == current_user.id,
        models.RssNotificationRule.scope.in_(NEWS_SCOPES),
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Bildirim kuralı bulunamadı.")

    stamp = _parse_stamp(at)
    if stamp is None:
        raise HTTPException(status_code=400, detail="Geçersiz zaman damgası.")

    links = [
        r.link for r in db.query(models.RssSeenArticle).filter(
            models.RssSeenArticle.rule_id == rule.id,
            models.RssSeenArticle.notified_at == stamp,
        ).all()
    ]
    items = []
    if links:
        items = (
            db.query(models.News)
            .filter(models.News.source_url.in_(links))
            .order_by(models.News.published_at.desc().nulls_last(),
                      models.News.created_at.desc())
            .all()
        )
    return {
        "rule_id": rule.id,
        "rule_name": rule.name,
        "category_id": rule.category_id,
        "count": len(items),
        # Alan adları /news/ listesiyle aynı → Akış ekranı kartları değişmeden çalışır.
        "items": [schemas.NewsListOut.model_validate(n) for n in items],
    }
