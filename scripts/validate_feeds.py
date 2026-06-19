"""Aday RSS feed kataloğunu doğrular ve çalışanları JSON olarak çıkarır.

Kullanım:
    python -m scripts.validate_feeds            # tümünü doğrula, rapor + valid_feeds.json yaz
    python -m scripts.validate_feeds --quick    # her kategoriden ilk 1 feed (hızlı deneme)

Kategori adları routers.categories.CATEGORY_TREE ile birebir eşleşmeli.
"""
import sys
import json
import concurrent.futures as cf
from pathlib import Path

import requests
import feedparser

HEADERS = {"User-Agent": "Mozilla/5.0 (OpenNews FeedValidator)"}

# category_name -> [ (kaynak adı, feed url), ... ]
CANDIDATES = {
    # ── Ana çekirdek ────────────────────────────────────────────────
    "Teknoloji": [
        ("Webtekno", "https://www.webtekno.com/rss.xml"),
        ("ShiftDelete", "https://shiftdelete.net/feed"),
        ("Donanım Haber", "https://www.donanimhaber.com/rss/tum/"),
        ("Technopat", "https://www.technopat.net/feed/"),
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("TechCrunch", "https://techcrunch.com/feed/"),
        ("NTV Teknoloji", "https://www.ntv.com.tr/teknoloji.rss"),
    ],
    "Ekonomi": [
        ("NTV Ekonomi", "https://www.ntv.com.tr/ekonomi.rss"),
        ("AA Ekonomi", "https://www.aa.com.tr/tr/rss/default?cat=ekonomi"),
        ("Bloomberg HT", "https://www.bloomberght.com/rss"),
        ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
        ("Dünya Gazetesi", "https://www.dunya.com/rss"),
    ],
    "Spor": [
        ("Hürriyet Spor", "https://www.hurriyet.com.tr/rss/spor"),
        ("Sporx", "https://www.sporx.com/_xml/sporx_rss.xml"),
        ("Fotomaç", "https://www.fotomac.com.tr/rss/anasayfa.xml"),
        ("NTV Spor", "https://www.ntv.com.tr/spor.rss"),
        ("Guardian Sport", "https://www.theguardian.com/sport/rss"),
    ],
    "Siyaset": [
        ("AA Politika", "https://www.aa.com.tr/tr/rss/default?cat=politika"),
        ("BBC Türkçe", "https://feeds.bbci.co.uk/turkce/rss.xml"),
    ],
    "Sağlık": [
        ("NTV Sağlık", "https://www.ntv.com.tr/saglik.rss"),
        ("AA Sağlık", "https://www.aa.com.tr/tr/rss/default?cat=saglik"),
        ("Medical News Today", "https://www.medicalnewstoday.com/rss"),
        ("BBC Health", "https://feeds.bbci.co.uk/news/health/rss.xml"),
    ],
    "Kültür-Sanat": [
        ("Cumhuriyet Kültür-Sanat", "https://www.cumhuriyet.com.tr/rss/kultur-sanat"),
        ("AA Kültür", "https://www.aa.com.tr/tr/rss/default?cat=kultur"),
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
        ("Otomobil Haberleri", "https://www.arabalar.com.tr/rss"),
    ],
    "Oyun": [
        ("ShiftDelete Oyun", "https://shiftdelete.net/oyun/feed"),
        ("IGN", "https://feeds.ign.com/ign/all"),
        ("Polygon", "https://www.polygon.com/rss/index.xml"),
        ("Eurogamer", "https://www.eurogamer.net/feed"),
    ],
    "Magazin": [
        ("Hürriyet Magazin", "https://www.hurriyet.com.tr/rss/magazin"),
        ("Variety", "https://variety.com/feed/"),
    ],
    "Eğitim": [
        ("NTV Eğitim", "https://www.ntv.com.tr/egitim.rss"),
        ("AA Eğitim", "https://www.aa.com.tr/tr/rss/default?cat=egitim"),
    ],
    "Dünya": [
        ("NTV Dünya", "https://www.ntv.com.tr/dunya.rss"),
        ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World", "https://www.theguardian.com/world/rss"),
        ("AA Dünya", "https://www.aa.com.tr/tr/rss/default?cat=dunya"),
    ],
    "Türkiye": [
        ("NTV Türkiye", "https://www.ntv.com.tr/turkiye.rss"),
        ("AA Güncel", "https://www.aa.com.tr/tr/rss/default?cat=guncel"),
        ("TRT Gündem", "https://www.trthaber.com/gundem_articles.rss"),
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
        ("BBC Science Environment", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
    ],
    "İş & Kariyer": [
        ("Harvard Business Review", "https://hbr.org/feed"),
        ("Webrazzi", "https://webrazzi.com/feed/"),
    ],
    "Seyahat": [
        ("Guardian Travel", "https://www.theguardian.com/travel/rss"),
        ("Lonely Planet", "https://www.lonelyplanet.com/news/feed/atom/"),
    ],
    "Medya & Eğlence": [
        ("Hollywood Reporter", "https://www.hollywoodreporter.com/feed/"),
        ("Variety", "https://variety.com/feed/"),
    ],
    "Toplum": [
        ("Guardian Society", "https://www.theguardian.com/society/rss"),
    ],
    "Hukuk & Güvenlik": [
        ("AA Asayiş", "https://www.aa.com.tr/tr/rss/default?cat=guncel"),
    ],
    "Diğer": [
        ("NTV Yaşam", "https://www.ntv.com.tr/yasam.rss"),
    ],
    # ── Güçlü alt kategoriler ──────────────────────────────────────
    "Yapay Zeka": [
        ("VentureBeat AI", "https://venturebeat.com/category/ai/feed/"),
        ("MIT Tech Review", "https://www.technologyreview.com/feed/"),
        ("Google AI Blog", "https://blog.google/technology/ai/rss/"),
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
        ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
        ("Cointelegraph", "https://cointelegraph.com/rss"),
    ],
    "Sosyal Medya": [
        ("TechCrunch Social", "https://techcrunch.com/category/social/feed/"),
    ],
    "Robotik": [
        ("IEEE Spectrum Robotics", "https://spectrum.ieee.org/feeds/topic/robotics.rss"),
    ],
    "Borsa & Hisse": [
        ("Bloomberg HT Borsa", "https://www.bloomberght.com/rss"),
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
        ("Fanatik Futbol", "https://www.fanatik.com.tr/rss/futbol"),
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
        ("NASA Breaking News", "https://www.nasa.gov/news-release/feed/"),
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
        ("Healthline Nutrition", "https://www.healthline.com/nutrition/feed"),
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


def check(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        if r.status_code != 200:
            return (False, f"HTTP {r.status_code}", 0)
        d = feedparser.parse(r.content)
        n = len(d.entries)
        if n >= 3:
            return (True, "ok", n)
        return (False, "az/boş öğe", n)
    except Exception as e:
        return (False, type(e).__name__, 0)


def main():
    quick = "--quick" in sys.argv
    tasks = []
    for cat, feeds in CANDIDATES.items():
        for name, url in (feeds[:1] if quick else feeds):
            tasks.append((cat, name, url))

    results = {}
    valid = {}
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(check, url): (cat, name, url) for cat, name, url in tasks}
        for fut in cf.as_completed(futs):
            cat, name, url = futs[fut]
            ok, msg, n = fut.result()
            results.setdefault(cat, []).append((ok, name, url, msg, n))
            if ok:
                valid.setdefault(cat, []).append({"name": name, "url": url, "entries": n})

    total = ok_count = 0
    for cat in CANDIDATES:
        rows = results.get(cat, [])
        for ok, name, url, msg, n in sorted(rows, key=lambda x: not x[0]):
            total += 1
            ok_count += 1 if ok else 0
            flag = "✅" if ok else "❌"
            print(f"{flag} [{cat}] {name} ({n}) {msg if not ok else ''}  {url}")

    out = Path(__file__).parent.parent / "valid_feeds.json"
    out.write_text(json.dumps(valid, ensure_ascii=False, indent=2))
    cats_with = len(valid)
    print(f"\n— {ok_count}/{total} feed çalışıyor | {cats_with}/{len(CANDIDATES)} kategoride en az 1 geçerli feed")
    print(f"— Geçerli katalog: {out}")


if __name__ == "__main__":
    main()
