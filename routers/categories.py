from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
import models, schemas
from dependencies import db_dependency, user_dependency

router = APIRouter(
    prefix="/categories",
    tags=["Categories"]
)

# Bu listeyi buradan veya bir constants dosyasından çekebilirsin
CATEGORIES_LIST = [
    "Teknoloji", "Ekonomi", "Spor", "Siyaset", "Sağlık", 
    "Kültür-Sanat", "Bilim", "Otomobil", "Oyun", "Magazin", 
    "Eğitim", "Dünya", "Türkiye", "Gastronomi", "Diğer"
]

@router.get("/", response_model=List[schemas.CategoryOut])
def get_categories(db: db_dependency):
    """
    ### BURAK (Frontend):
    - **Senaryo:** Kullanıcı ilk kayıt olduğunda veya profilinde ilgi alanı seçerken bu listeyi çağır.
    - **Katalog:** Sistemdeki 15 ana kategoriyi ID'leri ile birlikte döner.
    - **Kullanım:** Buradan gelen ID'leri, `POST /users/interests` endpoint'ine bir liste olarak göndereceksin.
    """
    return db.query(models.NewsCategory).all()


@router.post("/", response_model=schemas.CategoryOut, status_code=201)
def create_category(body: schemas.CategoryCreate, db: db_dependency, current_user: user_dependency):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Yalnızca adminler kategori oluşturabilir.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Kategori adı boş olamaz.")
    exists = db.query(models.NewsCategory).filter(models.NewsCategory.name == name).first()
    if exists:
        raise HTTPException(status_code=409, detail="Bu kategori zaten mevcut.")
    cat = models.NewsCategory(name=name)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat