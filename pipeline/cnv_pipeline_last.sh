#!/bin/bash
###############################################################################
# CNV Analysis Pipeline — Targeted Panel Sequencing (No Reference Normals)
#
# Tools : BWA-MEM, samtools, picard, CNVkit, ExomeDepth (R)
# Input : Paired-end FASTQ files from a targeted gene panel
# Ref   : hg19 (or any BWA-indexed reference)
#
# Usage : bash cnv_pipeline.sh --input <FASTQ_DIR> --output <OUT_DIR> \
#                              --prefix <PREFIX> --ref <REF.fa> --bed <TARGETS.bed>
#         bash cnv_pipeline.sh --input <FASTQ_DIR> --output <OUT_DIR> \
#                              --prefix <PREFIX> --ref <REF.fa> --bed <TARGETS.bed> \
#                              --genders genders.txt
###############################################################################

set -euo pipefail

#=============================================================================
# USAGE / HELP
#=============================================================================

VERSION="2.0.0"

usage() {
    cat <<EOF

$(tput bold)cnv_pipeline.sh v${VERSION}$(tput sgr0)
CNV analysis pipeline for targeted panel sequencing (no matched normals).
Runs CNVkit (flat reference) + ExomeDepth (cohort reference) and produces
a consensus callset. Optionally stratifies analysis by sex using a genders
file, running the full pipeline independently for each group.

$(tput bold)USAGE$(tput sgr0)
    bash cnv_pipeline.sh [OPTIONS]

$(tput bold)REQUIRED OPTIONS$(tput sgr0)
    -i, --input   DIR    Directory containing paired-end FASTQ files.
                         Files must follow the naming convention:
                         <SAMPLE>_L001_R1_001.fastq.gz / _R2_001.fastq.gz

    -o, --output  DIR    Output directory (created if it does not exist).

    -p, --prefix  STR    Prefix for all output files (e.g. "cohort_A",
                         "run20250225"). Applied to CNVkit summaries,
                         ExomeDepth results, and consensus calls.

    -r, --ref     FILE   Reference genome FASTA (hg19/hg38, BWA-indexed).
                         If BWA/samtools/Picard indices are missing they will
                         be built automatically.

    -b, --bed     FILE   Target regions BED file for the panel
                         (0-based, provided by panel manufacturer).

$(tput bold)OPTIONAL OPTIONS$(tput sgr0)
    -g, --genders FILE   Tab-separated file mapping sample IDs to sex.
                         Header line required. Format:
                           Pool<TAB>Gender
                           R449-POOL-49<TAB>Male
                           R449-POOL-50<TAB>Female
                         When provided the pipeline runs separately for each
                         gender group, producing independent output subtrees:
                           <output>/Male/   and   <output>/Female/
                         Gender values are case-insensitive (male/Male/MALE).
                         Samples absent from the genders file are skipped with
                         a warning. Gender groups with zero samples are skipped.

    -t, --threads  INT   Number of CPU threads to use. (default: 5)

    -k, --keep-bams      Keep deduplicated BAM files after the pipeline
                         finishes. By default BAMs are removed once
                         CNVkit and ExomeDepth have completed to save
                         disk space.

    -h, --help           Show this help message and exit.
    -v, --version        Show version and exit.

$(tput bold)EXAMPLES$(tput sgr0)
    # Run without gender stratification
    bash cnv_pipeline.sh \\
        --input  /data/fastq/cohort_A \\
        --output /results/cohort_A \\
        --prefix cohort_A \\
        --ref    /ref/hg19.fasta \\
        --bed    /panels/panel_targets.bed

    # Run with gender stratification
    bash cnv_pipeline.sh \\
        --input   /data/fastq/cohort_A \\
        --output  /results/cohort_A \\
        --prefix  cohort_A \\
        --ref     /ref/hg19.fasta \\
        --bed     /panels/panel_targets.bed \\
        --genders /data/genders.txt

    # With custom thread count and keep BAMs
    bash cnv_pipeline.sh \\
        --input   /data/fastq/cohort_A \\
        --output  /results/cohort_A \\
        --prefix  cohort_A \\
        --ref     /ref/hg19.fasta \\
        --bed     /panels/panel_targets.bed \\
        --genders /data/genders.txt \\
        --threads 12 \\
        --keep-bams

$(tput bold)OUTPUT STRUCTURE (without --genders)$(tput sgr0)
    <output>/
    ├── bams/                          Removed on completion (unless --keep-bams)
    ├── qc/                            flagstat, samtools stats, on-target depth
    ├── cnvkit/                        CNVkit .cnr, .cns, .call.cns, plots
    ├── exomedepth/                    ExomeDepth per-sample TSVs
    ├── <prefix>_consensus_cnvs.tsv    HIGH-confidence calls (both tools agree)
    ├── <prefix>_union_cnvs.tsv        All calls from both tools
    └── logs/

$(tput bold)OUTPUT STRUCTURE (with --genders)$(tput sgr0)
    <output>/
    ├── Male/
    │   ├── bams/
    │   ├── qc/
    │   ├── cnvkit/
    │   ├── exomedepth/
    │   ├── <prefix>_Male_consensus_cnvs.tsv
    │   ├── <prefix>_Male_union_cnvs.tsv
    │   └── logs/
    ├── Female/                        chrY excluded
    │   └── ... (same structure)
    ├── All/                           All samples, autosomal targets only
    │   ├── bams/                      (symlinks to Male + Female BAMs)
    │   ├── cnvkit/
    │   ├── exomedepth/
    │   ├── <prefix>_All_consensus_cnvs.tsv
    │   ├── <prefix>_All_union_cnvs.tsv
    │   └── logs/
    ├── targets_no_chrY.bed             Auto-generated (chrY removed)
    ├── targets_autosomal.bed          Auto-generated (chrX/Y removed)
    └── logs/                          Top-level pipeline log

$(tput bold)FILTERING TIPS$(tput sgr0)
    ExomeDepth : BF > 10 for confident calls
    CNVkit     : |log2| > 0.3 for meaningful copy-number changes
    Consensus  : most reliable — confirmed by both callers

EOF
}

#=============================================================================
# ARGUMENT PARSING
#=============================================================================

# Defaults
THREADS=5
KEEP_BAMS=false
FASTQ_DIR=""
OUTDIR=""
PREFIX=""
REF=""
TARGET_BED=""
GENDERS_FILE=""

# Require GNU getopt (long option support)
# GNU getopt signals enhanced mode by returning exit code 4 from --test
getopt --test > /dev/null 2>&1 || GETOPT_STATUS=$?
if [[ "${GETOPT_STATUS:-0}" -ne 4 ]]; then
    echo "ERROR: GNU getopt (enhanced version) is required." >&2
    echo "  Ubuntu/Debian : sudo apt-get install util-linux" >&2
    echo "  macOS         : brew install gnu-getopt" >&2
    echo "  Then add to PATH: export PATH=\"/usr/local/opt/gnu-getopt/bin:\$PATH\"" >&2
    exit 1
fi

PARSED=$(getopt \
    --options i:o:p:r:b:g:t:khv \
    --longoptions input:,output:,prefix:,ref:,bed:,genders:,threads:,keep-bams,help,version \
    --name "$0" -- "$@") || { usage; exit 1; }

eval set -- "${PARSED}"

while true; do
    case "$1" in
        -i|--input)     FASTQ_DIR="$2";    shift 2 ;;
        -o|--output)    OUTDIR="$2";       shift 2 ;;
        -p|--prefix)    PREFIX="$2";       shift 2 ;;
        -r|--ref)       REF="$2";          shift 2 ;;
        -b|--bed)       TARGET_BED="$2";   shift 2 ;;
        -g|--genders)   GENDERS_FILE="$2"; shift 2 ;;
        -t|--threads)   THREADS="$2";      shift 2 ;;
        -k|--keep-bams) KEEP_BAMS=true;    shift ;;
        -h|--help)      usage; exit 0 ;;
        -v|--version)   echo "cnv_pipeline.sh v${VERSION}"; exit 0 ;;
        --)             shift; break ;;
        *)              echo "ERROR: Unexpected argument: $1" >&2; usage; exit 1 ;;
    esac
done

#=============================================================================
# VALIDATE REQUIRED ARGUMENTS
#=============================================================================

ERRORS=0

check_required() {
    local val="$1" flag="$2"
    if [[ -z "${val}" ]]; then
        echo "ERROR: ${flag} is required." >&2
        ERRORS=$(( ERRORS + 1 ))
    fi
}

check_required "${FASTQ_DIR}"  "--input"
check_required "${OUTDIR}"     "--output"
check_required "${PREFIX}"     "--prefix"
check_required "${REF}"        "--ref"
check_required "${TARGET_BED}" "--bed"

if [[ "${ERRORS}" -gt 0 ]]; then
    echo "" >&2
    echo "Run with --help for usage information." >&2
    exit 1
fi

if [[ ! -d "${FASTQ_DIR}" ]]; then
    echo "ERROR: Input directory not found: ${FASTQ_DIR}" >&2; exit 1
fi
if [[ ! -f "${REF}" ]]; then
    echo "ERROR: Reference FASTA not found: ${REF}" >&2; exit 1
fi
if [[ ! -f "${TARGET_BED}" ]]; then
    echo "ERROR: Target BED file not found: ${TARGET_BED}" >&2; exit 1
fi
if [[ -n "${GENDERS_FILE}" && ! -f "${GENDERS_FILE}" ]]; then
    echo "ERROR: Genders file not found: ${GENDERS_FILE}" >&2; exit 1
fi
if ! [[ "${THREADS}" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: --threads must be a positive integer (got: ${THREADS})" >&2; exit 1
fi

#=============================================================================
# TOP-LEVEL SETUP
#=============================================================================

mkdir -p "${OUTDIR}"
TOP_LOG_DIR="${OUTDIR}/logs"
mkdir -p "${TOP_LOG_DIR}"

# Global log function — always writes to the top-level log,
# and also to the per-run log if RUN_LOG_DIR is set
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "${msg}" | tee -a "${TOP_LOG_DIR}/pipeline.log"
    if [[ -n "${RUN_LOG_DIR:-}" && "${RUN_LOG_DIR}" != "${TOP_LOG_DIR}" ]]; then
        echo "${msg}" >> "${RUN_LOG_DIR}/pipeline.log"
    fi
}

# Per-run log dir (set inside run_pipeline, unset at top level)
RUN_LOG_DIR=""

check_tool() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: $1 not found. Please install it and ensure it is on PATH." >&2
        exit 1
    fi
}

log "============================================================"
log " CNV Pipeline v${VERSION}"
log "============================================================"
log " Input FASTQ dir : ${FASTQ_DIR}"
log " Output dir      : ${OUTDIR}"
log " Prefix          : ${PREFIX}"
log " Reference       : ${REF}"
log " Target BED      : ${TARGET_BED}"
log " Genders file    : ${GENDERS_FILE:-none}"
log " Threads         : ${THREADS}"
log " Keep BAMs       : ${KEEP_BAMS}"
log "============================================================"

#=============================================================================
# STEP 0: DEPENDENCY CHECKS (runs once regardless of gender mode)
#=============================================================================

log "Checking dependencies..."
check_tool bwa
check_tool samtools
check_tool picard
check_tool cnvkit.py
check_tool Rscript

if [[ ! -f "${REF}.bwt" ]]; then
    log "BWA index not found — indexing reference genome..."
    bwa index "${REF}" 2>&1 | tee -a "${TOP_LOG_DIR}/bwa_index.log"
fi

if [[ ! -f "${REF}.fai" ]]; then
    log "FASTA index not found — indexing..."
    samtools faidx "${REF}"
fi

DICT="${REF%.fasta}.dict"
if [[ ! -f "${DICT}" ]]; then
    DICT="${REF%.fa}.dict"
    if [[ ! -f "${DICT}" ]]; then
        log "Sequence dictionary not found — creating..."
        picard CreateSequenceDictionary \
            R="${REF}" \
            O="${REF%.fasta}.dict" \
            2>&1 | tee -a "${TOP_LOG_DIR}/dict.log"
    fi
fi

#=============================================================================
# GENDER PARSING
# Populates two associative arrays: GENDER_MAP[pool_id]=gender
# and two indexed arrays: MALE_POOLS[], FEMALE_POOLS[]
#=============================================================================

declare -A GENDER_MAP
MALE_POOLS=()
FEMALE_POOLS=()
DEFERRED_BAM_DIRS=()

parse_genders() {
    local file="$1"
    local line pool gender
    local line_num=0

    log "Parsing genders file: ${file}"

    while IFS=$'\t' read -r pool gender; do
        line_num=$(( line_num + 1 ))
        # Skip header line
        [[ "${line_num}" -eq 1 ]] && continue
        # Strip Windows carriage returns and trailing whitespace
        pool="${pool//$'\r'/}"; pool="${pool%% }"
        gender="${gender//$'\r'/}"; gender="${gender%% }"
        # Skip blank lines
        [[ -z "${pool}" ]] && continue

        # Normalise to title case (Male/Female)
        gender="$(echo "${gender}" | tr '[:upper:]' '[:lower:]')"
        case "${gender}" in
            male)   gender="Male"   ;;
            female) gender="Female" ;;
            *)
                log "WARNING: Unrecognised gender '${gender}' for ${pool} — skipping."
                continue
                ;;
        esac

        GENDER_MAP["${pool}"]="${gender}"

        if [[ "${gender}" == "Male" ]]; then
            MALE_POOLS+=("${pool}")
        else
            FEMALE_POOLS+=("${pool}")
        fi
    done < "${file}"

    log "  Male samples   : ${#MALE_POOLS[@]}"
    log "  Female samples : ${#FEMALE_POOLS[@]}"
}

#=============================================================================
# FASTQ PARTITIONING
# Creates a temp directory of symlinks for a given list of pool IDs.
# Usage: partition_fastqs <tmp_dir> <pool_id1> [pool_id2 ...]
#=============================================================================

partition_fastqs() {
    local tmp_dir="$1"
    shift
    local pools=("$@")
    local matched=0 unmatched=0

    mkdir -p "${tmp_dir}"

    for pool in "${pools[@]}"; do
        # Find all FASTQs whose basename starts with <pool>_
        local found=false
        for fq in "${FASTQ_DIR}/${pool}_"*.fastq.gz; do
            if [[ -f "${fq}" ]]; then
                ln -sf "${fq}" "${tmp_dir}/$(basename "${fq}")"
                found=true
            fi
        done

        if [[ "${found}" == true ]]; then
            matched=$(( matched + 1 ))
        else
            log "WARNING: No FASTQ files found for pool ${pool} — skipping."
            unmatched=$(( unmatched + 1 ))
        fi
    done

    log "  Partitioned ${matched} samples into ${tmp_dir} (${unmatched} unmatched)."

    # Return 1 if nothing was symlinked (empty group)
    [[ "${matched}" -gt 0 ]]
}

#=============================================================================
# CORE PIPELINE FUNCTION
# run_pipeline <fastq_dir> <outdir> <prefix>
# Uses globals: REF, TARGET_BED, THREADS, KEEP_BAMS
#=============================================================================

run_pipeline() {
    local PIPELINE_FASTQ_DIR="$1"
    local PIPELINE_OUTDIR="$2"
    local PIPELINE_PREFIX="$3"

    # Derived paths for this run
    local BAM_DIR="${PIPELINE_OUTDIR}/bams"
    local CNVKIT_DIR="${PIPELINE_OUTDIR}/cnvkit"
    local EXOMEDEPTH_DIR="${PIPELINE_OUTDIR}/exomedepth"
    local QC_DIR="${PIPELINE_OUTDIR}/qc"
    RUN_LOG_DIR="${PIPELINE_OUTDIR}/logs"

    mkdir -p "${BAM_DIR}" "${CNVKIT_DIR}" "${EXOMEDEPTH_DIR}" \
             "${QC_DIR}" "${RUN_LOG_DIR}"

    log "------------------------------------------------------------"
    log " Starting run: prefix=${PIPELINE_PREFIX}"
    log " FASTQ dir   : ${PIPELINE_FASTQ_DIR}"
    log " Output dir  : ${PIPELINE_OUTDIR}"
    log "------------------------------------------------------------"

    #-------------------------------------------------------------------------
    # STEP 1: ALIGNMENT
    #-------------------------------------------------------------------------

    log "===== STEP 1: Alignment and BAM Processing ====="

    local SAMPLES=()
    for r1 in "${PIPELINE_FASTQ_DIR}"/*_R1_001.fastq.gz; do
        local sample
        sample=$(basename "$r1" | sed 's/_L001_R1_001.fastq.gz//')
        SAMPLES+=("$sample")
    done

    if [[ ${#SAMPLES[@]} -eq 0 ]]; then
        log "ERROR: No FASTQ files matching *_L001_R1_001.fastq.gz found in ${PIPELINE_FASTQ_DIR}"
        return 1
    fi

    log "Found ${#SAMPLES[@]} samples: ${SAMPLES[*]}"

    local BAM_LIST=()

    for sample in "${SAMPLES[@]}"; do
        local R1="${PIPELINE_FASTQ_DIR}/${sample}_L001_R1_001.fastq.gz"
        local R2="${PIPELINE_FASTQ_DIR}/${sample}_L001_R2_001.fastq.gz"

        if [[ ! -f "${R2}" ]]; then
            log "WARNING: R2 file not found for ${sample} — skipping."
            continue
        fi

        local FINAL_BAM="${BAM_DIR}/${sample}.dedup.bam"
        BAM_LIST+=("${FINAL_BAM}")

        if [[ -f "${FINAL_BAM}" && -f "${FINAL_BAM}.bai" ]]; then
            log "Skipping ${sample} — already processed."
            continue
        fi

        log "Processing ${sample}..."

        # Extract short ID for read group SM tag (falls back to full sample name)
        local SHORT_ID
        SHORT_ID=$(echo "$sample" | grep -oP 'POOL-\K\d+' || echo "${sample}")

        log "  Aligning ${sample}..."
        bwa mem -t "${THREADS}" \
            -R "@RG\tID:${sample}\tSM:Sample_${SHORT_ID}\tPL:ILLUMINA\tLB:lib1\tPU:unit1" \
            "${REF}" "${R1}" "${R2}" \
            2>"${RUN_LOG_DIR}/bwa_${sample}.log" \
        | samtools sort -@ "${THREADS}" \
            -o "${BAM_DIR}/${sample}.sorted.bam" -

        log "  Marking duplicates for ${sample}..."
        picard MarkDuplicates \
            I="${BAM_DIR}/${sample}.sorted.bam" \
            O="${FINAL_BAM}" \
            M="${QC_DIR}/${sample}.dedup_metrics.txt" \
            REMOVE_DUPLICATES=false \
            CREATE_INDEX=true \
            VALIDATION_STRINGENCY=LENIENT \
            2>"${RUN_LOG_DIR}/picard_${sample}.log"

        rm -f "${BAM_DIR}/${sample}.sorted.bam"

        samtools flagstat "${FINAL_BAM}" > "${QC_DIR}/${sample}.flagstat.txt"
        samtools stats   "${FINAL_BAM}" > "${QC_DIR}/${sample}.stats.txt"

        # -a: include zero-coverage target positions so gaps lower the mean
        samtools depth -a -b "${TARGET_BED}" "${FINAL_BAM}" \
            | awk '{sum+=$3; n++} END {print "Mean on-target depth: " (n ? sum/n : 0)}' \
            > "${QC_DIR}/${sample}.ontarget_depth.txt"

        log "  Done: ${sample}"
    done

    log "Alignment complete for all samples."

    #-------------------------------------------------------------------------
    # STEP 2: CNVkit
    #-------------------------------------------------------------------------

    log "===== STEP 2: CNVkit Analysis (Flat Reference) ====="

    export MPLBACKEND=Agg
    export MPLCONFIGDIR="${PIPELINE_OUTDIR}/.matplotlib"
    mkdir -p "${MPLCONFIGDIR}"
    cat > "${MPLCONFIGDIR}/matplotlibrc" << 'MPLRC'
figure.dpi: 300
savefig.dpi: 300
savefig.bbox: tight
font.size: 10
MPLRC

    local ACCESS_BED="${CNVKIT_DIR}/access-ref.bed"
    if [[ ! -f "${ACCESS_BED}" ]]; then
        log "Generating access/mappability file..."
        cnvkit.py access "${REF}" \
            -o "${CNVKIT_DIR}/access-ref-all.bed" \
            2>&1 | tee -a "${RUN_LOG_DIR}/cnvkit_access.log"

        # Derive allowed chromosomes from TARGET_BED so that autosomal
        # runs (X/Y removed from targets) also exclude X/Y from access
        local TARGET_CHROMS
        TARGET_CHROMS=$(cut -f1 "${TARGET_BED}" | sort -V | uniq | tr '\n' '|' | sed 's/|$//')
        grep -P "^(${TARGET_CHROMS})\t" \
            "${CNVKIT_DIR}/access-ref-all.bed" > "${ACCESS_BED}"
        log "Filtered access file: $(wc -l < "${ACCESS_BED}") regions (chromosomes: ${TARGET_CHROMS//|/, })"
    fi

    log "Running CNVkit batch (flat reference)..."
    cnvkit.py batch \
        "${BAM_LIST[@]}" \
        --normal \
        --targets "${TARGET_BED}" \
        --fasta "${REF}" \
        --access "${ACCESS_BED}" \
        --output-reference "${CNVKIT_DIR}/flat_reference.cnn" \
        --output-dir "${CNVKIT_DIR}" \
        -p "${THREADS}" \
        2>&1 | tee -a "${RUN_LOG_DIR}/cnvkit_batch.log"

    # Use chromosomes from TARGET_BED for all downstream filtering
    local STANDARD_CHROMS
    STANDARD_CHROMS=$(cut -f1 "${TARGET_BED}" | sort -V | uniq | tr '\n' ' ' | sed 's/ $//')

    log "Filtering CNVkit output to standard chromosomes..."
    for cnr_file in "${CNVKIT_DIR}"/*.cnr; do
        head -1 "${cnr_file}" > "${cnr_file}.tmp"
        for chr in ${STANDARD_CHROMS}; do
            awk -v c="${chr}" -F'\t' '$1 == c' "${cnr_file}" >> "${cnr_file}.tmp"
        done
        mv "${cnr_file}.tmp" "${cnr_file}"
    done

    for cns_file in "${CNVKIT_DIR}"/*.cns; do
        [[ "${cns_file}" == *.call.cns ]] && continue
        [[ "${cns_file}" == *.bintest.cns ]] && continue
        head -1 "${cns_file}" > "${cns_file}.tmp"
        for chr in ${STANDARD_CHROMS}; do
            awk -v c="${chr}" -F'\t' '$1 == c' "${cns_file}" >> "${cns_file}.tmp"
        done
        mv "${cns_file}.tmp" "${cns_file}"
    done

    log "Running CNVkit bintest (per-bin statistical testing)..."
    for cnr_file in "${CNVKIT_DIR}"/*.cnr; do
        local sample_name
        sample_name=$(basename "$cnr_file" .cnr)
        local seg_file="${CNVKIT_DIR}/${sample_name}.cns"
        if [[ -f "${seg_file}" ]]; then
            cnvkit.py bintest "${cnr_file}" -s "${seg_file}" \
                -o "${CNVKIT_DIR}/${sample_name}.bintest.cns" \
                2>&1 | tee -a "${RUN_LOG_DIR}/cnvkit_bintest.log" || true
        fi
    done

    log "Calling CNVs..."
    for cns_file in "${CNVKIT_DIR}"/*.cns; do
        [[ "${cns_file}" == *.call.cns ]] && continue
        [[ "${cns_file}" == *.bintest.cns ]] && continue
        local sample_name
        sample_name=$(basename "$cns_file" .cns)

        cnvkit.py call "${cns_file}" \
            -m clonal \
            -o "${CNVKIT_DIR}/${sample_name}.call.cns" \
            2>&1 | tee -a "${RUN_LOG_DIR}/cnvkit_call.log"

        local cnr_file="${CNVKIT_DIR}/${sample_name}.cnr"
        if [[ -f "${cnr_file}" ]]; then
            cnvkit.py scatter \
                "${cnr_file}" -s "${cns_file}" \
                -o "${CNVKIT_DIR}/${sample_name}.scatter.png" \
                --fig-size 16 8 2>/dev/null || true

            for chr in ${STANDARD_CHROMS}; do
                cnvkit.py scatter \
                    "${cnr_file}" -s "${cns_file}" -c "${chr}" \
                    -o "${CNVKIT_DIR}/${sample_name}.scatter.chr${chr}.png" \
                    --fig-size 14 6 2>/dev/null || true
            done

            cnvkit.py diagram \
                "${cnr_file}" -s "${cns_file}" \
                -o "${CNVKIT_DIR}/${sample_name}.diagram.pdf" \
                2>/dev/null || true
        fi
    done

    log "Generating CNVkit heatmap..."
    local CNS_FILES=()
    for f in "${CNVKIT_DIR}"/*.cns; do
        [[ "${f}" == *.call.cns ]] && continue
        [[ "${f}" == *.bintest.cns ]] && continue
        CNS_FILES+=("${f}")
    done
    cnvkit.py heatmap "${CNS_FILES[@]}" \
        -o "${CNVKIT_DIR}/${PIPELINE_PREFIX}_heatmap.png" \
        --fig-size 20 10 \
        2>/dev/null || log "  Heatmap generation failed (non-critical)."

    log "Exporting CNVkit results to SEG format..."
    for call_file in "${CNVKIT_DIR}"/*.call.cns; do
        local sample_name
        sample_name=$(basename "$call_file" .call.cns)
        cnvkit.py export seg "${call_file}" \
            -o "${CNVKIT_DIR}/${sample_name}.seg" 2>/dev/null || true
    done

    log "Generating combined CNVkit summary TSVs..."
    {
        printf "sample\tchromosome\tstart\tend\tlog2\tcn\tdepth\tprobes\tweight\n"
        for call_file in "${CNVKIT_DIR}"/*.call.cns; do
            local sample_name
            sample_name=$(basename "$call_file" .call.cns)
            tail -n +2 "${call_file}" \
                | awk -v s="${sample_name}" -F'\t' '{print s"\t"$0}'
        done
    } > "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_calls.tsv"

    {
        printf "sample\tchromosome\tstart\tend\tlog2\tcn\ttype\tsize_bp\n"
        for call_file in "${CNVKIT_DIR}"/*.call.cns; do
            local sample_name
            sample_name=$(basename "$call_file" .call.cns)
            tail -n +2 "${call_file}" \
                | awk -v s="${sample_name}" -F'\t' \
                    '$6 != 2 {type=($6<2)?"DEL":"DUP"; print s"\t"$1"\t"$2"\t"$3"\t"$5"\t"$6"\t"type"\t"$3-$2}'
        done
    } > "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_cnvs.tsv"

    log "  Total segments  : $(( $(wc -l < "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_calls.tsv") - 1 ))"
    log "  Non-neutral CNVs: $(( $(wc -l < "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_cnvs.tsv") - 1 ))"

    log "Generating CNVkit bintest summary TSV..."
    {
        printf "sample\tchromosome\tstart\tend\tgene\tlog2\n"
        for bt_file in "${CNVKIT_DIR}"/*.bintest.cns; do
            [[ -f "${bt_file}" ]] || continue
            local sample_name
            sample_name=$(basename "$bt_file" .bintest.cns)
            # bintest.cns columns: chr($1),start($2),end($3),gene($4),log2($5),depth($6),...
            tail -n +2 "${bt_file}" \
                | awk -v s="${sample_name}" -F'\t' '{print s"\t"$1"\t"$2"\t"$3"\t"$4"\t"$5}'
        done
    } > "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_bintest.tsv"
    log "  Bintest entries : $(( $(wc -l < "${CNVKIT_DIR}/${PIPELINE_PREFIX}_cnvkit_bintest.tsv") - 1 ))"

    # Combined scatter plot (Python)
    cat > "${CNVKIT_DIR}/plot_all_scatter.py" << 'PYSCRIPT'
import sys, os, glob
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams['figure.dpi'] = 300
matplotlib.rcParams['savefig.dpi'] = 300
import matplotlib.pyplot as plt

cnvkit_dir = sys.argv[1]
prefix     = sys.argv[2]

cnr_files  = sorted(glob.glob(os.path.join(cnvkit_dir, "*.cnr")))
n_samples  = len(cnr_files)

if n_samples == 0:
    print("No .cnr files found"); sys.exit(1)

fig, axes = plt.subplots(n_samples, 1, figsize=(20, 3 * n_samples), sharex=True)
if n_samples == 1:
    axes = [axes]

chrom_order = [str(i) for i in range(1, 23)] + ['X', 'Y']

for idx, cnr_file in enumerate(cnr_files):
    sample = os.path.basename(cnr_file).replace('.cnr', '')

    chroms, starts, log2s = [], [], []
    with open(cnr_file) as f:
        f.readline()
        for line in f:
            parts = line.strip().split('\t')
            if parts[0] in chrom_order:
                chroms.append(parts[0])
                starts.append(int(parts[1]))
                log2s.append(float(parts[3]))

    if not chroms:
        continue

    chrom_offsets, offset = {}, 0
    for c in chrom_order:
        chrom_offsets[c] = offset
        positions = [s for ch, s in zip(chroms, starts) if ch == c]
        offset += (max(positions) if positions else 0) + 5_000_000

    x_pos  = [chrom_offsets.get(c, 0) + s for c, s in zip(chroms, starts)]
    colors = ['#4477AA' if chrom_order.index(c) % 2 == 0 else '#AA4455'
              for c in chroms]

    ax = axes[idx]
    ax.scatter(x_pos, log2s, c=colors, s=3, alpha=0.5, linewidths=0)
    ax.axhline(y=0,    color='gray',  linewidth=0.5, linestyle='--')
    ax.axhline(y=0.3,  color='green', linewidth=0.3, linestyle=':')
    ax.axhline(y=-0.3, color='green', linewidth=0.3, linestyle=':')
    ax.set_ylim(-3, 3)
    ax.set_ylabel(sample.replace('.dedup', ''), fontsize=7,
                  rotation=0, labelpad=80, ha='right', va='center')
    ax.tick_params(axis='y', labelsize=6)

    if idx == n_samples - 1:
        tick_pos, tick_labels = [], []
        for c in chrom_order:
            positions = [s for ch, s in zip(chroms, starts) if ch == c]
            if positions:
                mid = chrom_offsets[c] + (max(positions) + min(positions)) / 2
                tick_pos.append(mid); tick_labels.append(c)
        ax.set_xticks(tick_pos)
        ax.set_xticklabels(tick_labels, fontsize=7)
        ax.set_xlabel('Chromosome', fontsize=9)
    else:
        ax.set_xticks([])

fig.suptitle(f'CNVkit Log2 Ratios — {prefix}', fontsize=12, y=1.0)
plt.tight_layout()
out = os.path.join(cnvkit_dir, f'{prefix}_scatter.png')
plt.savefig(out, dpi=300, bbox_inches='tight')
plt.close()
print(f"Scatter plot saved: {out}")
PYSCRIPT

    python "${CNVKIT_DIR}/plot_all_scatter.py" "${CNVKIT_DIR}" "${PIPELINE_PREFIX}" \
        2>&1 | tee -a "${RUN_LOG_DIR}/cnvkit_scatter.log" \
        || log "  All-samples scatter failed (non-critical)."

    log "CNVkit analysis complete."

    #-------------------------------------------------------------------------
    # STEP 3: ExomeDepth
    #-------------------------------------------------------------------------

    log "===== STEP 3: ExomeDepth Analysis ====="

    cat > "${EXOMEDEPTH_DIR}/run_exomedepth.R" << 'RSCRIPT_EOF'
#!/usr/bin/env Rscript
suppressPackageStartupMessages({
    library(ExomeDepth)
    library(GenomicRanges)
})

args         <- commandArgs(trailingOnly = TRUE)
bam_dir      <- args[1]
target_bed   <- args[2]
output_dir   <- args[3]
ref_fasta    <- args[4]
prefix       <- args[5]

cat("=== ExomeDepth CNV Analysis ===\n")
cat("BAM dir    :", bam_dir,    "\n")
cat("Target BED :", target_bed, "\n")
cat("Output dir :", output_dir, "\n")
cat("Prefix     :", prefix,     "\n")

targets   <- read.table(target_bed, header = FALSE, sep = "\t",
                        stringsAsFactors = FALSE)
target_gr <- GRanges(
    seqnames = targets[,1],
    ranges   = IRanges(start = as.integer(targets[,2]) + 1,
                       end   = as.integer(targets[,3]))
)
if (ncol(targets) >= 4) {
    target_gr$name <- targets[,4]
} else {
    target_gr$name <- paste0(seqnames(target_gr), ":",
                             start(target_gr), "-", end(target_gr))
}
cat("Loaded", length(target_gr), "target regions.\n")

bam_files    <- sort(list.files(bam_dir, pattern = "\\.dedup\\.bam$",
                                full.names = TRUE))
sample_names <- gsub("\\.dedup\\.bam$", "", basename(bam_files))
cat("Found", length(bam_files), "BAM files.\n")

cat("Counting reads (this may take a while)...\n")
counts_list <- getBamCounts(
    bed.frame = data.frame(
        chromosome = as.character(seqnames(target_gr)),
        start      = start(target_gr),
        end        = end(target_gr)),
    bam.files      = bam_files,
    include.chr    = FALSE,
    referenceFasta = ref_fasta
)

counts_df <- as.data.frame(counts_list)
cat("Count matrix:", nrow(counts_df), "x", ncol(counts_df), "\n")

annotation_cols  <- c("chromosome","start","end","GC","exon","exon.name","space","names")
sample_col_names <- setdiff(names(counts_df),
                            annotation_cols[annotation_cols %in% names(counts_df)])
sample_col_names <- sample_col_names[sapply(counts_df[, sample_col_names], is.numeric)]

if (length(sample_col_names) != length(bam_files)) {
    cat("WARNING: Column count mismatch — falling back to last N columns.\n")
    sample_col_names <- names(counts_df)[
        (ncol(counts_df) - length(bam_files) + 1):ncol(counts_df)]
}

all_results <- data.frame()

for (i in seq_along(bam_files)) {
    sample <- sample_names[i]
    cat("\n--- Processing:", sample, "(", i, "/", length(bam_files), ") ---\n")

    test_counts <- counts_df[, sample_col_names[i]]
    ref_matrix  <- as.matrix(counts_df[, sample_col_names[-i]])

    tryCatch({
        ref_selection <- select.reference.set(
            test.counts      = test_counts,
            reference.counts = ref_matrix,
            bin.length       = width(target_gr),
            n.bins.reduced   = 10000
        )
        cat("  Selected", length(ref_selection$reference.choice),
            "reference samples.\n")

        ref_counts <- apply(
            ref_matrix[, ref_selection$reference.choice, drop = FALSE],
            1, sum)

        ed <- new("ExomeDepth",
                  test      = test_counts,
                  reference = ref_counts,
                  formula   = 'cbind(test, reference) ~ 1')

        ed <- CallCNVs(ed,
                       chromosome = as.character(seqnames(target_gr)),
                       start      = start(target_gr),
                       end        = end(target_gr),
                       name       = target_gr$name)

        if (nrow(ed@CNV.calls) > 0) {
            calls        <- ed@CNV.calls
            calls$sample <- sample
            cat("  Found", nrow(calls), "CNV calls.\n")
            write.table(calls,
                        file      = file.path(output_dir,
                                              paste0(sample, "_exomedepth.tsv")),
                        row.names = FALSE, sep = "\t", quote = FALSE)
            all_results <- rbind(all_results, calls)
        } else {
            cat("  No CNVs called.\n")
        }
    }, error = function(e) {
        cat("  ERROR:", conditionMessage(e), "\n")
    })
}

if (nrow(all_results) > 0) {
    all_results$type_label <- ifelse(all_results$type == "deletion", "DEL", "DUP")
    all_results$size       <- all_results$end - all_results$start
    all_results            <- all_results[order(-all_results$BF), ]

    out_file <- file.path(output_dir, paste0(prefix, "_exomedepth.tsv"))
    write.table(all_results, file = out_file,
                row.names = FALSE, sep = "\t", quote = FALSE)

    cat("\n=== ExomeDepth Summary ===\n")
    cat("Total CNV calls :", nrow(all_results), "\n")
    cat("Deletions       :", sum(all_results$type == "deletion"), "\n")
    cat("Duplications    :", sum(all_results$type == "duplication"), "\n")
    cat("Calls BF > 10   :", sum(all_results$BF > 10), "\n")
    cat("\nPer-sample call counts:\n")
    print(table(all_results$sample, all_results$type_label))
} else {
    cat("\nNo CNVs detected across any sample.\n")
}

cat("\nExomeDepth analysis complete.\n")
RSCRIPT_EOF

    Rscript "${EXOMEDEPTH_DIR}/run_exomedepth.R" \
        "${BAM_DIR}" \
        "${TARGET_BED}" \
        "${EXOMEDEPTH_DIR}" \
        "${REF}" \
        "${PIPELINE_PREFIX}" \
        2>&1 | tee -a "${RUN_LOG_DIR}/exomedepth.log"

    log "ExomeDepth analysis complete."

    #-------------------------------------------------------------------------
    # STEP 4: Consensus
    #-------------------------------------------------------------------------

    log "===== STEP 4: Generating Consensus Summary ====="

    cat > "${PIPELINE_OUTDIR}/generate_consensus_last.R" << 'CONSENSUS_EOF'
#!/usr/bin/env Rscript
suppressPackageStartupMessages({ library(GenomicRanges) })

args           <- commandArgs(trailingOnly = TRUE)
cnvkit_dir     <- args[1]
exomedepth_dir <- args[2]
output_dir     <- args[3]
prefix         <- args[4]

cat("=== Generating Tiered Consensus CNV Calls ===\n")
cat("Prefix:", prefix, "\n")

# Helper: normalise sample names (strip .dedup, .bintest etc.)
normalise_sample <- function(x) {
    x <- gsub("\\.dedup\\.bintest$", "", x)
    x <- gsub("\\.dedup$", "", x)
    x
}

#--------------------------------------------------------------------------
# 1. Read standard CNVkit calls (.call.cns files)
#--------------------------------------------------------------------------
cnvkit_files <- list.files(cnvkit_dir, pattern = "\\.call\\.cns$", full.names = TRUE)
# Exclude bintest.call.cns if any
cnvkit_files <- cnvkit_files[!grepl("bintest\\.call\\.cns$", cnvkit_files)]
cnvkit_all   <- data.frame()

for (f in cnvkit_files) {
    raw_name <- gsub("\\.call\\.cns$", "", basename(f))
    sample   <- normalise_sample(raw_name)
    df       <- read.table(f, header = TRUE, sep = "\t", stringsAsFactors = FALSE)
    df       <- df[df$cn != 2, ]
    if (nrow(df) > 0) {
        df$sample <- sample
        df$tool   <- "CNVkit_seg"
        df$type   <- ifelse(df$cn < 2, "DEL", "DUP")
        cnvkit_all <- rbind(cnvkit_all,
                            df[, c("chromosome","start","end","cn","log2",
                                   "sample","tool","type")])
    }
}
cat("CNVkit segmentation calls (non-neutral):", nrow(cnvkit_all), "\n")

#--------------------------------------------------------------------------
# 2. Read CNVkit bintest results and merge consecutive significant bins
#--------------------------------------------------------------------------
bt_file <- file.path(cnvkit_dir, paste0(prefix, "_cnvkit_bintest.tsv"))
bintest_merged <- data.frame()

if (file.exists(bt_file)) {
    bt_raw <- read.table(bt_file, header = TRUE, sep = "\t", stringsAsFactors = FALSE)
    bt_raw$sample <- normalise_sample(bt_raw$sample)

    # Filter bins with significant signal
    bt_sig <- bt_raw[abs(bt_raw$log2) >= 0.5, ]
    cat("Bintest significant bins (|log2| >= 0.5):", nrow(bt_sig), "\n")

    if (nrow(bt_sig) > 0) {
        # Merge consecutive bins per sample/chromosome/direction into regions
        for (s in unique(bt_sig$sample)) {
            for (chr in unique(bt_sig$chromosome[bt_sig$sample == s])) {
                sub <- bt_sig[bt_sig$sample == s & bt_sig$chromosome == chr, ]
                sub <- sub[order(sub$start), ]
                if (nrow(sub) == 0) next

                # Assign direction
                sub$dir <- ifelse(sub$log2 < 0, "DEL", "DUP")

                # Merge consecutive bins of same direction (allow gap up to 1kb)
                regions <- list()
                current <- list(
                    start  = sub$start[1], end = sub$end[1],
                    dir    = sub$dir[1],   n_bins = 1,
                    log2s  = sub$log2[1],  genes = sub$gene[1]
                )

                if (nrow(sub) > 1) {
                    for (i in 2:nrow(sub)) {
                        gap <- sub$start[i] - current$end
                        if (sub$dir[i] == current$dir && gap <= 1000) {
                            current$end    <- sub$end[i]
                            current$n_bins <- current$n_bins + 1
                            current$log2s  <- c(current$log2s, sub$log2[i])
                            current$genes  <- unique(c(current$genes, sub$gene[i]))
                        } else {
                            regions <- c(regions, list(current))
                            current <- list(
                                start  = sub$start[i], end = sub$end[i],
                                dir    = sub$dir[i],   n_bins = 1,
                                log2s  = sub$log2[i],  genes = sub$gene[i]
                            )
                        }
                    }
                }
                regions <- c(regions, list(current))

                for (r in regions) {
                    # Require at least 3 consecutive bins for a credible call
                    if (r$n_bins >= 3) {
                        bintest_merged <- rbind(bintest_merged, data.frame(
                            chromosome = chr,
                            start      = r$start,
                            end        = r$end,
                            log2       = mean(r$log2s),
                            n_bins     = r$n_bins,
                            genes      = paste(r$genes, collapse = ";"),
                            sample     = s,
                            tool       = "CNVkit_bintest",
                            type       = r$dir,
                            stringsAsFactors = FALSE
                        ))
                    }
                }
            }
        }
    }
}
cat("Bintest merged regions (>= 3 bins):", nrow(bintest_merged), "\n")

# Filter out bintest regions seen in too many samples (likely artefacts)
if (nrow(bintest_merged) > 0) {
    n_samples_total <- length(unique(c(cnvkit_all$sample, bintest_merged$sample)))
    max_recurrence  <- ceiling(n_samples_total * 0.5)

    region_keys <- paste(bintest_merged$chromosome, bintest_merged$start,
                         bintest_merged$end, bintest_merged$type, sep = "_")
    key_counts  <- table(region_keys)
    keep        <- names(key_counts[key_counts <= max_recurrence])
    n_before    <- nrow(bintest_merged)
    bintest_merged <- bintest_merged[region_keys %in% keep, ]
    cat("Bintest regions after artefact filter (<= 50% samples):",
        nrow(bintest_merged), "of", n_before, "\n")
}

#--------------------------------------------------------------------------
# 3. Read ExomeDepth results
#--------------------------------------------------------------------------
ed_file <- file.path(exomedepth_dir, paste0(prefix, "_exomedepth.tsv"))
ed_all  <- data.frame()

if (file.exists(ed_file)) {
    ed_raw <- read.table(ed_file, header = TRUE, sep = "\t", stringsAsFactors = FALSE)
    if (nrow(ed_raw) > 0) {
        ed_all <- data.frame(
            chromosome = ed_raw$chromosome,
            start      = ed_raw$start,
            end        = ed_raw$end,
            cn         = NA, log2 = NA,
            sample     = normalise_sample(ed_raw$sample),
            tool       = "ExomeDepth",
            type       = ifelse(ed_raw$type == "deletion", "DEL", "DUP"),
            BF         = ed_raw$BF,
            stringsAsFactors = FALSE
        )
    }
}
cat("ExomeDepth calls:", nrow(ed_all), "\n")

#--------------------------------------------------------------------------
# 4. Overlap function (reusable)
#--------------------------------------------------------------------------
find_overlapping_calls <- function(calls_a, calls_b, min_recip = 0.5) {
    results <- data.frame()
    samples <- unique(c(calls_a$sample, calls_b$sample))

    for (s in samples) {
        a <- calls_a[calls_a$sample == s, ]
        b <- calls_b[calls_b$sample == s, ]
        if (nrow(a) == 0 || nrow(b) == 0) next

        for (cnv_type in c("DEL", "DUP")) {
            a_t <- a[a$type == cnv_type, ]
            b_t <- b[b$type == cnv_type, ]
            if (nrow(a_t) == 0 || nrow(b_t) == 0) next

            gr_a <- GRanges(seqnames = a_t$chromosome,
                            ranges = IRanges(a_t$start, a_t$end))
            gr_b <- GRanges(seqnames = b_t$chromosome,
                            ranges = IRanges(b_t$start, b_t$end))

            hits <- findOverlaps(gr_a, gr_b)
            if (length(hits) == 0) next

            for (h in seq_along(hits)) {
                qi  <- queryHits(hits)[h]
                si  <- subjectHits(hits)[h]
                ovl <- intersect(gr_a[qi], gr_b[si])

                frac_a <- width(ovl) / width(gr_a[qi])
                frac_b <- width(ovl) / width(gr_b[si])

                if (frac_a >= min_recip && frac_b >= min_recip) {
                    results <- rbind(results, data.frame(
                        sample     = s,
                        chromosome = as.character(seqnames(gr_a[qi])),
                        start      = min(start(gr_a[qi]), start(gr_b[si])),
                        end        = max(end(gr_a[qi]), end(gr_b[si])),
                        type       = cnv_type,
                        idx_a      = qi,
                        idx_b      = si,
                        stringsAsFactors = FALSE
                    ))
                }
            }
        }
    }
    results
}

#--------------------------------------------------------------------------
# 5. Build tiered consensus
#--------------------------------------------------------------------------
all_consensus <- data.frame()

# Helper: estimate integer copy number from log2 ratio
log2_to_cn <- function(l2) {
    cn <- round(2 * 2^l2)
    cn[cn < 0] <- 0
    cn
}

# --- HIGH: standard CNVkit seg + ExomeDepth overlap ---
if (nrow(cnvkit_all) > 0 && nrow(ed_all) > 0) {
    seg_ed <- find_overlapping_calls(cnvkit_all, ed_all)
    if (nrow(seg_ed) > 0) {
        for (i in seq_len(nrow(seg_ed))) {
            row <- seg_ed[i, ]
            # Fix: match by sample+chromosome+start+end instead of positional idx_a
            # idx_a is a local GRanges index, not a global cnvkit_all row index
            ck_candidates <- cnvkit_all[
                cnvkit_all$sample      == row$sample &
                cnvkit_all$type        == row$type   &
                cnvkit_all$chromosome  == row$chromosome, ]
            # Pick the candidate with the greatest reciprocal overlap to row
            if (nrow(ck_candidates) == 0) next
            ovl_size <- pmin(ck_candidates$end, row$end) - pmax(ck_candidates$start, row$start)
            ck_i <- ck_candidates[which.max(ovl_size), ]
            all_consensus <- rbind(all_consensus, data.frame(
                sample        = row$sample,
                chromosome    = row$chromosome,
                start         = row$start,
                end           = row$end,
                type          = row$type,
                cn            = ck_i$cn,
                tool_a        = "CNVkit_seg",
                bintest_log2  = NA,
                bintest_nbins = NA,
                confidence    = "HIGH",
                stringsAsFactors = FALSE
            ))
        }
    }
}

# --- HIGH: bintest merged + ExomeDepth overlap ---
if (nrow(bintest_merged) > 0 && nrow(ed_all) > 0) {
    bt_ed <- find_overlapping_calls(bintest_merged, ed_all, min_recip = 0.3)
    if (nrow(bt_ed) > 0) {
        for (i in seq_len(nrow(bt_ed))) {
            row <- bt_ed[i, ]
            # Fix: same approach — match by coordinates, not positional index
            bt_candidates <- bintest_merged[
                bintest_merged$sample     == row$sample &
                bintest_merged$type       == row$type   &
                bintest_merged$chromosome == row$chromosome, ]
            if (nrow(bt_candidates) == 0) next
            ovl_size <- pmin(bt_candidates$end, row$end) - pmax(bt_candidates$start, row$start)
            bt_i <- bt_candidates[which.max(ovl_size), ]
            all_consensus <- rbind(all_consensus, data.frame(
                sample        = row$sample,
                chromosome    = row$chromosome,
                start         = row$start,
                end           = row$end,
                type          = row$type,
                cn            = log2_to_cn(bt_i$log2),
                tool_a        = "CNVkit_bintest",
                bintest_log2  = bt_i$log2,
                bintest_nbins = bt_i$n_bins,
                confidence    = "HIGH",
                stringsAsFactors = FALSE
            ))
        }
    }
}

# --- MEDIUM: strong bintest-only (no ExomeDepth confirmation) ---
if (nrow(bintest_merged) > 0) {
    # Keep bintest regions NOT already in HIGH consensus
    bt_remaining <- bintest_merged
    if (nrow(all_consensus) > 0) {
        high_keys <- paste(all_consensus$sample, all_consensus$chromosome,
                           all_consensus$type, sep = "_")
        bt_keys   <- paste(bt_remaining$sample, bt_remaining$chromosome,
                           bt_remaining$type, sep = "_")
        # Remove bintest calls that overlap with HIGH calls
        if (nrow(all_consensus) > 0) {
            for (s in unique(bt_remaining$sample)) {
                hi <- all_consensus[all_consensus$sample == s, ]
                bt <- bt_remaining[bt_remaining$sample == s, ]
                if (nrow(hi) == 0 || nrow(bt) == 0) next

                gr_hi <- GRanges(seqnames = hi$chromosome, ranges = IRanges(hi$start, hi$end))
                gr_bt <- GRanges(seqnames = bt$chromosome, ranges = IRanges(bt$start, bt$end))
                hits  <- findOverlaps(gr_bt, gr_hi)
                if (length(hits) > 0) {
                    remove_idx <- which(bt_remaining$sample == s)[queryHits(hits)]
                    bt_remaining <- bt_remaining[-remove_idx, , drop = FALSE]
                }
            }
        }
    }

    # Require >= 3 bins and mean |log2| >= 0.5 for MEDIUM
    medium <- bt_remaining[bt_remaining$n_bins >= 3 & abs(bt_remaining$log2) >= 0.5, ]
    if (nrow(medium) > 0) {
        for (i in seq_len(nrow(medium))) {
            r <- medium[i, ]
            all_consensus <- rbind(all_consensus, data.frame(
                sample     = r$sample,
                chromosome = r$chromosome,
                start      = r$start,
                end        = r$end,
                type       = r$type,
                cn         = log2_to_cn(r$log2),
                tool_a     = "CNVkit_bintest",
                bintest_log2 = r$log2,
                bintest_nbins = r$n_bins,
                confidence = "MEDIUM",
                stringsAsFactors = FALSE
            ))
        }
    }
}

#--------------------------------------------------------------------------
# 6. Output
#--------------------------------------------------------------------------
if (nrow(all_consensus) > 0) {
    # Remove duplicate rows: same sample+chromosome+start+end+type+confidence
    # can appear when one CNVkit region overlaps multiple ExomeDepth calls
    dedup_key <- paste(all_consensus$sample, all_consensus$chromosome,
                       all_consensus$start,  all_consensus$end,
                       all_consensus$type,   all_consensus$confidence, sep = "_")
    n_before      <- nrow(all_consensus)
    all_consensus <- all_consensus[!duplicated(dedup_key), ]
    if (nrow(all_consensus) < n_before)
        cat("Removed", n_before - nrow(all_consensus), "duplicate row(s).\n")

    all_consensus <- all_consensus[order(all_consensus$confidence,
                                         all_consensus$sample,
                                         all_consensus$chromosome,
                                         all_consensus$start), ]
    con_file <- file.path(output_dir, paste0(prefix, "_consensus_cnvs.tsv"))
    write.table(all_consensus, file = con_file,
                row.names = FALSE, sep = "\t", quote = FALSE)

    cat("\n=== TIERED CONSENSUS RESULTS ===\n")
    cat("HIGH   (both tools agree)  :", sum(all_consensus$confidence == "HIGH"), "\n")
    cat("MEDIUM (bintest-only, strong):", sum(all_consensus$confidence == "MEDIUM"), "\n")
    cat("Total  :", nrow(all_consensus), "\n")
    cat("\nPer-sample:\n")
    print(table(all_consensus$sample, all_consensus$confidence))
} else {
    cat("\nNo consensus CNVs detected.\n")
}

# Union of all calls for reference
union_calls <- data.frame()
if (nrow(cnvkit_all) > 0)
    union_calls <- rbind(union_calls,
                         cnvkit_all[, c("chromosome","start","end","sample","tool","type")])
if (nrow(bintest_merged) > 0)
    union_calls <- rbind(union_calls,
                         bintest_merged[, c("chromosome","start","end","sample","tool","type")])
if (nrow(ed_all) > 0)
    union_calls <- rbind(union_calls,
                         ed_all[, c("chromosome","start","end","sample","tool","type")])

if (nrow(union_calls) > 0) {
    union_file <- file.path(output_dir, paste0(prefix, "_union_cnvs.tsv"))
    write.table(union_calls, file = union_file,
                row.names = FALSE, sep = "\t", quote = FALSE)
    cat("\nAll calls (union) saved:", nrow(union_calls), "total.\n")
}

cat("\nConsensus analysis complete.\n")
CONSENSUS_EOF

    Rscript "${PIPELINE_OUTDIR}/generate_consensus_last.R" \
        "${CNVKIT_DIR}" \
        "${EXOMEDEPTH_DIR}" \
        "${PIPELINE_OUTDIR}" \
        "${PIPELINE_PREFIX}" \
        2>&1 | tee -a "${RUN_LOG_DIR}/consensus.log"

    #-------------------------------------------------------------------------
    # STEP 5: BAM CLEANUP (deferred — tracked for later removal)
    #-------------------------------------------------------------------------

    if [[ "${KEEP_BAMS}" == false ]]; then
        log "===== STEP 5: BAM cleanup deferred until all analyses complete ====="
        DEFERRED_BAM_DIRS+=("${BAM_DIR}")
    else
        log "===== STEP 5: Skipping BAM cleanup (--keep-bams set) ====="
        log "BAMs retained at: ${BAM_DIR}"
    fi

    #-------------------------------------------------------------------------
    # STEP 6: RUN SUMMARY
    #-------------------------------------------------------------------------

    log "===== Run complete: ${PIPELINE_PREFIX} ====="
    log "  ${CNVKIT_DIR}/                     CNVkit results"
    log "  ${EXOMEDEPTH_DIR}/                 ExomeDepth results"
    log "  ${PIPELINE_OUTDIR}/${PIPELINE_PREFIX}_consensus_cnvs.tsv"
    log "  ${PIPELINE_OUTDIR}/${PIPELINE_PREFIX}_union_cnvs.tsv"
    if [[ "${KEEP_BAMS}" == true ]]; then
        log "  ${BAM_DIR}/                        Deduplicated BAMs (retained)"
    fi

    # Clear per-run log dir so subsequent calls don't double-write
    RUN_LOG_DIR=""
}

#=============================================================================
# MAIN EXECUTION
#=============================================================================

if [[ -n "${GENDERS_FILE}" ]]; then

    #--------------------------------------------------------------------------
    # Gender-stratified mode
    #--------------------------------------------------------------------------

    parse_genders "${GENDERS_FILE}"

    # Temp directories for FASTQ symlinks
    TMP_MALE="${OUTDIR}/tmp_fastq_Male"
    TMP_FEMALE="${OUTDIR}/tmp_fastq_Female"

    # Cleanup trap — remove tmp dirs even if pipeline exits early
    cleanup_tmp() {
        log "Cleaning up temporary FASTQ symlink directories..."
        rm -rf "${TMP_MALE}" "${TMP_FEMALE}"
        log "Cleanup done."
    }
    trap cleanup_tmp EXIT

    # Run Male group
    if [[ ${#MALE_POOLS[@]} -gt 0 ]]; then
        log "===== Processing Male group (${#MALE_POOLS[@]} samples) ====="
        if partition_fastqs "${TMP_MALE}" "${MALE_POOLS[@]}"; then
            run_pipeline "${TMP_MALE}" "${OUTDIR}/Male" "${PREFIX}_Male"
        else
            log "WARNING: No FASTQs resolved for Male group — skipping."
        fi
    else
        log "WARNING: No Male samples in genders file — skipping Male run."
    fi

    # Run Female group (exclude chrY — females have no Y chromosome)
    if [[ ${#FEMALE_POOLS[@]} -gt 0 ]]; then
        log "===== Processing Female group (${#FEMALE_POOLS[@]} samples) ====="

        FEMALE_BED="${OUTDIR}/targets_no_chrY.bed"
        grep -vP "^(chrY|Y)\t" "${TARGET_BED}" > "${FEMALE_BED}"
        log "  Female BED: $(wc -l < "${FEMALE_BED}") regions (chrY removed from $(wc -l < "${TARGET_BED}") total)"

        ORIG_TARGET_BED="${TARGET_BED}"
        TARGET_BED="${FEMALE_BED}"

        if partition_fastqs "${TMP_FEMALE}" "${FEMALE_POOLS[@]}"; then
            run_pipeline "${TMP_FEMALE}" "${OUTDIR}/Female" "${PREFIX}_Female"
        else
            log "WARNING: No FASTQs resolved for Female group — skipping."
        fi

        TARGET_BED="${ORIG_TARGET_BED}"
    else
        log "WARNING: No Female samples in genders file — skipping Female run."
    fi

    #--------------------------------------------------------------------------
    # Combined autosomal run (all samples, X/Y excluded)
    #--------------------------------------------------------------------------

    log "===== Processing All-autosomal run (all samples, excluding chrX/Y) ====="

    # Create autosome-only BED by filtering out X and Y chromosomes
    AUTOSOMAL_BED="${OUTDIR}/targets_autosomal.bed"
    grep -vP "^(chrX|chrY|X|Y)\t" "${TARGET_BED}" > "${AUTOSOMAL_BED}"
    log "  Autosomal BED: $(wc -l < "${AUTOSOMAL_BED}") regions (from $(wc -l < "${TARGET_BED}") total)"

    # Reuse BAMs from Male/Female runs to avoid re-alignment
    ALL_BAM_DIR="${OUTDIR}/All/bams"
    mkdir -p "${ALL_BAM_DIR}"

    REUSED=0
    for src_dir in "${OUTDIR}/Male/bams" "${OUTDIR}/Female/bams"; do
        if [[ -d "${src_dir}" ]]; then
            for bam in "${src_dir}"/*.dedup.bam; do
                [[ -f "${bam}" ]] || continue
                bam_base=$(basename "${bam}")
                ln -sf "${bam}" "${ALL_BAM_DIR}/${bam_base}"
                # Symlink the index — handle both .bam.bai and .bai naming
                if [[ -f "${bam}.bai" ]]; then
                    ln -sf "${bam}.bai" "${ALL_BAM_DIR}/${bam_base}.bai"
                elif [[ -f "${bam%.bam}.bai" ]]; then
                    ln -sf "${bam%.bam}.bai" "${ALL_BAM_DIR}/${bam_base}.bai"
                fi
                REUSED=$(( REUSED + 1 ))
            done
        fi
    done
    log "  Reused ${REUSED} BAMs from Male/Female runs (alignment will be skipped)"

    if [[ "${REUSED}" -gt 0 ]]; then
        # Temporarily swap TARGET_BED to autosomal-only
        ORIG_TARGET_BED="${TARGET_BED}"
        TARGET_BED="${AUTOSOMAL_BED}"

        # Build a tmp FASTQ dir containing ONLY gender-listed samples.
        # Using the original FASTQ_DIR here would pull in samples that are
        # absent from the genders file (e.g. pools from previous runs).
        TMP_ALL="${OUTDIR}/tmp_fastq_All"
        ALL_POOLS=( "${MALE_POOLS[@]}" "${FEMALE_POOLS[@]}" )
        if partition_fastqs "${TMP_ALL}" "${ALL_POOLS[@]}"; then
            run_pipeline "${TMP_ALL}" "${OUTDIR}/All" "${PREFIX}_All"
        else
            log "WARNING: No FASTQs resolved for All group — skipping All-autosomal run."
        fi

        # Restore original BED
        TARGET_BED="${ORIG_TARGET_BED}"

        # Clean up All tmp FASTQ symlinks
        rm -rf "${TMP_ALL}"
    else
        log "WARNING: No BAMs found to reuse — skipping All-autosomal run."
    fi

else

    #--------------------------------------------------------------------------
    # Standard mode (no gender stratification)
    #--------------------------------------------------------------------------

    run_pipeline "${FASTQ_DIR}" "${OUTDIR}" "${PREFIX}"

fi

#=============================================================================
# DEFERRED BAM CLEANUP
# All analyses are complete — now safe to remove BAMs if requested.
#=============================================================================

if [[ ${#DEFERRED_BAM_DIRS[@]} -gt 0 ]]; then
    log ""
    log "===== Deferred BAM Cleanup ====="
    for bam_dir in "${DEFERRED_BAM_DIRS[@]}"; do
        if [[ -d "${bam_dir}" ]]; then
            rm -rf "${bam_dir}"
            log "  Removed: ${bam_dir}"
        fi
    done
    log "BAM cleanup complete."
fi

#=============================================================================
# FINAL SUMMARY
#=============================================================================

log ""
log "============================================================"
log " Pipeline finished."
log " Prefix  : ${PREFIX}"
log " Output  : ${OUTDIR}"
if [[ -n "${GENDERS_FILE}" ]]; then
    log " Mode    : Gender-stratified + All-autosomal"
    log "   Male   → ${OUTDIR}/Male/  (full BED with X/Y)"
    log "   Female → ${OUTDIR}/Female/  (chrY excluded)"
    log "   All    → ${OUTDIR}/All/  (autosomal only, no chrX/Y)"
else
    log " Mode    : Combined (no gender stratification)"
fi
log "============================================================"
