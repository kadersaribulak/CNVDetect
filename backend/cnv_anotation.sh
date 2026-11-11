#!/bin/bash

CLASSIFY_PY_PATH="$HOME/ClassifyCNV/ClassifyCNV.py"
GENOME_BUILD="hg19"

if [ -z "$1" ]; then
    echo "Kullanim: ./cnv_annotation.sh /dosyalarin/oldugu/dizin"
    exit 1
fi

# Windows path uyumluluğu için cd ile absolute path al
cd "$1" || { echo "HATA: Dizine girilemedi: $1"; exit 1; }
INPUT_DIR=$(pwd)
cd - > /dev/null

SUMMARY_FILE="${INPUT_DIR}/CNV_Final_Summary_Report.tsv"

echo -e "Source\tPool_ID\tChr\tStart\tEnd\tType\tCN\tClassification\tScore\tGenes" > "$SUMMARY_FILE"

for TSV_FILE in "${INPUT_DIR}"/*consensus_cnvs*.tsv; do
    [[ "$TSV_FILE" == *"CNV_Final_Summary_Report"* ]] && continue
    [ -e "$TSV_FILE" ] || continue

    BASE_NAME=$(basename "$TSV_FILE" .tsv)
    echo "----------------------------------------------------------"
    echo "DOSYA ISLENIYOR: $BASE_NAME"

    BED_FILE="${INPUT_DIR}/${BASE_NAME}_ready.bed"
    MAP_FILE="${INPUT_DIR}/${BASE_NAME}_map.tsv"

    rm -f "$BED_FILE" "$MAP_FILE"

    awk -F'\t' '
    NR==1 { next }
    {
        sample = $1
        chrom = $2
        if (chrom !~ /^chr/) chrom = "chr" chrom
        start_val = sprintf("%.0f", $3)
        end_val   = sprintf("%.0f", $4)
        type      = $5
        cn        = $6
        variant_id = chrom "_" start_val "_" end_val "_" type
        print chrom "\t" start_val "\t" end_val "\t" type >> "'"$BED_FILE"'"
        print variant_id "\t" sample "\t" cn >> "'"$MAP_FILE"'"
    }' "$TSV_FILE"

    OUTPUT_FOLDER="${INPUT_DIR}/Results_${BASE_NAME}"
    rm -rf "$OUTPUT_FOLDER"

    python3 "$CLASSIFY_PY_PATH" \
        --infile "$BED_FILE" \
        --GenomeBuild "$GENOME_BUILD" \
        --outdir "$OUTPUT_FOLDER"

    SCORE_FILE=$(find "$OUTPUT_FOLDER" \( -name "Scoresheet.txt" -o -name "*.Scores" \) 2>/dev/null | head -n 1)

    if [ -n "$SCORE_FILE" ] && [ -f "$SCORE_FILE" ]; then
        awk -F'\t' '
        BEGIN {
            while ((getline < "'"$MAP_FILE"'") > 0) {
                sample_map[$1] = $2
                cn_map[$1] = $3
            }
        }
        NR > 1 {
            variant_id = $1
            pool_info = (variant_id in sample_map ? sample_map[variant_id] : "NA")
            cn_value  = (variant_id in cn_map ? cn_map[variant_id] : "NA")
            print "'"$BASE_NAME"'" "\t" pool_info "\t" $2 "\t" $3 "\t" $4 "\t" $5 "\t" cn_value "\t" $6 "\t" $7 "\t" $NF
        }' "$SCORE_FILE" >> "$SUMMARY_FILE"

        echo "-> $BASE_NAME basariyla islendi."
    else
        echo "!! HATA: Sonuc dosyasi bulunamadi."
    fi

    # Ara dosyalari temizle
    rm -f "$BED_FILE" "$MAP_FILE"
    rm -rf "$OUTPUT_FOLDER"
done

echo "----------------------------------------------------------"
echo "BITTI! Sonuclar: $SUMMARY_FILE"