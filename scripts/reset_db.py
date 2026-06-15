"""Veritabanını deploy öncesi sıfırlar.

KORUNUR: admin kullanıcısı, kategoriler, onaylı topluluk RSS kaynakları.
SİLİNİR : tüm haberler, tüm podcastler (ses dosyaları dahil), admin-dışı
          kullanıcılar ve tüm kullanıcı verisi (yer imi, sonra-oku, tıklama,
          geri bildirim, kayıtlı RSS, kişisel RSS listeleri, push token, çeviri cache).

Ayrıca podcasts tablosuna is_archived kolonunu ekler (yoksa) ve scraper'ın
"görülen url" hafızasını temizler ki haberler yeniden scrape edilebilsin.

Çalıştırma:  python -m scripts.reset_db
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine
import utils

SEEN_URLS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".scraper_seen_urls.json"
)


def main():
    with engine.begin() as conn:
        # 0. Eksikse is_archived kolonunu ekle (create_all mevcut tabloya kolon eklemez).
        conn.execute(text(
            "ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false"
        ))

        # 1. Silmeden önce ses dosyası yollarını topla.
        audio_urls = [r[0] for r in conn.execute(text(
            "SELECT audio_url FROM podcasts WHERE audio_url IS NOT NULL"
        ))]

        # 2. İçerik + kullanıcı verisi (çocuk tablolardan ebeveyne doğru).
        for stmt in [
            "DELETE FROM podcasts",
            "DELETE FROM summary_feedback",
            "DELETE FROM user_bookmarks",
            "DELETE FROM read_later_items",
            "DELETE FROM user_clicks",
            "DELETE FROM saved_rss_articles",
            "DELETE FROM push_tokens",
            "DELETE FROM password_reset_tokens",
            "DELETE FROM refresh_tokens",
            "DELETE FROM user_rss_feeds",
            "DELETE FROM user_rss_lists",
            "DELETE FROM translation_cache",
            "DELETE FROM user_interests",
            "DELETE FROM news",
            # Onaylı topluluk RSS'leri KORU; bekleyen/reddedileni sil, sahipliği kopar.
            "UPDATE community_rss_sources SET submitted_by = NULL",
            "DELETE FROM community_rss_sources WHERE status <> 'approved'",
            # Admin-dışı kullanıcıları sil.
            "DELETE FROM users WHERE is_admin = false",
        ]:
            res = conn.execute(text(stmt))
            print(f"  {stmt[:60]:<60} → {res.rowcount if res.rowcount is not None else '-'}")

    # 3. Ses dosyalarını diskten/depodan sil.
    deleted_files = 0
    for url in audio_urls:
        try:
            utils.delete_from_gcs(url)
            deleted_files += 1
        except Exception as e:
            print(f"  [uyarı] ses dosyası silinemedi: {url} ({e})")
    print(f"  Silinen ses dosyası: {deleted_files}/{len(audio_urls)}")

    # 4. Scraper hafızasını temizle (haberler yeniden eklenebilsin).
    try:
        if os.path.exists(SEEN_URLS_FILE):
            os.remove(SEEN_URLS_FILE)
            print("  .scraper_seen_urls.json temizlendi")
    except Exception as e:
        print(f"  [uyarı] scraper hafızası temizlenemedi: {e}")

    print("✅ Sıfırlama tamamlandı.")


if __name__ == "__main__":
    main()
