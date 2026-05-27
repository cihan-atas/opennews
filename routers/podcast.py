from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import RedirectResponse
from typing_extensions import List, Annotated
import schemas, models, tempfile, os
from dependencies import db_dependency, user_dependency
from utils import upload_to_gcs, get_signed_audio_url, delete_from_gcs
from worker import process_news_and_tts_task
import services.stt as stt_service

router = APIRouter(
    prefix="/podcast",    # Tüm yolların başına otomatik /podcast ekler
    tags=["Podcast"] # Swagger dökümanında bunları gruplar
)

@router.get("/", response_model=schemas.PodcastPagination) 
def get_my_podcasts(
    current_user: user_dependency, 
    db: db_dependency,
    page: int = 1,
    size: int = 10
):
    """
    ### BURAK:
    - Kullanıcının ürettiği podcastleri sayfalı olarak getirir.
    """
    offset = (page - 1) * size
    query = db.query(models.Podcast).filter(models.Podcast.user_id == current_user.id)
    
    total_count = query.count()
    items = query.order_by(models.Podcast.created_at.desc()).offset(offset).limit(size).all()
    
    return {
        "items": items,
        "total_count": total_count,
        "page": page,
        "size": size
    }

@router.get("/{podcast_id}/audio")
def stream_podcast_audio(podcast_id: int, db: db_dependency, current_user: user_dependency):
    """
    ### BURAK:
    - Podcast sesini çalmak için bu endpoint'i kullan.
    - 1 saatlik geçici bir GCS linki üretir ve oraya yönlendirir (302).
    - Audio player'da src olarak direkt bu URL'yi kullanabilirsin.
    """
    podcast = db.query(models.Podcast).filter(
        models.Podcast.id == podcast_id,
        models.Podcast.user_id == current_user.id,
    ).first()
    if not podcast:
        raise HTTPException(status_code=404, detail="Podcast bulunamadı.")

    signed_url = get_signed_audio_url(podcast.audio_url)
    return RedirectResponse(url=signed_url, status_code=302)


@router.post("/generate/{news_id}", status_code=status.HTTP_202_ACCEPTED)
def generate_podcast(news_id: int, db: db_dependency, current_user: user_dependency):
    """
    Kullanıcı isteğiyle belirli bir haber için podcast oluşturur.
    Zaten varsa mevcut podcast'i döner, yoksa Celery task başlatır.
    """
    existing = db.query(models.Podcast).filter(
        models.Podcast.news_id == news_id,
        models.Podcast.user_id == current_user.id,
    ).first()
    if existing:
        return {"status": "exists", "podcast_id": existing.id}

    news = db.query(models.News).filter(models.News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Haber bulunamadı.")

    process_news_and_tts_task.delay(news_id, current_user.id)
    return {"status": "processing"}


@router.get("/by-news/{news_id}", response_model=schemas.PodcastOut)
def get_podcast_by_news(news_id: int, db: db_dependency, current_user: user_dependency):
    """
    Belirli bir habere ait podcast'i döner. Yoksa 404.
    Frontend bu endpoint'i polling ile kontrol eder.
    """
    podcast = db.query(models.Podcast).filter(
        models.Podcast.news_id == news_id,
        models.Podcast.user_id == current_user.id,
    ).first()
    if not podcast:
        raise HTTPException(status_code=404, detail="Henüz podcast oluşturulmadı.")
    return podcast


@router.post("/", response_model=schemas.PodcastOut, status_code=status.HTTP_201_CREATED)
def create_podcast(podcast: schemas.PodcastCreate, db: db_dependency, current_user: user_dependency):
    """
    ### CIHAN (AI & Pipeline):
    - **Adım 1:** Gemini ile özeti oluştur ve Google TTS ile .mp3 dosyasını üret.
    - **Adım 2:** Ürettiğin dosyayı `utils.upload_to_gcs` fonksiyonu ile Frankfurt'a gönder.
    - **Adım 3:** GCS'den dönen URL'yi bu endpoint'e 'audio_url' olarak post et.

    Örnek Akış (Logic):
    ------------------
    # file_name = f"podcasts/user_{current_user.id}_{datetime.now().timestamp()}.mp3"
    # public_url = upload_to_gcs(file_path="local_temp_audio.mp3", destination_blob_name=file_name)
    # podcast.audio_url = public_url
    """
    
    new_podcast = models.Podcast(
        **podcast.dict(),
        user_id=current_user.id
    )

    db.add(new_podcast)
    db.commit()
    db.refresh(new_podcast)
    return new_podcast

@router.get("/{podcast_id}/transcript")
def get_podcast_transcript(podcast_id: int, db: db_dependency, current_user: user_dependency):
    """Podcast ses dosyasını Groq Whisper ile metne çevirir ve döner.
    İlk çağrıda transkript üretilip DB'ye kaydedilir; sonraki çağrılarda cache'den döner.
    """
    podcast = db.query(models.Podcast).filter(
        models.Podcast.id == podcast_id,
        models.Podcast.user_id == current_user.id,
    ).first()
    if not podcast:
        raise HTTPException(status_code=404, detail="Podcast bulunamadı.")

    if podcast.transcript:
        return {"transcript": podcast.transcript, "cached": True}

    # Ses dosyasını geçici dizine indir
    import urllib.request
    audio_url = get_signed_audio_url(podcast.audio_url)
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        urllib.request.urlretrieve(audio_url, tmp_path)
        transcript = stt_service.transcribe(tmp_path, language="tr")
    finally:
        os.unlink(tmp_path)

    # DB'ye kaydet
    podcast.transcript = transcript
    db.commit()

    return {"transcript": transcript, "cached": False}


@router.post("/transcribe", summary="Ses dosyası yükle → metin")
async def transcribe_audio(
    current_user: user_dependency,
    file: UploadFile = File(..., description="mp3/wav/m4a/ogg — maks 25 MB"),
):
    """Yüklenen ses dosyasını Groq Whisper ile metne çevirir.
    Podcast kütüphanesiyle ilişkili olmayan tek seferlik transkripsiyon için kullanılır.
    """
    allowed = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {ext}")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        transcript = stt_service.transcribe(tmp_path, language="tr")
    finally:
        os.unlink(tmp_path)

    return {"transcript": transcript, "filename": file.filename}


@router.delete("/{podcast_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_podcast(podcast_id: int, db: db_dependency, current_user: user_dependency):
    # 1. Kaydı bul
    podcast = db.query(models.Podcast).filter(
        models.Podcast.id == podcast_id,
        models.Podcast.user_id == current_user.id
    ).first()

    if not podcast:
        raise HTTPException(status_code=404, detail="Podcast bulunamadı.")

    # URL'i değişkene al (DB'den silinince kaybolmasın)
    audio_url_to_delete = podcast.audio_url

    try:
        # 2. Veritabanından sil
        db.delete(podcast)
        db.commit()
        
        # 3. GCS'den dosyayı uçur
        delete_from_gcs(audio_url_to_delete)
        
        return None
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Silme işlemi başarısız.")