"""Admin yönetim endpoint'leri — sistem istatistikleri + kullanıcı yönetimi.

Tüm endpoint'ler admin_dependency ile korunur (is_admin değilse 403)."""
from fastapi import APIRouter, HTTPException, status
from datetime import datetime, timezone, timedelta
from sqlalchemy import func
import models
from dependencies import db_dependency, admin_dependency

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/stats")
def get_stats(db: db_dependency, current_admin: admin_dependency):
    """Sistem geneli sayımlar ve en çok tıklanan kategoriler."""
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)

    user_count = db.query(func.count(models.User.id)).scalar() or 0
    news_count = db.query(func.count(models.News.id)).scalar() or 0
    podcast_count = db.query(func.count(models.Podcast.id)).scalar() or 0
    admin_count = db.query(func.count(models.User.id)).filter(models.User.is_admin.is_(True)).scalar() or 0
    pending_rss = (
        db.query(func.count(models.CommunityRssSource.id))
        .filter(models.CommunityRssSource.status == "pending")
        .scalar() or 0
    )
    news_24h = db.query(func.count(models.News.id)).filter(models.News.created_at >= since_24h).scalar() or 0

    top_rows = (
        db.query(
            models.NewsCategory.name,
            func.coalesce(func.sum(models.UserClick.click_count), 0).label("clicks"),
        )
        .join(models.UserClick, models.UserClick.category_id == models.NewsCategory.id)
        .group_by(models.NewsCategory.name)
        .order_by(func.sum(models.UserClick.click_count).desc())
        .limit(5)
        .all()
    )
    top_categories = [{"name": r.name, "clicks": int(r.clicks)} for r in top_rows]

    return {
        "users": user_count,
        "admins": admin_count,
        "news": news_count,
        "podcasts": podcast_count,
        "pending_rss": pending_rss,
        "news_last_24h": news_24h,
        "top_categories": top_categories,
    }


@router.get("/users")
def list_users(db: db_dependency, current_admin: admin_dependency):
    """Kayıtlı kullanıcıların listesi (id, username, email, is_admin)."""
    users = db.query(models.User).order_by(models.User.id.asc()).all()
    return [
        {"id": u.id, "username": u.username, "email": u.email, "is_admin": u.is_admin}
        for u in users
    ]


@router.post("/users/{user_id}/toggle-admin")
def toggle_admin(user_id: int, db: db_dependency, current_admin: admin_dependency):
    """Bir kullanıcının admin yetkisini açar/kapatır. Kendi yetkisini değiştiremez."""
    if user_id == current_admin.id:
        raise HTTPException(status_code=400, detail="Kendi admin yetkinizi değiştiremezsiniz.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    user.is_admin = not user.is_admin
    db.commit()
    return {"id": user.id, "is_admin": user.is_admin}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: db_dependency, current_admin: admin_dependency):
    """Bir kullanıcıyı siler. Admin kendini silemez."""
    if user_id == current_admin.id:
        raise HTTPException(status_code=400, detail="Kendi hesabınızı bu panelden silemezsiniz.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    db.delete(user)
    db.commit()
