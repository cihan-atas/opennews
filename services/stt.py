"""Konuşmadan metne (STT) — Groq Whisper.

Limitler (ücretsiz):
  whisper-large-v3       → 20 istek/dk, 2K istek/gün
  whisper-large-v3-turbo → 20 istek/dk, 2K istek/gün (daha hızlı, biraz daha az doğru)

Kullanım alanları:
  - Podcast transkripti (dinle + oku)
  - RSS ses makalelerini metne çevirme
"""
from services.settings_store import settings  # kullanıcı→.env çözümlemeli proxy

_GROQ_STT_CLIENT = None
_GROQ_STT_CLIENT_KEY = None


def _get_groq_stt_client():
    # Anahtar kullanıcıya özel olabildiği için client'ı anahtara göre önbellekle.
    global _GROQ_STT_CLIENT, _GROQ_STT_CLIENT_KEY
    api_key = settings.GROQ_API_KEY
    if _GROQ_STT_CLIENT is None or api_key != _GROQ_STT_CLIENT_KEY:
        from openai import OpenAI
        _GROQ_STT_CLIENT = OpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        _GROQ_STT_CLIENT_KEY = api_key
    return _GROQ_STT_CLIENT


def transcribe(audio_path: str, language: str = "tr") -> str:
    """Ses dosyasını metne çevirir.

    audio_path : yerel dosya yolu (mp3, wav, m4a, ogg, flac — maks 25 MB)
    language   : ISO 639-1 dil kodu ('tr', 'en', ...). None → otomatik algıla.
    Döner      : transkript metni
    """
    if settings.STT_PROVIDER == "groq":
        return _groq_transcribe(audio_path, language)
    raise ValueError(f"Bilinmeyen STT provider: {settings.STT_PROVIDER}")


def _groq_transcribe(audio_path: str, language: str | None) -> str:
    client = _get_groq_stt_client()
    with open(audio_path, "rb") as f:
        kwargs = dict(
            file=f,
            model=settings.GROQ_STT_MODEL,
            response_format="text",
        )
        if language:
            kwargs["language"] = language
        result = client.audio.transcriptions.create(**kwargs)
    return result if isinstance(result, str) else result.text
