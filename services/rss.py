"""RSS besleme çekme — router ve worker'ın ortak kullandığı tek kaynak.

Daha önce bu kod routers/rss_reader.py içindeydi; bildirim değerlendirme görevi
(worker.py → evaluate_rss_notifications) de aynı işi yaptığı için buraya taşındı.
Worker'ın router import etmesi doğru olmazdı.

Redis cache: aynı listeye birden fazla bildirim kuralı bağlanabildiği için aynı
besleme bir turda defalarca çekilebilir. Kısa ömürlü cache bunu önler.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import feedparser

logger = logging.getLogger(__name__)

# Bazı yayıncılar (Cloudflare vb.) feedparser'ın varsayılan User-Agent'ını
# bloklar ve boş besleme döndürür. Gerçek bir tarayıcı UA'sı ile istek atıyoruz.
FEED_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CACHE_TTL_SECONDS = 300
_MAX_ENTRIES = 100

_redis_client = None
_redis_tried = False


def _redis():
    """Broker Redis'ini paylaşır. Bağlanamazsa cache sessizce devre dışı kalır."""
    global _redis_client, _redis_tried
    if _redis_tried:
        return _redis_client
    _redis_tried = True
    try:
        import redis
        from config import settings
        _redis_client = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_timeout=2)
        _redis_client.ping()
    except Exception as exc:
        logger.info("[RSS] Redis cache devre dışı: %s", exc)
        _redis_client = None
    return _redis_client


def link_hash(link: str) -> str:
    """Makale linkinin tekilleştirme anahtarı (rss_seen_articles.link_hash)."""
    return hashlib.sha1((link or "").strip().encode("utf-8")).hexdigest()


def _parse(url: str, feed_title: Optional[str]) -> list[dict]:
    parsed = feedparser.parse(url, agent=FEED_USER_AGENT)
    articles = []
    for entry in parsed.entries[:_MAX_ENTRIES]:
        pub = entry.get("published_parsed") or entry.get("updated_parsed")
        if pub:
            dt = datetime(*pub[:6], tzinfo=timezone.utc).isoformat()
        else:
            dt = None
        articles.append({
            "title": entry.get("title", "Başlık yok"),
            "link": entry.get("link", ""),
            "summary": entry.get("summary", ""),
            "published": dt,
            "feed_title": feed_title or parsed.feed.get("title", url),
            "feed_url": url,
        })
    return articles


def fetch_feed_title(url: str) -> Optional[str]:
    """Beslemenin kendi başlığı (liste eklenirken otomatik isimlendirme için)."""
    try:
        parsed = feedparser.parse(url, agent=FEED_USER_AGENT)
        return parsed.feed.get("title") or None
    except Exception:
        return None


def fetch_feed(url: str, feed_title: Optional[str] = None, use_cache: bool = True) -> list[dict]:
    """Tek bir beslemeyi çeker ve makale sözlükleri döner. Hata durumunda boş liste.

    Boş sonuçlar cachelenmez — geçici bir engellemede 5 dk boyunca boş kalmasın.
    """
    cache_key = f"rss:feed:{hashlib.sha1(url.encode('utf-8')).hexdigest()}"
    client = _redis() if use_cache else None

    if client is not None:
        try:
            cached = client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    try:
        articles = _parse(url, feed_title)
    except Exception as exc:
        logger.warning("[RSS] Besleme çekilemedi %s: %s", url, exc)
        return []

    if client is not None and articles:
        try:
            client.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(articles))
        except Exception:
            pass

    return articles
