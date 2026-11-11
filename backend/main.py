from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd, io, re, json, os, pathlib, asyncio, tempfile
from collections import defaultdict

app = FastAPI(title="CNVDetect API", version="2.0.0")

# ── Pipeline Status Tracker ───────────────────────────────────────────────────
import threading as _threading
_pipeline_status = {
    "running": False, "output_dir": "", "prefix": "",
    "started_at": "", "last_log": "", "step": "", "steps_done": [],
}
_status_lock = _threading.Lock()

def _update_status(**kwargs):
    with _status_lock:
        _pipeline_status.update(kwargs)

@app.get("/api/pipeline-status")
async def pipeline_status_endpoint():
    with _status_lock:
        status = dict(_pipeline_status)
    if status["output_dir"] and os.path.isdir(status["output_dir"]):
        out = status["output_dir"]
        files = []
        for root, dirs, fnames in os.walk(out):
            for f in fnames:
                if f.endswith(("_consensus_cnvs.tsv","_CNV_Final_Report.xlsx","CNV_Final_Summary_Report.tsv")):
                    files.append(os.path.relpath(os.path.join(root,f), out))
        status["output_files"] = sorted(files)
    return status
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Gene DB ─────────────────────────────────────────────────────────────────
GENE_DB = {
  "hg19": {
    "BRCA1":("chr17",41196312,41277500),"BRCA2":("chr13",32889611,32973805),
    "TP53":("chr17",7571720,7590868),"EGFR":("chr7",55086725,55324313),
    "KRAS":("chr12",25358180,25403854),"MLH1":("chr3",37034841,37092337),
    "MSH2":("chr2",47630206,47789365),"MSH6":("chr2",48010221,48034092),
    "PMS2":("chr7",6012870,6048737),"APC":("chr5",112043200,112181936),
    "PTEN":("chr10",89622870,89731687),"ATM":("chr11",108093559,108239826),
    "CHEK2":("chr22",29083731,29137822),"PALB2":("chr16",23614403,23652631),
    "BRIP1":("chr17",59756481,60017818),"NBN":("chr8",90967711,91065088),
    "MLH1":("chr3",37034841,37092337),"MSH2":("chr2",47630206,47789365),
  },
  "hg38": {
    "BRCA1":("chr17",43044295,43125483),"BRCA2":("chr13",32315474,32400266),
    "TP53":("chr17",7668421,7687490),"EGFR":("chr7",55019017,55211628),
  }
}

_DB_PATH = pathlib.Path(__file__).parent / "genes_db.json"
def _load_gene_db():
    if _DB_PATH.exists():
        try:
            with open(_DB_PATH,"r",encoding="utf-8") as f:
                full = json.load(f)
            result = {}
            for build, genes in full.items():
                result[build] = {}
                for gene, coords in genes.items():
                    if isinstance(coords,(list,tuple)) and len(coords)==3:
                        result[build][gene] = (coords[0], int(coords[1]), int(coords[2]))
            total = sum(len(v) for v in result.values())
            print(f"[CNVDetect] Gene DB loaded: {total} entries")
            return result
        except Exception as e:
            print(f"[CNVDetect] Could not load genes_db.json: {e}")
    print(f"[CNVDetect] Using built-in DB")
    return GENE_DB

ACTIVE_GENE_DB = _load_gene_db()

# ── Institutional BED ────────────────────────────────────────────────────────
_INST_BED_PATH = pathlib.Path(__file__).parent / "targets_merged.bed"

# ── Config.json loader ────────────────────────────────────────────────────────
_APP_ROOT = pathlib.Path(__file__).parent.parent  # CNVDetect_fixed/
_CONFIG_PATH = _APP_ROOT / "config.json"

def _load_config():
    """Build config from relative paths inside CNVDetect folder.
    All paths are relative to APP_ROOT — works on any machine."""
    cfg = {
        "ref":         str(_APP_ROOT / "reference" / "hg19.fasta"),
        "pipeline":    str(_APP_ROOT / "pipeline"  / "cnv_pipeline_last.sh"),
        "anno":        str(_APP_ROOT / "backend"   / "cnv_anotation.sh"),
        "instBed":     str(_APP_ROOT / "backend"   / "targets_merged.bed"),
        "classifyCNV": str(_APP_ROOT / "tools"     / "ClassifyCNV" / "ClassifyCNV.py"),
    }
    # Validate each path exists
    for k, v in cfg.items():
        if pathlib.Path(v).exists():
            print(f"[CNVDetect] ✓ {k}: {v}")
        else:
            print(f"[CNVDetect] ✗ {k} NOT FOUND: {v}")
    return cfg

APP_CONFIG = _load_config()

@app.get("/api/config")
async def get_config():
    """Returns resolved app config paths for frontend."""
    return APP_CONFIG
_INST_BED = ""
if _INST_BED_PATH.exists():
    _INST_BED = _INST_BED_PATH.read_text(encoding="utf-8").strip()
    print(f"[CNVDetect] Institutional BED loaded: {len(_INST_BED.splitlines())} regions")

def nt(v):
    s=str(v or "").upper()
    if "DEL" in s: return "DEL"
    if "DUP" in s or "GAIN" in s: return "DUP"
    return s

def nc(v): return re.sub(r"^chr","",str(v or ""),flags=re.IGNORECASE).strip()

def parse(b):
    t=b.decode("utf-8",errors="replace")
    sep="\t" if "\t" in t.split("\n")[0] else ","
    return pd.read_csv(io.StringIO(t),sep=sep,dtype=str).fillna("")

# ── Basic endpoints ──────────────────────────────────────────────────────────
@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/api/genes")
def genes(build:str="hg19"):
    return sorted(ACTIVE_GENE_DB.get(build,ACTIVE_GENE_DB.get("hg19",{})).keys())

@app.get("/api/institutional-bed")
def institutional_bed():
    if _INST_BED:
        regions = len([l for l in _INST_BED.split("\n") if l.strip()])
        return {"bed": _INST_BED, "regions": regions, "name": "Kurumsal Panel"}
    return {"bed": "", "regions": 0, "name": "Kurumsal Panel (bulunamadı)"}

@app.post("/api/bed/generate")
async def bed(payload:dict):
    gs=payload.get("genes",[]);build=payload.get("build","hg19");pad=int(payload.get("padding",50))
    db=ACTIVE_GENE_DB.get(build,ACTIVE_GENE_DB.get("hg19",{}))
    lines=[];missing=[]
    for g in gs:
        gu=g.strip().upper()
        if gu in db:
            ch,st,en=db[gu]
            lines.append(f"{ch}\t{max(0,st-pad)}\t{en+pad}\t{gu}")
        else: missing.append(g)
    return {"bed":"\n".join(lines),"found":len(lines),"missing":missing}

@app.post("/api/upload/cnv")
async def upload_cnv(file:UploadFile=File(...)):
    content=await file.read()
    try:
        df=parse(content);cl={c.lower():c for c in df.columns}
        rows=[]
        for _,r in df.iterrows():
            def gv(*keys):
                for k in keys:
                    if k in cl: return str(r.get(cl[k],""))
                return ""
            rows.append({"sample":gv("sample","pool_id","pool","id"),
                "chromosome":nc(gv("chromosome","chr")),
                "start":gv("start"),"end":gv("end"),
                "type":nt(gv("type")),"cn":gv("cn"),
                "confidence":gv("confidence","bf"),
                "db_freq":gv("db_freq","frequency"),
                "db_n_samples":gv("db_n_samples","n_samples")})
        return {"rows":rows,"filename":file.filename,"count":len(rows)}
    except Exception as e: raise HTTPException(400,str(e))

@app.post("/api/upload/annotation")
async def upload_anno(file:UploadFile=File(...)):
    content=await file.read()
    try:
        df=parse(content)
        return {"rows":df.to_dict("records"),"filename":file.filename,"count":len(df)}
    except Exception as e: raise HTTPException(400,str(e))

@app.post("/api/merge")
async def merge(payload:dict):
    base=payload.get("cnv",[]);anno=payload.get("annotation",[])
    merged=[];matched=0
    for r in base:
        # Match on Pool_ID + Chr + Start + Type (ignore Source — filenames differ)
        hit=next((a for a in anno
            if str(a.get("Pool_ID","")).strip()==r["sample"]
            and nc(a.get("Chr",""))==nc(r["chromosome"])
            and str(a.get("Start","")).strip()==str(r.get("start","")).strip()
            and nt(a.get("Type",""))==nt(r.get("type",""))),None)
        if hit: matched+=1
        merged.append({**r,
            "classification":hit.get("Classification","") if hit else "",
            "score":hit.get("Score","") if hit else "",
            "genes":hit.get("Genes","") if hit else ""})
    return {"merged":merged,"matched":matched}

@app.post("/api/stats")
async def stats(payload:dict):
    rows=payload.get("rows",[])
    cm,tm,clm,sm={},{},{},{}
    for r in rows:
        c=nc(r.get("chromosome",""));t=nt(r.get("type",""))
        cl=str(r.get("classification","")).strip();s=str(r.get("sample","")).strip()
        if c: cm[c]=cm.get(c,0)+1
        if t: tm[t]=tm.get(t,0)+1
        if cl: clm[cl]=clm.get(cl,0)+1
        if s: sm[s]=sm.get(s,0)+1
    def sc(d):
        def k(x):
            try: return(0,int(x))
            except: return(1,x)
        return dict(sorted(d.items(),key=lambda x:k(x[0]))[:22])
    return {"total":len(rows),
        "deletions":sum(1 for r in rows if nt(r.get("type",""))=="DEL"),
        "duplications":sum(1 for r in rows if nt(r.get("type",""))=="DUP"),
        "samples":len(set(r.get("sample","") for r in rows if r.get("sample"))),
        "chr_counts":sc(cm),"type_counts":tm,
        "class_counts":dict(sorted(clm.items(),key=lambda x:-x[1])[:8]),
        "sample_counts":dict(sorted(sm.items(),key=lambda x:-x[1])[:14])}

# ── Pipeline runner ──────────────────────────────────────────────────────────
@app.post("/api/pipeline/validate")
async def validate_pipeline(payload: dict):
    """Validate paths before running pipeline"""
    errors = []
    fastq_dir  = payload.get("fastqDir","")
    output_dir = payload.get("outputDir","")
    ref        = payload.get("ref","")
    bed        = payload.get("bed","")
    pipeline   = payload.get("pipelineScript","")

    if not fastq_dir:  errors.append("FASTQ dizini belirtilmedi")
    elif not os.path.isdir(fastq_dir): errors.append(f"FASTQ dizini bulunamadı: {fastq_dir}")

    if not output_dir: errors.append("Çıktı dizini belirtilmedi")

    if ref and not os.path.isfile(ref): errors.append(f"Referans FASTA bulunamadı: {ref}")

    if bed:
        if not os.path.isfile(bed): errors.append(f"BED dosyası bulunamadı: {bed}")
    else:
        errors.append("BED dosyası belirtilmedi")

    if pipeline and not os.path.isfile(pipeline):
        errors.append(f"Pipeline scripti bulunamadı: {pipeline}")

    return {"valid": len(errors)==0, "errors": errors}


# ── Fast folder finder ──────────────────────────────────────────────────────
@app.get("/api/find-folder")
async def find_folder(name: str, file: str = ""):
    """
    Find a folder by name. If a filename inside the folder is provided,
    use it to disambiguate between multiple matches.
    """
    try:
        home = str(pathlib.Path.home())
    except:
        home = "/root"

    mnt_users = "/mnt/c/Users"
    roots = []
    if os.path.isdir(mnt_users):
        try:
            for user in os.listdir(mnt_users):
                upath = os.path.join(mnt_users, user)
                if os.path.isdir(upath):
                    # Search deeper — up to 4 levels
                    roots.append(upath)
        except:
            pass
    roots.append(home)

    candidates = []

    def search(root, depth=0):
        if depth > 4:
            return
        try:
            for entry in os.scandir(root):
                if not entry.is_dir(follow_symlinks=False):
                    continue
                if entry.name == name:
                    candidates.append(entry.path)
                elif depth < 4:
                    search(entry.path, depth + 1)
        except PermissionError:
            pass

    for root in roots:
        if os.path.isdir(root):
            search(root)

    if not candidates:
        return {"path": "", "name": name}

    # If only one match, return it
    if len(candidates) == 1:
        return {"path": candidates[0], "name": name}

    # Multiple matches — use file hint to pick the right one
    if file:
        for c in candidates:
            if os.path.exists(os.path.join(c, file)):
                return {"path": c, "name": name}

    # Return deepest path (most specific) as best guess
    candidates.sort(key=lambda p: p.count('/'), reverse=True)
    return {"path": candidates[0], "name": name}

# ── Detect sample names from FASTQ folder ───────────────────────────────────
@app.get("/api/detect-samples")
async def detect_samples(folder: str):
    """Scan a FASTQ folder and return detected sample names (without _L001_R1_001 suffix)."""
    if not os.path.isdir(folder):
        return {"samples": [], "error": f"Folder not found: {folder}"}
    import glob
    samples = []
    import re as _re
    for pattern in ["*_L001_R1_001.fastq.gz", "*_R1_001.fastq.gz", "*_R1.fastq.gz"]:
        for f in glob.glob(os.path.join(folder, pattern)):
            name = os.path.basename(f)
            for suffix in ["_L001_R1_001.fastq.gz", "_R1_001.fastq.gz", "_R1.fastq.gz"]:
                if name.endswith(suffix):
                    sample = name[:-len(suffix)]
                    # Strip _S## suffix (e.g. R462-POOL-37_S37 → R462-POOL-37)
                    sample = _re.sub(r'_S\d+$', '', sample)
                    samples.append(sample)
                    break
    return {"samples": sorted(set(samples))}

# ── Pipeline WebSocket ───────────────────────────────────────────────────────
@app.websocket("/ws/pipeline")
async def run_pipeline(ws: WebSocket):
    await ws.accept()
    try:
        raw = await ws.receive_text()
        cfg = json.loads(raw)

        fastq_dir   = cfg.get("fastqDir", "")
        output_dir  = cfg.get("outputDir", "")
        prefix      = cfg.get("prefix", "analiz")
        ref         = cfg.get("ref", "")
        bed         = cfg.get("bed", "")
        genders     = cfg.get("genders", "")
        genders_text = cfg.get("gendersText", "")

        # If genders content sent inline, write to tmp file
        if genders_text and (not genders or genders.startswith('inline:')):
            import re as _re, glob as _glob
            # Try to match genders pool IDs to actual FASTQ sample names
            lines = genders_text.strip().split('\n')
            header = lines[0] if lines else 'Pool\tGender'
            data_lines = lines[1:] if len(lines) > 1 else []

            # Scan FASTQ folder for real sample names
            fastq_samples = {}  # pool_id_stripped -> full_sample_name
            if fastq_dir and os.path.isdir(fastq_dir):
                for pattern in ["*_L001_R1_001.fastq.gz", "*_R1_001.fastq.gz", "*_R1.fastq.gz"]:
                    for f in _glob.glob(os.path.join(fastq_dir, pattern)):
                        bname = os.path.basename(f)
                        for sfx in ["_L001_R1_001.fastq.gz", "_R1_001.fastq.gz", "_R1.fastq.gz"]:
                            if bname.endswith(sfx):
                                full = bname[:-len(sfx)]
                                stripped = _re.sub(r'_S\d+$', '', full)
                                fastq_samples[stripped] = full
                                break

            resolved_lines = [header]
            for line in data_lines:
                parts = line.split('\t')
                if len(parts) >= 2:
                    pool_id, gender = parts[0].strip(), parts[1].strip()
                    # Use full FASTQ sample name if available
                    real_id = fastq_samples.get(pool_id, pool_id)
                    resolved_lines.append(f"{real_id}\t{gender}")

            tmp_g = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, prefix="cnvdetect_genders_")
            tmp_g.write('\n'.join(resolved_lines) + '\n')
            tmp_g.close()
            genders = tmp_g.name
        pipeline    = cfg.get("pipelineScript", "")
        do_anno     = cfg.get("doAnno", True)
        anno_script = cfg.get("annoScript", "")
        threads     = int(cfg.get("threads", 5))
        keep_bams   = cfg.get("keepBams", False)
        bed_text    = cfg.get("bedText", "")

        if not bed and bed_text:
            tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".bed", delete=False, prefix="cnvdetect_")
            tmp.write(bed_text)
            tmp.close()
            bed = tmp.name
            await ws.send_json({"type": "info", "msg": f"BED geçici dosyaya yazıldı: {bed}"})

        if not all([fastq_dir, output_dir, ref, bed, pipeline]):
            missing = [
                k for k, v in [
                    ("FASTQ", fastq_dir),
                    ("Output", output_dir),
                    ("Ref", ref),
                    ("BED", bed),
                    ("Pipeline", pipeline),
                ] if not v
            ]
            await ws.send_json({"type": "error", "msg": f"Eksik parametreler: {', '.join(missing)}"})
            return

        cmd = [
            "bash", pipeline,
            "--input", fastq_dir,
            "--output", output_dir,
            "--prefix", prefix,
            "--ref", ref,
            "--bed", bed,
        ]
        if genders:
            cmd += ["--genders", genders]
        cmd += ["--threads", str(threads)]
        if keep_bams:
            cmd += ["--keep-bams"]

        import datetime as _dt
        _update_status(running=True, output_dir=output_dir, prefix=prefix,
                       started_at=_dt.datetime.now().isoformat(), step="starting", steps_done=[], last_log="")
        await ws.send_json({"type": "info", "msg": "▶ Pipeline başlatılıyor..."})
        await ws.send_json({"type": "cmd", "msg": " ".join(cmd)})

        os.makedirs(output_dir, exist_ok=True)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=os.path.dirname(pipeline) or ".",
        )

        last_ping = asyncio.get_event_loop().time()
        async for line in proc.stdout:
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                await ws.send_json({"type": "log", "msg": text})
                # Update status tracker
                step = _pipeline_status.get("step", "")
                if "STEP 1" in text: step = "Alignment"
                elif "STEP 2" in text: step = "CNVkit"
                elif "STEP 3" in text: step = "ExomeDepth"
                elif "STEP 4" in text: step = "Consensus"
                elif "STEP 5" in text: step = "Cleanup"
                elif "Processing Male" in text: step = "Male-Alignment"
                elif "Processing Female" in text: step = "Female-Alignment"
                elif "Run complete" in text or "Pipeline finished" in text: step = "Done"
                _update_status(last_log=text[:200], step=step)
            # Send keepalive ping every 30 seconds to prevent timeout
            now = asyncio.get_event_loop().time()
            if now - last_ping > 30:
                try:
                    await ws.send_json({"type": "ping", "msg": "..."})
                    last_ping = now
                except:
                    break

        retcode = await proc.wait()

        # Run annotation regardless of retcode if pipeline produced output dirs
        # Also collect consensus files from Male/Female/All subfolders
        anno_dirs = []
        if do_anno and anno_script and os.path.isfile(anno_script):
            if genders:
                for sub in ["Male", "Female", "All"]:
                    d = os.path.join(output_dir, sub)
                    if os.path.isdir(d):
                        # Check if consensus file exists in this subdir
                        consensus_files = [
                            f for f in os.listdir(d)
                            if f.endswith("_consensus_cnvs.tsv")
                        ]
                        if consensus_files:
                            anno_dirs.append(d)
            else:
                consensus_files = [
                    f for f in os.listdir(output_dir)
                    if f.endswith("_consensus_cnvs.tsv")
                ] if os.path.isdir(output_dir) else []
                if consensus_files:
                    anno_dirs = [output_dir]

        if retcode == 0:
            await ws.send_json({"type": "success", "msg": "✓ Pipeline tamamlandı!"})
        else:
            await ws.send_json({"type": "warning", "msg": f"⚠ Pipeline hata koduyla bitti ({retcode}) — annotation yine de deneniyor."})

        if anno_dirs:
            await ws.send_json({"type": "info", "msg": f"▶ Annotation başlatılıyor... ({len(anno_dirs)} klasör)"})
            for d in anno_dirs:
                await ws.send_json({"type": "log", "msg": f"  📂 Annotation: {os.path.basename(d)}"})
                conda_run = f"source $(conda info --base)/etc/profile.d/conda.sh && conda activate cnv_pipeline && bash {anno_script} {d}"
                try:
                    aproc = await asyncio.create_subprocess_exec(
                        "bash", "-c", conda_run,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                    )
                    async for line in aproc.stdout:
                        line_text = line.decode("utf-8", "replace").rstrip()
                        if line_text:
                            await ws.send_json({"type": "log", "msg": line_text})
                    await aproc.wait()
                except Exception as ae:
                    await ws.send_json({"type": "warning", "msg": f"Annotation hatası ({os.path.basename(d)}): {ae}"})

            # Collect all summary reports from root and subfolders
            found_summaries = []
            root_summary = os.path.join(output_dir, "CNV_Final_Summary_Report.tsv")
            if os.path.isfile(root_summary):
                found_summaries.append(("All", root_summary))
            for d in anno_dirs:
                s = os.path.join(d, "CNV_Final_Summary_Report.tsv")
                if os.path.isfile(s):
                    found_summaries.append((os.path.basename(d), s))

            if found_summaries:
                await ws.send_json({"type": "info", "msg": f"📊 {len(found_summaries)} summary birleştiriliyor..."})
                try:
                    import pandas as pd
                    prefix_name = os.path.basename(output_dir)
                    merged_xlsx = os.path.join(output_dir, f"{prefix_name}_CNV_Final_Report.xlsx")
                    merged_tsv  = os.path.join(output_dir, f"{prefix_name}_CNV_Final_Report.tsv")

                    dfs = []
                    for label, s in found_summaries:
                        df = pd.read_csv(s, sep="\t")
                        df.insert(0, "Group", label)
                        dfs.append(df)

                    merged = pd.concat(dfs, ignore_index=True)
                    merged.to_csv(merged_tsv, sep="\t", index=False)

                    with pd.ExcelWriter(merged_xlsx, engine="openpyxl") as writer:
                        merged.to_excel(writer, sheet_name="All_Results", index=False)
                        for label, _ in found_summaries:
                            sub = merged[merged["Group"] == label]
                            if not sub.empty:
                                sub.to_excel(writer, sheet_name=label[:31], index=False)

                    await ws.send_json({"type": "success", "msg": f"✓ Annotation tamamlandı! → {merged_xlsx}"})
                except Exception as me:
                    await ws.send_json({"type": "warning", "msg": f"⚠ Excel birleştirme hatası: {me}"})
                    for label, s in found_summaries:
                        await ws.send_json({"type": "info", "msg": f"  → {label}: {s}"})
            else:
                await ws.send_json({"type": "info", "msg": "⚠ Annotation summary bulunamadı."})
        elif do_anno and anno_script:
            await ws.send_json({"type": "warning", "msg": "⚠ Annotation: consensus dosyası bulunamadı, annotation atlandı."})

        if retcode != 0:
            await ws.send_json({"type": "error", "msg": f"✗ Pipeline hata kodu: {retcode}"})

        _update_status(running=False, step="completed")
        await ws.send_json({"type": "done", "msg": "Tüm işlemler tamamlandı.", "outputDir": output_dir})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "msg": f"✗ Hata: {str(e)}"})
        except:
            pass

