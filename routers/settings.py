"""Kullanıcıya özel API anahtarları / sağlayıcı ayarları (BYOK).

Her kullanıcı kendi anahtarlarını girer; girmediği alanlar sistemin .env
değerine düşer. Şema tek kaynak: services/settings_store.SETTINGS_SCHEMA.
"""
from fastapi import APIRouter, HTTPException
from dependencies import db_dependency, user_dependency
from services import settings_store

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get("")
def get_my_settings(current_user: user_dependency, db: db_dependency):
    """Ayarlar ekranı şeması + bu kullanıcının mevcut durumu.

    Gizli alanların değeri asla dönmez; yalnızca kullanıcının kendi anahtarını
    girip girmediği (is_set) bilgisi gelir."""
    return {"groups": settings_store.build_user_view(db, current_user.id)}


@router.put("")
def update_my_settings(payload: dict, current_user: user_dependency, db: db_dependency):
    """Bu kullanıcının key→value ayarlarını kaydeder.

    - value boş string ("") ise kayıt silinir → o kullanıcı için .env'e geri düşülür.
    - Gizli alanlarda boş göndermek 'değiştirme' demektir; istemci dokunulmayan
      gizli alanları payload'a KOYMAMALIDIR.
    - Yalnızca yönetilen (şemadaki) anahtarlar kabul edilir.
    """
    values = payload.get("values", payload)
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="Geçersiz gövde: 'values' bir nesne olmalı.")
    unknown = [k for k in values if k not in settings_store.MANAGED_KEYS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen ayar anahtar(lar)ı: {', '.join(unknown)}")
    settings_store.set_many(db, current_user.id, values)
    return {"status": "ok", "updated": [k for k in values]}
