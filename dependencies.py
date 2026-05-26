from typing_extensions import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from config import settings

# Ayarları dosya başında değişkenlere atıyoruz
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM

# 1. Veritabanı Bağımlılığı (DB Dependency)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

db_dependency = Annotated[Session, Depends(get_db)]

# 2. OAuth2 Yapılandırması: Token'ın nereden alınacağını belirtir.
# "tokenUrl" login olduğumuz endpoint'in ismidir.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login") 

# 3. Bu fonksiyon her istekte token'ı kontrol eder.
async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: db_dependency):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Token'ı decode et ve içindeki payload'ı al
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        
        if user_id is None:  # Token'da "sub" (subject) alanı yoksa geçersiz sayarız
            raise credentials_exception
            
    except JWTError:  # Token geçersizse veya decode edilemezse bu hataya düşeriz
        raise credentials_exception
    
    # Token içindeki ID ile veritabanından kullanıcıyı çek
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    
    if user is None:  # Böyle bir kullanıcı yoksa geçersiz sayarız
        raise credentials_exception
        
    return user # Fonksiyona tertemiz user objesini döndürür

# Tip belirtimi için kolaylık
user_dependency = Annotated[models.User, Depends(get_current_user)]