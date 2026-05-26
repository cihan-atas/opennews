from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

# Veritabanı motorunu oluşturuyoruz
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Veritabanı oturumlarını oluşturacak sınıf
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Modellerin türetildiği temel sınıf
Base = declarative_base()