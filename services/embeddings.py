"""Vektör embedding üretimi — sağlayıcı-bağımsız, 768 boyut (mevcut Vector(768) şeması).

Sağlayıcılar:
  - vertex (varsayılan): text-embedding-005 (768-dim)
  - openai: text-embedding-3-small, dimensions=768 (şema değişmeden uyum)
"""
from config import settings

_VERTEX_MODEL = "publishers/google/models/text-embedding-005"
_DIM = 768


def embed(text: str, task_type: str = "retrieval_document") -> list[float]:
    if settings.EMBEDDING_PROVIDER == "openai":
        return _openai_embed(text)
    return _vertex_embed(text)


def _vertex_embed(text: str) -> list[float]:
    from google import genai
    client = genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_LOCATION,
    )
    response = client.models.embed_content(model=_VERTEX_MODEL, contents=text)
    return response.embeddings[0].values


def _openai_embed(text: str) -> list[float]:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    # dimensions=768 → mevcut pgvector Vector(768) sütununa birebir oturur (migration gerekmez).
    response = client.embeddings.create(
        model=settings.OPENAI_EMBED_MODEL,
        input=text,
        dimensions=_DIM,
    )
    return response.data[0].embedding
