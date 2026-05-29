from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from datetime import datetime, timezone
from pgvector.sqlalchemy import Vector

# ==========================================
# 1. ARA TABLO (KÖPRÜ / JUNCTION TABLE)  - Many-to-Many ilişkilerde kullanılır.
# ==========================================
# Bu tablo veritabanında fiziksel olarak oluşur ama biz kodda buna doğrudan dokunmayız.
# Sadece "Hangi kullanıcı hangi kategoriyi seviyor?" eşleşmesini tutan bir listedir.
user_interests = Table(
    "user_interests",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("category_id", Integer, ForeignKey("categories.id"), primary_key=True)
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)

    # ==========================================
    # İLİŞKİLER (RELATIONSHIPS)
    # ==========================================
    
    # [ONE-TO-MANY]: Bir kullanıcının birden fazla podcasti olabilir.
    # - "Podcast": Bağlanılan sınıfın adı.
    # - back_populates="owner": Podcast sınıfındaki 'owner' değişkeniyle bu değişken el sıkışıyor. 
    #   Yani john.podcasts deyince liste gelir, podcast.owner deyince john gelir.
    podcasts = relationship("Podcast", back_populates="owner")

    # [MANY-TO-MANY]: Kullanıcı ve Kategori arasındaki çoktan-çoğa ilişki.
    # - secondary=user_interests: "SQLAlchemy, bu verilere ulaşmak için aradaki köprü tabloyu kullan!"
    #   Bu sayede john.interests deyince doğrudan NewsCategory objeleri listelenir.
    interests = relationship("NewsCategory", secondary=user_interests)

class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    content = Column(Text, nullable=False)
    summary = Column(Text) # AI tarafından özetlenmiş hali
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    source_url = Column(String, unique=True, index=True, nullable=False) # Haberlerin orijinal linki, bu sayede aynı haber tekrar eklenmez.
    image_url = Column(String)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Gemini text-embedding-004 → 768 boyutlu vektör
    embedding = Column(Vector(768), nullable=True)

    category = relationship("NewsCategory") # Relationship sayesinde isme ulaşacağız

class Podcast(Base):
    __tablename__ = "podcasts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    audio_url = Column(String, nullable=False) # Cloud Storage (GCP) üzerindeki dosya yolu
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    duration = Column(Integer, nullable=False) # Saniye cinsinden
    news_id = Column(Integer, ForeignKey("news.id"), nullable=True)
    source_url = Column(String, nullable=True)
    transcript = Column(String, nullable=True)  # Groq Whisper STT çıktısı, ilk istekte üretilir

    owner = relationship("User", back_populates="podcasts")

class NewsCategory(Base):
    """Sistemdeki mevcut kategorileri tutan basit bir tablo, id olmasa da olurdu çünkü name, unique ve primary key olabilir ama arama yaparken id(sayısal) daha hızlı olur."""
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False) # "Teknoloji", "Siyaset" vb.

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False) # Kullanıcı silindiğinde ona ait refresh token'lar da silinsin(CASCADE)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))  # Token'ın ne zaman oluşturulduğu bilgisi, ileride blacklist yaparken veya token'ların ömrünü yönetirken faydalı olabilir.

class UserClick(Base):
    __tablename__ = "user_clicks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    click_count = Column(Integer, default=1)
    last_click_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_suggested = Column(Boolean, default=False)

    user = relationship("User")
    category = relationship("NewsCategory")

class UserRssList(Base):
    __tablename__ = "user_rss_lists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    feeds = relationship("UserRssFeed", back_populates="rss_list", cascade="all, delete-orphan")


class UserRssFeed(Base):
    __tablename__ = "user_rss_feeds"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("user_rss_lists.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, nullable=False)
    title = Column(String)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    rss_list = relationship("UserRssList", back_populates="feeds")


class CommunityRssSource(Base):
    __tablename__ = "community_rss_sources"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, unique=True, nullable=False)
    title = Column(String, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    submitted_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, default="pending")  # "pending", "approved", "rejected"
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    category = relationship("NewsCategory")
    submitter = relationship("User")


class SummaryFeedback(Base):
    __tablename__ = "summary_feedback"

    id = Column(Integer, primary_key=True, index=True)
    news_id = Column(Integer, ForeignKey("news.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating = Column(String, nullable=False)  # "up" veya "down"
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    news = relationship("News")
    user = relationship("User")


class UserBookmark(Base):
    __tablename__ = "user_bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    news_id = Column(Integer, ForeignKey("news.id", ondelete="CASCADE"), nullable=False)
    saved_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    news = relationship("News")


class PushToken(Base):
    """Expo push token per user/device. Expo Push API is free — no credentials needed."""
    __tablename__ = "push_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    platform = Column(String, nullable=True)  # "ios" | "android" | "web"
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")


class SavedRssArticle(Base):
    __tablename__ = "saved_rss_articles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    link = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    feed_title = Column(String, nullable=True)
    feed_url = Column(String, nullable=True)
    published = Column(String, nullable=True)
    saved_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")