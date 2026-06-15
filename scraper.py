#!/usr/bin/env python3
"""
Türkçe haber kaynaklarından RSS ile haber çeken ve DB'ye kaydeden scraper.

Kullanım:
  python scraper.py
  python scraper.py --limit 20
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup
from sqlalchemy.exc import IntegrityError

# ─── Sabitler ─────────────────────────────────────────────────────────────────

SEEN_URLS_FILE = Path(__file__).parent / ".scraper_seen_urls.json"

# Feed -> kategori eşlemeleri merkezi feeds_catalog.FEED_CATALOG'dan üretilir
# (kategori adları DB'deki kategorilerle birebir eşleşmeli — ana veya alt kategori).
# Katalog scripts/validate_feeds.py ile doğrulanmıştır.
from feeds_catalog import scraper_sources

RSS_SOURCES = scraper_sources()

# İçerik çıkarmak için denenen CSS seçiciler (öncelik sırasıyla)
CONTENT_SELECTORS = [
    "[itemprop='articleBody']",
    "article",
    ".article-content",
    ".news-content",
    ".story-content",
    ".content-text",
    ".article-body",
    "main",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

MIN_CONTENT_LENGTH = 200  # Daha kısa içerikler atlanır
REQUEST_DELAY = 0.5        # Saniye — rate limiting

is_currently_scraping = False

# ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

def clean_news_content(text: str) -> str:
    """
    ### Data Cleaning Pipeline:
    - Web sitelerindeki arayüz çöplerini, navigasyon gürültülerini 
      ve sosyal medya buton yazılarını temizler.
    """
    if not text:
        return ""
    
    # Satır başlarındaki veya içindeki "Haberin Devamı" kalıplarını uçur
    text = re.sub(r"(?i)haberin\s+devamı", "", text)
    
    # Haber sonlarındaki web gürültülerini temizle
    noise_patterns = [
        r"paylaş[:\-\s]*",
        r"henüz\s+yorum\s+yok",
        r"ilk\s+yorumu\s+yaz",
        r"yorumunuz\s+gönderildi.*",
        r"onaylandıktan\s+sonra\s+yayımlanacak.*",
        r"yorum\s+yaz\s+iptal",
        r"gözden\s+kaçmasın"
    ]
    
    for pattern in noise_patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    
    # Fazlalık whitespace, tab ve boş satırları düzelt
    text = re.sub(r'\n+', '\n', text)  
    text = re.sub(r' +', ' ', text)    
    
    return text.strip()


def load_seen_urls() -> set:
    """Önceki çalışmalardan kalan URL'leri yükle (tekrar yüklemeyi önler)."""
    if SEEN_URLS_FILE.exists():
        with open(SEEN_URLS_FILE) as f:
            return set(json.load(f))
    return set()


def save_seen_urls(seen: set) -> None:
    with open(SEEN_URLS_FILE, "w") as f:
        json.dump(sorted(seen), f, indent=2)


def extract_content(url: str) -> str | None:
    """Haber sayfasından ana metni çıkarır."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"    [!] İçerik alınamadı: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()

    for selector in CONTENT_SELECTORS:
        el = soup.select_one(selector)
        if el:
            text = el.get_text(separator=" ", strip=True)
            if len(text) >= MIN_CONTENT_LENGTH:
                return clean_news_content(text)

    # Fallback: uzun <p> taglarını birleştir
    paragraphs = [
        p.get_text(strip=True)
        for p in soup.find_all("p")
        if len(p.get_text(strip=True)) > 50
    ]
    text = " ".join(paragraphs)
    return clean_news_content(text) if len(text) >= MIN_CONTENT_LENGTH else None


def extract_image(entry) -> str | None:
    """RSS entry'den görsel URL'ini çıkarır."""
    if hasattr(entry, "media_content") and entry.media_content:
        return entry.media_content[0].get("url")
    if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
        return entry.media_thumbnail[0].get("url")
    return None


def extract_published_at(entry) -> datetime | None:
    """RSS entry'den yayın tarihini çıkarır."""
    t = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if t:
        return datetime(*t[:6], tzinfo=timezone.utc)
    return None


def login(api_url: str, email: str, password: str) -> str | None:
    """API'ye giriş yapar, Bearer access_token döner."""
    resp = requests.post(
        f"{api_url}/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if resp.status_code == 200:
        token = resp.json().get("access_token")
        print(f"[Auth] Giriş başarılı: {email}")
        return token
    print(f"[Auth] Giriş başarısız ({resp.status_code}): {resp.text[:200]}")
    return None


def get_category_map(api_url: str, token: str) -> dict[str, int]:
    """Kategori adı → ID sözlüğü döner."""
    resp = requests.get(
        f"{api_url}/categories/",
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        print(f"[!] Kategoriler alınamadı: {resp.status_code}")
        return {}
    return {cat["name"]: cat["id"] for cat in resp.json()}


def post_news(api_url: str, token: str, payload: dict) -> bool:
    """Haberi /news/ endpoint'ine gönderir."""
    resp = requests.post(
        f"{api_url}/news/",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code == 201:
        return True
    print(f"    [!] POST /news/ başarısız ({resp.status_code}): {resp.text[:200]}")
    return False


# ─── Ana Akış ─────────────────────────────────────────────────────────────────

def scrape_to_db(limit: int = 0) -> dict:
    """RSS kaynaklarından haber çekip direkt DB'ye kaydeder. Credential gerekmez."""
    from database import SessionLocal
    import models

    global is_currently_scraping
    
    # Eğer zaten çalışıyorsa, yeni bir tane başlatma, hata dön
    if is_currently_scraping:
        print("[!] Scraper zaten çalışıyor, yeni işlem reddedildi.")  # Eşzamanlı olarak 1'den fazla worker çalışırsa böyle yazmak sorunu çözmüyor o yüzden compose dosyasına bunu yazdık: celery -A tasks worker --loglevel=info --concurrency=1
        return {"status": "already_running", "message": "Tarama devam ediyor."}

    is_currently_scraping = True # Kilidi kapat

    db = SessionLocal()
    try:
        categories = db.query(models.NewsCategory).all()
        category_map = {cat.name: cat.id for cat in categories}
        if not category_map:
            print("[!] Kategori listesi boş — seed_data çalıştırıldı mı?")
            sys.exit(1)

        seen_urls = load_seen_urls()
        uploaded = skipped_dup = skipped_content = 0

        for source in RSS_SOURCES:
            if limit and uploaded >= limit:
                break

            cat_name = source["category_name"]
            cat_id = category_map.get(cat_name)
            if cat_id is None:
                print(f"\n[RSS] '{cat_name}' kategorisi bulunamadı, atlanıyor.")
                continue

            print(f"\n[RSS] {source['url']}  →  {cat_name} (id={cat_id})")
            # Besleme okuma hatası (ağ kopması, bozuk XML vb.) tüm taramayı öldürmesin;
            # sadece bu beslemeyi atla ve sıradakine geç.
            try:
                feed = feedparser.parse(source["url"])
            except Exception as feed_e:
                print(f"    [!] Besleme okunamadı, atlanıyor: {feed_e}")
                continue

            if not feed.entries:
                print(" Feed boş veya erişilemiyor.")
                continue

            for entry in feed.entries:
                if limit and uploaded >= limit:
                    break

                source_url = entry.get("link", "").strip()
                if not source_url:
                    continue

                if source_url in seen_urls:
                    skipped_dup += 1
                    continue

                title = entry.get("title", "Başlık Yok").strip()
                print(f"  → {title[:75]}")

                content = extract_content(source_url)
                seen_urls.add(source_url)

                if not content:
                    print("    İçerik çıkarılamadı, atlanıyor.")
                    skipped_content += 1
                    # --- CHECKPOINT: Bozuk linki de hafızaya hemen işle ---
                    save_seen_urls(seen_urls) 
                    # ---------------------------------------------------
                    continue

                from utils import detect_lang
                news = models.News(
                    title=title,
                    content=content,
                    category_id=cat_id,
                    source_url=source_url,
                    image_url=extract_image(entry),
                    published_at=extract_published_at(entry),
                    lang=detect_lang(f"{title} {content}"),
                )

                # --- KRİTİK NOKTA: HER ADIMDA KAYDET (CHECKPOINT) --- Mükerrer URL'leri önlemek ve ilerlemeyi kaybetmemek için her haber eklendikten sonra commit yapıyoruz.
                try:
                    db.add(news)
                    db.commit() # Haberi Frankfurt'a kalıcı olarak yaz
                    uploaded += 1
                    print(f"    ✓ Yüklendi [{uploaded}/{limit or '∞'}]")
                except IntegrityError:
                    db.rollback() # Bu kayıt için işlemi geri al
                    skipped_dup += 1
                    print(f"    [!] Bu haber zaten veritabanında var, atlanıyor.")
                except Exception as inner_e:
                    db.rollback()
                    print(f"    [!] Beklenmedik kayıt hatası: {inner_e}")
                
                # Hafızayı her halükarda güncelle
                save_seen_urls(seen_urls) 
                time.sleep(REQUEST_DELAY)

        print("\n─── Scraper Tamamlandı ──────────────────────")
        print(f"  Yüklenen : {uploaded}")
        print(f"  Tekrar   : {skipped_dup}")
        print(f"  Atlanan  : {skipped_content}")
        return {"uploaded": uploaded, "skipped_dup": skipped_dup, "skipped_content": skipped_content}

    except Exception as e:
        db.rollback()
        print(f"[!] Hata: {e}")
        raise
    finally:
        is_currently_scraping = False    # hata verse de vermese de kilidi açmamız lazım
        db.close()
        # Redis flag'ini temizle (API prosesi bunu okuyarak scraper'ın bittiğini anlar)
        try:
            import redis as _redis
            from config import settings as _cfg
            _redis.from_url(_cfg.CELERY_BROKER_URL).delete("scraper_running")
        except Exception as _e:
            print(f"[System] Redis flag temizlenemedi: {_e}")
        print("[System] Kilit açıldı, yeni isteklere hazır.")

def main():
    parser = argparse.ArgumentParser(description="AI News Bulletin — Haber Scraper")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maksimum yüklenecek haber sayısı (0 = sınırsız)",
    )
    args = parser.parse_args()
    scrape_to_db(args.limit)


if __name__ == "__main__":
    main()