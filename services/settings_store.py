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


_MODEL_CUSTOM_MAP = {
    "GROQ_QUALITY_MODEL": "GROQ_CUSTOM_MODEL",
    "GEMINI_MODEL": "GEMINI_CUSTOM_MODEL",
    "OPENROUTER_MODEL": "OPENROUTER_CUSTOM_MODEL",
    "NVIDIA_MODEL": "NVIDIA_CUSTOM_MODEL",
    "OPENAI_CHAT_MODEL": "OPENAI_CUSTOM_MODEL",
}


def get(key: str, default=None):
    """Etkin değer: aktif kullanıcının ayarı → .env → default."""
    env_default = getattr(_env, key, default)
    ctx = _current_user.get()
    raw = ctx.get(key) if ctx else None

    # Eğer özel model ("custom") seçilmişse, ilgili custom alanın değerini döndür
    if key in _MODEL_CUSTOM_MAP and raw == "custom":
        custom_key = _MODEL_CUSTOM_MAP[key]
        custom_val = ctx.get(custom_key) if ctx else None
        if custom_val and str(custom_val).strip():
            return str(custom_val).strip()
        return env_default

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
        value = _clamp_stepper(key, value)
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


def _clamp_stepper(key: str, value):
    """Stepper alanlarını şemadaki min/max/step'e oturtur.

    İstemci zaten sınırlıyor ama ayarlar düz key→value gövdesiyle geliyor;
    bozuk bir değer (0, 7 dk) doğrudan kazıma sıklığına dönüşürdü.
    """
    spec = STEPPER_FIELDS.get(key)
    if spec is None or value is None or value == "":
        return value
    try:
        n = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return ""                      # anlamsız değer → .env varsayılanına düş
    step = spec.get("step", 1)
    n = round(n / step) * step
    return max(spec["min"], min(spec["max"], n))


# ── Şema (Ayarlar ekranını hem web hem mobil için tanımlar) ───────────────────
# Alan tipleri: "select" | "text" | "password" | "stepper"
# stepper: sayısal, min/max/step ile sınırlı (−/+ butonlu). Sınırlar hem burada
# hem istemcide geçerli; set_many yazmadan önce kırpar.
# secret=True olan alanların değeri istemciye maskeli döner (is_set: bool).
#
# Kazıma aralığının sınırları — bildirim kuralı aralıklarıyla (rss_reader,
# notifications, mobile/components/IntervalStepper) bilerek aynı.
SCRAPER_INTERVAL_MIN = 15
SCRAPER_INTERVAL_MAX = 1440
SCRAPER_INTERVAL_STEP = 15

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
                 {"value": "groq", "label": "Groq (ücretsiz, ultra hızlı) — önerilen"},
                 {"value": "gemini", "label": "Google Gemini (ücretsiz kota)"},
                 {"value": "openrouter", "label": "OpenRouter (birçok ücretsiz model)"},
                 {"value": "nvidia", "label": "NVIDIA NIM (1000 ücretsiz kredi)"},
                 {"value": "openai", "label": "OpenAI"},
                 {"value": "mock", "label": "Mock (anahtarsız, test)"},
             ]},
            # --- Groq ---
            {"key": "GROQ_API_KEY", "label": "Groq API Key", "type": "password", "secret": True,
             "required": True, "help": "console.groq.com → API Keys", "show_when": {"field": "AI_PROVIDER", "in": ["groq"]}},
            {"key": "GROQ_QUALITY_MODEL", "label": "Groq Modeli", "type": "select",
             "options": [
                 {"value": "openai/gpt-oss-120b", "label": "GPT-OSS 120B (En Yüksek Kalite)", "desc": "120B açık ağırlıklı model, derin muhakeme ve podcast anlatımı"},
                 {"value": "openai/gpt-oss-20b", "label": "GPT-OSS 20B (Ultra Hızlı)", "desc": "~1000 token/s hız, seri haber özetleme"},
                 {"value": "qwen/qwen3.8-27b", "label": "Qwen 3.8 27B (Güçlü Türkçe)", "desc": "27B parametreli model, mükemmel Türkçe dil ve mantık yeteneği"},
                 {"value": "allam-2-7b", "label": "Allam 2 7B", "desc": "Hafif ve hızlı alternatif model"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "desc": "Groq kütüphanesinden farklı bir model adı yazın"},
             ],
             "show_when": {"field": "AI_PROVIDER", "in": ["groq"]}},
            {"key": "GROQ_CUSTOM_MODEL", "label": "Özel Groq Model Adı", "type": "text",
             "placeholder": "örn: meta-llama/llama-4-scout",
             "show_when": {"field": "GROQ_QUALITY_MODEL", "in": ["custom"]}},

            # --- Gemini ---
            {"key": "GEMINI_API_KEY", "label": "Gemini API Key", "type": "password", "secret": True,
             "required": True, "help": "aistudio.google.com → API Key", "show_when": {"field": "AI_PROVIDER", "in": ["gemini"]}},
            {"key": "GEMINI_MODEL", "label": "Gemini Modeli", "type": "select",
             "options": [
                 {"value": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (Önerilen)", "desc": "En dengeli, yüksek hızlı ve zengin Türkçe destekli model"},
                 {"value": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite (Hafif & Hızlı)", "desc": "En yüksek ücretsiz istek kotası ve anlık hız"},
                 {"value": "gemini-2.5-pro", "label": "Gemini 2.5 Pro (Yüksek Muhakeme)", "desc": "Karmaşık görevler ve derin senaryolar için en güçlü model"},
                 {"value": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite (Yeni)", "desc": "Yeni nesil hafif ve hızlı Flash mimarisi"},
                 {"value": "gemini-3.5-flash", "label": "Gemini 3.5 Flash (Yeni)", "desc": "Yeni nesil yüksek performanslı Flash"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "desc": "Google AI Studio'dan farklı bir model adı yazın"},
             ],
             "show_when": {"field": "AI_PROVIDER", "in": ["gemini"]}},
            {"key": "GEMINI_CUSTOM_MODEL", "label": "Özel Gemini Model Adı", "type": "text",
             "placeholder": "örn: gemini-3.8-flash",
             "show_when": {"field": "GEMINI_MODEL", "in": ["custom"]}},

            # --- OpenRouter ---
            {"key": "OPENROUTER_API_KEY", "label": "OpenRouter API Key", "type": "password", "secret": True,
             "required": True, "help": "openrouter.ai → Keys", "show_when": {"field": "AI_PROVIDER", "in": ["openrouter"]}},
            {"key": "OPENROUTER_MODEL", "label": "OpenRouter Modeli", "type": "select",
             "options": [
                 {"value": "openrouter/free", "label": "Auto-Free (Otomatik En İyi Ücretsiz)", "desc": "Aktif olan en iyi ücretsiz modele otomatik yönlendirir (önerilen)"},
                 {"value": "google/gemma-4-31b-it:free", "label": "Google Gemma 4 31B (Ücretsiz)", "desc": "Google'ın gelişmiş açık kaynaklı Gemma 4 modeli"},
                 {"value": "google/gemma-4-26b-a4b-it:free", "label": "Google Gemma 4 26B MoE (Ücretsiz)", "desc": "Google Gemma 4 Mixture-of-Experts mimarisi"},
                 {"value": "nvidia/nemotron-3-super-120b-a12b:free", "label": "NVIDIA Nemotron 3 120B (Ücretsiz)", "desc": "120B parametreli devasa açık model"},
                 {"value": "nvidia/nemotron-3.5-lightning:free", "label": "NVIDIA Nemotron 3.5 (Ücretsiz)", "desc": "NVIDIA hızlı optimize akıl yürütme modeli"},
                 {"value": "liquid/lfm-2.5-2.6b:free", "label": "Liquid LFM 2.5 (Ücretsiz)", "desc": "Ultra hafif ve hızlı açık model"},
                 {"value": "dots-studio/dots-3-note-preview:free", "label": "Dots 3 Note (Ücretsiz)", "desc": "Not ve özetleme odaklı açık model"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "desc": "OpenRouter kütüphanesinden dilediğiniz modeli yazın (:free ekleyebilirsiniz)"},
             ],
             "show_when": {"field": "AI_PROVIDER", "in": ["openrouter"]}},
            {"key": "OPENROUTER_CUSTOM_MODEL", "label": "Özel OpenRouter Model Adı", "type": "text",
             "placeholder": "örn: meta-llama/llama-3.2-3b-instruct:free",
             "show_when": {"field": "OPENROUTER_MODEL", "in": ["custom"]}},

            # --- NVIDIA NIM ---
            {"key": "NVIDIA_API_KEY", "label": "NVIDIA API Key", "type": "password", "secret": True,
             "required": True, "help": "build.nvidia.com → Get API Key (1000 kredi ücretsiz)", "show_when": {"field": "AI_PROVIDER", "in": ["nvidia"]}},
            {"key": "NVIDIA_MODEL", "label": "NVIDIA Modeli", "type": "select",
             "options": [
                 {"value": "meta/llama-3.3-70b-instruct", "label": "Llama 3.3 70B Instruct (Önerilen)", "desc": "NVIDIA NIM hızlandırmalı Llama 3.3 70B, üstün zeka"},
                 {"value": "deepseek-ai/deepseek-r1", "label": "DeepSeek R1 (Akıl Yürütme)", "desc": "NVIDIA NIM üzerinde DeepSeek R1 reasoning modeli"},
                 {"value": "meta/llama-3.1-70b-instruct", "label": "Llama 3.1 70B Instruct", "desc": "Yüksek doğruluk ve bağlam kavrama"},
                 {"value": "meta/llama-3.1-8b-instruct", "label": "Llama 3.1 8B Instruct (Ultra Hızlı)", "desc": "Çok düşük gecikmeli hafif model"},
                 {"value": "mistralai/mistral-large-2-instruct", "label": "Mistral Large 2 (123B)", "desc": "Mistral'in 123B parametreli amiral gemisi"},
                 {"value": "mistralai/mixtral-8x22b-instruct", "label": "Mixtral 8x22B (MoE)", "desc": "Yüksek kapasiteli Mixture-of-Experts mimarisi"},
                 {"value": "qwen/qwen2.5-72b-instruct", "label": "Qwen 2.5 72B (Güçlü Çok Dilli)", "desc": "Zengin Türkçe kelime haznesi ve dil desteği"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "desc": "build.nvidia.com üzerindeki model ID'sini yazın"},
             ],
             "show_when": {"field": "AI_PROVIDER", "in": ["nvidia"]}},
            {"key": "NVIDIA_CUSTOM_MODEL", "label": "Özel NVIDIA Model Adı", "type": "text",
             "placeholder": "örn: meta/llama-3.1-405b-instruct",
             "show_when": {"field": "NVIDIA_MODEL", "in": ["custom"]}},

            # --- OpenAI ---
            {"key": "OPENAI_API_KEY", "label": "OpenAI API Key", "type": "password", "secret": True,
             "required": True, "show_when": {"field": "AI_PROVIDER", "in": ["openai"]}},
            {"key": "OPENAI_CHAT_MODEL", "label": "OpenAI Modeli", "type": "select",
             "options": [
                 {"value": "gpt-4o-mini", "label": "GPT-4o Mini (Hızlı & Ekonomik)", "desc": "Düşük maliyetli, yüksek hızlı ve zeki"},
                 {"value": "gpt-4o", "label": "GPT-4o (Amiral Gemisi)", "desc": "Gelişmiş akıl yürütme ve yüksek kalite"},
                 {"value": "o3-mini", "label": "o3-mini (Muhakeme / Reasoning)", "desc": "Karmaşık mantıksal görevler için muhakeme modeli"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "desc": "OpenAI model ID'sini yazın"},
             ],
             "show_when": {"field": "AI_PROVIDER", "in": ["openai"]}},
            {"key": "OPENAI_CUSTOM_MODEL", "label": "Özel OpenAI Model Adı", "type": "text",
             "placeholder": "örn: gpt-4-turbo",
             "show_when": {"field": "OPENAI_CHAT_MODEL", "in": ["custom"]}},
        ],
    },
    {
        "id": "tts",
        "title": "Seslendirme (TTS) & Podcast Dili",
        "icon": "🎙️",
        "required": True,
        "note": "Podcast dili ve ses ayarları. Edge ücretsiz ve anahtar gerektirmez — en kolay başlangıç.",
        "fields": [
            {"key": "PODCAST_LANG", "label": "Podcast Üretim Dili", "type": "select", "required": True,
             "options": [
                 {"value": "tr", "label": "Türkçe (TR)"},
                 {"value": "en", "label": "İngilizce (EN)"},
             ]},
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
    {
        "id": "notifications",
        "title": "Bildirimler",
        "icon": "🔔",
        "required": False,
        "note": "Sessiz saatlerde RSS bildirimi gönderilmez; biriken haberler aralık "
                "bitince tek özet olarak gelir. Gece yarısını aşan aralık desteklenir "
                "(ör. 23:00 → 08:00).",
        "fields": [
            {"key": "QUIET_HOURS_ENABLED", "label": "Sessiz Saatler", "type": "select",
             "options": [
                 {"value": "true", "label": "Açık"},
                 {"value": "false", "label": "Kapalı"},
             ]},
            {"key": "QUIET_HOURS_START", "label": "Başlangıç (SS:DD)", "type": "text",
             "help": "24 saat biçiminde, örn. 23:00",
             "show_when": {"field": "QUIET_HOURS_ENABLED", "in": ["true"]}},
            {"key": "QUIET_HOURS_END", "label": "Bitiş (SS:DD)", "type": "text",
             "help": "24 saat biçiminde, örn. 08:00",
             "show_when": {"field": "QUIET_HOURS_ENABLED", "in": ["true"]}},
        ],
    },
    {
        "id": "scraper",
        "title": "Haber Kazıma",
        "icon": "🕷️",
        "required": False,
        "note": "Akış haberlerinin ne sıklıkla taranacağı. Kısaltmak haberleri "
                "tazeler ama sunucuyu ve kaynak siteleri daha çok yorar; bir tur "
                "50–150 saniye sürüyor. Bildirim kuralları ancak akış tazelendiğinde "
                "tetiklenir, yani bu değer bildirim gecikmesinin de alt sınırıdır.",
        "fields": [
            {"key": "SCRAPER_INTERVAL_MINUTES", "label": "Tarama Aralığı", "type": "stepper",
             "min": SCRAPER_INTERVAL_MIN, "max": SCRAPER_INTERVAL_MAX,
             # help yok: sınırları istemci zaten stepper'ın altında yazıyor,
             # "nasıl alınır?" balonu bu alan için anlamsız olurdu.
             "step": SCRAPER_INTERVAL_STEP},
        ],
    },
]

# Anahtar başına "nasıl alınır?" bilgisi (adım + bağlantı). Tek kaynak; hem web
# hem mobil bu bilgiyi info butonunda gösterir.
HELP = {
    "GROQ_API_KEY": ("Groq: console.groq.com → API Keys → Create API Key. Tamamen ücretsiz.",
                     "https://console.groq.com/keys"),
    "GEMINI_API_KEY": ("Google AI Studio: aistudio.google.com → Get API key. Ücretsiz kota var.",
                       "https://aistudio.google.com/apikey"),
    "OPENAI_API_KEY": ("OpenAI: platform.openai.com → API keys → Create new secret key.",
                       "https://platform.openai.com/api-keys"),
    "OPENROUTER_API_KEY": ("OpenRouter: openrouter.ai → Keys → Create Key. :free uzantılı modeller ücretsizdir.",
                           "https://openrouter.ai/keys"),
    "NVIDIA_API_KEY": ("NVIDIA: build.nvidia.com → Get API Key. Kayıt olunca 1000 kredi ücretsiz verilir.",
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
STEPPER_FIELDS = {f["key"]: f for section in SETTINGS_SCHEMA for f in section["fields"]
                  if f["type"] == "stepper"}


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

    # Model alanlarında daha önceden elle yazılmış özel bir model adı varsa,
    # select'te 'custom' olarak görünmesini ve custom input alanına yazılmasını sağla
    legacy_custom_values = {}
    for section in SETTINGS_SCHEMA:
        for f in section["fields"]:
            key = f["key"]
            if key in _MODEL_CUSTOM_MAP:
                uval = user_data.get(key)
                if uval:
                    valid_opts = [o["value"] for o in f.get("options", []) if o["value"] != "custom"]
                    if uval not in valid_opts and uval != "custom":
                        legacy_custom_values[_MODEL_CUSTOM_MAP[key]] = uval

    for section in SETTINGS_SCHEMA:
        fields = []
        for f in section["fields"]:
            key = f["key"]
            item = {k: f[k] for k in f}  # kopya
            user_val = user_data.get(key)
            if key in legacy_custom_values and not user_val:
                user_val = legacy_custom_values[key]

            has_own = user_val not in (None, "")
            env_default = getattr(_env, key, "")
            if f.get("secret"):
                item["value"] = ""                       # gizli: değeri hiç gönderme
                item["is_set"] = has_own                 # yalnızca kullanıcının kendi anahtarı
            else:
                effective = user_val if has_own else env_default
                # Eğer bir model seçici alanı ise ve değer seçenekler arasında yoksa 'custom' yap
                if key in _MODEL_CUSTOM_MAP and effective:
                    valid_opts = [o["value"] for o in f.get("options", []) if o["value"] != "custom"]
                    if effective not in valid_opts:
                        effective = "custom"
                item["value"] = "" if effective is None else str(effective)
                item["is_set"] = has_own
            item["own"] = has_own
            if key in HELP:
                item["help"], item["help_url"] = HELP[key]
            fields.append(item)
        out.append({**section, "fields": fields})
    return out
