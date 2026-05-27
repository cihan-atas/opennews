"""Vektör embedding üretimi — sağlayıcı-bağımsız, 768 boyut (mevcut Vector(768) şeması).

Sağlayıcılar:
  - vertex              : Vertex AI text-embedding-005 (768-dim) — ücretli
  - openai              : text-embedding-3-small, dimensions=768 — ücretli
  - local               : sentence-transformers yerel model — tamamen ücretsiz, Türkçe destekli
  - mock                : deterministik sin-bazlı vektör (geliştirme)

OpenRouter ve NVIDIA NIM embedding API'si sunmadığından yerel model (local) önerilir.
Model: paraphrase-multilingual-mpnet-base-v2 → 768-dim, 50+ dil, Türkçe dahil.
"""
from config import settings

_VERTEX_MODEL = "publishers/google/models/text-embedding-005"
_DIM = 768

# Yerel model singleton — ilk çağrıda yüklenir, sonrakinde cache'den gelir.
_local_model = None


def embed(text: str, task_type: str = "retrieval_document") -> list[float]:
    provider = settings.EMBEDDING_PROVIDER
    if provider == "openai":
        return _openai_embed(text)
    if provider == "local":
        return _local_embed(text)
    if provider == "mock":
        return _mock_embed(text)
    return _vertex_embed(text)


# ── Yerel (sentence-transformers — ücretsiz, Türkçe) ─────────────────────────
def _local_embed(text: str) -> list[float]:
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer
        # 768-dim, 50+ dil destekli, Türkçe dahil — DB migration gerektirmez.
        _local_model = SentenceTransformer(settings.LOCAL_EMBED_MODEL)
    vec = _local_model.encode(text, normalize_embeddings=True).tolist()
    # Model farklı dim döndürürse pad/truncate yap
    if len(vec) < _DIM:
        vec += [0.0] * (_DIM - len(vec))
    return vec[:_DIM]


# ── OpenAI ───────────────────────────────────────────────────────────────────
def _openai_embed(text: str) -> list[float]:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.embeddings.create(
        model=settings.OPENAI_EMBED_MODEL,
        input=text,
        dimensions=_DIM,
    )
    return response.data[0].embedding


# ── Vertex ────────────────────────────────────────────────────────────────────
def _vertex_embed(text: str) -> list[float]:
    from google import genai
    client = genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_LOCATION,
    )
    response = client.models.embed_content(model=_VERTEX_MODEL, contents=text)
    return response.embeddings[0].values


# ── Mock (geliştirme) ─────────────────────────────────────────────────────────
def _mock_embed(text: str) -> list[float]:
    import math
    words = text.lower().split()[:_DIM]
    vec = [math.sin(sum(ord(c) for c in w) * (i + 1)) for i, w in enumerate(words)]
    vec += [0.0] * (_DIM - len(vec))
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]
