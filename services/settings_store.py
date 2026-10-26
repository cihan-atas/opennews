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
                 {"value": "openai/gpt-oss-120b", "label": "GPT-OSS 120B (En Yüksek Kalite)", "badge": "⭐ Önerilen", "category": "recommended", "desc": "120B açık ağırlıklı model, podcast ve senaryo üretimi için en yüksek kalite"},
                 {"value": "openai/gpt-oss-20b", "label": "GPT-OSS 20B (Ultra Hızlı)", "badge": "⚡ ~1000 tps", "category": "fast", "desc": "Ultra yüksek çıkarım hızı, seri haber özetleme ve anlık yanıtlar"},
                 {"value": "qwen/qwen3.8-27b", "label": "Qwen 3.8 27B (Güçlü Türkçe)", "badge": "🧠 Zengin Türkçe", "category": "smart", "desc": "27B multimodal model, gelişmiş akıl yürütme ve üstün Türkçe kabiliyeti"},
                 {"value": "allam-2-7b", "label": "Allam 2 7B (Hafif)", "badge": "⚡ Hafif", "category": "fast", "desc": "Hızlı ve düşük gecikmeli alternatif model"},
                 {"value": "openai/gpt-oss-safeguard-20b", "label": "GPT-OSS Safeguard 20B", "badge": "🛡️ Güvenlik", "category": "special", "desc": "Güvenlik ve içerik moderasyonu odaklı model"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "badge": "Özel", "category": "custom", "desc": "Groq kütüphanesinden farklı bir model adı yazın"},
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
                 {"value": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (Dengeli & Hızlı)", "badge": "⭐ Önerilen", "category": "recommended", "desc": "Google'ın en dengeli, çok hızlı ve zengin Türkçe destekli Flash modeli"},
                 {"value": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite (Yüksek Kota)", "badge": "⚡ Hızlı", "category": "fast", "desc": "En yüksek ücretsiz istek kotası ve minimum gecikme süresi"},
                 {"value": "gemini-2.5-pro", "label": "Gemini 2.5 Pro (Yüksek Muhakeme)", "badge": "🧠 Pro Zeka", "category": "smart", "desc": "Karmaşık görevler, derin senaryolar ve ayrıntılı analizler için amiral gemisi"},
                 {"value": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "badge": "🚀 En Yeni Flash", "category": "new", "desc": "Google'ın en son 3.8 nesil Flash mimarisi"},
                 {"value": "gemini-3.7-flash", "label": "Gemini 3.7 Flash", "badge": "🚀 3.7 Flash", "category": "new", "desc": "3.7 nesil yüksek hızlı multimodal model"},
                 {"value": "gemini-3.6-flash", "label": "Gemini 3.6 Flash", "badge": "🚀 3.6 Flash", "category": "new", "desc": "3.6 nesil kararlı Flash modeli"},
                 {"value": "gemini-3.5-flash", "label": "Gemini 3.5 Flash", "badge": "🚀 3.5 Flash", "category": "new", "desc": "3.5 nesil yüksek performanslı Flash"},
                 {"value": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "badge": "⚡ 3.5 Lite", "category": "fast", "desc": "3.5 nesil ultra hafif ve hızlı model"},
                 {"value": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro Preview", "badge": "🧠 3.1 Pro", "category": "smart", "desc": "3.1 nesil derin muhakeme ve analiz modeli"},
                 {"value": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite", "badge": "⚡ 3.1 Lite", "category": "fast", "desc": "3.1 nesil optimize hafif Flash"},
                 {"value": "gemini-3-flash-preview", "label": "Gemini 3 Flash Preview", "badge": "🚀 Gemini 3", "category": "new", "desc": "Gemini 3 mimarisi önizleme sürümü"},
                 {"value": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "badge": "⚡ 2.0 Flash", "category": "fast", "desc": "2.0 nesil genel amaçlı hızlı model"},
                 {"value": "gemini-2.0-flash-lite", "label": "Gemini 2.0 Flash-Lite", "badge": "⚡ 2.0 Lite", "category": "fast", "desc": "2.0 nesil ekonomik ve hızlı model"},
                 {"value": "gemini-1.5-flash", "label": "Gemini 1.5 Flash", "badge": "1M Ctx", "category": "classic", "desc": "1 milyon token bağlam penceresi, stabil sürüm"},
                 {"value": "gemini-1.5-pro", "label": "Gemini 1.5 Pro", "badge": "🧠 2M Ctx", "category": "smart", "desc": "2 milyon token devasa bağlam, derin analiz"},
                 {"value": "gemini-flash-latest", "label": "Gemini Flash (Latest)", "badge": "Otomatik", "category": "recommended", "desc": "Google tarafından sunulan en güncel Flash modeli"},
                 {"value": "gemini-pro-latest", "label": "Gemini Pro (Latest)", "badge": "Otomatik", "category": "smart", "desc": "Google tarafından sunulan en güncel Pro modeli"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "badge": "Özel", "category": "custom", "desc": "Google AI Studio'dan farklı bir model ID'si yazın"},
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
                 {"value": "openrouter/free", "label": "Auto-Free (Otomatik Ücretsiz Router)", "badge": "🆓 ⭐ Önerilen", "category": "free", "desc": "Aktif olan en iyi ücretsiz modele otomatik yönlendirir (kesinti olmaz)"},
                 {"value": "google/gemma-4-31b-it:free", "label": "Google Gemma 4 31B (Free)", "badge": "🆓 31B Instruct", "category": "free", "desc": "Google'ın 31B açık kaynaklı güçlü instruct modeli (256k ctx)"},
                 {"value": "google/gemma-4-26b-a4b-it:free", "label": "Google Gemma 4 26B MoE (Free)", "badge": "🆓 26B MoE", "category": "free", "desc": "Google Gemma 4 Mixture-of-Experts mimarisi (256k ctx)"},
                 {"value": "nvidia/nemotron-3-super-120b-a12b:free", "label": "NVIDIA Nemotron 3 120B (Free)", "badge": "🆓 🧠 120B", "category": "free", "desc": "NVIDIA'nın 120B devasa açık ağırlıklı modeli (262k ctx)"},
                 {"value": "nvidia/nemotron-3.5-lightning:free", "label": "NVIDIA Nemotron 3.5 Lightning (Free)", "badge": "🆓 ⚡ 1M Ctx", "category": "free", "desc": "NVIDIA 3.5 optimize ultra hızlı model (1M token bağlam)"},
                 {"value": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "label": "NVIDIA Nemotron 3 Nano Omni (Free)", "badge": "🆓 🧠 Akıl Yürütme", "category": "free", "desc": "30B çok yönlü akıl yürütme modeli (256k ctx)"},
                 {"value": "nvidia/nemotron-3-ultra-550b-a55b:free", "label": "NVIDIA Nemotron 3 Ultra 550B (Free)", "badge": "🆓 🧠 550B", "category": "free", "desc": "550B parametreli devasa süper model (1M ctx)"},
                 {"value": "nvidia/nemotron-3.5-super-vl:free", "label": "NVIDIA Nemotron 3.5 Super VL (Free)", "badge": "🆓 1M Ctx", "category": "free", "desc": "NVIDIA 3.5 Super Vision-Language modeli (1M ctx)"},
                 {"value": "cohere/north-mini-code:free", "label": "Cohere North Mini Code (Free)", "badge": "🆓 Kod & Mantık", "category": "free", "desc": "Cohere'in 256k bağlamlı akıl yürütme ve kod modeli"},
                 {"value": "liquid/lfm-2.5-2.6b:free", "label": "Liquid LFM 2.5 (Free)", "badge": "🆓 ⚡ Ultra Hızlı", "category": "free", "desc": "LiquidAI'nin düşük gecikmeli hafif modeli (65k ctx)"},
                 {"value": "dots-studio/dots-3-note-preview:free", "label": "Dots 3 Note Preview (Free)", "badge": "🆓 Özetleme", "category": "free", "desc": "Not tutma ve metin özetleme odaklı model (512k ctx)"},
                 {"value": "poolside/laguna-s-2.1:free", "label": "Poolside Laguna S 2.1 (Free)", "badge": "🆓 Ücretsiz", "category": "free", "desc": "Poolside açık ağırlıklı model (262k ctx)"},
                 {"value": "poolside/laguna-xs-2.1:free", "label": "Poolside Laguna XS 2.1 (Free)", "badge": "🆓 ⚡ Hafif", "category": "free", "desc": "Poolside ultra kompakt model (262k ctx)"},
                 {"value": "thinkingmachines/inkling:free", "label": "Thinking Machines Inkling (Free)", "badge": "🆓 1M Ctx", "category": "free", "desc": "1 milyon token bağlamlı açık model"},
                 {"value": "thinkingmachines/inkling-small:free", "label": "Thinking Machines Inkling Small (Free)", "badge": "🆓 ⚡ Hızlı", "category": "free", "desc": "Hafif 1M bağlamlı model"},
                 {"value": "xingchen-agi/xing4.0-29b-a4b:free", "label": "XingChen 4.0 29B (Free)", "badge": "🆓 Ücretsiz", "category": "free", "desc": "29B Mixture-of-Experts açık model"},
                 {"value": "recursive/flint-v1.0:free", "label": "Recursive Flint 1.0 (Free)", "badge": "🆓 Ücretsiz", "category": "free", "desc": "Recursive AI açık instruct modeli"},
                 {"value": "deepseek/deepseek-r1", "label": "DeepSeek R1 (Reasoning)", "badge": "🧠 Akıl Yürütme", "category": "popular", "desc": "Akıl yürütme ve mantıkta lider DeepSeek R1"},
                 {"value": "deepseek/deepseek-chat", "label": "DeepSeek V3 (Chat)", "badge": "🔥 Çok Popüler", "category": "popular", "desc": "Yüksek zeka, düşük maliyet, güçlü Türkçe desteği"},
                 {"value": "meta-llama/llama-3.3-70b-instruct", "label": "Meta Llama 3.3 70B Instruct", "badge": "🔥 70B Amiral", "category": "popular", "desc": "Meta'nın amiral gemisi 70B modeli (128k ctx)"},
                 {"value": "meta-llama/llama-3.1-405b-instruct", "label": "Meta Llama 3.1 405B Instruct", "badge": "🧠 405B Devasa", "category": "popular", "desc": "Açık kaynak dünyasının en büyük 405B modeli"},
                 {"value": "meta-llama/llama-3.1-8b-instruct", "label": "Meta Llama 3.1 8B Instruct", "badge": "⚡ Hızlı", "category": "popular", "desc": "Düşük maliyetli ve hızlı yanıtlar"},
                 {"value": "qwen/qwen-2.5-72b-instruct", "label": "Qwen 2.5 72B Instruct", "badge": "Zengin Türkçe", "category": "popular", "desc": "Çok dilli ve Türkçe anlatımda lider Qwen 72B"},
                 {"value": "mistralai/mistral-large", "label": "Mistral Large", "badge": "Mistral Amiral", "category": "popular", "desc": "Mistral'in en güçlü ticari modeli"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "badge": "Özel", "category": "custom", "desc": "OpenRouter kütüphanesinden dilediğiniz modeli yazın (:free ekleyebilirsiniz)"},
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
                 {"value": "meta/llama-3.3-70b-instruct", "label": "Llama 3.3 70B Instruct", "badge": "⭐ Önerilen", "category": "recommended", "desc": "NVIDIA NIM optimize Llama 3.3 70B, üstün zeka ve akıl yürütme"},
                 {"value": "nvidia/llama-3.1-nemotron-70b-instruct", "label": "NVIDIA Llama 3.1 Nemotron 70B", "badge": "🚀 Nemotron 70B", "category": "recommended", "desc": "NVIDIA'nın özel eğitilmiş ödüllü Nemotron 70B modeli"},
                 {"value": "deepseek-ai/deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash", "badge": "🧠 DeepSeek", "category": "smart", "desc": "NVIDIA NIM üzerinde DeepSeek V4.1 Flash yüksek hızlı muhakeme"},
                 {"value": "nvidia/llama-3.1-nemotron-51b-instruct", "label": "NVIDIA Nemotron 51B Instruct", "badge": "Dengeli", "category": "smart", "desc": "51B parametreli dengeli zeka ve hız"},
                 {"value": "nvidia/llama-3.1-nemotron-ultra-253b-v1", "label": "NVIDIA Nemotron Ultra 253B", "badge": "🧠 253B Devasa", "category": "smart", "desc": "253B parametreli devasa akıl yürütme modeli"},
                 {"value": "nvidia/nemotron-4-340b-instruct", "label": "NVIDIA Nemotron 4 340B", "badge": "🧠 340B Amiral", "category": "smart", "desc": "NVIDIA'nın en büyük 340B açık mimarisi"},
                 {"value": "nvidia/nemotron-3-super-120b-a12b", "label": "NVIDIA Nemotron 3 Super 120B", "badge": "🧠 120B", "category": "smart", "desc": "120B parametreli süper model"},
                 {"value": "nvidia/nemotron-3.5-lightning-30b-a3b", "label": "NVIDIA Nemotron 3.5 Lightning 30B", "badge": "⚡ Hızlı", "category": "fast", "desc": "30B ultra hızlı ve düşük gecikmeli model"},
                 {"value": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "label": "NVIDIA Nemotron 3 Nano Omni", "badge": "Akıl Yürütme", "category": "smart", "desc": "30B akıl yürütme ve mantık modeli"},
                 {"value": "nvidia/nemotron-3-ultra-550b-a55b", "label": "NVIDIA Nemotron 3 Ultra 550B", "badge": "🧠 550B", "category": "smart", "desc": "550B parametreli ultra model"},
                 {"value": "nvidia/nemotron-3.5-super-vl-120b-a12b", "label": "NVIDIA Nemotron 3.5 Super VL", "badge": "Vision & Text", "category": "multimodal", "desc": "120B görsel ve metinsel model"},
                 {"value": "meta/llama-3.2-90b-vision-instruct", "label": "Meta Llama 3.2 90B Vision", "badge": "90B Vision", "category": "smart", "desc": "Meta 90B multimodal instruct modeli"},
                 {"value": "meta/llama-3.2-11b-vision-instruct", "label": "Meta Llama 3.2 11B Vision", "badge": "⚡ Hafif Vision", "category": "fast", "desc": "Hızlı ve hafif görsel/metin modeli"},
                 {"value": "mistralai/mistral-large-2-instruct", "label": "Mistral Large 2 (123B)", "badge": "Mistral Amiral", "category": "smart", "desc": "Mistral 123B amiral gemisi instruct modeli"},
                 {"value": "mistralai/mixtral-8x22b-v0.1", "label": "Mixtral 8x22B MoE", "badge": "MoE 8x22B", "category": "smart", "desc": "Yüksek kapasiteli Mixture-of-Experts modeli"},
                 {"value": "nv-mistralai/mistral-nemo-12b-instruct", "label": "Mistral NeMo 12B", "badge": "⚡ NeMo 12B", "category": "fast", "desc": "NVIDIA & Mistral ortak yapımı 12B kompakt model"},
                 {"value": "mistralai/mistral-7b-instruct-v0.3", "label": "Mistral 7B Instruct v0.3", "badge": "⚡ Hafif", "category": "fast", "desc": "Klasik ve hızlı 7B instruct modeli"},
                 {"value": "google/gemma-4-31b-it", "label": "Google Gemma 4 31B", "badge": "Google 31B", "category": "smart", "desc": "Google Gemma 4 31B instruct modeli"},
                 {"value": "google/gemma-3-12b-it", "label": "Google Gemma 3 12B", "badge": "Google 12B", "category": "fast", "desc": "Google Gemma 3 12B instruct modeli"},
                 {"value": "microsoft/phi-3.5-moe-instruct", "label": "Microsoft Phi 3.5 MoE", "badge": "Microsoft MoE", "category": "smart", "desc": "Microsoft'un optimize MoE mimarisi"},
                 {"value": "openai/gpt-oss-20b", "label": "OpenAI GPT-OSS 20B", "badge": "⚡ Hızlı", "category": "fast", "desc": "NVIDIA altyapısında barındırılan GPT-OSS 20B"},
                 {"value": "moonshotai/kimi-k2.6", "label": "Moonshot Kimi K2.6", "badge": "Kimi", "category": "smart", "desc": "Uzun bağlam ve akıl yürütme modeli"},
                 {"value": "ai21labs/jamba-1.5-large-instruct", "label": "AI21 Jamba 1.5 Large", "badge": "Mamba Hibrit", "category": "smart", "desc": "SSM/Transformer hibrit mimarisi"},
                 {"value": "01-ai/yi-large", "label": "01.AI Yi Large", "badge": "Yi Large", "category": "smart", "desc": "Gelişmiş çift dilli amiral gemisi model"},
                 {"value": "z-ai/glm-5.3", "label": "Zhipu GLM 5.3", "badge": "GLM 5.3", "category": "smart", "desc": "Gelişmiş çok dilli dil modeli"},
                 {"value": "writer/palmyra-creative-122b", "label": "Palmyra Creative 122B", "badge": "Yaratıcı 122B", "category": "smart", "desc": "Yaratıcı yazı ve hikaye anlatımı için 122B"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "badge": "Özel", "category": "custom", "desc": "build.nvidia.com üzerindeki herhangi bir NIM model ID'si"},
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
                 {"value": "gpt-4o-mini", "label": "GPT-4o Mini (Hızlı & Ekonomik)", "badge": "⭐ Önerilen", "category": "recommended", "desc": "Düşük maliyetli, yüksek hızlı ve zeki model"},
                 {"value": "gpt-4o", "label": "GPT-4o (Amiral Gemisi)", "badge": "🧠 Amiral Gemisi", "category": "smart", "desc": "Gelişmiş akıl yürütme, çok modlu ve yüksek kaliteli"},
                 {"value": "o3-mini", "label": "o3-mini (Akıl Yürütme / Reasoning)", "badge": "🧠 Reasoning", "category": "smart", "desc": "Derin düşünme ve karmaşık mantıksal görevler"},
                 {"value": "o1-mini", "label": "o1-mini (Reasoning)", "badge": "🧠 Muhakeme", "category": "smart", "desc": "Mantık ve kod odaklı akıl yürütme"},
                 {"value": "gpt-4-turbo", "label": "GPT-4 Turbo", "badge": "Klasik 128k", "category": "classic", "desc": "128k bağlamlı GPT-4 modeli"},
                 {"value": "custom", "label": "✏️ Özel Model (Elle Girin)", "badge": "Özel", "category": "custom", "desc": "OpenAI model ID'sini yazın"},
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
