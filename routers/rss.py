from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import models
from dependencies import db_dependency, user_dependency
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/rss", tags=["Community RSS"])


def _require_admin(current_user):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Bu işlem için admin yetkisi gerekiyor.")


class RssSubmit(BaseModel):
    url: str
    title: Optional[str] = None
    category_id: Optional[int] = None


class RssAdminAdd(BaseModel):
    url: str
    title: Optional[str] = None
    category_id: Optional[int] = None


@router.post("/submit", status_code=status.HTTP_201_CREATED)
def submit_rss_source(body: RssSubmit, db: db_dependency, current_user: user_dependency):
    source = models.CommunityRssSource(
        url=str(body.url),
        title=body.title,
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
    source = models.CommunityRssSource(
        url=str(body.url),
        title=body.title,
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
def approve_source(source_id: int, db: db_dependency, current_user: user_dependency):
    _require_admin(current_user)
    source = db.query(models.CommunityRssSource).filter(models.CommunityRssSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Kaynak bulunamadı.")
    source.status = "approved"
    db.commit()
    return {"message": "Kaynak onaylandı."}


@router.post("/{source_id}/reject")
def reject_source(source_id: int, db: db_dependency, current_user: user_dependency):
    _require_admin(current_user)
    source = db.query(models.CommunityRssSource).filter(models.CommunityRssSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Kaynak bulunamadı.")
    source.status = "rejected"
    db.commit()
    return {"message": "Kaynak reddedildi."}


@router.get("/approved")
def list_approved(db: db_dependency, current_user: user_dependency):
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
