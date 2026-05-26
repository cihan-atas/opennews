from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- Veritabanı Ayarları ---
    # .env içindeki isimlerle birebir aynı olmalı
    DATABASE_URL: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = "news_and_podcast"
    PGDATA: str = "/var/lib/postgresql/data/pgdata"

    # --- JWT & Güvenlik Ayarları ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- Google Cloud & Celery Ayarları ---
    GOOGLE_APPLICATION_CREDENTIALS: str = "gcp-service-account.json"  # localde bu dosya ile çalışacağız, Cloud Run'da ise bizim ona verdiğimiz news-and-podcast-sa service account'u kullanacak
    CELERY_BROKER_URL: str
    GCP_PROJECT_ID: str = "project-9b6d702e-bc81-4d20-aff"
    GCP_BUCKET_NAME: str
    GCP_LOCATION: str = "europe-west3"
    FRONTEND_URL: str = "http://localhost:5173"  # Localde varsayılan değer, bulutta ezilecek.

    # --- Sağlayıcı Seçimi (Faz 2: GCP bağımlılığını azaltma) ---
    # Varsayılanlar GCP'dir → mevcut davranış birebir korunur.
    # .env'de bu değerleri değiştirerek kod değişmeden non-GCP sağlayıcıya geçilir.
    AI_PROVIDER: str = "vertex"          # vertex | openai
    EMBEDDING_PROVIDER: str = "vertex"   # vertex | openai
    TTS_PROVIDER: str = "google"         # google | edge
    STORAGE_PROVIDER: str = "gcs"        # gcs | s3

    # OpenAI (AI_PROVIDER/EMBEDDING_PROVIDER=openai için)
    OPENAI_API_KEY: str = ""
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"  # dimensions=768 ile mevcut Vector(768) şemasına uyar

    # S3-uyumlu depolama (STORAGE_PROVIDER=s3 için — Cloudflare R2 / MinIO / AWS)
    S3_ENDPOINT_URL: str = ""            # R2: https://<accountid>.r2.cloudflarestorage.com
    S3_REGION: str = "auto"
    S3_BUCKET_NAME: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_PUBLIC_BASE_URL: str = ""         # Public bucket/CDN tabanı (ör. https://cdn.site.com). Boşsa imzalı URL üretilir.

    # Edge TTS (TTS_PROVIDER=edge için)
    EDGE_TTS_VOICE: str = "tr-TR-EmelNeural"

    # Pydantic'e .env dosyasını nasıl okuyacağını söylüyoruz
    model_config = SettingsConfigDict(
        env_file=".env",            # Dosya adı
        env_file_encoding="utf-8", # Karakter seti
        extra="ignore"              # .env'de fazla değişken varsa hata verme, görmezden gel
    )

# Uygulama içinde tek bir instance (singleton gibi) kullanmak için nesneyi üretiyoruz
settings = Settings()