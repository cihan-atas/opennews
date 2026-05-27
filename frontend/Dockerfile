# 1. Node.js motorunu Docker'ın içine alıyoruz
FROM node:20-alpine

# 2. Çalışma dizinini belirliyoruz
WORKDIR /app

# 3. GitHub Actions'tan gelen API URL'ini yakalayıp Vite build'ine aktarıyoruz
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# 4. Önce sadece paket listesini kopyalayıp kütüphaneleri indiriyoruz (Hız için)
COPY package*.json ./
RUN npm install

# 5. Geri kalan tüm frontend kodlarını kopyalıyoruz
COPY . .

# 6. Projeyi production modunda derle (dist klasörü hatasız oluşsun)
RUN npm run build

# 7. Statik dosyaları en hafif ve kararlı şekilde sunacak paketi küresel yüklüyoruz
RUN npm install -g sirv-cli

# 8. Cloud Run için standart portu açıyoruz
EXPOSE 8080

# 9. Derlenen dist klasörünü, Cloud Run'ın dayattığı portta doğrudan dünyaya açıyoruz
CMD ["sh", "-c", "sirv dist --port ${PORT:-8080} --host --single"]