"""
Sağlayıcı-bağımsız servis katmanı (Faz 2).

Backend kodu artık google.cloud / genai çağrılarını doğrudan yapmaz;
ai / embeddings / tts / storage modüllerindeki arayüzlerden geçer.
Sağlayıcı seçimi config.settings üzerinden (.env) yapılır; varsayılanlar GCP'dir.
"""
