"""Nesne depolama — sağlayıcı-bağımsız.

Sağlayıcılar:
  - gcs (varsayılan): Google Cloud Storage (Frankfurt bucket)
  - s3: S3-uyumlu (Cloudflare R2 / MinIO / AWS) — boto3

upload  -> kalıcı URL (DB'de audio_url olarak saklanır)
signed_url -> geçici erişim linki (public base varsa onu döner)
delete  -> nesneyi siler
"""
import os
from config import settings


def upload(local_path: str, destination_blob_name: str) -> str:
    if settings.STORAGE_PROVIDER == "s3":
        return _s3_upload(local_path, destination_blob_name)
    return _gcs_upload(local_path, destination_blob_name)


def signed_url(stored_url: str, expiration_minutes: int = 60) -> str:
    if settings.STORAGE_PROVIDER == "s3":
        return _s3_signed_url(stored_url, expiration_minutes)
    return _gcs_signed_url(stored_url, expiration_minutes)


def delete(stored_url: str) -> None:
    if settings.STORAGE_PROVIDER == "s3":
        return _s3_delete(stored_url)
    return _gcs_delete(stored_url)


# ── GCS ──────────────────────────────────────────────────────────────────────
def _gcs_upload(local_path: str, blob_name: str) -> str:
    from google.cloud import storage
    bucket_name = settings.GCP_BUCKET_NAME
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    bucket.blob(blob_name).upload_from_filename(local_path)
    return f"https://storage.googleapis.com/{bucket_name}/{blob_name}"


def _gcs_signed_url(gcs_url: str, expiration_minutes: int) -> str:
    import google.auth
    import google.auth.transport.requests
    from google.oauth2 import service_account
    from google.cloud import storage
    from datetime import timedelta

    bucket_name = settings.GCP_BUCKET_NAME
    blob_name = gcs_url.split(f"{bucket_name}/")[-1]

    cred_file = settings.GOOGLE_APPLICATION_CREDENTIALS
    if os.path.exists(cred_file):
        credentials = service_account.Credentials.from_service_account_file(
            cred_file, scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    else:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        credentials.refresh(google.auth.transport.requests.Request())

    client = storage.Client(credentials=credentials)
    blob = client.bucket(bucket_name).blob(blob_name)
    return blob.generate_signed_url(
        expiration=timedelta(minutes=expiration_minutes), method="GET", version="v4", credentials=credentials,
    )


def _gcs_delete(audio_url: str) -> None:
    from google.cloud import storage
    bucket_name = settings.GCP_BUCKET_NAME
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    prefix = f"https://storage.googleapis.com/{bucket_name}/"
    blob_name = audio_url.replace(prefix, "")
    blob = bucket.blob(blob_name)
    if blob.exists():
        blob.delete()
        print(f"[Storage:GCS] Silindi: {blob_name}")
    else:
        print(f"[Storage:GCS] Bulunamadı: {blob_name}")


# ── S3-uyumlu (R2 / MinIO / AWS) ─────────────────────────────────────────────
def _s3_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL or None,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
    )


def _s3_key(stored_url: str) -> str:
    base = settings.S3_PUBLIC_BASE_URL
    if base and stored_url.startswith(base):
        return stored_url[len(base):].lstrip("/")
    marker = f"/{settings.S3_BUCKET_NAME}/"
    if marker in stored_url:
        return stored_url.split(marker, 1)[1]
    return stored_url.rsplit("/", 1)[-1]


def _s3_upload(local_path: str, blob_name: str) -> str:
    client = _s3_client()
    client.upload_file(local_path, settings.S3_BUCKET_NAME, blob_name, ExtraArgs={"ContentType": "audio/mpeg"})
    if settings.S3_PUBLIC_BASE_URL:
        return f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{blob_name}"
    # Public base yoksa anahtar referansı sakla; erişim signed_url ile verilir.
    return f"s3://{settings.S3_BUCKET_NAME}/{blob_name}"


def _s3_signed_url(stored_url: str, expiration_minutes: int) -> str:
    # Public bucket/CDN tanımlıysa doğrudan o URL kullanılabilir.
    if settings.S3_PUBLIC_BASE_URL and stored_url.startswith(settings.S3_PUBLIC_BASE_URL):
        return stored_url
    client = _s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET_NAME, "Key": _s3_key(stored_url)},
        ExpiresIn=expiration_minutes * 60,
    )


def _s3_delete(stored_url: str) -> None:
    client = _s3_client()
    client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=_s3_key(stored_url))
    print(f"[Storage:S3] Silindi: {_s3_key(stored_url)}")
