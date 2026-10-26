"""Metinden sese (TTS) — sağlayıcı-bağımsız. MP3 byte'ları döner.

Sağlayıcılar:
  - google (varsayılan): Google Cloud Text-to-Speech
  - edge: edge-tts (ücretsiz, anahtarsız, Microsoft Azure sesleri)
  - polly: Amazon Polly (AWS neural sesleri)

Çift ses modu (synthesize_segmented):
  Türkçe segmentler → EDGE_TTS_VOICE / POLLY_VOICE_TR (Ayarlar'dan seçilir)
  İngilizce segmentler → en-US-AriaNeural / Joanna (Polly)
"""
from services.settings_store import settings  # DB→.env çözümlemeli proxy

_EDGE_TR_VOICE = "tr-TR-EmelNeural"   # kullanıcı ayar girmemişse varsayılan
_EDGE_EN_VOICE = "en-US-AriaNeural"


def _edge_tr_voice() -> str:
    """Kullanıcının EDGE_TTS_VOICE ayarı → .env → varsayılan.

    Çağrı anında okunur; worker'ın user_context'i o kullanıcının sesini çözsün.
    """
    return settings.EDGE_TTS_VOICE or _EDGE_TR_VOICE


def synthesize(text: str) -> bytes:
    """Tek ses, düz metin. Sadece Türkçe ses kullanır."""
    if settings.TTS_PROVIDER == "edge":
        return _edge_synthesize(text, _edge_tr_voice())
    elif settings.TTS_PROVIDER == "polly":
        try:
            return _polly_synthesize(text, settings.POLLY_VOICE_TR)
        except Exception as e:
            print(f"[TTS] Polly failed: {e}, falling back to edge-tts")
            return _edge_synthesize(text, _edge_tr_voice())
    return _google_synthesize(text)


def synthesize_segmented(segments: list) -> bytes:
    """Her segmenti dile göre uygun sesle sentezler, MP3'leri birleştirir.

    segments: [{"text": "...", "lang": "tr"|"en"}, ...]
    """
    is_all_en = bool(segments) and all(seg.get("lang") == "en" for seg in segments)

    if settings.TTS_PROVIDER == "polly":
        try:
            full_text = "".join(seg.get("text", "") for seg in segments)
            if is_all_en:
                return _polly_synthesize(full_text, "Joanna")
            from services import ai as ai_service
            ssml_text = ai_service.phonetize_english_for_tr_tts(full_text)
            return _polly_synthesize(ssml_text, settings.POLLY_VOICE_TR)
        except Exception as e:
            print(f"[TTS] Polly synthesize failed: {e}, falling back to edge-tts")

    if settings.TTS_PROVIDER != "edge" and settings.TTS_PROVIDER != "polly":
        full = "".join(s["text"] for s in segments)
        return _google_synthesize(full, "en-US" if is_all_en else "tr-TR")

    import asyncio

    tr_voice = _edge_tr_voice()

    async def _run() -> bytes:
        import edge_tts
        chunks = bytearray()
        for seg in segments:
            text = seg.get("text", "").strip()
            if not text:
                continue
            voice = _EDGE_EN_VOICE if seg.get("lang") == "en" else tr_voice
            communicate = edge_tts.Communicate(text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    chunks.extend(chunk["data"])
        return bytes(chunks)

    return asyncio.run(_run())


def _google_synthesize(text: str, lang_code: str = "tr-TR") -> bytes:
    from google.cloud import texttospeech
    client = texttospeech.TextToSpeechClient()
    synthesis_input = texttospeech.SynthesisInput(text=text)
    voice = texttospeech.VoiceSelectionParams(
        language_code=lang_code,
        ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL,
    )
    audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
    response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
    return response.audio_content


def _edge_synthesize(text: str, voice: str) -> bytes:
    import asyncio
    import edge_tts

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        chunks = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.extend(chunk["data"])
        return bytes(chunks)

    return asyncio.run(_run())


# Amazon Polly tek istekte en fazla 3000 karakter (billed text) kabul eder.
# Uzun podcast metinleri bu sınırı aşar → cümle bazında parçalayıp birleştiriyoruz.
_POLLY_MAX_CHARS = 2800


def _split_for_polly(text: str, limit: int = _POLLY_MAX_CHARS) -> list:
    """Metni Polly sınırının altında, cümle bütünlüğünü koruyan parçalara böler."""
    import re
    if len(text) <= limit:
        return [text]
    # Cümle sonlarından böl (nokta/ünlem/soru + boşluk veya satır sonu)
    sentences = re.split(r'(?<=[.!?])\s+|\n+', text)
    chunks, cur = [], ""
    for s in sentences:
        if not s:
            continue
        # Tek cümle bile sınırı aşıyorsa kelime kelime kır
        while len(s) > limit:
            head, s = s[:limit], s[limit:]
            if cur:
                chunks.append(cur); cur = ""
            chunks.append(head)
        if len(cur) + len(s) + 1 <= limit:
            cur = f"{cur} {s}".strip()
        else:
            if cur:
                chunks.append(cur)
            cur = s
    if cur:
        chunks.append(cur)
    return chunks


def _polly_synthesize(text: str, voice: str) -> bytes:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    client_params = {}
    if settings.AWS_ACCESS_KEY_ID:
        client_params["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
    if settings.AWS_SECRET_ACCESS_KEY:
        client_params["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    if settings.AWS_REGION:
        client_params["region_name"] = settings.AWS_REGION

    client = boto3.client("polly", **client_params)

    is_ssml = text.strip().startswith("<speak>")
    text_type = "ssml" if is_ssml else "text"
    # SSML'i bölmek riskli (etiket bütünlüğü); yalnızca düz metni parçalıyoruz.
    parts = [text] if is_ssml else _split_for_polly(text)

    try:
        audio = bytearray()
        for part in parts:
            if not part.strip():
                continue
            response = client.synthesize_speech(
                Text=part,
                TextType=text_type,
                OutputFormat="mp3",
                VoiceId=voice,
                Engine=settings.POLLY_ENGINE,
            )
            audio.extend(response["AudioStream"].read())
        return bytes(audio)
    except (BotoCoreError, ClientError) as err:
        print(f"[TTS] Amazon Polly synthesis failed: {err}")
        raise err
