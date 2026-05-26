from fastapi import APIRouter, HTTPException, status
import schemas, models
from dependencies import db_dependency, user_dependency
from sqlalchemy import UniqueConstraint
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/bookmarks", tags=["Bookmarks"])


@router.get("/", response_model=schemas.BookmarkPagination)
def get_bookmarks(db: db_dependency, current_user: user_dependency, page: int = 1, size: int = 20):
    query = (
        db.query(models.UserBookmark)
        .filter(models.UserBookmark.user_id == current_user.id)
        .order_by(models.UserBookmark.saved_at.desc())
    )
    total_count = query.count()
    items = query.offset((page - 1) * size).limit(size).all()
    return {"items": items, "total_count": total_count, "page": page, "size": size}


@router.post("/{news_id}", status_code=status.HTTP_201_CREATED)
def add_bookmark(news_id: int, db: db_dependency, current_user: user_dependency):
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")

    existing = db.query(models.UserBookmark).filter(
        models.UserBookmark.user_id == current_user.id,
        models.UserBookmark.news_id == news_id,
    ).first()
    if existing:
        return {"message": "Zaten kaydedilmiş."}

    bookmark = models.UserBookmark(user_id=current_user.id, news_id=news_id)
    db.add(bookmark)
    db.commit()
    return {"message": "Kaydedildi."}


@router.delete("/{news_id}", status_code=status.HTTP_200_OK)
def remove_bookmark(news_id: int, db: db_dependency, current_user: user_dependency):
    bookmark = db.query(models.UserBookmark).filter(
        models.UserBookmark.user_id == current_user.id,
        models.UserBookmark.news_id == news_id,
    ).first()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    db.delete(bookmark)
    db.commit()
    return {"message": "Kaldırıldı."}


@router.get("/check/{news_id}")
def check_bookmark(news_id: int, db: db_dependency, current_user: user_dependency):
    exists = db.query(models.UserBookmark).filter(
        models.UserBookmark.user_id == current_user.id,
        models.UserBookmark.news_id == news_id,
    ).first()
    return {"bookmarked": exists is not None}
