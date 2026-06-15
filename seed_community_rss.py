"""Doğrulanmış feed kataloğundan onaylı topluluk RSS kaynaklarını seed eder.

RSS okuyucusunun "Topluluk" sekmesinde görünen onaylı kaynakları doldurur.
Idempotent: aynı URL zaten varsa atlar, yalnızca kategori/başlık güncellenir.
"""
from feeds_catalog import FEED_CATALOG
import models


def seed_community_rss(db):
    # Kategori adı -> id
    cat_ids = {c.name: c.id for c in db.query(models.NewsCategory).all()}
    added = 0
    seen_urls = set()  # aynı feed birden fazla kategoride olabilir; topluluk RSS'te url unique
    for category_name, feeds in FEED_CATALOG.items():
        cat_id = cat_ids.get(category_name)
        for source_name, url in feeds:
            if url in seen_urls:
                continue  # paylaşılan feed ilk kategoride kalır
            seen_urls.add(url)
            existing = db.query(models.CommunityRssSource).filter_by(url=url).first()
            if existing:
                # Mevcut kaydı güncel tut (kategori/başlık/onay)
                if existing.category_id != cat_id and cat_id is not None:
                    existing.category_id = cat_id
                if not existing.title:
                    existing.title = source_name
                if existing.status != "approved":
                    existing.status = "approved"
                continue
            db.add(models.CommunityRssSource(
                url=url,
                title=source_name,
                category_id=cat_id,
                submitted_by=None,   # sistem tarafından eklendi
                status="approved",
            ))
            added += 1
    db.commit()
    return added
