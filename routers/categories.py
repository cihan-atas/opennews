from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
import models, schemas
from dependencies import db_dependency, user_dependency

router = APIRouter(
    prefix="/categories",
    tags=["Categories"]
)

# Hiyerarşik kategori kataloğu — ANA KATEGORİ -> [ALT KATEGORİLER].
# Hem akış (ilgi alanı) tercihleri hem topluluk RSS kategorileri bu ağaçtan seed edilir
# (seed_data.seed_categories açılışta eksikleri ekler, mevcutları doğru parent'a bağlar).
# NOT: Ana kategori adları scraper.RSS_SOURCES ile eşleştiği için korunur (silinmez/yeniden adlandırılmaz).
CATEGORY_TREE = {
    "Teknoloji": [
        "Yapay Zeka", "Makine Öğrenmesi", "Siber Güvenlik", "Yazılım & Geliştirme",
        "Web Geliştirme", "Mobil & Uygulamalar", "Donanım & Gadget", "Akıllı Telefonlar",
        "Bilgisayarlar", "Kripto & Blockchain", "Artırılmış & Sanal Gerçeklik (AR/VR)",
        "Nesnelerin İnterneti (IoT)", "Bulut & Veri Merkezi", "Sosyal Medya", "Robotik", "Açık Kaynak",
    ],
    "Ekonomi": [
        "Borsa & Hisse", "Kripto Para", "Finans & Bankacılık", "Merkez Bankaları",
        "Enflasyon & Faiz", "Döviz & Altın", "Emlak & Konut", "Girişimcilik & Startup",
        "Şirket Haberleri", "Vergi & Maliye", "Enerji Ekonomisi", "İstihdam & İşsizlik", "Ticaret & İhracat",
    ],
    "Spor": [
        "Futbol", "Basketbol", "Voleybol", "Tenis", "Formula 1", "MotoGP", "Atletizm",
        "Yüzme", "Boks & MMA", "Güreş", "E-Spor", "Olimpiyatlar", "Bisiklet", "Golf", "Kış Sporları",
    ],
    "Siyaset": [
        "İç Politika", "Dış Politika", "Seçimler", "Parlamento", "Diplomasi",
        "Yerel Yönetimler", "Siyasi Partiler",
    ],
    "Sağlık": [
        "Beslenme & Diyet", "Fitness & Egzersiz", "Mental Sağlık", "Hastalıklar",
        "İlaç & Tedavi", "Salgın & Aşı", "Kadın Sağlığı", "Çocuk Sağlığı",
        "Alternatif Tıp", "Uyku & Dinlenme",
    ],
    "Kültür-Sanat": [
        "Sinema & Dizi", "Müzik", "Tiyatro", "Kitap & Edebiyat", "Resim & Heykel",
        "Fotoğrafçılık", "Müzeler & Sergiler", "Dans", "Mimari", "Sokak Sanatı",
    ],
    "Bilim": [
        "Uzay & Astronomi", "Fizik", "Kimya", "Biyoloji", "Genetik", "Paleontoloji",
        "Çevre Bilimi", "Matematik", "Nörobilim", "Arkeoloji",
    ],
    "Otomobil": [
        "Elektrikli Araçlar", "Otonom Araçlar", "SUV & Arazi", "Spor Otomobiller",
        "Motosiklet", "Klasik Araçlar", "Otomotiv Teknolojisi", "Yeni Model Tanıtımları",
    ],
    "Oyun": [
        "PC Oyunları", "Konsol Oyunları", "Mobil Oyunlar", "Bağımsız Oyunlar (Indie)",
        "Oyun Donanımı", "E-Spor Turnuvaları", "Oyun İncelemeleri", "Retro Oyunlar",
    ],
    "Magazin": [
        "Ünlüler", "Diziler & Realiteler", "Moda & Güzellik", "Kraliyet & Aristokrasi",
        "Sosyal Medya Fenomenleri", "Aşk & İlişkiler",
    ],
    "Eğitim": [
        "Üniversite & YÖK", "Sınavlar (YKS/LGS)", "Online Eğitim", "Burslar",
        "Yurt Dışı Eğitim", "Dil Öğrenimi", "Mesleki Eğitim", "Okul Öncesi",
    ],
    "Dünya": [
        "Avrupa", "ABD & Kuzey Amerika", "Orta Doğu", "Asya & Pasifik", "Afrika",
        "Latin Amerika", "Birleşmiş Milletler", "Göç & Mülteciler", "Savaş & Çatışmalar",
    ],
    "Türkiye": [
        "Gündem", "Asayiş", "Belediyeler", "Türkiye Ekonomisi", "Türkiye Eğitim",
        "Hava Durumu", "Deprem & Afet",
    ],
    "Gastronomi": [
        "Tarifler", "Restoran & Mekan", "Dünya Mutfakları", "Tatlılar",
        "İçecekler & Kahve", "Şarap & Bira", "Vegan & Vejetaryen", "Sokak Lezzetleri",
    ],
    "Yaşam & Stil": [
        "Moda", "Güzellik & Bakım", "Dekorasyon & Ev", "Minimalizm", "Kişisel Gelişim",
        "Psikoloji", "İlişkiler", "Ebeveynlik", "Evcil Hayvanlar", "Düğün & Organizasyon",
    ],
    "Çevre & Doğa": [
        "İklim Değişikliği", "Yenilenebilir Enerji", "Geri Dönüşüm", "Sürdürülebilirlik",
        "Vahşi Yaşam", "Ormanlar", "Okyanuslar", "Doğal Afetler",
    ],
    "İş & Kariyer": [
        "Kariyer Tavsiyeleri", "İş İlanları & İK", "Uzaktan Çalışma", "Liderlik & Yönetim",
        "Freelance", "Networking", "KOBİ'ler",
    ],
    "Seyahat": [
        "Yurt İçi Geziler", "Yurt Dışı Geziler", "Bütçe Seyahati", "Lüks Seyahat",
        "Kamp & Doğa", "Gezi Rehberleri", "Havayolu & Uçuş", "Otel & Konaklama",
    ],
    "Medya & Eğlence": [
        "Yayıncılık (Streaming)", "Podcast'ler", "YouTube & İçerik Üreticileri",
        "Animasyon & Çizgi Roman", "Stand-up & Komedi", "Festivaller",
    ],
    "Toplum": [
        "İnsan Hakları", "Kadın Hakları", "Gönüllülük & STK", "Din & İnanç",
        "Nüfus & Demografi", "Şehircilik", "Engelli Hakları",
    ],
    "Hukuk & Güvenlik": [
        "Adliye & Davalar", "Suç & Asayiş", "Siber Suçlar", "Trafik",
        "İtfaiye & Acil Durum", "Savunma Sanayi", "İstihbarat",
    ],
    "Diğer": [
        "İlginç Haberler", "Burç & Astroloji", "Hobi & El İşi", "Bahçecilik",
    ],
}

# Geriye dönük uyumluluk: düz isim listesi (ana + tüm alt kategoriler).
CATEGORIES_LIST = list(CATEGORY_TREE.keys()) + [
    child for children in CATEGORY_TREE.values() for child in children
]

@router.get("/", response_model=List[schemas.CategoryOut])
def get_categories(db: db_dependency):
    """
    ### BURAK (Frontend):
    - **Senaryo:** Kullanıcı ilk kayıt olduğunda veya profilinde ilgi alanı seçerken bu listeyi çağır.
    - **Katalog:** Tüm kategorileri (ana + alt) ID ve `parent_id` ile birlikte döner.
      `parent_id` NULL olanlar ana kategori, dolu olanlar o ananın alt kategorisidir.
    - **Kullanım:** Buradan gelen ID'leri, `POST /users/interests` endpoint'ine bir liste olarak göndereceksin.
    """
    return db.query(models.NewsCategory).order_by(models.NewsCategory.id).all()


@router.post("/", response_model=schemas.CategoryOut, status_code=201)
def create_category(body: schemas.CategoryCreate, db: db_dependency, current_user: user_dependency):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Yalnızca adminler kategori oluşturabilir.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Kategori adı boş olamaz.")
    if body.parent_id is not None:
        parent = db.query(models.NewsCategory).filter(models.NewsCategory.id == body.parent_id).first()
        if not parent:
            raise HTTPException(status_code=422, detail="Geçersiz ana kategori.")
    exists = db.query(models.NewsCategory).filter(models.NewsCategory.name == name).first()
    if exists:
        raise HTTPException(status_code=409, detail="Bu kategori zaten mevcut.")
    cat = models.NewsCategory(name=name, parent_id=body.parent_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat