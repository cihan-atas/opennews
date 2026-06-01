from fastapi import APIRouter, HTTPException, status
import schemas, models
from dependencies import db_dependency, user_dependency

router = APIRouter(prefix="/read-later", tags=["Read Later"])


@router.get("/", response_model=schemas.ReadLaterPagination)
def get_read_later(db: db_dependency, current_user: user_dependency, page: int = 1, size: int = 20):
    query = (
        db.query(models.ReadLaterItem)
        .filter(models.ReadLaterItem.user_id == current_user.id)
        .order_by(models.ReadLaterItem.added_at.desc())
    )
    total_count = query.count()
    items = query.offset((page - 1) * size).limit(size).all()
    return {"items": items, "total_count": total_count, "page": page, "size": size}


@router.post("/{news_id}", status_code=status.HTTP_201_CREATED)
def add_read_later(news_id: int, db: db_dependency, current_user: user_dependency):
    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")

    existing = db.query(models.ReadLaterItem).filter(
        models.ReadLaterItem.user_id == current_user.id,
        models.ReadLaterItem.news_id == news_id,
    ).first()
    if existing:
        return {"message": "Zaten listede."}

    item = models.ReadLaterItem(user_id=current_user.id, news_id=news_id)
    db.add(item)
    db.commit()
    return {"message": "Sonra oku listesine eklendi."}


@router.delete("/{news_id}", status_code=status.HTTP_200_OK)
def remove_read_later(news_id: int, db: db_dependency, current_user: user_dependency):
    item = db.query(models.ReadLaterItem).filter(
        models.ReadLaterItem.user_id == current_user.id,
        models.ReadLaterItem.news_id == news_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    db.delete(item)
    db.commit()
    return {"message": "Listeden kaldırıldı."}


@router.get("/check/{news_id}")
def check_read_later(news_id: int, db: db_dependency, current_user: user_dependency):
    exists = db.query(models.ReadLaterItem).filter(
        models.ReadLaterItem.user_id == current_user.id,
        models.ReadLaterItem.news_id == news_id,
    ).first()
    return {"in_read_later": exists is not None}
