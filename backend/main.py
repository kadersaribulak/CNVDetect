from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd, io, re, json, os, pathlib, asyncio, tempfile, signal, glob
import datetime as _dt
import threading as _threading
from urllib.parse import urlparse

app = FastAPI(title="CNVDetect API", version="2.0.0")

# ── CORS ─────────────────────────────────────────────────────────────────────
# Only the local UI may call the API from a browser:
#   - Vite dev server / local pages (http://localhost:<port>, http://127.0.0.1:<port>)
#   - packaged Electron (file:// pages send Origin "null")
# Behind nginx the UI is same-origin, so no CORS is needed there.
_LOCAL_ORIGIN_RE = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=_LOCAL_ORIGIN_RE,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _ws_origin_allowed(ws: WebSocket) -> bool:
    """Browsers do not apply CORS to WebSockets, so check the Origin manually."""
    origin = ws.headers.get("origin")
    if not origin or origin == "null":
        return True  # non-browser client or packaged Electron (file://)
    if re.match(_LOCAL_ORIGIN_RE, origin):
        return True
    # Same-origin through a reverse proxy (nginx): Origin host == Host header
    host = ws.headers.get("x-forwarded-host") or ws.headers.get("host", "")
    return urlparse(origin).netloc == host

# ── Pipeline Status Tracker ───────────────────────────────────────────────────
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

# ── Config.json loader ────────────────────────────────────────────────────────
_APP_ROOT = pathlib.Path(__file__).resolve().parent.parent  # CNVDetect/
_CONFIG_PATH = _APP_ROOT / "config.json"

_CONFIG_DEFAULTS = {
    "ref":         "reference/hg19.fasta",
    "pipeline":    "pipeline/cnv_pipeline_last.sh",
    "anno":        "backend/cnv_anotation.sh",
    "instBed":     "backend/targets_merged.bed",
    "classifyCNV": "tools/ClassifyCNV/ClassifyCNV.py",
}

def _load_config():
    """Read config.json (if present) and resolve every path relative to APP_ROOT.
    Absolute paths in config.json are used as-is — works on any machine."""
    raw = dict(_CONFIG_DEFAULTS)
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
            raw.update({k: v for k, v in user_cfg.items() if k in _CONFIG_DEFAULTS and v})
        except Exception as e:
            print(f"[CNVDetect] Could not read config.json, using defaults: {e}")
    cfg = {}
    for k, v in raw.items():
        p = pathlib.Path(v)
        cfg[k] = str(p if p.is_absolute() else (_APP_ROOT / p).resolve())
        if pathlib.Path(cfg[k]).exists():
            print(f"[CNVDetect] ✓ {k}: {cfg[k]}")
        else:
            print(f"[CNVDetect] ✗ {k} NOT FOUND: {cfg[k]}")
    return cfg

APP_CONFIG = _load_config()

@app.get("/api/config")
async def get_config():
    """Returns resolved app config paths for frontend."""
    return APP_CONFIG

# ── Institutional BED ────────────────────────────────────────────────────────
_INST_BED_PATH = pathlib.Path(APP_CONFIG["instBed"])
_INST_BED = ""
if _INST_BED_PATH.exists():
    _INST_BED = _INST_BED_PATH.read_text(encoding="utf-8").strip()
    print(f"[CNVDetect] Institutional BED loaded: {len(_INST_BED.splitlines())} regions")

# ── Helpers ──────────────────────────────────────────────────────────────────
def nt(v):
    s=str(v or "").upper()
    if "DEL" in s: return "DEL"
    if "DUP" in s or "GAIN" in s: return "DUP"
    return s

def nc(v): return re.sub(r"^chr","",str(v or ""),flags=re.IGNORECASE).strip()

def npos(v):
    """Normalise a genomic position so '12345', '12345.0' and ' 12345 ' compare equal."""
    s = str(v or "").strip()
    try:
        return str(int(round(float(s))))
    except ValueError:
        return s

def parse(b):
    t=b.decode("utf-8",errors="replace")
    sep="\t" if "\t" in t.split("\n")[0] else ","
    return pd.read_csv(io.StringIO(t),sep=sep,dtype=str).fillna("")

FASTQ_SUFFIXES = ["_L001_R1_001.fastq.gz", "_R1_001.fastq.gz", "_R1.fastq.gz"]

def _scan_fastq_samples(folder):
    """Return {sample_without_S##: full_sample_name} for R1 FASTQs in folder."""
    found = {}
    for pattern in ["*" + s for s in FASTQ_SUFFIXES]:
        for f in glob.glob(os.path.join(folder, pattern)):
            name = os.path.basename(f)
            for suffix in FASTQ_SUFFIXES:
                if name.endswith(suffix):
                    full = name[:-len(suffix)]
                    found[re.sub(r'_S\d+$', '', full)] = full
                    break
    return found

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
    # Index annotation rows by Pool_ID + Chr + Start + Type (ignore Source — filenames differ).
    # Start is normalised numerically: the annotation script rounds it with %.0f.
    index={}
    for a in anno:
        key=(str(a.get("Pool_ID","")).strip(), nc(a.get("Chr","")),
             npos(a.get("Start","")), nt(a.get("Type","")))
        index.setdefault(key,a)
    merged=[];matched=0
    for r in base:
        key=(str(r.get("sample","")).strip(), nc(r.get("chromosome","")),
             npos(r.get("start","")), nt(r.get("type","")))
        hit=index.get(key)
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
    """Validate paths before running pipeline. Script paths come from config.json only."""
    errors = []
    fastq_dir  = payload.get("fastqDir","")
    output_dir = payload.get("outputDir","")
    bed        = payload.get("bed","")
    ref        = APP_CONFIG["ref"]
    pipeline   = APP_CONFIG["pipeline"]

    if not fastq_dir:  errors.append("FASTQ dizini belirtilmedi")
    elif not os.path.isabs(fastq_dir): errors.append(f"FASTQ dizini tam yol olmalı: {fastq_dir}")
    elif not os.path.isdir(fastq_dir): errors.append(f"FASTQ dizini bulunamadı: {fastq_dir}")

    if not output_dir: errors.append("Çıktı dizini belirtilmedi")
    elif not os.path.isabs(output_dir): errors.append(f"Çıktı dizini tam yol olmalı: {output_dir}")

    if not os.path.isfile(ref): errors.append(f"Referans FASTA bulunamadı: {ref}")

    if bed:
        if not os.path.isfile(bed): errors.append(f"BED dosyası bulunamadı: {bed}")
    else:
        errors.append("BED dosyası belirtilmedi")

    if not os.path.isfile(pipeline):
        errors.append(f"Pipeline scripti bulunamadı: {pipeline}")

    return {"valid": len(errors)==0, "errors": errors}


# ── Fast folder finder ──────────────────────────────────────────────────────
# Large/system folders that never contain FASTQ runs — skipping them keeps the search fast
_SKIP_DIRS = {"AppData", "node_modules", "site-packages", "$Recycle.Bin", "Windows",
              "Program Files", "Program Files (x86)", "ProgramData", "__pycache__"}

@app.get("/api/find-folder")
async def find_folder(name: str, file: str = ""):
    """
    Find a folder by name. If a filename inside the folder is provided,
    use it to disambiguate between multiple matches.
    """
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return {"path": "", "name": name}
    try:
        home = str(pathlib.Path.home())
    except Exception:
        home = "/root"

    mnt_users = "/mnt/c/Users"
    roots = []
    if os.path.isdir(mnt_users):
        try:
            for user in os.listdir(mnt_users):
                upath = os.path.join(mnt_users, user)
                if os.path.isdir(upath):
                    roots.append(upath)
        except OSError:
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
                elif depth < 4 and not entry.name.startswith(".") and entry.name not in _SKIP_DIRS:
                    search(entry.path, depth + 1)
        except OSError:
            pass

    def run_search():
        for root in roots:
            if os.path.isdir(root):
                search(root)

    # Filesystem walk is blocking — keep it off the event loop
    await asyncio.to_thread(run_search)

    if not candidates:
        return {"path": "", "name": name}

    # If only one match, return it
    if len(candidates) == 1:
        return {"path": candidates[0], "name": name}

    # Multiple matches — use file hint to pick the right one
    if file and "/" not in file and "\\" not in file:
        hits = [c for c in candidates if os.path.exists(os.path.join(c, file))]
        if len(hits) == 1:
            return {"path": hits[0], "name": name}
        if hits:
            candidates = hits

    # Still ambiguous — return the most specific path; the UI lets the user edit it
    candidates.sort(key=lambda p: p.count('/'), reverse=True)
    return {"path": candidates[0], "name": name, "ambiguous": True}

# ── Server-side folder browser (read-only) ──────────────────────────────────
# The browser's own folder dialog hides files and cannot return a full path, so the UI
# navigates folders through the backend instead. Only names are listed — never contents.
_FASTQ_EXTS = (".fastq.gz", ".fq.gz", ".fastq", ".fq")
_WIN_SYSTEM_USERS = {"Public", "Default", "Default User", "All Users", "defaultuser0", "WDAGUtilityAccount"}

def _windows_user_dirs():
    """Real Windows user profile folders under /mnt/c/Users (WSL)."""
    base = "/mnt/c/Users"
    if not os.path.isdir(base):
        return []
    try:
        names = os.listdir(base)
    except OSError:
        return []
    return [os.path.join(base, n) for n in sorted(names)
            if n not in _WIN_SYSTEM_USERS and not n.startswith(".")
            and os.path.isdir(os.path.join(base, n, "Desktop"))]

def _browse_shortcuts():
    items = []
    for u in _windows_user_dirs():
        for sub, tr in [("Desktop", "Masaüstü"), ("Documents", "Belgeler"), ("Downloads", "İndirilenler")]:
            p = os.path.join(u, sub)
            if os.path.isdir(p):
                items.append({"label": tr, "path": p})
    home = str(pathlib.Path.home())
    items.append({"label": "Linux Home", "path": home})
    if os.path.isdir("/mnt/c"):
        items.append({"label": "C:", "path": "/mnt/c"})
    return items

@app.get("/api/browse")
async def browse(path: str = ""):
    if not path:
        users = _windows_user_dirs()
        path = os.path.join(users[0], "Desktop") if len(users) == 1 else str(pathlib.Path.home())
    path = os.path.normpath(path)
    if not os.path.isabs(path) or not os.path.isdir(path):
        return {"error": f"Klasör bulunamadı: {path}", "path": path, "shortcuts": _browse_shortcuts()}

    def listing():
        dirs, fastqs, others = [], [], 0
        with os.scandir(path) as it:
            for e in it:
                if e.name.startswith((".", "$")):
                    continue
                try:
                    if e.is_dir():
                        dirs.append(e.name)
                    elif e.name.lower().endswith(_FASTQ_EXTS):
                        fastqs.append(e.name)
                    else:
                        others += 1
                except OSError:
                    pass
        return dirs, fastqs, others

    try:
        dirs, fastqs, others = await asyncio.to_thread(listing)
    except PermissionError:
        return {"error": f"Erişim izni yok: {path}", "path": path, "shortcuts": _browse_shortcuts()}

    parent = os.path.dirname(path)
    return {
        "path": path,
        "parent": parent if parent != path else None,
        "dirs": sorted(dirs, key=str.lower),
        "fastqs": sorted(fastqs, key=str.lower),
        "samples": sorted(_scan_fastq_samples(path).keys()),  # names the pipeline will detect
        "otherFiles": others,
        "shortcuts": _browse_shortcuts(),
    }

# ── Detect sample names from FASTQ folder ───────────────────────────────────
@app.get("/api/detect-samples")
async def detect_samples(folder: str):
    """Scan a FASTQ folder and return detected sample names (without _L001_R1_001 suffix)."""
    if not os.path.isabs(folder) or not os.path.isdir(folder):
        return {"samples": [], "error": f"Folder not found: {folder}"}
    return {"samples": sorted(_scan_fastq_samples(folder).keys())}

# ── Process helpers ─────────────────────────────────────────────────────────
# Start child processes in their own session so the whole tree (bwa, samtools, R…) can be killed
_SESSION_KW = {"start_new_session": True} if os.name == "posix" else {}

def _kill_proc(proc):
    if proc is None or proc.returncode is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
    except ProcessLookupError:
        pass
    except Exception:
        try: proc.kill()
        except Exception: pass

def _safe_prefix(v):
    return re.sub(r"[^\w.-]", "_", str(v or "").strip()) or "analiz"

# ── Pipeline WebSocket ───────────────────────────────────────────────────────
@app.websocket("/ws/pipeline")
async def run_pipeline(ws: WebSocket):
    if not _ws_origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()

    state = {"proc": None, "stopped": False}
    tmp_files = []
    watcher = None
    owns_status = False

    async def send(obj):
        """Send to the client; a failed send means the client is gone → stop work."""
        try:
            await ws.send_json(obj)
            return True
        except Exception:
            state["stopped"] = True
            _kill_proc(state["proc"])
            return False

    try:
        cfg = json.loads(await ws.receive_text())

        with _status_lock:
            if _pipeline_status["running"]:
                busy = True
            else:
                busy = False
                _pipeline_status["running"] = True
        if busy:
            await send({"type": "error", "msg": "Zaten çalışan bir analiz var. Bitmesini bekleyin veya durdurun."})
            return
        owns_status = True

        # Script and reference paths come ONLY from config.json — never from the client
        pipeline    = APP_CONFIG["pipeline"]
        anno_script = APP_CONFIG["anno"]
        classify_py = APP_CONFIG["classifyCNV"]
        ref         = APP_CONFIG["ref"]

        fastq_dir   = str(cfg.get("fastqDir", "")).strip()
        output_dir  = str(cfg.get("outputDir", "")).strip()
        prefix      = _safe_prefix(cfg.get("prefix", "analiz"))
        bed         = str(cfg.get("bed", "")).strip()
        bed_text    = cfg.get("bedText", "")
        genders     = str(cfg.get("genders", "")).strip()
        genders_text = cfg.get("gendersText", "")
        do_anno     = bool(cfg.get("doAnno", True))
        keep_bams   = bool(cfg.get("keepBams", False))
        try:
            threads = max(1, min(64, int(cfg.get("threads", 5))))
        except (TypeError, ValueError):
            threads = 5

        # Only the institutional BED may be referenced by path; anything else is sent as text
        if bed and os.path.realpath(bed) != os.path.realpath(APP_CONFIG["instBed"]):
            bed = ""
        if not bed and bed_text:
            tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".bed", delete=False, prefix="cnvdetect_")
            tmp.write(bed_text if bed_text.endswith("\n") else bed_text + "\n")
            tmp.close()
            tmp_files.append(tmp.name)
            bed = tmp.name
            await send({"type": "info", "msg": f"BED geçici dosyaya yazıldı: {bed}"})

        # Genders file given as a path must exist; otherwise inline content is used
        if genders and (genders.startswith("inline:") or not os.path.isfile(genders)):
            genders = ""
        if genders_text and not genders:
            # Match genders pool IDs to actual FASTQ sample names
            lines = genders_text.strip().split('\n')
            header = lines[0] if lines else 'Pool\tGender'
            fastq_samples = _scan_fastq_samples(fastq_dir) if os.path.isdir(fastq_dir) else {}
            resolved_lines = [header]
            for line in lines[1:]:
                parts = line.split('\t')
                if len(parts) >= 2:
                    pool_id, gender = parts[0].strip(), parts[1].strip()
                    resolved_lines.append(f"{fastq_samples.get(pool_id, pool_id)}\t{gender}")
            tmp_g = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, prefix="cnvdetect_genders_")
            tmp_g.write('\n'.join(resolved_lines) + '\n')
            tmp_g.close()
            tmp_files.append(tmp_g.name)
            genders = tmp_g.name

        # ── Validation ──
        errors = []
        if not fastq_dir or not os.path.isabs(fastq_dir) or not os.path.isdir(fastq_dir):
            errors.append(f"FASTQ klasörü bulunamadı (tam yol gerekli): {fastq_dir or '-'}")
        if not output_dir or not os.path.isabs(output_dir):
            errors.append(f"Çıktı klasörü tam yol olmalı: {output_dir or '-'}")
        if not bed:
            errors.append("BED belirtilmedi")
        if not os.path.isfile(ref):
            errors.append(f"Referans FASTA bulunamadı: {ref}")
        if not os.path.isfile(pipeline):
            errors.append(f"Pipeline scripti bulunamadı: {pipeline}")
        if errors:
            for e in errors:
                await send({"type": "error", "msg": e})
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

        _update_status(running=True, output_dir=output_dir, prefix=prefix,
                       started_at=_dt.datetime.now().isoformat(), step="starting", steps_done=[], last_log="")
        await send({"type": "info", "msg": "▶ Pipeline başlatılıyor..."})
        await send({"type": "cmd", "msg": " ".join(cmd)})

        os.makedirs(output_dir, exist_ok=True)

        # Watch the socket: a "stop" message or a disconnect kills the running process tree
        async def _watch():
            try:
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    text = msg.get("text")
                    if text:
                        try:
                            if json.loads(text).get("action") == "stop":
                                break
                        except Exception:
                            pass
            except Exception:
                pass
            state["stopped"] = True
            _kill_proc(state["proc"])
        watcher = asyncio.create_task(_watch())

        state["proc"] = proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=os.path.dirname(pipeline) or ".",
            **_SESSION_KW,
        )

        loop = asyncio.get_running_loop()
        last_ping = loop.time()
        async for line in proc.stdout:
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                if not await send({"type": "log", "msg": text}):
                    break
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
            # Keepalive ping every 30 seconds to prevent proxy timeouts
            now = loop.time()
            if now - last_ping > 30:
                if not await send({"type": "ping", "msg": "..."}):
                    break
                last_ping = now

        retcode = await proc.wait()
        state["proc"] = None

        if state["stopped"]:
            _update_status(running=False, step="stopped")
            await send({"type": "error", "msg": "■ Analiz kullanıcı tarafından durduruldu."})
            return

        # Annotation runs on every folder that contains a consensus file
        anno_dirs = []
        if do_anno and os.path.isfile(anno_script):
            candidate_dirs = [os.path.join(output_dir, s) for s in ["Male", "Female", "All"]] if genders else [output_dir]
            for d in candidate_dirs:
                if os.path.isdir(d) and any(f.endswith("_consensus_cnvs.tsv") for f in os.listdir(d)):
                    anno_dirs.append(d)

        if retcode == 0:
            await send({"type": "success", "msg": "✓ Pipeline tamamlandı!"})
        else:
            await send({"type": "warning", "msg": f"⚠ Pipeline hata koduyla bitti ({retcode}) — annotation yine de deneniyor."})

        if anno_dirs:
            _update_status(step="Annotation")
            await send({"type": "info", "msg": f"▶ Annotation başlatılıyor... ({len(anno_dirs)} klasör)"})
            # Paths are passed as positional args ($0 $1 $2) — never interpolated into the shell string
            anno_shell = (
                'if command -v conda >/dev/null 2>&1; then '
                'source "$(conda info --base)/etc/profile.d/conda.sh" && conda activate cnv_pipeline; '
                'fi; exec bash "$0" "$1" "$2"'
            )
            for d in anno_dirs:
                if state["stopped"]:
                    break
                await send({"type": "log", "msg": f"  📂 Annotation: {os.path.basename(d)}"})
                try:
                    state["proc"] = aproc = await asyncio.create_subprocess_exec(
                        "bash", "-c", anno_shell, anno_script, d, classify_py,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                        **_SESSION_KW,
                    )
                    async for line in aproc.stdout:
                        line_text = line.decode("utf-8", "replace").rstrip()
                        if line_text and not await send({"type": "log", "msg": line_text}):
                            break
                    await aproc.wait()
                    state["proc"] = None
                except Exception as ae:
                    await send({"type": "warning", "msg": f"Annotation hatası ({os.path.basename(d)}): {ae}"})

            if state["stopped"]:
                _update_status(running=False, step="stopped")
                return

            # Collect all summary reports from root and subfolders
            found_summaries = []
            seen = set()
            root_summary = os.path.join(output_dir, "CNV_Final_Summary_Report.tsv")
            for label, s in [("All", root_summary)] + [(os.path.basename(d), os.path.join(d, "CNV_Final_Summary_Report.tsv")) for d in anno_dirs]:
                if os.path.isfile(s) and os.path.realpath(s) not in seen:
                    seen.add(os.path.realpath(s))
                    found_summaries.append((label, s))

            if found_summaries:
                await send({"type": "info", "msg": f"📊 {len(found_summaries)} summary birleştiriliyor..."})
                try:
                    prefix_name = os.path.basename(output_dir.rstrip("/"))
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

                    await send({"type": "success", "msg": f"✓ Annotation tamamlandı! → {merged_xlsx}"})
                except Exception as me:
                    await send({"type": "warning", "msg": f"⚠ Excel birleştirme hatası: {me}"})
                    for label, s in found_summaries:
                        await send({"type": "info", "msg": f"  → {label}: {s}"})
            else:
                await send({"type": "info", "msg": "⚠ Annotation summary bulunamadı."})
        elif do_anno:
            if not os.path.isfile(anno_script):
                await send({"type": "warning", "msg": f"⚠ Annotation scripti bulunamadı: {anno_script}"})
            else:
                await send({"type": "warning", "msg": "⚠ Annotation: consensus dosyası bulunamadı, annotation atlandı."})

        if retcode != 0:
            await send({"type": "error", "msg": f"✗ Pipeline hata kodu: {retcode}"})

        _update_status(running=False, step="completed" if retcode == 0 else "failed")
        await send({"type": "done", "msg": "Tüm işlemler tamamlandı.", "outputDir": output_dir})

    except WebSocketDisconnect:
        state["stopped"] = True
    except Exception as e:
        await send({"type": "error", "msg": f"✗ Hata: {str(e)}"})
    finally:
        if watcher:
            watcher.cancel()
        _kill_proc(state["proc"])
        if owns_status:
            with _status_lock:
                if _pipeline_status["running"]:
                    _pipeline_status["running"] = False
                    _pipeline_status["step"] = "stopped" if state["stopped"] else "failed"
        for f in tmp_files:
            try: os.remove(f)
            except OSError: pass
        # Close explicitly so the client gets onclose right away
        try: await ws.close()
        except Exception: pass
