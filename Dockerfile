# 1. Hafif bir Python imajı ile başlıyoruz
FROM python:3.11-slim

# 2. Python'ın logları anında ekrana basmasını sağlıyoruz (Buffer'ı kapatıyoruz)
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# 3. Çalışma dizinimizi oluşturuyoruz
WORKDIR /app

# 4. Sistem bağımlılıklarını yüklüyoruz (Eğer ilerde psycopg2 veya benzeri derleme gerektiren paketler gelirse diye)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 5. Sadece requirements.txt'yi kopyalayıp yüklüyoruz 
# (Bu sayede kod değişse bile docker cache burayı tekrar çalıştırmaz, hız kazanırız)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 6. Uygulamanın kalanını kopyalıyoruz
COPY . .

# 7. Güvenlik: Uygulamayı root olmayan bir kullanıcıyla çalıştıralım. 
# appuser sadece kendi uygulama klasörüne (/app) yazma ve okuma yetkisine sahiptir.
# Sistem dosyalarına dokunamaz, yeni paket yükleyemez, ağ ayarlarını değiştiremez.
# Saldırgan sızsa bile, o kullanıcının yetkileriyle hapsolur.
# .scraper_seen_urls.json dosyasını yazabilmesi için appuser'a izin veriyoruz.
RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app

# 8. GCP Cloud Run için standart port 8080'dir
EXPOSE 8080

# 9. Uygulamayı ayağa kaldırıyoruz
# --proxy-headers: Cloud Run/Load Balancer arkasında gerçek IP'leri görebilmek için kritik
CMD ["/bin/sh", "-c", "alembic upgrade heads & exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers"]