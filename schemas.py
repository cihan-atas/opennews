from pydantic import BaseModel, EmailStr, Field, validator
from typing import List, Optional
from datetime import datetime

# --- Kategori Şemaları ---

class CategoryBase(BaseModel):
    name: str

class CategoryCreate(CategoryBase):
    # Kategori oluştururken isim zorunlu; parent_id verilirse alt kategori olur.
    parent_id: Optional[int] = None

class CategoryOut(CategoryBase):
    id: int
    parent_id: Optional[int] = None

    class Config:
        from_attributes = True

# --- Kullanıcı Şemaları ---

# 1. Base Şema (Ortak Alanlar)
# Her iki yönde de (giriş-çıkış) ortak olan alanları burada topluyoruz.
class UserBase(BaseModel):
    email: EmailStr

# 2. Kayıt Şeması (User Create)
# Kullanıcı kayıt olurken ekstra olarak şifre ve username göndermeli.
class UserCreate(UserBase):
    username: str
    password: str

# 3. Yanıt Şeması (User Out / Response)
# API üzerinden kullanıcıya "Hesabın oluştu, işte bilgilerin" dediğimizde
# şifreyi gizleyip ID gibi otomatik oluşan alanları ekliyoruz.
class UserOut(UserBase):
    id: int
    username: str
    is_admin: bool = False
    interests: List[CategoryOut] = []

    class Config:
        from_attributes = True

# 5. Kullanıcı İlgi Alanları Güncelleme Şeması
class UserInterestsUpdate(BaseModel):
    category_ids: List[int] = Field(..., min_items=2, description="At least 2 category IDs must be selected!") # En az 2 kategori seçilmeli, bu sayede öneri mekanizması daha sağlıklı çalışır.

    # Opsiyonel: Daha detaylı hata mesajı için
    @validator('category_ids')
    def check_min_categories(cls, v):
        if len(v) < 2:
            raise ValueError('You must select at least 2 categories!')
        return v

# --- Haber Şemaları ---

class NewsBase(BaseModel):
    title: str
    category_id: int
    source_url: str = Field(..., description="Haberin orijinal linki zorunludur")
    image_url: Optional[str] = None
    summary: Optional[str] = None
    published_at: Optional[datetime] = None
    lang: Optional[str] = None  # haberin orijinal dili ('tr' | 'en')

class NewsCreate(NewsBase):
    content: str

class NewsListOut(NewsBase):
    """
    BURAK: Ana sayfada/Listede görünecek hafif paket.
    İçinde 'content' yok, sadece özet ve başlık var.
    """
    id: int
    created_at: datetime
    category: Optional[CategoryOut] = None

    class Config:
        from_attributes = True

class NewsDetailOut(NewsBase):
    """
    BURAK: Habere tıklandığında açılacak ağır paket.
    Burada 'content' (tam metin) geri geliyor.
    """
    id: int
    content: str
    created_at: datetime
    category: Optional[CategoryOut] = None

    class Config:
        from_attributes = True

# --- Podcast Şemaları ---

class PodcastBase(BaseModel):
    title: str
    audio_url: str
    duration: int # Saniye cinsinden, frontend'in oynatıcıyı doğru ayarlaması için gerekli

class PodcastCreate(PodcastBase):
    # Podcast oluştururken ekstra bir alan gerekmiyor.
    # user_id'yi(kimin için üretildiği bilgisi) genellikle endpoint'te o an giriş yapmış 
    # olan kullanıcıdan otomatik alacağımız için buraya yazmıyoruz.
    pass

class PodcastOut(PodcastBase):
    id: int
    user_id: int
    news_id: Optional[int] = None
    source_url: Optional[str] = None
    transcript: Optional[str] = None
    is_archived: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

# --- Token Şeması ---
# Login sonrası kullanıcıya döneceğimiz paket.
# Web: refresh token HttpOnly Cookie'de saklanır (refresh_token null döner).
# Mobil (X-Client: mobile): cookie kullanılamadığı için refresh_token body'de döner,
# istemci tarafında expo-secure-store'da saklanır.
class Token(BaseModel):
    access_token: str
    token_type: str
    refresh_token: Optional[str] = None

# --- Pagination Şemaları ---
class PaginationBase(BaseModel):
    total_count: int
    page: int
    size: int

class NewsPagination(PaginationBase):
    items: List[NewsListOut]

class PodcastPagination(PaginationBase):
    items: List[PodcastOut]

# --- Öneri Şeması ---
class SuggestionOut(BaseModel):
    category_id: int
    category_name: str
    message: str # "Örnek: Teknoloji kategorisine çok sık bakıyorsun, ilgini çekebilir!"

class UserPasswordChange(BaseModel):
    old_password: str
    new_password: str

# --- Şifre Sıfırlama Şemaları ---
class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=6, description="Yeni şifre en az 6 karakter olmalı.")

class BookmarkOut(BaseModel):
    id: int
    news_id: int
    saved_at: datetime
    news: Optional["NewsListOut"] = None

    class Config:
        from_attributes = True

class BookmarkPagination(PaginationBase):
    items: List[BookmarkOut]

# --- Sonra Oku Şemaları ---
class ReadLaterOut(BaseModel):
    id: int
    news_id: int
    added_at: datetime
    news: Optional["NewsListOut"] = None

    class Config:
        from_attributes = True

class ReadLaterPagination(PaginationBase):
    items: List[ReadLaterOut]


class PushTokenRegister(BaseModel):
    token: str
    platform: Optional[str] = None  # "ios" | "android" | "web"