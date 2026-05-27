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


def generate(prompt: str, quality: bool = False) -> str:
    """Verilen prompt için düz metin yanıtı döner.
    quality=True → daha iyi model (podcast script, çeviri gibi önemli işler).
    quality=False → hızlı/yüksek-limitli model (haber özeti gibi toplu işler).
    """
    provider = settings.AI_PROVIDER
    if provider == "groq":
        return _groq_generate(prompt, quality=quality)
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


# Sembol → yazı: TTS'e gitmeden önce basit temizlik (AI fallback'inden önce çalışır)
_SYMBOL_MAP = [
    (re.compile(r'\$\s*(\d+)'),     r'\1 dolar'),
    (re.compile(r'€\s*(\d+)'),      r'\1 euro'),
    (re.compile(r'£\s*(\d+)'),      r'\1 sterlin'),
    (re.compile(r'(\d+)\s*%'),      r'yüzde \1'),
    (re.compile(r'\s&\s'),          ' ve '),
    (re.compile(r'https?://\S+'),   ''),
    (re.compile(r'www\.\S+'),       ''),
]


def _symbol_cleanup(text: str) -> str:
    for pattern, repl in _SYMBOL_MAP:
        text = pattern.sub(repl, text)
    return re.sub(r'\s{2,}', ' ', text).strip()


def prepare_tts_script(text: str) -> str:
    """Podcast scriptini Türkçe TTS için hazırlar.

    İngilizce kelimeler, kısaltmalar ve semboller Türkçe okunuşa dönüştürülür.
    Hata durumunda sembol temizliği uygulanmış orijinal metin döner.
    """
    cleaned = _symbol_cleanup(text)
    prompt = (
        "Aşağıdaki Türkçe podcast metnini sesli okuma (TTS) için düzenle. "
        "SADECE şu değişiklikleri yap, başka hiçbir şeyi değiştirme:\n"
        "1. İngilizce kelimeleri Türkçe karşılığına veya Türkçe fonetik yazımına çevir.\n"
        "   Örnekler: ChatGPT→Çet-Ci-Pi-Ti, API→Eypiai, iPhone→Ayvon, "
        "startup→girişim, online→çevrimiçi, tweet→tvit, "
        "app→uygulama, AI→yapay zeka, update→güncelleme, "
        "CEO→Si-İ-O, NASA→Nasa, FBI→Ef-Bi-Ay, NATO→Nato.\n"
        "2. Büyük harf kısaltmaları fonetik yaz: GPT→Ci-Pi-Ti, LLM→El-El-Em.\n"
        "3. Rakam+birim: '5K' → 'beş bin', '2B' → 'iki milyar'.\n"
        "4. Cümle ekleyip çıkarma — sadece kelime değişimi yap.\n"
        "5. Sadece düzenlenmiş metni döndür, açıklama ekleme.\n\n"
        f"{cleaned}"
    )
    try:
        result = generate(prompt, quality=False)
        # Boş veya çok kısa yanıt gelirse orijinale dön
        if len(result.strip()) < len(cleaned) * 0.5:
            return cleaned
        return result.strip()
    except Exception:
        return cleaned


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


def _groq_generate(prompt: str, quality: bool = False) -> str:
    client = _get_groq_client()
    model = settings.GROQ_QUALITY_MODEL if quality else settings.GROQ_MODEL
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant. Respond directly without any thinking process."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
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
