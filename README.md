# CNVDetect

**A wizard-driven platform for detecting and classifying copy number variants (CNVs) from targeted gene panel sequencing.**

CNVDetect runs the whole workflow from a single interface:
- alignment of FASTQ files
- two independent CNV callers (CNVkit + ExomeDepth) and a consensus callset
- ACMG-based classification with ClassifyCNV

No matched normal samples are required. The interface is available in English and Turkish.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running](#running)
- [Usage](#usage)
- [Outputs](#outputs)
- [Configuration](#configuration)
- [Running the pipeline from the command line](#running-the-pipeline-from-the-command-line)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Software versions](#software-versions)
- [Licence](#licence)

---

## Features

- **Panel / BED builder**
  - Institutional panel: loads a fixed in-house BED from the server (`backend/institutional_panel.bed`, not included in the repository; see [Configuration](#configuration))
  - Clinical preset panels, or a custom panel built from gene names, with automatic BED generation and adjustable padding (hg19 / hg38)
  - Upload your own BED file
- **Sex stratification** — male and female samples are analysed separately (chrY excluded for females; X/Y excluded in the combined analysis). Sample names are detected automatically from the FASTQ folder.
- **Running the analysis**
  - Folder picker that shows the FASTQ files and the number of samples in each folder
  - Live, per-step progress, tracked separately for males and females
  - Technical log view
  - Safe stop: all child processes are terminated
- **Tiered consensus CNV calling** — CNVkit (flat reference) and ExomeDepth (cohort reference) are run on every sample. Calls supported by both are reported as **HIGH** confidence; strong CNVkit bin-level (bintest) evidence without ExomeDepth support is reported as **MEDIUM**. See [Confidence levels](#confidence-levels).
- **Automatic classification** — ClassifyCNV assigns ACMG classes (Pathogenic / VUS / Benign …). Results from all groups are merged into a single Excel report.
- **Results view**
  - Filterable, sortable table
  - Charts by chromosome, classification and sample
  - TSV export and a notes panel

## How it works

```
┌──────────────┐   HTTP / WebSocket   ┌──────────────────┐   bash   ┌────────────────────────────────┐
│  Frontend    │ ───────────────────▶ │  Backend         │ ───────▶ │  cnv_pipeline_last.sh          │
│  React+Vite  │ ◀─────────────────── │  FastAPI :8765   │          │  BWA → Picard → CNVkit         │
│  (Docker /   │   live logs, status  │  (WSL / Linux)   │          │        → ExomeDepth → Consensus│
│   Electron)  │                      └──────────────────┘          │  cnv_anotation.sh → ClassifyCNV│
└──────────────┘                                                    └────────────────────────────────┘
```

- The **backend** runs on Linux (or WSL), because it needs direct access to the bioinformatics tools and to the FASTQ folders.
- The **frontend** can be served in three ways: by nginx in Docker (web), by the Vite dev server, or as an Electron desktop app.

## Requirements

| Component | Notes |
|---|---|
| Linux, or Windows + **WSL2** (Ubuntu) | The backend and the pipeline run on Linux |
| **conda** environment `cnv_pipeline` | Created from `environment.yml`, which pins every tool version (see [Software versions](#software-versions)) |
| **ClassifyCNV** 1.1.1 | Installed separately under `tools/ClassifyCNV/` (or `~/ClassifyCNV/`); see [Licence](#licence) |
| **Reference genome** | `reference/hg19.fasta` and/or `reference/hg38.fasta`; the user picks the build per run. Missing BWA/samtools/Picard indexes are built automatically on the first run (for hg38 this can take more than an hour). |
| **Node.js 18+** | Only for frontend development or Electron |
| **Docker** | Only for serving the web frontend with Docker |

> The reference genome with its indexes (~8 GB) and the `tools/` folder are not included in the repository because of their size.

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/kadersaribulak/CNVDetect.git
cd CNVDetect

# 2. Create the conda environment (pipeline tools + backend, pinned versions)
conda env create -f environment.yml
conda activate cnv_pipeline

# 3. Reference genome
mkdir -p reference
#   Place hg19.fasta and/or hg38.fasta in reference/ (paths: refHg19 / refHg38 in config.json)

# 4. ClassifyCNV (not redistributed with CNVDetect)
git clone https://github.com/Genotek/ClassifyCNV.git tools/ClassifyCNV
#   See ClassifyCNV's own README for setup and resource files

# 5. (Optional) Refresh the full gene coordinate database
python3 backend/download_genes.py
```

On startup the backend checks every configured path and prints `✓` or `✗` for each one, so missing components are easy to spot.

## Running

### Web (recommended): backend in WSL, frontend in Docker

```bash
# Terminal 1: backend
conda activate cnv_pipeline
cd backend
uvicorn main:app --host 0.0.0.0 --port 8765

# Terminal 2: frontend
sudo docker compose up -d --build
```

Open **http://localhost:3001** in your browser. nginx forwards API and WebSocket requests to the backend at `host.docker.internal:8765`.

> ⚠️ `--host 0.0.0.0` exposes the backend to your network, so only use it on a trusted network. The backend never accepts script paths from the client: every script it runs is read from `config.json`.

### Development mode (Vite + Electron)

```bash
# Terminal 1: backend
cd backend && uvicorn main:app --host 127.0.0.1 --port 8765

# Terminal 2: frontend
npm install
npm run dev     # Vite (http://localhost:5173) + Electron window
npm run web     # Vite only, for the browser
```

Vite proxies `/api`, `/ws` and `/health` to `localhost:8765` automatically.

### Desktop package (Electron)

```bash
npm run build   # builds an AppImage / dmg / nsis installer into dist-electron/
```

The package bundles the backend and the pipeline scripts. Python, the pipeline tools, the reference genome and ClassifyCNV must still be installed on the target machine.

## Usage

| Step | What to do |
|---|---|
| **1. Panel** | Choose the genome build (hg19 or hg38); the run uses the matching reference. Then use the institutional panel, add a clinical preset, type gene names or upload a BED file. A BED preview is shown on the right. |
| **2. Samples** | Optional sex stratification. Sample names are filled in from the FASTQ folder; set Male/Female for each sample or import a TSV. |
| **3. Run** | Click the **FASTQ Folder** box and select the folder that contains the FASTQ files; the number of files and samples is shown. Enter an output folder name, adjust the thread count and the "Keep BAM files" option if needed, then start. The output folder is created next to the FASTQ folder. |
| **4. Results** | Load `*_consensus_cnvs.tsv` and `CNV_Final_Summary_Report.tsv`. CNVs are matched to their classification by sample, chromosome, start position and type. |

**FASTQ naming:** `<SAMPLE>_S<n>_L001_R1_001.fastq.gz` / `..._R2_001.fastq.gz` (Illumina convention). The `_S<n>` suffix is stripped from sample names automatically.

**Sex file format** (tab-separated, header row required):

```
Pool	Gender
R462-POOL-37	Male
R462-POOL-38	Female
```

## Outputs

```
<output folder>/
├── Male/  Female/  All/                  # when sex stratification is on
│   ├── qc/                               # flagstat, samtools stats, on-target depth
│   ├── cnvkit/                           # .cnr, .cns, .call.cns, plots
│   ├── exomedepth/                       # per-sample ExomeDepth results
│   ├── <prefix>_consensus_cnvs.tsv       # HIGH and MEDIUM consensus calls
│   ├── <prefix>_union_cnvs.tsv           # every call from CNVkit (segments, bintest) and ExomeDepth
│   └── CNV_Final_Summary_Report.tsv      # ClassifyCNV classification
├── <folder>_CNV_Final_Report.xlsx        # combined Excel report for all groups
└── <folder>_CNV_Final_Report.tsv
```

BAM files are deleted at the end of the run unless "Keep BAM files" is selected.

### Confidence levels

Each row of `<prefix>_consensus_cnvs.tsv` has a `confidence` column:

| Level | Evidence | Rule |
|---|---|---|
| **HIGH** | Both callers | A CNVkit segment call and an ExomeDepth call of the same sample and type with ≥ 50% reciprocal overlap, **or** a CNVkit bintest region and an ExomeDepth call with ≥ 30% reciprocal overlap |
| **MEDIUM** | CNVkit bintest only | ≥ 3 consecutive significant bins (gap ≤ 1 kb), mean \|log2\| ≥ 0.5, seen in ≤ 50% of the samples of the run, and not overlapping a HIGH call of the same sample |

HIGH calls are confirmed by two independent methods. MEDIUM calls rest on strong bin-level evidence from CNVkit alone and should be reviewed (scatter plots, target depth) before they are acted on. Calls supported by only one caller that do not meet the MEDIUM rule appear only in the union file.

No Bayes factor or log2 cut-off is applied to the callers' output when the consensus is built. Suggested extra filters for manual review: ExomeDepth `BF > 10`, CNVkit `|log2| > 0.3`.

## Configuration

Settings are stored in `config.json`. Paths are relative to the project root; absolute paths also work. Restart the backend after changing it.

```json
{
  "refHg19":      "./reference/hg19.fasta",
  "refHg38":      "./reference/hg38.fasta",
  "instBedBuild": "hg19",
  "pipeline":     "./pipeline/cnv_pipeline_last.sh",
  "anno":         "./backend/cnv_anotation.sh",
  "instBed":      "./backend/institutional_panel.bed",
  "classifyCNV":  "./tools/ClassifyCNV/ClassifyCNV.py"
}
```

**Genome build (hg19 / hg38).** The user chooses the build for every run in the Panel step. The run aligns against `refHg19` or `refHg38` and ClassifyCNV classifies with the same build. Only one of the two FASTA files is required; a build whose FASTA is missing is shown as unavailable. Chromosome names in the target BED (`chr17` or `17`) are adapted automatically to the naming used by the chosen FASTA. An older `config.json` with a single `ref` (and `genomeBuild`) is still accepted.

`instBed` is optional, and `instBedBuild` is the build its coordinates are in; the panel can only be used with that build. The in-house panel BED is not distributed with the repository, and the **Institutional panel** option is shown only when the backend finds this file. To offer your institution's fixed panel, save its BED file as `backend/institutional_panel.bed` (or point `instBed` to it) and restart the backend. Without it, the option is hidden and the other panel options (presets, gene names, BED upload) work as usual.

## Running the pipeline from the command line

The pipeline can also be used without the interface:

```bash
bash pipeline/cnv_pipeline_last.sh \
    --input   /path/to/FASTQ \
    --output  /path/to/CNV_output \
    --prefix  cohort_A \
    --ref     reference/hg19.fasta \
    --bed     /path/to/panel_targets.bed \
    --genders genders.txt \
    --threads 8

GENOME_BUILD=hg19 bash backend/cnv_anotation.sh /path/to/CNV_output/Male tools/ClassifyCNV/ClassifyCNV.py
```

For all options: `bash pipeline/cnv_pipeline_last.sh --help`

**Example panel.** `examples/example_panel_hg19.bed` lists 12 hereditary cancer genes (BRCA1, BRCA2, TP53, MLH1, MSH2, MSH6, PMS2, APC, PTEN, ATM, CHEK2, PALB2) as whole-gene regions with ±50 bp padding, in the same format the BED builder produces. For a real analysis, use the capture design of your panel.

## Project structure

```
CNVDetect/
├── backend/
│   ├── main.py                 # FastAPI: BED generation, uploads, merging, pipeline WebSocket
│   ├── cnv_anotation.sh        # Classification with ClassifyCNV
│   ├── download_genes.py       # Builds the gene coordinate DB from UCSC refGene
│   ├── genes_db.json           # hg19 / hg38 gene coordinates
│   └── institutional_panel.bed # (not in the repo) optional in-house panel BED
├── pipeline/
│   └── cnv_pipeline_last.sh    # BWA → Picard → CNVkit + ExomeDepth → Consensus
├── src/                        # React frontend (pages, components, EN/TR translations)
├── electron/                   # Desktop shell
├── examples/                   # Example panel BED (hg19)
├── config.json                 # Reference build, script and tool paths
├── environment.yml             # Pinned conda environment
├── Dockerfile, nginx.conf, docker-compose.yml   # Web frontend
└── reference/, tools/          # (not in the repo) reference genome and ClassifyCNV
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Backend service is down" in the interface | Check that the backend is running: `curl http://localhost:8765/health`. With Docker, start it with `--host 0.0.0.0`. |
| API requests return `502` (Docker) | The backend is not running, or it only listens on `127.0.0.1`. |
| `Bind for 0.0.0.0:3001 failed: port is already allocated` | An old container is holding the port. Check with `sudo docker ps -a`, then remove the old container or change the port in `docker-compose.yml`. |
| Annotation produces no results | Check that the `classifyCNV` line in the backend startup log shows `✓`. |
| `$'\r': command not found` | A script has CRLF line endings. The repository's `.gitattributes` prevents this; to fix a file by hand, run `sed -i 's/\r$//' file.sh`. |
| The WSL / Docker disk keeps growing | Check with `sudo docker system df`; the build cache can be cleared with `sudo docker builder prune`. WSL's `ext4.vhdx` does not shrink by itself when space is freed inside it; compact it with `diskpart` → `compact vdisk`. |
| "hg38 reference FASTA not found" | Add the FASTA for that build to `reference/` or fix `refHg19` / `refHg38` in `config.json`, then restart the backend. |
| "The institutional panel is in hg19 coordinates" | The in-house panel can only be used with the build in `instBedBuild`. Choose that build in the Panel step. |

## Software versions

Versions of the environment used to develop and run CNVDetect 2.0.0 (pinned in `environment.yml`):

| Software | Version |
|---|---|
| BWA (BWA-MEM) | 0.7.19 |
| samtools / htslib | 1.23.1 |
| Picard | 3.4.0 |
| CNVkit | 0.9.13 |
| R | 4.4.3 |
| ExomeDepth | 1.1.18 |
| GenomicRanges | 1.58.0 |
| bedtools | 2.31.1 |
| ClassifyCNV | 1.1.1 (commit 148757c) |
| Python | 3.10.20 |
| FastAPI / uvicorn | 0.136.0 / 0.44.0 |
| pandas / openpyxl | 2.3.3 / 3.1.5 |

## Licence

CNVDetect is released under the [MIT License](LICENSE).

The external tools keep their own licences. ClassifyCNV is distributed by its authors under its own licence, which allows free use for academic instruction and research only and does not allow redistribution. It is therefore not included in this repository and must be installed separately from [Genotek/ClassifyCNV](https://github.com/Genotek/ClassifyCNV); commercial use requires a licence from its authors.
