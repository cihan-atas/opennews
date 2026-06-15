from routers.categories import CATEGORY_TREE
import models


def seed_categories(db):
    """Hiyerarşik kategori ağacını idempotent şekilde seed eder.
    - Ana kategorileri (parent_id=None) oluşturur/garantiler.
    - Alt kategorileri oluşturur; mevcut (eski düz) kayıtları doğru ana kategoriye bağlar.
    Mevcut adlar korunur (silinmez), yalnızca eksikler eklenir ve parent ilişkisi düzeltilir.
    """
    # 1) Ana kategoriler
    parent_ids = {}
    for parent_name in CATEGORY_TREE.keys():
        cat = db.query(models.NewsCategory).filter_by(name=parent_name).first()
        if not cat:
            cat = models.NewsCategory(name=parent_name, parent_id=None)
            db.add(cat)
            db.flush()
        elif cat.parent_id is not None:
            cat.parent_id = None  # ana kategori olduğundan emin ol
        parent_ids[parent_name] = cat.id
    db.commit()

    # 2) Alt kategoriler
    for parent_name, children in CATEGORY_TREE.items():
        pid = parent_ids[parent_name]
        for child_name in children:
            child = db.query(models.NewsCategory).filter_by(name=child_name).first()
            if not child:
                db.add(models.NewsCategory(name=child_name, parent_id=pid))
            elif child.parent_id != pid:
                child.parent_id = pid  # eski düz kaydı doğru ana kategoriye bağla
    db.commit()
