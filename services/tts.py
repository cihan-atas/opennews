"""Metinden sese (TTS) — sağlayıcı-bağımsız. MP3 byte'ları döner.

Sağlayıcılar:
  - google (varsayılan): Google Cloud Text-to-Speech
  - edge: edge-tts (ücretsiz, anahtarsız, Microsoft Azure sesleri)
"""
from config import settings


def synthesize(text: str) -> bytes:
    """text'i seslendirip MP3 byte'ları döner."""
    if settings.TTS_PROVIDER == "edge":
        return _edge_synthesize(text)
    return _google_synthesize(text)


def _google_synthesize(text: str) -> bytes:
    from google.cloud import texttospeech
    client = texttospeech.TextToSpeechClient()
    synthesis_input = texttospeech.SynthesisInput(text=text)
    voice = texttospeech.VoiceSelectionParams(
        language_code="tr-TR",
        ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL,
    )
    audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
    response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
    return response.audio_content


def _edge_synthesize(text: str) -> bytes:
    import asyncio
    import edge_tts

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(text, settings.EDGE_TTS_VOICE)
        chunks = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.extend(chunk["data"])
        return bytes(chunks)

    return asyncio.run(_run())
