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
import requests

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


REQUEST_TIMEOUT = 20
_HEADERS = {
    "User-Agent": FEED_USER_AGENT,
    "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
}


def _download(url: str) -> Optional[bytes]:
    """Beslemeyi requests ile indirir.

    feedparser'ın kendi indiricisi 3xx yönlendirmelerini takip etmiyordu; örneğin
    therecord.media/feed/ → /feed yönlendirmesinde besleme sessizce boş dönüyordu.
    requests yönlendirmeyi takip eder ve hata sebebini açıkça verir.
    """
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    except Exception as exc:
        # Bazı yayıncılar (xda-developers, polygon) sunucu IP'lerine bağlantıyı
        # doğrudan kapatıyor — başlık değiştirmek çözmüyor.
        logger.warning("[RSS] Bağlanılamadı %s: %s", url, type(exc).__name__)
        return None

    if resp.status_code != 200:
        # 403 genelde Cloudflare bot duvarı (ör. bleepingcomputer) — JS challenge
        # çözülmeden geçilemez.
        logger.warning("[RSS] HTTP %s: %s", resp.status_code, url)
        return None

    return resp.content


def _parse(url: str, feed_title: Optional[str]) -> list[dict]:
    content = _download(url)
    if content is None:
        return []
    parsed = feedparser.parse(content)
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
    content = _download(url)
    if content is None:
        return None
    try:
        return feedparser.parse(content).feed.get("title") or None
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
