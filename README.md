# CNVDetect

**Hedefli gen paneli sekanslama verisinden kopya sayısı değişikliği (CNV) tespiti ve sınıflandırması için sihirbaz akışlı analiz platformu.**

FASTQ dosyalarından başlayıp hizalama, iki bağımsız CNV çağırıcı (CNVkit + ExomeDepth), konsensüs ve ACMG tabanlı sınıflandırmaya (ClassifyCNV) kadar tüm süreci tek bir arayüzden yürütür. Eşleşmiş normal örnek gerektirmez. Arayüz Türkçe ve İngilizce destekler.

---

## İçindekiler

- [Özellikler](#özellikler)
- [Nasıl çalışır](#nasıl-çalışır)
- [Gereksinimler](#gereksinimler)
- [Kurulum](#kurulum)
- [Çalıştırma](#çalıştırma)
- [Kullanım](#kullanım)
- [Çıktılar](#çıktılar)
- [Yapılandırma](#yapılandırma)
- [Pipeline'ı komut satırından çalıştırma](#pipelineı-komut-satırından-çalıştırma)
- [Proje yapısı](#proje-yapısı)
- [Sorun giderme](#sorun-giderme)

---

## Özellikler

- **Panel / BED oluşturma**
  - Kurumsal panel (141 gen, 1929 hedef bölge, hg19)
  - Hazır klinik paneller ve gen adıyla özel panel; padding ayarlı otomatik BED üretimi (hg19 / hg38)
  - Kendi BED dosyanızı yükleme
- **Cinsiyet stratifikasyonu** — Erkek ve kadın örnekler ayrı analiz edilir (kadınlarda chrY, ortak analizde X/Y hariç). FASTQ klasöründen örnek adları otomatik algılanır.
- **Analiz yürütme**
  - FASTQ dosyalarını ve örnek sayısını gösteren klasör seçici
  - Canlı ilerleme takibi (adım adım, erkek/kadın ayrı)
  - Teknik log görünümü
  - Analizi güvenle durdurma (tüm alt süreçler sonlandırılır)
- **Konsensüs CNV çağrısı** — CNVkit (flat reference) ve ExomeDepth (kohort referansı) sonuçlarının kesişimi yüksek güvenli çağrı olarak raporlanır.
- **Otomatik sınıflandırma** — ClassifyCNV ile ACMG kriterlerine göre (Pathogenic / VUS / Benign …). Sonuçlar tek bir Excel raporunda birleştirilir.
- **Bulgular ekranı**
  - Filtrelenebilir / sıralanabilir tablo
  - Kromozom, sınıf ve örnek dağılımı grafikleri
  - TSV dışa aktarma ve not alanı

## Nasıl çalışır

```
┌──────────────┐   HTTP / WebSocket   ┌──────────────────┐   bash   ┌───────────────────────────────┐
│  Arayüz      │ ───────────────────▶ │  Backend         │ ───────▶ │  cnv_pipeline_last.sh         │
│  React+Vite  │ ◀─────────────────── │  FastAPI :8765   │          │  BWA → Picard → CNVkit        │
│  (Docker /   │   canlı log, durum   │  (WSL / Linux)   │          │        → ExomeDepth → Konsensüs│
│   Electron)  │                      └──────────────────┘          │  cnv_anotation.sh → ClassifyCNV│
└──────────────┘                                                    └───────────────────────────────┘
```

- **Backend** Linux (WSL) üzerinde çalışır; çünkü biyoinformatik araçlara ve FASTQ klasörlerine doğrudan erişmesi gerekir.
- **Arayüz** üç şekilde çalışabilir: Docker'daki nginx (web), Vite geliştirme sunucusu ya da Electron masaüstü uygulaması.

## Gereksinimler

| Bileşen | Not |
|---|---|
| Linux veya Windows + **WSL2** (Ubuntu) | Backend ve pipeline Linux'ta çalışır |
| **Python 3.10+** | Backend için |
| **conda** ortamı `cnv_pipeline` | İçinde: `bwa`, `samtools`, `picard`, `cnvkit`, `r-base` + Bioconductor `ExomeDepth`, `GenomicRanges` |
| **ClassifyCNV** | `tools/ClassifyCNV/` (veya `~/ClassifyCNV/`) altına kurulmalı |
| **Referans genom** | `reference/hg19.fasta` — BWA/samtools/Picard indeksleri yoksa ilk çalıştırmada otomatik oluşturulur |
| **Node.js 18+** | Sadece arayüzü geliştirmek veya Electron için |
| **Docker** | Sadece web arayüzünü Docker ile sunmak için |

> Referans genom ve indeksleri (~8 GB) ile `tools/` klasörü boyutları nedeniyle depoya dahil değildir.

## Kurulum

```bash
# 1. Depoyu klonlayın
git clone https://github.com/kadersaribulak/CNVDetect.git
cd CNVDetect

# 2. Pipeline araçları için conda ortamı
conda create -n cnv_pipeline -c bioconda -c conda-forge \
    bwa samtools picard cnvkit r-base bioconductor-exomedepth bioconductor-genomicranges
conda activate cnv_pipeline

# 3. Backend bağımlılıkları (aynı ortamda)
pip install -r backend/requirements.txt

# 4. Referans genom
mkdir -p reference
#   hg19.fasta dosyasını reference/ klasörüne koyun

# 5. ClassifyCNV
git clone https://github.com/Genotek/ClassifyCNV.git tools/ClassifyCNV
#   Kurulum ve kaynak dosyalar için ClassifyCNV'nin kendi README'sine bakın

# 6. (İsteğe bağlı) Tam gen koordinat veritabanını güncelleme
python3 backend/download_genes.py
```

Backend açılışta tüm yolları kontrol eder ve terminale `✓` / `✗` olarak yazar. Eksik bir bileşen varsa orada görünür.

## Çalıştırma

### Web (önerilen) — Backend WSL'de, arayüz Docker'da

```bash
# Terminal 1 — Backend
conda activate cnv_pipeline
cd backend
uvicorn main:app --host 0.0.0.0 --port 8765

# Terminal 2 — Arayüz
sudo docker compose up -d --build
```

Tarayıcıda **http://localhost:3001** adresini açın. nginx, API ve WebSocket isteklerini `host.docker.internal:8765` üzerinden backend'e yönlendirir.

> ⚠️ `--host 0.0.0.0` backend'i ağa açar. Sadece güvenilir bir ağda kullanın. Backend, istemcinin göndereceği script yollarını kabul etmez; çalıştırılan tüm scriptler `config.json`'dan okunur.

### Geliştirme modu (Vite + Electron)

```bash
# Terminal 1 — Backend
cd backend && uvicorn main:app --host 127.0.0.1 --port 8765

# Terminal 2 — Arayüz
npm install
npm run dev     # Vite (http://localhost:5173) + Electron penceresi
npm run web     # Sadece tarayıcı için Vite
```

Vite, `/api`, `/ws` ve `/health` isteklerini otomatik olarak `localhost:8765`'e yönlendirir.

### Masaüstü paketi (Electron)

```bash
npm run build   # dist-electron/ altına AppImage / dmg / nsis üretir
```

Paket backend'i ve pipeline'ı içerir; ancak hedef makinede Python, pipeline araçları, referans genom ve ClassifyCNV ayrıca kurulu olmalıdır.

## Kullanım

| Adım | Ne yapılır |
|---|---|
| **1. Panel Seçimi** | Genom sürümünü (hg19/hg38) seçin. Ardından kurumsal paneli kullanın, hazır bir klinik panel ekleyin, gen adı yazın veya BED yükleyin. Sağda BED önizlemesi görünür. |
| **2. Hasta Örnekleri** | İsteğe bağlı cinsiyet stratifikasyonu. Örnek adları FASTQ klasöründen otomatik gelir; her örnek için Erkek/Kadın seçin veya TSV içe aktarın. |
| **3. Analizi Başlat** | **FASTQ Klasörü** kutusuna tıklayıp FASTQ'ların bulunduğu klasörü seçin (dosya ve örnek sayısı gösterilir). Çıktı klasörü adını yazın, gerekirse thread sayısını ve "BAM dosyalarını sakla" seçeneğini ayarlayıp başlatın. Çıktı, FASTQ klasörüyle aynı üst klasöre yazılır. |
| **4. Bulgular** | `*_consensus_cnvs.tsv` ve `CNV_Final_Summary_Report.tsv` dosyalarını yükleyin. CNV'ler örnek + kromozom + başlangıç + tip ile sınıflandırmayla eşleştirilir. |

**FASTQ adlandırma:** `<ÖRNEK>_S<n>_L001_R1_001.fastq.gz` / `..._R2_001.fastq.gz` (Illumina standardı). Örnek adındaki `_S<n>` eki otomatik ayıklanır.

**Cinsiyet dosyası formatı** (sekmeyle ayrılmış, başlık satırı zorunlu):

```
Pool	Gender
R462-POOL-37	Male
R462-POOL-38	Female
```

## Çıktılar

```
<çıktı klasörü>/
├── Male/  Female/  All/                  # cinsiyet stratifikasyonu açıksa
│   ├── qc/                               # flagstat, samtools stats, hedef derinliği
│   ├── cnvkit/                           # .cnr, .cns, .call.cns, grafikler
│   ├── exomedepth/                       # örnek bazlı ExomeDepth sonuçları
│   ├── <önek>_consensus_cnvs.tsv         # iki araçla doğrulanmış (yüksek güven)
│   ├── <önek>_union_cnvs.tsv             # iki aracın tüm çağrıları
│   └── CNV_Final_Summary_Report.tsv      # ClassifyCNV sınıflandırması
├── <klasör>_CNV_Final_Report.xlsx        # tüm grupların birleşik Excel raporu
└── <klasör>_CNV_Final_Report.tsv
```

- **Filtreleme önerileri:**
  - ExomeDepth için `BF > 10`
  - CNVkit için `|log2| > 0.3`
  - En güvenilir sonuçlar konsensüs dosyasındakilerdir.
- BAM dosyaları, "BAM dosyalarını sakla" seçilmedikçe analiz sonunda silinir.

## Yapılandırma

Tüm yollar proje köküne göredir; mutlak yol da yazılabilir. Değişiklikten sonra backend'i yeniden başlatın. Ayarlar `config.json` dosyasındadır:

```json
{
  "ref":         "./reference/hg19.fasta",
  "pipeline":    "./pipeline/cnv_pipeline_last.sh",
  "anno":        "./backend/cnv_anotation.sh",
  "instBed":     "./backend/targets_merged.bed",
  "classifyCNV": "./tools/ClassifyCNV/ClassifyCNV.py"
}
```

## Pipeline'ı komut satırından çalıştırma

Arayüz olmadan da kullanılabilir:

```bash
bash pipeline/cnv_pipeline_last.sh \
    --input   /yol/FASTQ \
    --output  /yol/CNV_output \
    --prefix  kohort_A \
    --ref     reference/hg19.fasta \
    --bed     backend/targets_merged.bed \
    --genders genders.txt \
    --threads 8

bash backend/cnv_anotation.sh /yol/CNV_output/Male tools/ClassifyCNV/ClassifyCNV.py
```

Tüm seçenekler için: `bash pipeline/cnv_pipeline_last.sh --help`

## Proje yapısı

```
CNVDetect/
├── backend/
│   ├── main.py                 # FastAPI: BED üretimi, dosya yükleme, eşleştirme, pipeline WebSocket
│   ├── cnv_anotation.sh        # ClassifyCNV ile sınıflandırma
│   ├── download_genes.py       # UCSC refGene'den gen koordinat veritabanı
│   ├── genes_db.json           # hg19 / hg38 gen koordinatları
│   └── targets_merged.bed      # Kurumsal panel
├── pipeline/
│   └── cnv_pipeline_last.sh    # BWA → Picard → CNVkit + ExomeDepth → Konsensüs
├── src/                        # React arayüzü (sayfalar, bileşenler, TR/EN çeviriler)
├── electron/                   # Masaüstü kabuğu
├── config.json                 # Referans / script / araç yolları
├── Dockerfile, nginx.conf, docker-compose.yml   # Web arayüzü
└── reference/, tools/          # (depoda yok) referans genom ve ClassifyCNV
```

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Arayüzde "Backend servisi çalışmıyor" | Backend'in çalıştığını kontrol edin: `curl http://localhost:8765/health`. Docker kullanıyorsanız `--host 0.0.0.0` ile başlatın. |
| API istekleri `502` dönüyor (Docker) | Backend kapalı ya da sadece `127.0.0.1`'de dinliyor. |
| `Bind for 0.0.0.0:3001 failed: port is already allocated` | Eski bir container portu tutuyor: `sudo docker ps -a`. Eskisini kaldırın veya `docker-compose.yml`'de portu değiştirin. |
| Annotation sonuç üretmiyor | Backend açılış logunda `classifyCNV` satırının `✓` olduğunu kontrol edin. |
| `$'\r': command not found` | Script'lerin satır sonu CRLF olmuş. Depodaki `.gitattributes` bunu önler; elle düzeltmek için `sed -i 's/\r$//' dosya.sh`. |
| WSL / Docker diski hızla büyüyor | `sudo docker system df` ile kontrol edin. Derleme önbelleği `sudo docker builder prune` ile temizlenebilir. WSL'in `ext4.vhdx` dosyası içeride yer açılsa bile kendiliğinden küçülmez; `diskpart` → `compact vdisk` ile küçültülür. |
