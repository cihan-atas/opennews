"""Uygulama geneli ayar/anahtar deposu — DB öncelikli, .env yedekli.

Amaç: API anahtarları ve sağlayıcı seçimleri artık .env'e gömülü olmak zorunda
değil; admin, uygulamanın Ayarlar ekranından girer. Değerler `app_settings`
tablosunda global tutulur (kullanıcıya özel DEĞİL).

Okuma sırası:  DB (app_settings)  →  .env / config.py varsayılanı

Kullanım (servislerde):
    from services.settings_store import settings          # proxy nesne
    settings.GROQ_API_KEY   # DB'de varsa onu, yoksa .env değerini döner

`settings` proxy'si, config.py'deki gerçek Settings ile aynı alan adlarına yanıt
verir; bu sayede mevcut servis kodu `from config import settings` yerine bunu
import ederek değişmeden çalışır.
"""
import time
import threading

from config import settings as _env

# Lazy: DB katmanı import döngüsü yaratmasın diye fonksiyon içinde import edilir.
_CACHE: dict[str, str] = {}
_CACHE_TS: float = 0.0
_TTL_SECONDS = 15          # DB değişiklikleri en geç bu sürede tüm süreçlere yansır
_LOCK = threading.Lock()


def _load(force: bool = False) -> None:
    global _CACHE, _CACHE_TS
    with _LOCK:
        if not force and (time.time() - _CACHE_TS) < _TTL_SECONDS:
            return
        try:
            from database import SessionLocal
            import models
            db = SessionLocal()
            try:
                rows = db.query(models.AppSetting).all()
                _CACHE = {r.key: r.value for r in rows if r.value is not None}
            finally:
                db.close()
        except Exception as e:
            # Tablo henüz yoksa / DB erişilemezse sessizce .env'e düş.
            print(f"[settings_store] DB okunamadı, .env kullanılacak: {e}")
            _CACHE = {}
        _CACHE_TS = time.time()


def invalidate() -> None:
    """Cache'i geçersiz kıl (admin bir değeri değiştirince çağrılır)."""
    global _CACHE_TS
    _CACHE_TS = 0.0


def get(key: str, default=None):
    """Anahtar için etkin değeri döner: DB → .env → default.

    Dönüş tipi, config.py'deki alanın tipine göre ayarlanır (int/bool cast)."""
    _load()
    env_default = getattr(_env, key, default)
    raw = _CACHE.get(key)
    if raw is None or raw == "":
        return env_default
    # DB string; hedef tip .env'deki değerin tipinden çıkarılır.
    if isinstance(env_default, bool):
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(env_default, int) and not isinstance(env_default, bool):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return env_default
    return raw


class _EffectiveSettings:
    """config.settings ile aynı arayüz; okumaları DB→.env sırasıyla çözer."""

    def __getattr__(self, name):
        return get(name)


# Servislerin import edeceği proxy.
settings = _EffectiveSettings()


# ── Yazma (admin) ─────────────────────────────────────────────────────────────
def set_many(db, values: dict) -> None:
    """Verilen key→value'ları upsert eder. value == "" ise kaydı siler (.env'e düşer)."""
    import models
    for key, value in values.items():
        if key not in MANAGED_KEYS:
            continue
        row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
        if value is None or value == "":
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            row = models.AppSetting(key=key, value=str(value))
            db.add(row)
        else:
            row.value = str(value)
    db.commit()
    invalidate()


# ── Şema (Ayarlar ekranını hem web hem mobil için tanımlar) ───────────────────
# Alan tipleri: "select" | "text" | "password"
# secret=True olan alanların değeri istemciye maskeli döner (is_set: bool).
# show_when: {"field": <selector_key>, "in": [<values>]} → yalnız ilgili sağlayıcı seçiliyse göster.

SETTINGS_SCHEMA = [
    {
        "id": "ai",
        "title": "Yapay Zeka (Metin Üretimi)",
        "icon": "🤖",
        "required": True,
        "note": "Podcast senaryosu ve haber özetleri için ZORUNLU. Bir sağlayıcı seç ve yalnızca onun anahtarını gir.",
        "fields": [
            {"key": "AI_PROVIDER", "label": "Sağlayıcı", "type": "select", "required": True,
             "options": [
                 {"value": "groq", "label": "Groq (ücretsiz, hızlı) — önerilen"},
                 {"value": "gemini", "label": "Google Gemini"},
                 {"value": "openai", "label": "OpenAI"},
                 {"value": "openrouter", "label": "OpenRouter"},
                 {"value": "nvidia", "label": "NVIDIA NIM"},
                 {"value": "mock", "label": "Mock (anahtarsız, test)"},
             ]},
            {"key": "GROQ_API_KEY", "label": "Groq API Key", "type": "password", "secret": True,
             "required": True, "help": "console.groq.com → API Keys", "show_when": {"field": "AI_PROVIDER", "in": ["groq"]}},
            {"key": "GROQ_QUALITY_MODEL", "label": "Groq Kalite Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "AI_PROVIDER", "in": ["groq"]}},
            {"key": "GEMINI_API_KEY", "label": "Gemini API Key", "type": "password", "secret": True,
             "required": True, "help": "aistudio.google.com → API Key", "show_when": {"field": "AI_PROVIDER", "in": ["gemini"]}},
            {"key": "GEMINI_MODEL", "label": "Gemini Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "AI_PROVIDER", "in": ["gemini"]}},
            {"key": "OPENAI_API_KEY", "label": "OpenAI API Key", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "AI_PROVIDER", "in": ["openai"]}},
            {"key": "OPENAI_CHAT_MODEL", "label": "OpenAI Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "AI_PROVIDER", "in": ["openai"]}},
            {"key": "OPENROUTER_API_KEY", "label": "OpenRouter API Key", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "AI_PROVIDER", "in": ["openrouter"]}},
            {"key": "OPENROUTER_MODEL", "label": "OpenRouter Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "AI_PROVIDER", "in": ["openrouter"]}},
            {"key": "NVIDIA_API_KEY", "label": "NVIDIA API Key", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "AI_PROVIDER", "in": ["nvidia"]}},
            {"key": "NVIDIA_MODEL", "label": "NVIDIA Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "AI_PROVIDER", "in": ["nvidia"]}},
        ],
    },
    {
        "id": "tts",
        "title": "Seslendirme (TTS)",
        "icon": "🔊",
        "required": True,
        "note": "Podcast sesi için ZORUNLU. Edge ücretsiz ve anahtar gerektirmez — en kolay başlangıç.",
        "fields": [
            {"key": "TTS_PROVIDER", "label": "Sağlayıcı", "type": "select", "required": True,
             "options": [
                 {"value": "edge", "label": "Edge TTS (ücretsiz, anahtarsız) — önerilen"},
                 {"value": "polly", "label": "Amazon Polly (AWS)"},
                 {"value": "google", "label": "Google Cloud TTS"},
             ]},
            {"key": "EDGE_TTS_VOICE", "label": "Edge Ses (opsiyonel)", "type": "text",
             "show_when": {"field": "TTS_PROVIDER", "in": ["edge"]}},
            {"key": "AWS_ACCESS_KEY_ID", "label": "AWS Access Key ID", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "TTS_PROVIDER", "in": ["polly"]}},
            {"key": "AWS_SECRET_ACCESS_KEY", "label": "AWS Secret Access Key", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "TTS_PROVIDER", "in": ["polly"]}},
            {"key": "AWS_REGION", "label": "AWS Bölge", "type": "text",
             "show_when": {"field": "TTS_PROVIDER", "in": ["polly"]}},
            {"key": "POLLY_VOICE_TR", "label": "Polly Türkçe Ses (opsiyonel)", "type": "text",
             "show_when": {"field": "TTS_PROVIDER", "in": ["polly"]}},
            {"key": "POLLY_ENGINE", "label": "Polly Motor", "type": "select",
             "options": [{"value": "neural", "label": "neural"}, {"value": "standard", "label": "standard"}],
             "show_when": {"field": "TTS_PROVIDER", "in": ["polly"]}},
        ],
    },
    {
        "id": "storage",
        "title": "Depolama (Ses Dosyaları)",
        "icon": "📦",
        "required": False,
        "note": "Opsiyonel. 'local' seçilirse anahtar gerekmez (dosyalar sunucuda saklanır).",
        "fields": [
            {"key": "STORAGE_PROVIDER", "label": "Sağlayıcı", "type": "select",
             "options": [
                 {"value": "local", "label": "Yerel (anahtarsız) — varsayılan"},
                 {"value": "gcs", "label": "Google Cloud Storage"},
                 {"value": "s3", "label": "S3 uyumlu (R2 / MinIO / AWS)"},
             ]},
            {"key": "GCP_BUCKET_NAME", "label": "GCS Bucket Adı", "type": "text",
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["gcs"]}},
            {"key": "S3_ENDPOINT_URL", "label": "S3 Endpoint URL", "type": "text",
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
            {"key": "S3_REGION", "label": "S3 Bölge", "type": "text",
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
            {"key": "S3_BUCKET_NAME", "label": "S3 Bucket Adı", "type": "text",
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
            {"key": "S3_ACCESS_KEY_ID", "label": "S3 Access Key ID", "type": "password", "secret": True,
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
            {"key": "S3_SECRET_ACCESS_KEY", "label": "S3 Secret Access Key", "type": "password", "secret": True,
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
            {"key": "S3_PUBLIC_BASE_URL", "label": "S3 Public Base URL (opsiyonel)", "type": "text",
             "show_when": {"field": "STORAGE_PROVIDER", "in": ["s3"]}},
        ],
    },
    {
        "id": "embeddings",
        "title": "Semantik Arama (Embedding)",
        "icon": "🧠",
        "required": False,
        "note": "Opsiyonel. 'none' (kapalı) düşük RAM için varsayılandır; 'local' anahtarsızdır.",
        "fields": [
            {"key": "EMBEDDING_PROVIDER", "label": "Sağlayıcı", "type": "select",
             "options": [
                 {"value": "none", "label": "Kapalı (varsayılan)"},
                 {"value": "local", "label": "Yerel model (anahtarsız)"},
                 {"value": "openai", "label": "OpenAI (yukarıdaki OpenAI anahtarını kullanır)"},
                 {"value": "vertex", "label": "Google Vertex"},
             ]},
            {"key": "LOCAL_EMBED_MODEL", "label": "Yerel Embedding Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "EMBEDDING_PROVIDER", "in": ["local"]}},
            {"key": "OPENAI_EMBED_MODEL", "label": "OpenAI Embedding Modeli (opsiyonel)", "type": "text",
             "show_when": {"field": "EMBEDDING_PROVIDER", "in": ["openai"]}},
        ],
    },
    {
        "id": "email",
        "title": "E-posta (SMTP)",
        "icon": "✉️",
        "required": False,
        "note": "Opsiyonel. Yalnızca şifre sıfırlama e-postası için gerekir. Boşsa link log'a yazılır.",
        "fields": [
            {"key": "SMTP_HOST", "label": "SMTP Sunucu", "type": "text"},
            {"key": "SMTP_PORT", "label": "SMTP Port", "type": "text"},
            {"key": "SMTP_USER", "label": "SMTP Kullanıcı", "type": "text"},
            {"key": "SMTP_PASSWORD", "label": "SMTP Şifre", "type": "password", "secret": True},
            {"key": "SMTP_FROM", "label": "Gönderen Adres (opsiyonel)", "type": "text"},
        ],
    },
]

# Şemadan türeyen düz kümeler.
MANAGED_KEYS = {f["key"] for section in SETTINGS_SCHEMA for f in section["fields"]}
SECRET_KEYS = {f["key"] for section in SETTINGS_SCHEMA for f in section["fields"] if f.get("secret")}


def build_admin_view() -> list:
    """Şemayı, her alanın mevcut durumuyla (is_set / value) zenginleştirip döner.

    - Gizli alanlar (secret): değer DÖNMEZ, yalnızca is_set gösterilir.
    - Diğer alanlar: etkin değer (DB→.env) döner ki seçiciler doğru gelsin.
    """
    _load(force=True)
    out = []
    for section in SETTINGS_SCHEMA:
        fields = []
        for f in section["fields"]:
            key = f["key"]
            item = {k: f[k] for k in f}  # kopya
            effective = get(key, "")
            has_db = bool(_CACHE.get(key))
            if f.get("secret"):
                item.pop("value", None)
                item["value"] = ""                       # gizli: değeri hiç gönderme
                item["is_set"] = bool(effective)
            else:
                item["value"] = "" if effective is None else str(effective)
                item["is_set"] = effective not in (None, "")
            item["from_db"] = has_db
            fields.append(item)
        out.append({**section, "fields": fields})
    return out
