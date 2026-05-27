from fastapi import APIRouter, Depends, HTTPException, status
from typing_extensions import List
from sqlalchemy import func, desc
from datetime import datetime, timedelta, timezone
import models, schemas
from dependencies import db_dependency, user_dependency

router = APIRouter(
    prefix="/users",  # Tüm yolların başına otomatik /users ekler
    tags=["Users"]    # Swagger dökümanında bunları gruplar
)

# 1. Mevcut Kullanıcının Profilini Getir
@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: user_dependency):
    """
    ### BURAK (Frontend):
    - Giriş yapan kullanıcının bilgilerini ve **seçili ilgi alanlarını** getirir.
    - **Kritik:** Eğer 'interests' listesi boş gelirse, bu yeni bir kullanıcıdır. Uygulama açılışında direkt kategori seçim ekranını göster.
    """
    return current_user

# 2. İlgi Alanlarını Güncelle
@router.post("/interests")
def update_interests(
    data: schemas.UserInterestsUpdate, 
    db: db_dependency, 
    current_user: user_dependency
):
    """
    ### BURAK (Frontend):
    - **ZORUNLULUK:** Kullanıcı en az **2 adet** kategori seçmelidir. 
    - **Validasyon:** Şema seviyesinde `min_items=2` kontrolü vardır. 1 tane gönderirsen otomatik hata döner.
    - **UX Notu:** Kullanıcı 2 seçim yapmadan 'Kaydet' butonunu *disabled* (pasif) yaparsan çok şık olur.
    - **Mantık:** Gönderdiğin liste son halidir; listede olmayanlar silinir, yeniler eklenir.
    """

    # Gelen ID'lere göre kategorileri çekiyoruz
    selected_categories = db.query(models.NewsCategory).filter(
        models.NewsCategory.id.in_(data.category_ids)
    ).all()
    
    # Güvenlik Kontrolü: Gönderilen ID sayısı ile DB'den gelen eşleşmeli
    if len(selected_categories) != len(data.category_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Some category IDs were not found in the database."
        )

    # Many-to-Many senkronizasyonu
    current_user.interests = selected_categories
    db.commit()
    
    return {"message": "Interests updated successfully!"}

# 3. Kullanıcıyı Sil
@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(current_user: user_dependency, db: db_dependency):
    """
    ### BURAK (Frontend):
    - Kullanıcı 'Hesabımı Sil' butonuna bastığında bu endpoint'i çağır. 
    - İşlem başarılı olursa kullanıcıyı Logout yap ve Login ekranına at.
    """
    db.delete(current_user)
    db.commit()
    return None # 204 No Content olduğu için bir şey dönmemize gerek yok

@router.get("/stats")
def get_user_stats(current_user: user_dependency, db: db_dependency):
    """Kullanıcının okuma ve dinleme istatistiklerini döner."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    total_reads = db.query(func.sum(models.UserClick.click_count)).filter(
        models.UserClick.user_id == current_user.id
    ).scalar() or 0

    week_reads = db.query(func.sum(models.UserClick.click_count)).filter(
        models.UserClick.user_id == current_user.id,
        models.UserClick.last_click_at >= week_ago,
    ).scalar() or 0

    fav = (
        db.query(models.NewsCategory.name, func.sum(models.UserClick.click_count).label("total"))
        .join(models.UserClick, models.UserClick.category_id == models.NewsCategory.id)
        .filter(models.UserClick.user_id == current_user.id)
        .group_by(models.NewsCategory.name)
        .order_by(desc("total"))
        .first()
    )

    podcasts_count = db.query(func.count(models.Podcast.id)).filter(
        models.Podcast.user_id == current_user.id
    ).scalar() or 0

    bookmarks_count = db.query(func.count(models.UserBookmark.id)).filter(
        models.UserBookmark.user_id == current_user.id
    ).scalar() or 0

    return {
        "articles_read": int(total_reads),
        "week_reads": int(week_reads),
        "favorite_category": fav[0] if fav else None,
        "podcasts_count": int(podcasts_count),
        "bookmarks_count": int(bookmarks_count),
    }


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(
    data: schemas.PushTokenRegister,
    db: db_dependency,
    current_user: user_dependency,
):
    """Expo push token'ını kaydeder. Uygulama açılışında / izin alındıktan sonra çağrılmalı."""
    existing = db.query(models.PushToken).filter(models.PushToken.token == data.token).first()
    if existing:
        existing.user_id = current_user.id
        existing.platform = data.platform
    else:
        db.add(models.PushToken(user_id=current_user.id, token=data.token, platform=data.platform))
    db.commit()
    return None


@router.delete("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def deregister_push_token(
    data: schemas.PushTokenRegister,
    db: db_dependency,
    current_user: user_dependency,
):
    """Çıkış yapılırken push token'ı sil."""
    token = db.query(models.PushToken).filter(
        models.PushToken.token == data.token,
        models.PushToken.user_id == current_user.id,
    ).first()
    if token:
        db.delete(token)
        db.commit()
    return None


@router.put("/change-password")
def change_password(
    data: schemas.UserPasswordChange, 
    db: db_dependency, 
    current_user: user_dependency
):
    """
    ### BURAK (Frontend):
    - Mevcut şifreyi, yeni şifreyi ve yeni şifre onayını alır.
    - Kullanıcı giriş yapmış olmalıdır (Header'da Token şart).
    """
    
    # 1. Mevcut şifre doğru mu kontrol et (Güvenlik için şart!)
    import utils
    if not utils.verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Mevcut şifreniz hatalı."
        )

    # 2. Yeni şifre eskisiyle aynı mı? (Opsiyonel ama iyi bir UX)
    if data.old_password == data.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Yeni şifre eskisinden farklı olmalıdır."
        )

    # 3. Şifreyi hashle ve kaydet
    current_user.hashed_password = utils.hash_password(data.new_password)
    db.commit()

    return {"message": "Şifreniz başarıyla güncellendi!"}