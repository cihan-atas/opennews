from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import models
from dependencies import db_dependency, user_dependency
from sqlalchemy.exc import IntegrityError
import feedparser

router = APIRouter(prefix="/rss", tags=["Community RSS"])


def _require_admin(current_user):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Bu işlem için admin yetkisi gerekiyor.")


def _validate_feed_url(url: str) -> Optional[str]:
    """RSS URL'sinin gerçekten ayrıştırılabilir bir besleme olduğunu doğrular.
    Geçerliyse beslemenin başlığını döndürür (otomatik isim için), değilse 400 atar."""
    try:
        parsed = feedparser.parse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="RSS kaynağı okunamadı. URL'yi kontrol edin.")
    # Ayrıştırma hatası (bozuk XML / besleme değil) ve hiç girdi yoksa geçersiz say.
    if getattr(parsed, "bozo", 0) and not parsed.entries:
        raise HTTPException(status_code=400, detail="Geçerli bir RSS/Atom beslemesi değil.")
    if not parsed.entries and not parsed.feed.get("title"):
        raise HTTPException(status_code=400, detail="Bu adreste yayın/besleme bulunamadı.")
    return parsed.feed.get("title") or None


class RssSubmit(BaseModel):
    url: str
    title: Optional[str] = None
    category_id: Optional[int] = None


class RssAdminAdd(BaseModel):
    url: str
    title: Optional[str] = None
    category_id: Optional[int] = None


class RssApprove(BaseModel):
    # Admin onaylarken kategoriyi değiştirebilir (None gönderilirse mevcut korunur)
    category_id: Optional[int] = None


def _validate_category(db, category_id):
    if category_id is None:
        return
    exists = db.query(models.NewsCategory).filter(models.NewsCategory.id == category_id).first()
    if not exists:
        raise HTTPException(status_code=422, detail="Geçersiz kategori.")


@router.post("/submit", status_code=status.HTTP_201_CREATED)
def submit_rss_source(body: RssSubmit, db: db_dependency, current_user: user_dependency):
    _validate_category(db, body.category_id)
    detected_title = _validate_feed_url(str(body.url))
    source = models.CommunityRssSource(
        url=str(body.url),
        title=body.title or detected_title,
        category_id=body.category_id,
        submitted_by=current_user.id,
        status="pending",
    )
    db.add(source)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Bu kaynak zaten gönderilmiş.")
    return {"message": "Kaynağınız inceleme kuyruğuna alındı.", "id": source.id}


@router.post("/admin/add", status_code=status.HTTP_201_CREATED)
def admin_add_source(body: RssAdminAdd, db: db_dependency, current_user: user_dependency):
    """Admin doğrudan onaylı kaynak ekler."""
    _require_admin(current_user)
    _validate_category(db, body.category_id)
    detected_title = _validate_feed_url(str(body.url))
    source = models.CommunityRssSource(
        url=str(body.url),
        title=body.title or detected_title,
        category_id=body.category_id,
        submitted_by=current_user.id,
        status="approved",
    )
    db.add(source)
    try:
        db.commit()
        db.refresh(source)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Bu kaynak zaten mevcut.")
    return {
        "id": source.id,
        "url": source.url,
        "title": source.title,
        "category_id": source.category_id,
        "category": source.category.name if source.category else None,
        "status": source.status,
    }


@router.get("/pending")
def list_pending(db: db_dependency, current_user: user_dependency):
    _require_admin(current_user)
    items = (
        db.query(models.CommunityRssSource)
        .filter(models.CommunityRssSource.status == "pending")
        .order_by(models.CommunityRssSource.created_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "url": s.url,
            "title": s.title,
            "category_id": s.category_id,
            "category": s.category.name if s.category else None,
            "submitted_by": s.submitted_by,
            "created_at": s.created_at,
        }
        for s in items
    ]


@router.post("/{source_id}/approve")
def approve_source(source_id: int, db: db_dependency, current_user: user_dependency, body: Optional[RssApprove] = None):
    _require_admin(current_user)
    source = db.query(models.CommunityRssSource).filter(models.CommunityRssSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Kaynak bulunamadı.")
    if body and body.category_id is not None:
        _validate_category(db, body.category_id)
        source.category_id = body.category_id
    source.status = "approved"
    db.commit()
    db.refresh(source)
    return {
        "message": "Kaynak onaylandı.",
        "id": source.id,
        "url": source.url,
        "title": source.title,
        "category_id": source.category_id,
        "category": source.category.name if source.category else None,
        "status": source.status,
    }


@router.post("/{source_id}/reject")
def reject_source(source_id: int, db: db_dependency, current_user: user_dependency):
    _require_admin(current_user)
    source = db.query(models.CommunityRssSource).filter(models.CommunityRssSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Kaynak bulunamadı.")
    source.status = "rejected"
    db.commit()
    return {"message": "Kaynak reddedildi."}


@router.delete("/{source_id}", status_code=status.HTTP_200_OK)
def delete_source(source_id: int, db: db_dependency, current_user: user_dependency):
    """Admin bir topluluk RSS kaynağını kalıcı olarak siler (onaylı/bekleyen fark etmez)."""
    _require_admin(current_user)
    source = db.query(models.CommunityRssSource).filter(models.CommunityRssSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Kaynak bulunamadı.")
    db.delete(source)
    db.commit()
    return {"message": "Kaynak silindi."}


def _approved_list(db):
    items = (
        db.query(models.CommunityRssSource)
        .filter(models.CommunityRssSource.status == "approved")
        .order_by(models.CommunityRssSource.created_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "url": s.url,
            "title": s.title,
            "category": s.category.name if s.category else None,
            "category_id": s.category_id,
        }
        for s in items
    ]


@router.get("/approved")
def list_approved(db: db_dependency, current_user: user_dependency):
    """Admin paneli için onaylı kaynaklar (admin yetkisi gerekir)."""
    _require_admin(current_user)
    return _approved_list(db)


@router.get("/community")
def list_community(db: db_dependency, current_user: user_dependency):
    """RSS okuyucu 'Topluluk' sekmesi için onaylı kaynaklar (her oturumlu kullanıcı)."""
    return _approved_list(db)
