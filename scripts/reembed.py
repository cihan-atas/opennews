"""Tüm haberlerin embedding'ini yeniden hesaplar (tek seferlik bakım scripti).

Neden gerekli?
  EMBEDDING_PROVIDER=mock iken üretilen vektörler anlamsızdı; semantik arama ve
  "Benzer Haberler" çalışmıyordu. EMBEDDING_PROVIDER=local'a geçtikten sonra mevcut
  (mock) vektörler geçersiz kalır — bu script hepsini gerçek modelle yeniden üretir.

Kullanım:
  EMBEDDING_PROVIDER=local olduğundan emin olun (.env), sonra:
      python -m scripts.reembed              # tüm haberleri yeniden embed et
      python -m scripts.reembed --only-null  # yalnızca embedding'i olmayanları işle

Not: İlk çalıştırmada local model (~420 MB) indirilir; sonrasında cache'den gelir.
"""
import sys
import os

# Proje kökünü import yoluna ekle (script alt dizinden çalıştırılabilsin).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from database import SessionLocal
from utils import get_embedding
import models


def reembed(only_null: bool = False, batch_commit: int = 20) -> dict:
    if settings.EMBEDDING_PROVIDER == "mock":
        print("[reembed] UYARI: EMBEDDING_PROVIDER=mock — gerçek embedding üretilmeyecek. "
              ".env'de 'local' (veya openai/vertex) yapın.")
        return {"status": "skipped", "reason": "mock provider"}

    db = SessionLocal()
    try:
        query = db.query(models.News)
        if only_null:
            query = query.filter(models.News.embedding.is_(None))
        items = query.order_by(models.News.created_at.desc()).all()
        total = len(items)
        print(f"[reembed] {total} haber işlenecek (provider={settings.EMBEDDING_PROVIDER}, only_null={only_null}).")

        done = 0
        for news in items:
            try:
                text = f"{news.title}\n\n{news.content}"
                news.embedding = get_embedding(text, task_type="retrieval_document")
                done += 1
                if done % batch_commit == 0:
                    db.commit()
                    print(f"[reembed] {done}/{total} ...")
            except Exception as e:
                db.rollback()
                print(f"[reembed] Haber {news.id} işlenemedi: {e}")
                continue
        db.commit()
        print(f"[reembed] Bitti. {done}/{total} haber yeniden embed edildi.")
        return {"status": "success", "processed": done, "total": total}
    finally:
        db.close()


if __name__ == "__main__":
    only_null = "--only-null" in sys.argv
    reembed(only_null=only_null)
