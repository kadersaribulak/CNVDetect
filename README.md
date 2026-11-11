# CNVDetect v2

Sihirbaz akışlı genomik CNV analiz platformu. TR/EN dil desteği.

## Masaüstü (Electron)

```bash
# Terminal 1 — Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --port 8765 --host 127.0.0.1

# Terminal 2 — Electron
npm install && npm run dev
```

## Web (Docker)

```bash
sudo docker compose up --build
# → http://localhost:3000
```

## Akış

1. **Panel Seçimi** — Hazır klinik panel veya özel gen listesi → BED oluştur
2. **Hasta Örnekleri** — Cinsiyet stratifikasyonu (isteğe bağlı)
3. **Analiz Başlat** — FASTQ ve çıktı klasörü seç
4. **Bulgular** — Sonuç dosyası yükle, tablo ve grafikler
