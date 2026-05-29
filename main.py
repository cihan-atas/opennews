from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
import os
from routers import auth, news, podcast, users, categories, bookmarks, feed, rss, rss_reader, admin  # Routers klasöründen çekiyoruz
from database import engine, SessionLocal
import models
from seed_data import seed_categories
import logging
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from worker import run_scraper_task

# Loglama: Hataları terminalde görelim ki neyin patladığını bilelim (Uygulama başlamadan hemen önce olması iyidir)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI-Powered News Bulletin and Podcast API",
    description="A 12-factor API that summarizes news and creates podcasts.",
)

# CORSOrigins listesini dinamik yapıyoruz:
# .env dosyasında VITE_API_URL'in hemen altına FRONTEND_URL=http://localhost:5173 yazabilirsin.
# Canlıya çıkarken de deploy.yml içinden bunu canlı linkle besleyeceğiz.
allowed_origins = [
    "http://localhost:5173",  # Vite web
    "http://localhost:8081",  # Expo web
    "http://localhost:19006", # Expo web (eski port)
]

# Eğer config içinde FRONTEND_URL tanımlandıysa listeye ekle
if hasattr(settings, "FRONTEND_URL") and settings.FRONTEND_URL:
    allowed_origins.append(settings.FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MERKEZİ HATA YAKALAYICI (Global Exception Handler) ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Uygulamanın herhangi bir yerinde fırlatılan ama yakalanmayan 
    tüm hataları (Exception) burada yakalıyoruz.
    """
    # Hatayı detaylıca terminale bas (GCP Cloud Logging için kritik)
    logger.error(f"An unexpected error occurred: {request.method} {request.url}")
    logger.error(f"Error Detail: {exc}", exc_info=True)
    
    # Frontend'e gidecek şık cevap
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "status": "error",
            "message": "An unexpected error occurred in the system",
            "detail": str(exc) if app.debug else "Please contact the technical team."
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Pydantic şemalarındaki kısıtlamalara (min_items=2 gibi) takılan
    istekleri burada yakalıyoruz.
    """
    logger.warning(f"Validation Error: {exc.errors()}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "status": "validation_error",
            "message": "There are missing or incorrect details in the data you sent.",
            "errors": exc.errors() # Burak hangi alanın hatalı olduğunu buradan görecek
        }
    )

# Startup Event: Uygulama ayağa kalkarken çalışır
@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    try:
        seed_categories(db) # Kategorileri kontrol et ve eksikse ekle
        
        # 🎯 UTKU (Otonom İlklendirme): Uygulama ilk kez ayağa kalkarken otomatik haber çekimini başlatıyoruz.
        # .delay() kullandığımız için API'nin açılış hızı sıfır kesintiye uğrar, iş asenkron kuyruğa devredilir.
        logger.info("[System Startup] Uygulama ilk açılış tetikleyicisi: Scraper görevi asenkron olarak kuyruğa fırlatılıyor...")
        run_scraper_task.delay()
        
    except Exception as e:
        logger.error(f"[System Startup] İlk açılış tetikleme hatası: {e}")
    finally:
        db.close()

# (pgvector Otomatik İlklendirme): 
# Tablolar oluşturulmadan önce veritabanında pgvector eklentisinin varlığını garanti ediyoruz.
# Local DB sıfırlandığında 'type vector does not exist' hatası almamızı kökten engeller.
from sqlalchemy import text
try:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
        logger.info("[Database] pgvector extension checked/created successfully.")
except Exception as e:
    logger.error(f"[Database] Failed to create pgvector extension: {e}")

# Proje başladığında tabloları kontrol eder/oluşturur
# (Biz Alembic kullanıyoruz, bu güvenlik önlemi olarak kalabilir ama veritabanındaki değişiklikler için Alembic migration'ları yazarken bu kodu kullanmayacağız)
models.Base.metadata.create_all(bind=engine)

# Router'ları uygulamaya dahil et
app.include_router(auth.router)
app.include_router(news.router)
app.include_router(podcast.router)
app.include_router(users.router)
app.include_router(categories.router)
app.include_router(bookmarks.router)
app.include_router(feed.router)
app.include_router(rss.router)
app.include_router(rss_reader.router)
app.include_router(admin.router)

@app.get("/")
def root():
    return {"status": "active", "message": "System is ready!"}

# Yerel geliştirme: audio dosyalarını statik olarak sun
_audio_dir = os.path.join(os.path.dirname(__file__), "audio_files")
os.makedirs(_audio_dir, exist_ok=True)
app.mount("/audio", StaticFiles(directory=_audio_dir), name="audio")