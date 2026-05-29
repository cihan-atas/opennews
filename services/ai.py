"""AI metin üretimi (özet/çeviri) — sağlayıcı-bağımsız.

Sağlayıcılar:
  - groq        : Groq — ücretsiz, hızlı  ← aktif
  - openrouter  : OpenRouter ücretsiz modeller (~50 istek/gün)
  - nvidia      : NVIDIA NIM — 1000 toplam ücretsiz kredi
  - openai      : OpenAI Chat Completions — ücretli
  - vertex      : Vertex AI Gemini — ücretli
  - mock        : API key gerektirmez, geliştirme için

generate(prompt, quality=False):
  quality=False → GROQ_MODEL        (llama-3.1-8b-instant, 14.4K/gün — bulk özetler)
  quality=True  → GROQ_QUALITY_MODEL (llama-4-scout veya qwen3-32b — podcast script)
"""
import re
from config import settings

_VERTEX_MODEL = "publishers/google/models/gemini-2.5-flash"
# Qwen3 gibi thinking-mode modeller <think>...</think> bloğu döndürür — temizle.
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _strip_think(text: str) -> str:
    return _THINK_RE.sub("", text).strip()


# Fonetik dönüşüm cache'i (modül içi) — aynı metin tekrar gelirse AI çağrısı yapılmaz.
# Süreç-yerel; worker yeniden başlayınca sıfırlanır, ama tek podcast içinde tekrar eden
# segmentlerde ve aynı haberin tekrar seslendirilmesinde ciddi tasarruf sağlar.
_PHONETIZE_CACHE: dict[str, str] = {}
_PHONETIZE_CACHE_MAX = 512


def generate(prompt: str, quality: bool = False, temperature: float = None, system_prompt: str = None) -> str:
    """Verilen prompt için düz metin yanıtı döner.
    quality=True → daha iyi model (podcast script, çeviri gibi önemli işler).
    quality=False → hızlı/yüksek-limitli model (haber özeti gibi toplu işler).
    """
    provider = settings.AI_PROVIDER
    if provider == "gemini":
        return _gemini_generate(prompt, temperature=temperature, system_prompt=system_prompt)
    if provider == "groq":
        kwargs = {}
        if temperature is not None:
            kwargs["temperature"] = temperature
        if system_prompt is not None:
            kwargs["system_prompt"] = system_prompt
        return _groq_generate(prompt, quality=quality, **kwargs)
    if provider == "openai":
        return _openai_generate(prompt)
    if provider == "openrouter":
        return _openrouter_generate(prompt)
    if provider == "nvidia":
        return _nvidia_generate(prompt)
    if provider == "mock":
        return _mock_generate(prompt)
    return _vertex_generate(prompt)


def translate(text: str, target_lang: str) -> str:
    """text'i hedef dile çevirir. target_lang: 'en' | 'tr'."""
    lang_name = "English" if target_lang == "en" else "Turkish"
    prompt = f"Translate the following text to {lang_name}. Return only the translation, nothing else:\n\n{text}"
    return generate(prompt, quality=True)


# Sembol → yazı: TTS öncesi deterministik temizlik
_SYMBOL_MAP = [
    (re.compile(r'\$\s*(\d+)'),   r'\1 dolar'),
    (re.compile(r'€\s*(\d+)'),    r'\1 euro'),
    (re.compile(r'£\s*(\d+)'),    r'\1 sterlin'),
    (re.compile(r'(\d+)\s*%'),    r'yüzde \1'),
    (re.compile(r'\s&\s'),        ' ve '),
    (re.compile(r'https?://\S+'), ''),
    (re.compile(r'www\.\S+'),     ''),
]


def _symbol_cleanup(text: str) -> str:
    for pattern, repl in _SYMBOL_MAP:
        text = pattern.sub(repl, text)
    return re.sub(r'\s{2,}', ' ', text).strip()


def prepare_tts_script(text: str) -> str:
    """Sembol temizliği yapar; segment_for_tts() ile kullanılır."""
    return _symbol_cleanup(text)


def segment_for_tts(text: str) -> list:
    """Metni Türkçe/İngilizce segmentlere böler, TTS normalizasyonu uygular.

    Aynı anda iki iş yapar:
    - Dil ayrımı: marka/İngilizce → lang:'en', Türkçe → lang:'tr'
    - Normalizasyon (TR segmentlerde):
        * Büyük harf kısaltmalar → Türkçe harf adlarıyla yaz (MFA→em ef a)
        * İngilizce köklü Türkçe eylemler → fonetik (hackledi→hekledi)

    Dönen format: [{"text": "...", "lang": "tr"}, {"text": "...", "lang": "en"}, ...]
    Hata durumunda tek 'tr' segmenti döner.
    """
    import json

    cleaned = _symbol_cleanup(text)
    if settings.TTS_PROVIDER == "polly":
        return [{"text": cleaned, "lang": "tr"}]

    prompt = (
        "Aşağıdaki Türkçe podcast metnini TTS için segmentlere böl ve normalize et.\n\n"
        "KURALLAR:\n"
        "1. Marka adları, İngilizce kelimeler, özel isimler → lang:'en', metni olduğu gibi bırak.\n"
        "2. Türkçe metin → lang:'tr'.\n"
        "3. Büyük harfli kısaltmalar Türkçe metindeyse → lang:'tr' ama Türkçe harf adlarıyla yaz:\n"
        "   MFA → em ef a | FBI → ef bi ay | CEO → si i o | API → ey pi ay\n"
        "   CIA → si ay ey | GPU → ci pi yu | CPU → si pi yu | AI → ey ay\n"
        "   (NATO, TBMM gibi Türkçe okunabilenler aynen kalır)\n"
        "4. İngilizce köklü Türkçe eylemler → lang:'tr', fonetik yaz:\n"
        "   hackledi→hekledi | hacklediler→heklediler | tweetledi→tvitledi\n"
        "   likeledi→laykledi | retweetledi→ritvitledi | downladı→daunlodladı\n"
        "5. Türkçeleşmiş kelimeler (internet, sistem, dijital, platform vb.) → lang:'tr'.\n"
        "6. Boşluk ve noktalama orijinal metindeki gibi korunmalı.\n"
        "Sadece JSON döndür:\n\n"
        '[ {"text": "...", "lang": "tr"}, {"text": "...", "lang": "en"} ]\n\n'
        "Örnek girdi:\n"
        "MFA sistemi GitHub hesabını hackledi. OpenAI CEO'su açıklama yaptı.\n\n"
        "Örnek çıktı:\n"
        '[ {"text": "em ef a", "lang": "tr"},'
        ' {"text": " sistemi ", "lang": "tr"},'
        ' {"text": "GitHub", "lang": "en"},'
        ' {"text": " hesabını hekledi. ", "lang": "tr"},'
        ' {"text": "OpenAI", "lang": "en"},'
        ' {"text": " si i o\'su açıklama yaptı.", "lang": "tr"} ]\n\n'
        f"Metin:\n{cleaned}"
    )
    try:
        raw = _groq_generate(prompt, model=settings.GROQ_SEGMENT_MODEL).strip()
        # AI bazen ```json...``` sarmalı kullanır
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        segments = json.loads(raw.strip())
        if not isinstance(segments, list) or not segments:
            return [{"text": cleaned, "lang": "tr"}]
        # Ardışık aynı-dil segmentleri birleştir (az API çağrısı)
        merged: list = []
        for seg in segments:
            if merged and merged[-1]["lang"] == seg.get("lang"):
                merged[-1]["text"] += seg["text"]
            else:
                merged.append({"text": seg["text"], "lang": seg.get("lang", "tr")})
        return merged
    except Exception:
        return [{"text": cleaned, "lang": "tr"}]


def phonetize_english_for_tr_tts(text: str) -> str:
    """Metindeki tüm İngilizce kelimeleri, marka adlarını, kısaltmaları ve cümleleri
    Türkçe seslendirme motorunun en doğal şekilde okuyabilmesi için Türkçe okunuşlarıyla (fonetik yazımlarıyla) değiştirir.
    Hiçbir SSML/XML etiketi (örn. <speak>, <lang>) kullanmaz, düz metin döner.
    """
    if settings.AI_PROVIDER == "mock":
        return text

    cache_key = text.strip()
    if cache_key in _PHONETIZE_CACHE:
        return _PHONETIZE_CACHE[cache_key]

    prompt = f"""Sen gelişmiş bir Türkçe TTS hazırlık asistanısın. Görevin, sana verilen metindeki TÜM İngilizce kelimeleri, marka/şirket isimlerini, kısaltmaları ve İngilizce cümleleri/sözleri tespit edip, bunların yerine Türkçe okunuşlarını (fonetik yazımlarını) yazmaktır. Böylece Türkçe bir seslendirici bu kelimeleri hatasız ve en doğal şekilde okuyabilecektir.

KURALLAR:
1. Türkçe kelimelere, eklere, noktalama işaretlerine kesinlikle dokunma. Onları olduğu gibi koru.
2. Metindeki TÜM İngilizce kelimeleri, marka isimlerini ve kısaltmaları istisnasız Türkçeleştir (Türkçe karakterlerle okunduğu gibi yaz).
3. Kısaltmaların okunuşlarını Türkçe karakterlerle yaz:
   - NPM -> En-Pi-Em
   - AI -> Ey-Ay
   - API -> Ey-Pi-Ay
   - CEO -> Si-İ-O
   - GPT -> Ci-Pi-Ti
   - GPT-4o -> Ci-Pi-Ti Dört O
   - AWS -> Ey-Dabılyu-Es
   - XML -> İks-Em-El
4. Marka, özel isim ve terimleri Türkçe okunuşlarıyla yaz:
   - OpenAI -> Open Ey-Ay
   - Google -> Gugıl
   - Claude -> Kılod
   - Anthropic -> Antropik
   - Microsoft -> Maykrosoft
   - DeepMind -> Dip Maynd
   - YouTube -> Yutub
   - Twitter -> Tvitır
   - Amazon -> Amazon
   - OS Security -> Oks Seküriti
   - registry -> rejistri
   - user directory -> yuzır direktori
   - /mnt/userdata -> maunt yuzırdeyta
   - format -> format
   - formatter -> formatır
5. İngilizce cümleleri veya tırnak içindeki İngilizce sözleri, Türkçe okunuş kurallarına göre heceleyerek yaz:
   - 'We are thrilled to bring this advanced intelligence to everyone' -> 'vi ar tırild tu bring diz edvenst inteli-cıns tu evriyvan'
6. Çıktıda kesinlikle hiçbir XML/HTML/SSML etiketi (örn. <speak>, <lang>) kullanma. Sadece düz metin döndür.
7. Ek açıklama veya yorum yapma. Sadece güncellenmiş düz metni döndür.

Metin:
{text}"""

    # Doğrudan Groq kullanılır. (Eski Gemini denemesi mevcut key ile her zaman 429
    # dönüyordu → gereksiz ~2 sn gecikme + log kirliliği; kaldırıldı — bkz. detay.md.)
    sys_prompt = "Sen gelişmiş bir Türkçe TTS hazırlık asistanısın. Görevin, verilen metindeki İngilizce kelimeleri Türkçe fonetik yazımlarıyla değiştirmek ve sadece düz metin döndürmektir."
    try:
        result = _groq_generate(prompt, quality=True, temperature=0.1, system_prompt=sys_prompt)
    except Exception as e:
        print(f"[AI] Phonetization Groq failed: {e}")
        return text

    if not result:
        return text

    try:
        if "```" in result:
            parts = result.split("```")
            if len(parts) >= 3:
                result = parts[1]
                if result.startswith("text") or result.startswith("plaintext"):
                    result = result.split("\n", 1)[1]
        result = _strip_think(result.strip())
    except Exception as e:
        print(f"[AI] Phonetization parsing failed: {e}")
        return text

    # Cache'e yaz (basit boyut sınırı ile).
    if len(_PHONETIZE_CACHE) >= _PHONETIZE_CACHE_MAX:
        _PHONETIZE_CACHE.clear()
    _PHONETIZE_CACHE[cache_key] = result
    return result


# ── Groq ─────────────────────────────────────────────────────────────────────
# Modeller (config.py'de ayarlanır):
#   GROQ_MODEL         = llama-3.1-8b-instant        → 14.4K istek/gün, hızlı
#   GROQ_QUALITY_MODEL = meta-llama/llama-4-scout...  → 1K istek/gün, kaliteli
#                      = qwen/qwen3-32b               → 1K istek/gün, 60 RPM, güçlü Türkçe

_GROQ_CLIENT = None


def _get_groq_client():
    global _GROQ_CLIENT
    if _GROQ_CLIENT is None:
        from openai import OpenAI
        _GROQ_CLIENT = OpenAI(
            api_key=settings.GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )
    return _GROQ_CLIENT


def _groq_generate(prompt: str, quality: bool = False, model: str = None, temperature: float = 0.7, system_prompt: str = None) -> str:
    client = _get_groq_client()
    if model is None:
        model = settings.GROQ_QUALITY_MODEL if quality else settings.GROQ_MODEL
    sys_content = system_prompt if system_prompt else "You are a helpful assistant. Respond directly without any thinking process."
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": sys_content},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=1024,
    )
    return _strip_think(response.choices[0].message.content)


# ── OpenRouter (~50 istek/gün ücretsiz) ──────────────────────────────────────
def _openrouter_generate(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url="https://openrouter.ai/api/v1",
    )
    response = client.chat.completions.create(
        model=settings.OPENROUTER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        extra_headers={
            "HTTP-Referer": settings.FRONTEND_URL,
            "X-Title": "NewsFlow",
        },
    )
    return _strip_think(response.choices[0].message.content.strip())


# ── NVIDIA NIM (1000 toplam ücretsiz kredi) ───────────────────────────────────
def _nvidia_generate(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(
        api_key=settings.NVIDIA_API_KEY,
        base_url="https://integrate.api.nvidia.com/v1",
    )
    response = client.chat.completions.create(
        model=settings.NVIDIA_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.6,
        max_tokens=1024,
    )
    return response.choices[0].message.content.strip()


# ── OpenAI ───────────────────────────────────────────────────────────────────
def _openai_generate(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


# ── Vertex (Gemini) ──────────────────────────────────────────────────────────
def _vertex_generate(prompt: str) -> str:
    from google import genai
    client = genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_LOCATION,
    )
    response = client.models.generate_content(model=_VERTEX_MODEL, contents=prompt)
    return response.text.strip()


# ── Mock (geliştirme) ─────────────────────────────────────────────────────────
def _mock_generate(prompt: str) -> str:
    lines = [l.strip() for l in prompt.split("\n") if l.strip()]
    content = "\n".join(lines[-20:]) if len(lines) > 20 else "\n".join(lines)
    return content[:2000] if len(content) > 2000 else content


# ── Gemini (Google Developer API) ─────────────────────────────────────────────
def _gemini_generate(prompt: str, model: str = None, temperature: float = None, system_prompt: str = None) -> str:
    from google import genai
    from google.genai import types

    model_name = model if model else settings.GEMINI_MODEL
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    
    config = None
    if temperature is not None or system_prompt is not None:
        config_kwargs = {}
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        if system_prompt is not None:
            config_kwargs["system_instruction"] = system_prompt
        config = types.GenerateContentConfig(**config_kwargs)

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=config
    )
    return response.text.strip()
