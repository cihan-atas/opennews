from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
import models, schemas
from dependencies import db_dependency

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