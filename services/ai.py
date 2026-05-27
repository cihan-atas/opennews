"""AI metin üretimi (özet/çeviri) — sağlayıcı-bağımsız.

Sağlayıcılar:
  - vertex (varsayılan): Vertex AI Gemini 2.5 Flash (google-genai)
  - openai: OpenAI Chat Completions (gpt-4o-mini)

Sağlayıcı SDK importları lazy'dir; sadece seçili sağlayıcının paketi gerekir.
"""
from config import settings

_VERTEX_MODEL = "publishers/google/models/gemini-2.5-flash"


def generate(prompt: str) -> str:
    """Verilen prompt için düz metin yanıtı döner."""
    if settings.AI_PROVIDER == "openai":
        return _openai_generate(prompt)
    if settings.AI_PROVIDER == "mock":
        return _mock_generate(prompt)
    return _vertex_generate(prompt)


def translate(text: str, target_lang: str) -> str:
    """text'i hedef dile çevirir. target_lang: 'en' | 'tr'."""
    target = "İngilizce" if target_lang == "en" else "Türkçe"
    prompt = f"Aşağıdaki metni {target} diline çevir. Yalnızca çeviriyi döndür:\n\n{text}"
    return generate(prompt)


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


# ── Mock (yerel geliştirme — API key gerektirmez) ────────────────────────────
def _mock_generate(prompt: str) -> str:
    lines = [l.strip() for l in prompt.split("\n") if l.strip()]
    content = "\n".join(lines[-20:]) if len(lines) > 20 else "\n".join(lines)
    return content[:2000] if len(content) > 2000 else content


# ── OpenAI ───────────────────────────────────────────────────────────────────
def _openai_generate(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()
