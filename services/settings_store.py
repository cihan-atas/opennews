"""Kullanıcıya özel ayar/anahtar deposu (BYOK) — kullanıcı öncelikli, .env yedekli.

Amaç: Her kullanıcı kendi API anahtarlarını ve sağlayıcı seçimlerini Ayarlar
ekranından girer. Podcast üretimi ilgili kullanıcının anahtarlarını kullanır;
kullanıcı bir anahtar girmemişse sistemin .env değerine düşülür.

Okuma sırası:  kullanıcının ayarı (user_settings)  →  .env / config.py varsayılanı

Kullanıcı bağlamı:
  Servisler (ai/tts/...) hangi kullanıcının anahtarını kullanacağını bilmeli.
  Worker, bir görevin başında `with user_context(user_id):` bloğu açar; blok
  içindeki tüm get()/settings.X okumaları o kullanıcının değerlerini çözer.
  Bağlam yoksa (ör. global özet görevi) doğrudan .env kullanılır.

    from services.settings_store import settings, user_context
    with user_context(user_id):
        summary = ai_service.generate(...)   # settings.GROQ_API_KEY → o kullanıcının

`settings` proxy'si config.py'deki Settings ile aynı alan adlarına yanıt verir;
mevcut servis kodu `from config import settings` yerine bunu import edip değişmeden
çalışır.
"""
import contextvars

from config import settings as _env

# Aktif kullanıcının ayar sözlüğü (key→value). Yoksa None → yalnızca .env kullanılır.
_current_user: contextvars.ContextVar = contextvars.ContextVar("current_user_settings", default=None)


def _load_user(db, user_id) -> dict:
    import models
    rows = (
        db.query(models.UserSetting)
        .filter(models.UserSetting.user_id == user_id)
        .all()
    )
    return {r.key: r.value for r in rows if r.value not in (None, "")}


class user_context:
    """Bloğu boyunca verilen kullanıcının anahtarlarını aktif eder.

    with user_context(user_id):
        ...   # bu blokta settings.X o kullanıcının değerini döner
    """

    def __init__(self, user_id):
        self.user_id = user_id
        self._token = None

    def __enter__(self):
        data = {}
        if self.user_id is not None:
            try:
                from database import SessionLocal
                db = SessionLocal()
                try:
                    data = _load_user(db, self.user_id)
                finally:
                    db.close()
            except Exception as e:
                print(f"[settings_store] kullanıcı ayarları okunamadı: {e}")
                data = {}
        self._token = _current_user.set(data)
        return self

    def __exit__(self, *exc):
        if self._token is not None:
            _current_user.reset(self._token)
        return False


def _cast(raw, env_default):
    """DB string değerini .env'deki alanın tipine çevirir."""
    if isinstance(env_default, bool):
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(env_default, int) and not isinstance(env_default, bool):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return env_default
    return raw


def get(key: str, default=None):
    """Etkin değer: aktif kullanıcının ayarı → .env → default."""
    env_default = getattr(_env, key, default)
    ctx = _current_user.get()
    raw = ctx.get(key) if ctx else None
    if raw is None or raw == "":
        return env_default
    return _cast(raw, env_default)


class _EffectiveSettings:
    """config.settings ile aynı arayüz; okumaları kullanıcı→.env sırasıyla çözer."""

    def __getattr__(self, name):
        return get(name)


# Servislerin import edeceği proxy.
settings = _EffectiveSettings()


# ── Yazma (kullanıcı kendi ayarları) ──────────────────────────────────────────
def set_many(db, user_id: int, values: dict) -> None:
    """Kullanıcının key→value ayarlarını upsert eder. value == "" ise kaydı siler
    (o kullanıcı için .env'e geri düşülür)."""
    import models
    for key, value in values.items():
        if key not in MANAGED_KEYS:
            continue
        row = (
            db.query(models.UserSetting)
            .filter(models.UserSetting.user_id == user_id, models.UserSetting.key == key)
            .first()
        )
        if value is None or value == "":
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            row = models.UserSetting(user_id=user_id, key=key, value=str(value))
            db.add(row)
        else:
            row.value = str(value)
    db.commit()


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

# Anahtar başına "nasıl alınır?" bilgisi (adım + bağlantı). Tek kaynak; hem web
# hem mobil bu bilgiyi info butonunda gösterir.
HELP = {
    "GROQ_API_KEY": ("Groq: console.groq.com → API Keys → Create API Key. Ücretsiz.",
                     "https://console.groq.com/keys"),
    "GEMINI_API_KEY": ("Google AI Studio: aistudio.google.com → Get API key. Ücretsiz kota var.",
                       "https://aistudio.google.com/apikey"),
    "OPENAI_API_KEY": ("OpenAI: platform.openai.com → API keys → Create new secret key. Ücretli.",
                       "https://platform.openai.com/api-keys"),
    "OPENROUTER_API_KEY": ("OpenRouter: openrouter.ai → Keys → Create Key. Bazı modeller ücretsiz.",
                           "https://openrouter.ai/keys"),
    "NVIDIA_API_KEY": ("NVIDIA: build.nvidia.com → bir model seç → Get API Key.",
                       "https://build.nvidia.com"),
    "AWS_ACCESS_KEY_ID": ("AWS: Console → IAM → Users → Security credentials → Create access key. Polly izni gerekir.",
                          "https://console.aws.amazon.com/iam/"),
    "AWS_SECRET_ACCESS_KEY": ("Access key oluşturunca gösterilen 'Secret access key' değeri (tek sefer görünür).",
                              "https://console.aws.amazon.com/iam/"),
    "S3_ACCESS_KEY_ID": ("S3 sağlayıcının panelinden (Cloudflare R2 / MinIO / AWS) erişim anahtarı oluştur.", ""),
    "S3_SECRET_ACCESS_KEY": ("Erişim anahtarıyla birlikte verilen gizli anahtar.", ""),
    "SMTP_PASSWORD": ("Gmail: Google Hesabı → Güvenlik → 2 Adımlı Doğrulama → Uygulama şifreleri.",
                      "https://myaccount.google.com/apppasswords"),
}

# Şemadan türeyen düz kümeler.
MANAGED_KEYS = {f["key"] for section in SETTINGS_SCHEMA for f in section["fields"]}
SECRET_KEYS = {f["key"] for section in SETTINGS_SCHEMA for f in section["fields"] if f.get("secret")}


def build_user_view(db, user_id: int) -> list:
    """Şemayı, ilgili kullanıcının mevcut durumuyla zenginleştirip döner.

    - Gizli alanlar (secret): değer DÖNMEZ, yalnızca kullanıcı kendi anahtarını
      girmiş mi (is_set) bilgisi döner.
    - Seçiciler/metinler: kullanıcının kendi değeri varsa o, yoksa .env varsayılanı
      döner (seçiciler doğru gelsin diye).
    - own: bu alanı kullanıcı kendisi mi ayarlamış (yoksa .env yedeği mi).
    """
    user_data = _load_user(db, user_id)
    out = []
    for section in SETTINGS_SCHEMA:
        fields = []
        for f in section["fields"]:
            key = f["key"]
            item = {k: f[k] for k in f}  # kopya
            user_val = user_data.get(key)
            has_own = user_val not in (None, "")
            env_default = getattr(_env, key, "")
            if f.get("secret"):
                item["value"] = ""                       # gizli: değeri hiç gönderme
                item["is_set"] = has_own                 # yalnızca kullanıcının kendi anahtarı
            else:
                effective = user_val if has_own else env_default
                item["value"] = "" if effective is None else str(effective)
                item["is_set"] = has_own
            item["own"] = has_own
            if key in HELP:
                item["help"], item["help_url"] = HELP[key]
            fields.append(item)
        out.append({**section, "fields": fields})
    return out
