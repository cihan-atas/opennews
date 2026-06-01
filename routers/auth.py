from fastapi import APIRouter, Depends, HTTPException, status, Response, Cookie, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import or_
from sqlalchemy.orm import Session
import secrets
import models, schemas, utils
from dependencies import db_dependency
from services import email as email_service
from config import settings
from datetime import datetime, timedelta, timezone
from typing_extensions import Annotated, Optional
from uuid import uuid4

router = APIRouter(
    prefix="/auth",    # Tüm yolların başına otomatik /auth ekler
    tags=["Authentication"] # Swagger dökümanında bunları gruplar
)

@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register_user(user: schemas.UserCreate, db: db_dependency):
    """
    Yeni bir kullanıcı kaydeder.
    1. E-posta kontrolü yapar.
    2. Şifreyi hashler.
    3. Veritabanına kaydeder.
    """
    
    # 1. Email kontrolü
    db_email = db.query(models.User).filter(models.User.email == user.email).first()
    if db_email:
        raise HTTPException(status_code=400, detail="This email is already in use!")

    # 2. Username kontrolü
    db_username = db.query(models.User).filter(models.User.username == user.username).first()
    if db_username:
        raise HTTPException(status_code=400, detail="This username is already taken, try another one!")
    
    # 3. Şifreyi utils içindeki motorumuzla hashliyoruz
    hashed_pass = utils.hash_password(user.password)
    
    # 4. SQLAlchemy modeline verileri dolduruyoruz
    new_user = models.User(
        username=user.username,
        email=user.email,
        hashed_password=hashed_pass
    )
    
    # 5. Veritabanına ekle ve onayla
    db.add(new_user)
    db.commit()
    db.refresh(new_user) # Yeni oluşan ID'yi almak için refresh şart
    
    return new_user

@router.post("/login", response_model=schemas.Token)
def login(request: Request, db: db_dependency, response: Response, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    """
    ### BURAK (Frontend):
    - **Esneklik:** Kullanıcı bu alana ister **Email** adresini, ister **Username** (kullanıcı adı) bilgisini girebilir. 
    - Arayüzde (UI) giriş kutusunun etiketini *"E-posta veya Kullanıcı Adı"* olarak belirlemek kullanıcı deneyimi (UX) açısından iyi olur.
    - Başarılı girişte sana `access_token` döner. Bunu 'Bearer' token olarak sakla.
    - **Refresh Token:** HttpOnly Cookie olarak otomatik set edilir, senin manuel saklamana gerek yoktur.
    """

    # 1. Kullanıcıyı hem email hem de username alanında arıyoruz
    user = db.query(models.User).filter(
        or_(
            models.User.email == form_data.username, 
            models.User.username == form_data.username
        )
    ).first()
    
    # 2. Kullanıcı var mı veya şifre doğru mu diye kontrol et, Giriş işlemlerinde güvenlik gereği genelde "Email yanlış" veya "Şifre yanlış" diye ayrı ayrı detay verilmez. "Bilgiler hatalı" denir ki art niyetli biri hangisinin doğru olduğunu anlamasın. 403, "Yetkin yok, giremezsin" demektir.
    if not user or not utils.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid credentials"
        )
    
    # 3. Payload hazırlıyoruz (sadece user id yeterli)
    token_data = {"sub": str(user.id)}

    # 4. Token'ları üret
    access_token = utils.create_access_token(data=token_data)
    # Ortak metodumuzu çağırıyoruz (Refresh işlerini o halletsin).
    # Web için cookie set edilir; mobil için aynı refresh token body'de döndürülür.
    new_refresh_token = handle_refresh_token_logic(db, response, user.id)

    # Mobil istemci (X-Client: mobile) cookie kullanamadığı için refresh token'ı body'de alır.
    is_mobile = request.headers.get("X-Client") == "mobile"

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": new_refresh_token if is_mobile else None,
    }

@router.post("/refresh", response_model=schemas.Token)
def refresh_access_token(request: Request, response: Response, db: db_dependency, refresh_token: Annotated[Optional[str], Cookie()] = None):
    # Web refresh token'ı cookie'den gönderir; mobil ise X-Refresh-Token header'ı ile gönderir.
    header_token = request.headers.get("X-Refresh-Token")
    token_value = refresh_token or header_token
    is_mobile = header_token is not None or request.headers.get("X-Client") == "mobile"

    if not token_value:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    db_token = db.query(models.RefreshToken).filter(models.RefreshToken.token == token_value).first()

    if not db_token:
        raise HTTPException(status_code=401, detail="Refresh token invalid")

    now = datetime.now(timezone.utc)
    
    # DB'den gelen expires_at eğer naive ise (etiketi yoksa) UTC etiketini yapıştırıyoruz
    db_expires_at = db_token.expires_at
    if db_expires_at.tzinfo is None:
        db_expires_at = db_expires_at.replace(tzinfo=timezone.utc)
    
    if db_expires_at < now:
        if db_token:
            db.delete(db_token)
            db.commit()
        raise HTTPException(status_code=401, detail="Refresh token expired")

    # Yeni Access Token üret
    new_access_token = utils.create_access_token(data={"sub": str(db_token.user_id)})

    # Ortak metodla Rotation yapıyoruz (Eskisini gönderiyoruz ki silsin)
    new_refresh_token = handle_refresh_token_logic(db, response, db_token.user_id, old_token_obj=db_token)

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "refresh_token": new_refresh_token if is_mobile else None,
    }

def handle_refresh_token_logic(db: Session, response: Response, user_id: int, old_token_obj=None):
    """
    Refresh token üretir, DB'ye kaydeder ve Cookie olarak set eder.
    Eğer eski bir token objesi gelirse onu siler (Rotation).
    """
    # 1. Eğer eski bilet varsa veritabanından siliyoruz (Rotation)
    if old_token_obj:
        db.delete(old_token_obj)
    
    # 2. Yeni Refresh Token üret
    new_refresh_token = utils.create_refresh_token(data={"sub": str(user_id), "jti": str(uuid4())})
    
    # 3. Refresh Token'ı DB'ye kaydet. Böylece ileride blacklist yapabiliriz,
    # yani kullanıcı çıkış yaparken veya token çalındığında bu token'ı geçersiz kılabiliriz.
    # access token'lar genelde blacklist yapılmaz çünkü ömürleri kısa, refresh token'lar uzun ömürlü olduğu için blacklist yapılır.
    new_db_token = models.RefreshToken(
        token=new_refresh_token,
        user_id=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7)
    )
    db.add(new_db_token)
    db.commit()
    
    # 4. Tarayıcıya Cookie olarak gönder
    response.set_cookie(
        key="refresh_token", 
        value=new_refresh_token, 
        httponly=True, 
        secure=True, # Lokalde test ediyorsan False yapabilirsin ama prod'da mutlaka True olmalı, böylece sadece HTTPS üzerinden gönderilir ve JS erişemez.
        samesite="lax", 
        max_age=7 * 24 * 60 * 60
    )
    
    return new_refresh_token

@router.post("/logout")
def logout(request: Request, response: Response, db: db_dependency, refresh_token: Annotated[Optional[str], Cookie()] = None):
    """
    ### BURAK:
    - Kullanıcı çıkış yaptığında bunu çağır. Cookie'leri temizler.
    - Mobil istemci refresh token'ı X-Refresh-Token header'ı ile gönderir.
    """
    token_value = refresh_token or request.headers.get("X-Refresh-Token")
    if token_value:
        db_token = db.query(models.RefreshToken).filter(models.RefreshToken.token == token_value).first()
        if db_token:
            db.delete(db_token)
            db.commit()
    
    # respose.delete_cookie("refresh_token") da kullanabilirsin ama burada tüm parametreleri vererek daha güvenli bir şekilde siliyoruz, çünkü set ederken de aynı parametrelerle set etmiştik.
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=True,  # set_cookie ile aynı olmalı; aksi halde tarayıcı (HTTPS'te) silme isteğini reddeder ve cookie kalır.
        samesite="lax" # set_cookie'deki değerin aynısı
    )

    return {"message": "Successfully logged out"}


@router.post("/forgot-password")
def forgot_password(body: schemas.ForgotPasswordRequest, db: db_dependency):
    """
    ### BURAK:
    - Kullanıcı "Şifremi unuttum" deyince bunu çağır.
    - **Güvenlik:** E-posta kayıtlı olsun olmasın HER ZAMAN 200 döner (hesap varlığı sızdırılmaz).
    - SMTP yapılandırılmışsa sıfırlama linki e-postayla gider; değilse server log'una yazılır (dev).
    """
    user = db.query(models.User).filter(models.User.email == body.email).first()

    if user:
        # Bu kullanıcıya ait eski/kullanılmamış token'ları temizle (tek aktif token).
        db.query(models.PasswordResetToken).filter(
            models.PasswordResetToken.user_id == user.id,
            models.PasswordResetToken.used == False,  # noqa: E712
        ).delete(synchronize_session=False)

        raw_token = secrets.token_urlsafe(32)
        reset_token = models.PasswordResetToken(
            user_id=user.id,
            token=raw_token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.add(reset_token)
        db.commit()

        reset_link = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={raw_token}"
        email_service.send_password_reset(user.email, reset_link)

    # Enumeration önleme: her durumda aynı yanıt.
    return {"message": "Eğer bu e-posta kayıtlıysa, sıfırlama bağlantısı gönderildi."}


@router.post("/reset-password")
def reset_password(body: schemas.ResetPasswordRequest, db: db_dependency):
    """
    ### BURAK:
    - E-postadaki linkten gelen token + yeni şifre ile çağrılır.
    - Başarılı sıfırlamada kullanıcının TÜM refresh token'ları silinir (tüm oturumlar kapanır).
    """
    db_token = db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.token == body.token
    ).first()

    if not db_token or db_token.used:
        raise HTTPException(status_code=400, detail="Geçersiz veya kullanılmış bağlantı.")

    expires_at = db_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Bağlantının süresi dolmuş, yeniden talep edin.")

    user = db.query(models.User).filter(models.User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Kullanıcı bulunamadı.")

    user.hashed_password = utils.hash_password(body.new_password)
    db_token.used = True

    # Güvenlik: tüm aktif oturumları kapat (refresh token'ları sil).
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == user.id
    ).delete(synchronize_session=False)

    db.commit()
    return {"message": "Şifreniz güncellendi. Artık yeni şifrenizle giriş yapabilirsiniz."}