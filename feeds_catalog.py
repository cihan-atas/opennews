"""Doğrulanmış RSS feed kataloğu — kategori adı -> [(kaynak adı, feed url), ...].

Tüm feed'ler scripts/validate_feeds.py ile HTTP 200 + geçerli XML (>=3 öğe)
olarak doğrulanmıştır. Kategori adları routers.categories.CATEGORY_TREE ile
birebir eşleşir (ana kategori veya alt kategori adı).

Kullanım:
- scraper.RSS_SOURCES bu katalogdan üretilir (otomatik haber akışı).
- seed_community_rss bu katalogdan onaylı topluluk RSS kaynaklarını seed eder (okuyucu).

Yeniden doğrulamak için:  python -m scripts.validate_feeds
"""

FEED_CATALOG = {
    # ── Ana çekirdek kategoriler ───────────────────────────────────
    "Teknoloji": [
        ("Webtekno", "https://www.webtekno.com/rss.xml"),
        ("Donanım Haber", "https://www.donanimhaber.com/rss/tum/"),
        ("ShiftDelete", "https://shiftdelete.net/feed"),
        ("Technopat", "https://www.technopat.net/feed/"),
        ("NTV Teknoloji", "https://www.ntv.com.tr/teknoloji.rss"),
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("TechCrunch", "https://techcrunch.com/feed/"),
    ],
    "Ekonomi": [
        ("NTV Ekonomi", "https://www.ntv.com.tr/ekonomi.rss"),
        ("Dünya Gazetesi", "https://www.dunya.com/rss"),
        ("Bloomberg HT", "https://www.bloomberght.com/rss"),
        ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ],
    "Spor": [
        ("Hürriyet Spor", "https://www.hurriyet.com.tr/rss/spor"),
        ("Fotomaç", "https://www.fotomac.com.tr/rss/anasayfa.xml"),
        ("Sözcü Spor", "https://www.sozcu.com.tr/feeds-rss-category-spor"),
        ("Guardian Sport", "https://www.theguardian.com/sport/rss"),
    ],
    "Siyaset": [
        ("BBC Türkçe", "https://feeds.bbci.co.uk/turkce/rss.xml"),
    ],
    "Sağlık": [
        ("NTV Sağlık", "https://www.ntv.com.tr/saglik.rss"),
        ("BBC Health", "https://feeds.bbci.co.uk/news/health/rss.xml"),
    ],
    "Kültür-Sanat": [
        ("Cumhuriyet Kültür-Sanat", "https://www.cumhuriyet.com.tr/rss/kultur-sanat"),
        ("Guardian Culture", "https://www.theguardian.com/culture/rss"),
    ],
    "Bilim": [
        ("TRT Bilim Teknoloji", "https://www.trthaber.com/bilim_teknoloji_articles.rss"),
        ("Science Daily", "https://www.sciencedaily.com/rss/all.xml"),
        ("Nature", "https://www.nature.com/nature.rss"),
        ("Popular Science", "https://www.popsci.com/feed/"),
    ],
    "Otomobil": [
        ("NTV Otomobil", "https://www.ntv.com.tr/otomobil.rss"),
        ("Motor1 Türkiye", "https://tr.motor1.com/rss/news/all/"),
    ],
    "Oyun": [
        ("ShiftDelete Oyun", "https://shiftdelete.net/oyun/feed"),
        ("Eurogamer", "https://www.eurogamer.net/feed"),
        ("Polygon", "https://www.polygon.com/rss/index.xml"),
        ("IGN", "https://feeds.ign.com/ign/all"),
    ],
    "Magazin": [
        ("Hürriyet Magazin", "https://www.hurriyet.com.tr/rss/magazin"),
        ("Variety", "https://variety.com/feed/"),
    ],
    "Eğitim": [
        ("NTV Eğitim", "https://www.ntv.com.tr/egitim.rss"),
    ],
    "Dünya": [
        ("NTV Dünya", "https://www.ntv.com.tr/dunya.rss"),
        ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World", "https://www.theguardian.com/world/rss"),
    ],
    "Türkiye": [
        ("NTV Türkiye", "https://www.ntv.com.tr/turkiye.rss"),
        ("TRT Gündem", "https://www.trthaber.com/gundem_articles.rss"),
        ("AA Güncel", "https://www.aa.com.tr/tr/rss/default?cat=guncel"),
    ],
    "Gastronomi": [
        ("Lezzet", "https://www.lezzet.com.tr/rss"),
        ("Nefis Yemek Tarifleri", "https://www.nefisyemektarifleri.com/feed/"),
    ],
    # ── Yeni ana kategoriler ───────────────────────────────────────
    "Yaşam & Stil": [
        ("NTV Yaşam", "https://www.ntv.com.tr/yasam.rss"),
        ("Guardian Lifeandstyle", "https://www.theguardian.com/lifeandstyle/rss"),
    ],
    "Çevre & Doğa": [
        ("Guardian Environment", "https://www.theguardian.com/environment/rss"),
        ("BBC Science & Environment", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
    ],
    "İş & Kariyer": [
        ("Webrazzi", "https://webrazzi.com/feed/"),
    ],
    "Seyahat": [
        ("Guardian Travel", "https://www.theguardian.com/travel/rss"),
    ],
    "Medya & Eğlence": [
        ("Hollywood Reporter", "https://www.hollywoodreporter.com/feed/"),
        ("Variety", "https://variety.com/feed/"),
    ],
    "Toplum": [
        ("Guardian Society", "https://www.theguardian.com/society/rss"),
    ],
    "Hukuk & Güvenlik": [
        ("Hürriyet Gündem", "https://www.hurriyet.com.tr/rss/gundem"),
        ("Habertürk Gündem", "https://www.haberturk.com/rss/kategori/gundem.xml"),
    ],
    "Diğer": [
        ("NTV Yaşam", "https://www.ntv.com.tr/yasam.rss"),
    ],
    # ── Güçlü alt kategoriler ──────────────────────────────────────
    "Yapay Zeka": [
        ("MIT Tech Review", "https://www.technologyreview.com/feed/"),
        ("Google AI Blog", "https://blog.google/technology/ai/rss/"),
        ("VentureBeat AI", "https://venturebeat.com/category/ai/feed/"),
    ],
    "Siber Güvenlik": [
        ("The Hacker News", "https://feeds.feedburner.com/TheHackersNews"),
        ("BleepingComputer", "https://www.bleepingcomputer.com/feed/"),
        ("Krebs on Security", "https://krebsonsecurity.com/feed/"),
    ],
    "Yazılım & Geliştirme": [
        ("Hacker News (YC)", "https://news.ycombinator.com/rss"),
        ("Dev.to", "https://dev.to/feed"),
        ("InfoQ", "https://feed.infoq.com/"),
    ],
    "Mobil & Uygulamalar": [
        ("ShiftDelete Mobil", "https://shiftdelete.net/mobil/feed"),
        ("Android Authority", "https://www.androidauthority.com/feed/"),
    ],
    "Donanım & Gadget": [
        ("Engadget", "https://www.engadget.com/rss.xml"),
        ("Tom's Hardware", "https://www.tomshardware.com/feeds/all"),
    ],
    "Kripto & Blockchain": [
        ("Cointelegraph", "https://cointelegraph.com/rss"),
        ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ],
    "Sosyal Medya": [
        ("TechCrunch Social", "https://techcrunch.com/category/social/feed/"),
    ],
    "Robotik": [
        ("IEEE Spectrum Robotics", "https://spectrum.ieee.org/feeds/topic/robotics.rss"),
    ],
    "Borsa & Hisse": [
        ("Bloomberg HT", "https://www.bloomberght.com/rss"),
    ],
    "Kripto Para": [
        ("Cointelegraph", "https://cointelegraph.com/rss"),
    ],
    "Finans & Bankacılık": [
        ("Investing.com TR", "https://tr.investing.com/rss/news.rss"),
    ],
    "Girişimcilik & Startup": [
        ("Webrazzi", "https://webrazzi.com/feed/"),
        ("TechCrunch Startups", "https://techcrunch.com/category/startups/feed/"),
    ],
    "Emlak & Konut": [
        ("Emlak Kulisi", "https://emlakkulisi.com/rss"),
    ],
    "Futbol": [
        ("Guardian Football", "https://www.theguardian.com/football/rss"),
    ],
    "Basketbol": [
        ("Eurohoops", "https://www.eurohoops.net/en/feed/"),
    ],
    "Formula 1": [
        ("Motorsport TR", "https://tr.motorsport.com/rss/f1/news/"),
        ("Autosport F1", "https://www.autosport.com/rss/f1/news/"),
    ],
    "Tenis": [
        ("Guardian Tennis", "https://www.theguardian.com/sport/tennis/rss"),
    ],
    "E-Spor": [
        ("Dexerto", "https://www.dexerto.com/feed/"),
    ],
    "Uzay & Astronomi": [
        ("Space.com", "https://www.space.com/feeds/all"),
        ("NASA", "https://www.nasa.gov/news-release/feed/"),
    ],
    "Sinema & Dizi": [
        ("Beyazperde", "https://www.beyazperde.com/rss/haberler.xml"),
        ("Variety Film", "https://variety.com/v/film/feed/"),
    ],
    "Müzik": [
        ("Guardian Music", "https://www.theguardian.com/music/rss"),
        ("Pitchfork", "https://pitchfork.com/feed/feed-news/rss"),
    ],
    "Kitap & Edebiyat": [
        ("Guardian Books", "https://www.theguardian.com/books/rss"),
    ],
    "PC Oyunları": [
        ("PC Gamer", "https://www.pcgamer.com/rss/"),
    ],
    "Konsol Oyunları": [
        ("Push Square", "https://www.pushsquare.com/feeds/latest"),
    ],
    "Elektrikli Araçlar": [
        ("Electrek", "https://electrek.co/feed/"),
        ("InsideEVs", "https://insideevs.com/rss/news/all/"),
    ],
    "Beslenme & Diyet": [
        ("BBC Good Food", "https://www.bbcgoodfood.com/rss"),
    ],
    "Fitness & Egzersiz": [
        ("Men's Health", "https://www.menshealth.com/rss/all.xml/"),
    ],
    "Moda": [
        ("Vogue", "https://www.vogue.com/feed/rss"),
        ("Guardian Fashion", "https://www.theguardian.com/fashion/rss"),
    ],
    "Evcil Hayvanlar": [
        ("Guardian Animals", "https://www.theguardian.com/world/animals/rss"),
    ],
    "İklim Değişikliği": [
        ("Guardian Climate Crisis", "https://www.theguardian.com/environment/climate-crisis/rss"),
    ],
    "Yayıncılık (Streaming)": [
        ("Variety TV", "https://variety.com/v/tv/feed/"),
    ],
    "Savunma Sanayi": [
        ("Defense News", "https://www.defensenews.com/arc/outboundfeeds/rss/"),
    ],
    "Avrupa": [
        ("Guardian Europe", "https://www.theguardian.com/world/europe-news/rss"),
    ],
    "ABD & Kuzey Amerika": [
        ("Guardian US", "https://www.theguardian.com/us-news/rss"),
    ],
    "Orta Doğu": [
        ("Guardian Middle East", "https://www.theguardian.com/world/middleeast/rss"),
    ],
    "Tarifler": [
        ("Nefis Yemek Tarifleri", "https://www.nefisyemektarifleri.com/feed/"),
    ],
}


def scraper_sources():
    """scraper.py için düz {url, category_name} listesi üretir."""
    sources = []
    for category_name, feeds in FEED_CATALOG.items():
        for _name, url in feeds:
            sources.append({"url": url, "category_name": category_name})
    return sources
