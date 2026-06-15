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
    VITE_API_URL: str = "http://localhost:8090"

    # --- Sağlayıcı Seçimi ---
    # vertex/google = GCP (ücretli)  |  openrouter/local = ücretsiz önerilen stack
    AI_PROVIDER: str = "vertex"          # vertex | gemini | openai | openrouter | nvidia | mock
    EMBEDDING_PROVIDER: str = "vertex"   # vertex | openai | local | mock | none (none=kapalı, düşük RAM)
    TTS_PROVIDER: str = "google"         # google | edge | polly
    STORAGE_PROVIDER: str = "gcs"        # gcs | s3 | local

    # OpenAI (AI_PROVIDER/EMBEDDING_PROVIDER=openai için)
    OPENAI_API_KEY: str = ""
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"

    # Groq — ücretsiz (AI_PROVIDER=groq için) ← önerilen
    # Key: console.groq.com → API Keys → Create API Key
    GROQ_API_KEY: str = ""
    # Bulk model: haber özeti, yüksek hacim (14.4K istek/gün)
    GROQ_MODEL: str = "llama-3.1-8b-instant"
    # Kalite model: podcast script, çeviri, daha az ama önemli işler (1K istek/gün)
    # meta-llama/llama-4-scout-17b-16e-instruct → en yeni Llama 4
    # qwen/qwen3-32b                            → güçlü Türkçe, 60 RPM
    GROQ_QUALITY_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    # Segment model: TR/EN dil ayrımı — 70B güçlü, 14.4K/gün aynı limit
    GROQ_SEGMENT_MODEL: str = "llama-3.3-70b-versatile"
    # STT: konuşmadan metne (podcast transkripti)
    STT_PROVIDER: str = "groq"              # groq (whisper)
    GROQ_STT_MODEL: str = "whisper-large-v3-turbo"  # hız/doğruluk dengesi

    # OpenRouter — ~50 istek/gün ücretsiz (AI_PROVIDER=openrouter için)
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = "meta-llama/llama-3.1-8b-instruct:free"

    # NVIDIA NIM — 1000 toplam ücretsiz kredi, sonra ücretli (AI_PROVIDER=nvidia için)
    # Key: build.nvidia.com → Get API Key
    NVIDIA_API_KEY: str = ""
    NVIDIA_MODEL: str = "meta/llama-3.1-8b-instruct"

    # Gemini API (AI_PROVIDER=gemini için)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Yerel embedding (EMBEDDING_PROVIDER=local için — ücretsiz, Türkçe dahil 50+ dil)
    # paraphrase-multilingual-mpnet-base-v2 → 768-dim, DB migration gerektirmez
    LOCAL_EMBED_MODEL: str = "paraphrase-multilingual-mpnet-base-v2"

    # S3-uyumlu depolama (STORAGE_PROVIDER=s3 için — Cloudflare R2 / MinIO / AWS)
    S3_ENDPOINT_URL: str = ""
    S3_REGION: str = "auto"
    S3_BUCKET_NAME: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_PUBLIC_BASE_URL: str = ""

    # Edge TTS (TTS_PROVIDER=edge için)
    EDGE_TTS_VOICE: str = "tr-TR-EmelNeural"

    # Amazon Polly (TTS_PROVIDER=polly için)
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "eu-central-1"
    POLLY_VOICE_TR: str = "Burcu"
    POLLY_ENGINE: str = "neural"

    # E-posta / SMTP (şifre sıfırlama linki için — opsiyonel)
    # Boş bırakılırsa reset linki gönderilmez, server log'una yazılır (dev modu).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""          # boşsa SMTP_USER kullanılır
    SMTP_USE_TLS: bool = True

    # Pydantic'e .env dosyasını nasıl okuyacağını söylüyoruz
    model_config = SettingsConfigDict(
        env_file=".env",            # Dosya adı
        env_file_encoding="utf-8", # Karakter seti
        extra="ignore"              # .env'de fazla değişken varsa hata verme, görmezden gel
    )

# Uygulama içinde tek bir instance (singleton gibi) kullanmak için nesneyi üretiyoruz
settings = Settings()