from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta, timezone
import secrets
from config import settings
import services.embeddings as _embeddings
import services.storage as _storage

# Ayarları dosya başında değişkenlere atıyoruz
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.REFRESH_TOKEN_EXPIRE_DAYS

# Passlib'e hangi algoritmayı (bcrypt) kullanacağımızı söylüyoruz ve eski algoritmaların kullanımını devre dışı bırakıyoruz (deprecated="auto").
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str):
    """Ham şifreyi alır ve güvenli bir hash döner."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str):
    """Ham şifre ile hashlenmiş şifreyi karşılaştırır, True/False döner."""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy() # Verilen veriyi kopyalayarak yeni bir sözlük oluşturuyoruz, böylece orijinal veri değişmez.
    # Şu anki zaman + ACCESS_TOKEN_EXPIRE_MINUTES dakika
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    # Payload + Secret Key + Algoritma = Mühürlü JWT
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    # jti: unique ID — prevents DB unique constraint collision on simultaneous logins
    to_encode.update({"exp": expire, "jti": secrets.token_urlsafe(16)})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


# ──────────────────────────────────────────────────────────────────────────────
# AI / Depolama: artık doğrudan GCP'ye değil, sağlayıcı-bağımsız services/ katmanına
# delege ediyoruz (Faz 2). Fonksiyon adları korundu → çağrı siteleri değişmedi.
# ──────────────────────────────────────────────────────────────────────────────

def get_embedding(text: str, task_type: str = "retrieval_document") -> list[float]:
    """768 boyutlu vektör üretir (sağlayıcı .env'den seçilir)."""
    return _embeddings.embed(text, task_type=task_type)


def translate_cached(db, text: str, target_lang: str) -> str:
    """Çeviriyi DB cache'inden döner; yoksa AI ile çevirip kaydeder.

    Aynı metin + hedef dil tekrar geldiğinde AI çağrısı yapılmaz (hız + kota tasarrufu)."""
    import hashlib
    import services.ai as _ai
    import models

    source_hash = hashlib.md5(f"{text}|{target_lang}".encode("utf-8")).hexdigest()
    cached = (
        db.query(models.TranslationCache)
        .filter(models.TranslationCache.source_hash == source_hash)
        .first()
    )
    if cached:
        return cached.translated_text

    translated = _ai.translate(text, target_lang)

    try:
        db.add(models.TranslationCache(
            source_hash=source_hash,
            target_lang=target_lang,
            translated_text=translated,
        ))
        db.commit()
    except Exception:
        # Eşzamanlı aynı çeviri (unique çakışması) veya yazma hatası → cache atla, çeviriyi yine de döndür.
        db.rollback()
    return translated


def get_signed_audio_url(gcs_url: str, expiration_minutes: int = 60) -> str:
    """Depolanan ses URL'inden geçici erişim linki üretir."""
    return _storage.signed_url(gcs_url, expiration_minutes)


def upload_to_gcs(file_path: str, destination_blob_name: str) -> str:
    """Yerel dosyayı nesne depolamaya yükler ve kalıcı URL döner."""
    return _storage.upload(file_path, destination_blob_name)


def delete_from_gcs(audio_url: str) -> None:
    """Depodaki nesneyi siler (hata olsa da akışı bozmaz)."""
    try:
        _storage.delete(audio_url)
    except Exception as e:
        print(f"[Storage ERROR] Dosya silinirken hata oluştu: {e}")
