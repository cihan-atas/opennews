from routers.categories import CATEGORIES_LIST
import models

def seed_categories(db):
    for cat_name in CATEGORIES_LIST:
        exists = db.query(models.NewsCategory).filter_by(name=cat_name).first()
        if not exists:
            db.add(models.NewsCategory(name=cat_name))
    db.commit()