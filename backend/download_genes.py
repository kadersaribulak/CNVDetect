#!/usr/bin/env python3
"""
CNVDetect — Gen Koordinat Veritabanı İndirici
Kullanım: python3 download_genes.py
Kaynak: UCSC FTP refGene.txt.gz (hg19 ve hg38)
"""

import json, sys, time, os, pathlib, gzip, io, urllib.request
from collections import defaultdict

OUTPUT_FILE = pathlib.Path(__file__).parent / "genes_db.json"

def fetch_refgene_ftp(build, retries=3):
    url = f"https://hgdownload.soe.ucsc.edu/goldenPath/{build}/database/refGene.txt.gz"
    print(f"  [{build}] İndiriliyor: {url}")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CNVDetect/2.0"})
            with urllib.request.urlopen(req, timeout=180) as response:
                raw = response.read()
            print(f"  [{build}] {len(raw)/1024/1024:.1f} MB alındı, işleniyor...")
            genes = defaultdict(lambda: {"chr": "", "start": float("inf"), "end": 0})
            with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8", errors="replace") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) < 6:
                        continue
                    try:
                        chrom    = parts[2].strip()
                        tx_start = int(parts[4])
                        tx_end   = int(parts[5])
                        name2    = parts[12].strip() if len(parts) > 12 else parts[1].strip()
                    except (ValueError, IndexError):
                        continue
                    if not name2 or "_" in chrom or "random" in chrom.lower() or "Un" in chrom:
                        continue
                    g = genes[name2]
                    if not g["chr"]:
                        g["chr"] = chrom
                    if g["chr"] == chrom:
                        g["start"] = min(g["start"], tx_start)
                        g["end"]   = max(g["end"],   tx_end)
            result = {}
            for gene, c in genes.items():
                if c["start"] != float("inf") and c["end"] > c["start"]:
                    result[gene] = [c["chr"], int(c["start"]), int(c["end"])]
            print(f"  [{build}] {len(result)} benzersiz gen")
            return result
        except Exception as e:
            print(f"  [{build}] Deneme {attempt} hata: {e}")
            if attempt < retries:
                time.sleep(5)
    return {}

def main():
    print("=" * 55)
    print("CNVDetect — Gen Koordinat Veritabanı İndirici")
    print("=" * 55)
    db = {}
    for build in ["hg19", "hg38"]:
        print(f"\n► {build} indiriliyor...")
        db[build] = fetch_refgene_ftp(build)
    total = sum(len(v) for v in db.values())
    if total == 0:
        print("\n✗ Veri indirilemedi.")
        sys.exit(1)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, separators=(",", ":"))
    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"\n✓ Tamamlandı! hg19: {len(db['hg19'])}, hg38: {len(db['hg38'])} gen")
    print(f"  Dosya: {OUTPUT_FILE} ({size_mb:.1f} MB)")
    print("\nŞimdi çalıştırın: sudo docker compose up --build")

if __name__ == "__main__":
    main()
