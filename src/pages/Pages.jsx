import { useState, useMemo, useEffect, useRef } from 'react'
import { Plus, Trash2, Save, Upload, ArrowRight, ArrowLeft,
         FolderOpen, Copy, Check, ChevronUp, ChevronDown,
         Filter, X, Download, BarChart3, FileText, Activity,
         Play, Square, CheckCircle, XCircle, Info, StickyNote } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts'
import { useStore } from '../hooks/useStore'
import { useLang } from '../hooks/useLang'
import { pickFolder, saveFilePath, writeToDisk } from '../hooks/useElectron'
import { WizardLayout, Btn, Tag, SectionCard, Badge, ClassBadge, ConfBadge, UploadZone, StatCard } from '../components/UI'
import sp from './SamplesPage.module.css'
import rp from './RunPage.module.css'
import re from './ResultsPage.module.css'

// ─── SAMPLES PAGE ────────────────────────────────────────────────────────────
export function SamplesPage() {
  const { sampleRows, setSampleRows, useGender, setUseGender,
          genderPath, setGenderPath, fastqDir, goTo } = useStore()
  const { t, lang } = useLang()
  const [errors,  setErrors]  = useState([])
  const [saveMsg, setSaveMsg] = useState('')

  const addRow    = () => setSampleRows(r => [...r, { id:'', gender:'Male' }])
  const removeRow = i  => setSampleRows(r => r.filter((_,idx) => idx!==i))
  const update    = (i,f,v) => { setSampleRows(r => r.map((row,idx) => idx===i?{...row,[f]:v}:row)); setErrors([]) }

  const validate = () => {
    const errs=[]; const seen=new Set()
    sampleRows.forEach((r,i) => {
      if (!r.id.trim()) errs.push(`${i+1}`)
      else if (seen.has(r.id.trim())) errs.push(`${r.id}`)
      seen.add(r.id.trim())
    })
    setErrors(errs); return !errs.length
  }

  const getTsv = () => ['Pool\tGender', ...sampleRows.filter(r=>r.id.trim()).map(r=>`${r.id}\t${r.gender}`)].join('\n')

  const handleSave = async () => {
    if (!validate()) return
    // Web mode: always store TSV content in genderPath with prefix 'inline:'
    // so backend knows to write it to a tmp file
    const tsv = getTsv()
    setGenderPath('inline:' + tsv)
    // Also try Electron disk save if available
    const fp = await saveFilePath(t.samples.saveLocal, 'genders.txt', [{name:'Text',extensions:['txt','tsv']}])
    if (fp) {
      const r = await writeToDisk(fp, tsv)
      if (r.ok) { setGenderPath(fp); setSaveMsg(fp); setTimeout(()=>setSaveMsg(''),4000); return }
    }
    setSaveMsg(lang==='tr' ? '✓ Cinsiyet listesi kaydedildi' : '✓ Gender list saved')
    setTimeout(()=>setSaveMsg(''),3000)
  }

  const handleImport = e => {
    const f=e.target.files[0]; if(!f) return
    const reader=new FileReader()
    reader.onload=ev=>{
      const lines=ev.target.result.trim().replace(/\r/g,'').split('\n')
      const sep=lines[0].includes('\t')?'\t':','
      const data=lines.slice(1).map(l=>{const p=l.split(sep);return{id:(p[0]||'').trim(),gender:(p[1]||'Male').trim()}}).filter(r=>r.id)
      if(data.length){setSampleRows(data);setErrors([])}
    }
    reader.readAsText(f); e.target.value=''
  }

  const male   = sampleRows.filter(r=>r.gender==='Male').length
  const female = sampleRows.filter(r=>r.gender==='Female').length

  // Auto-load sample names from FASTQ folder when fastqDir is set and sampleRows is empty
  useEffect(() => {
    if (!fastqDir || !fastqDir.startsWith('/')) return
    if (sampleRows.filter(r => r.id.trim()).length > 0) return // already has data
    const API_HTTP = window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin
    fetch(API_HTTP + '/api/detect-samples?folder=' + encodeURIComponent(fastqDir))
      .then(r => r.json())
      .then(d => {
        if (d.samples && d.samples.length > 0 && sampleRows.filter(r=>r.id.trim()).length === 0) {
          setSampleRows(d.samples.map(s => ({ id: s, gender: 'Male' })))
        }
      })
      .catch(() => {})
  }, [fastqDir])

  // Auto-sync genderPath whenever sample rows change (web mode)
  useEffect(() => {
    if (!useGender) { setGenderPath(''); return }
    const rows = sampleRows.filter(r => r.id.trim())
    if (!rows.length) { setGenderPath(''); return }
    const tsv = ['Pool\tGender', ...rows.map(r => `${r.id}\t${r.gender}`)].join('\n')
    // Only set inline if not already a real file path
    if (!genderPath || genderPath.startsWith('inline:')) {
      setGenderPath('inline:' + tsv)
    }
  }, [sampleRows, useGender])

  return (
    <WizardLayout step={2} title={t.samples.title} subtitle={t.samples.subtitle}
      back={<Btn variant="default" size="lg" onClick={()=>goTo(1)}><ArrowLeft size={16}/> {t.samples.back}</Btn>}
      next={<Btn variant="primary" size="lg" onClick={()=>{ if(!useGender||validate()) goTo(3) }}>
        {t.samples.next} <ArrowRight size={16}/>
      </Btn>}
    >
      {/* Toggle gender */}
      <div className={sp.toggleCard} onClick={()=>setUseGender(v=>!v)}>
        <div className={`${sp.toggleKnob} ${useGender?sp.knobOn:''}`}><div className={sp.knobThumb}/></div>
        <div>
          <div className={sp.toggleTitle}>{lang==='tr'?'Cinsiyet stratifikasyonu':'Sex stratification'}</div>
          <div className={sp.toggleDesc}>{t.samples.genderHint}</div>
        </div>
      </div>

      {useGender && (
        <>
          {/* Stats row */}
          <div className={sp.statsRow}>
            <div className={sp.stat}><div className={sp.statN}>{sampleRows.length}</div><div className={sp.statL}>{t.samples.total}</div></div>
            <div className={`${sp.stat} ${sp.male}`}><div className={sp.statN}>{male}</div><div className={sp.statL}>{t.samples.males} ♂</div></div>
            <div className={`${sp.stat} ${sp.female}`}><div className={sp.statN}>{female}</div><div className={sp.statL}>{t.samples.females} ♀</div></div>
            <div className={sp.importWrap}>
              <label className={sp.importBtn} htmlFor="imp-gender">
                <input id="imp-gender" type="file" accept=".tsv,.txt,.csv" style={{display:'none'}} onChange={handleImport}/>
                <Upload size={13}/> {t.samples.importFile}
              </label>
              <Btn variant="success" size="sm" onClick={handleSave}><Save size={13}/> {t.samples.saveLocal}</Btn>
            </div>
          </div>

          {saveMsg && <div className={sp.saveMsg}>✓ {saveMsg}</div>}
          {genderPath && !genderPath.startsWith('inline:') && !saveMsg && <div className={sp.savedPath}>{genderPath}</div>}

          {/* Table */}
          <SectionCard>
            <div className={sp.tableHead}>
              <span>{lang==='tr'?'Örnek listesi':'Sample list'}</span>
              <Btn variant="default" size="sm" onClick={addRow}><Plus size={13}/> {t.samples.addRow}</Btn>
            </div>
            <div className={sp.tableWrap}>
              <table className={sp.table}>
                <thead><tr>
                  <th className={sp.thN}>#</th>
                  <th>{t.samples.sampleId}</th>
                  <th>{t.samples.gender}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {sampleRows.map((row,i)=>(
                    <tr key={i} className={sp.tr}>
                      <td className={sp.tdN}>{i+1}</td>
                      <td>
                        <input className={`${sp.idInput} ${!row.id.trim()&&errors.length?sp.err:''}`}
                          value={row.id} onChange={e=>update(i,'id',e.target.value)}
                          placeholder={lang==='tr'?'POOL-001':'POOL-001'}/>
                      </td>
                      <td>
                        <div className={sp.genderRow}>
                          {['Male','Female'].map(g=>(
                            <button key={g} onClick={()=>update(i,'gender',g)}
                              className={`${sp.gBtn} ${row.gender===g?(g==='Male'?sp.gMale:sp.gFemale):''}`}>
                              {g==='Male'?'♂ '+(lang==='tr'?'Erkek':'Male'):'♀ '+(lang==='tr'?'Kadın':'Female')}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td><button className={sp.delBtn} onClick={()=>removeRow(i)}><Trash2 size={13}/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className={sp.addRowBtn} onClick={addRow}><Plus size={12}/> {t.samples.addRow}</button>
          </SectionCard>
        </>
      )}
    </WizardLayout>
  )
}

const API_HTTP = window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin
const API_WS = API_HTTP.replace(/^http/, 'ws') + '/ws/pipeline'

export function RunPage() {
  const { genome, genes, bedText, bedPath, sampleRows, useGender, genderPath,
          fastqDir, setFastqDir, outputDir, setOutputDir, doAnno, setDoAnno, threads, setThreads, keepBams, setKeepBams,
          goTo } = useStore()
  const { t, lang } = useLang()

  const [running,   setRunning]   = useState(false)
  const [backendOk, setBackendOk] = useState(null)  // null=checking, true=ok, false=down
  const [fastqPickLoading, setFastqPickLoading] = useState(false)
  const [bgPipeline, setBgPipeline] = useState(null)  // background pipeline status
  const [logs,      setLogs]      = useState([])
  const [status,    setStatus]    = useState(null)
  const [showLogs,  setShowLogs]  = useState(false)
  const [steps,     setSteps]     = useState([])
  const [fastqDrag, setFastqDrag] = useState(false)
  const [outDrag,   setOutDrag]   = useState(false)
  const [doneOutput,setDoneOutput]= useState('')
  const wsRef   = useRef(null)
  const logsRef = useRef(null)

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight }, [logs])

  // Check if a pipeline is running in background on mount
  useEffect(() => {
    const API_HTTP = window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin
    fetch(API_HTTP + '/api/pipeline-status')
      .then(r => r.json())
      .then(d => {
        if (d.running || (d.step && d.step !== 'completed' && d.step !== '')) {
          setBgPipeline(d)
        }
      })
      .catch(() => {})
  }, [])

  // Check backend health on mount
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch((window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin) + '/health')
        setBackendOk(r.ok)
      } catch { setBackendOk(false) }
    }
    check()
  }, [])

  // All possible pipeline steps (gender-agnostic)
  const ALL_STEPS = useMemo(() => [
    { key:'prep',     re: /Checking dependencies/,                   label: lang==='tr'?'Hazırlık':'Setup',            icon:'⚙️',  order:1 },
    { key:'align',    re: /STEP 1: Alignment/,                       label: lang==='tr'?'Hizalama':'Alignment',        icon:'🧬',  order:2 },
    { key:'bam',      re: /Marking duplicates|BAM processing/,       label: lang==='tr'?'BAM İşleme':'BAM Processing', icon:'📁',  order:3 },
    { key:'cnvkit',   re: /STEP 2:/,                                  label:'CNVkit',                                   icon:'🔬',  order:4 },
    { key:'exdepth',  re: /STEP 3:/,                                  label:'ExomeDepth',                               icon:'📊',  order:5 },
    { key:'consensus',re: /STEP 4:/,                                  label: lang==='tr'?'Konsensüs':'Consensus',       icon:'🔗',  order:6 },
    { key:'cleanup',  re: /STEP 5:|BAM cleanup/,                     label: lang==='tr'?'Temizlik':'Cleanup',          icon:'🗑️',  order:7 },
    { key:'anno',     re: /Annotation başlatılıyor|DOSYA ISLENIYOR/, label: lang==='tr'?'Sınıflandırma':'Annotation',  icon:'🏷️',  order:8 },
    { key:'done',     re: /BITTI! Sonuclar|basariyla islendi|Pipeline finished|Run complete/, label: lang==='tr'?'Tamamlandı':'Complete', icon:'✅', order:9 },
  ], [lang])

  // Gender track detection
  const [activeTrack, setActiveTrack] = useState('') // 'Male' | 'Female' | 'All'
  const [maleSteps,   setMaleSteps]   = useState([])
  const [femaleSteps, setFemaleSteps] = useState([])
  const [allSteps,    setAllSteps]    = useState([])

  // Use a ref for activeTrack to avoid stale closure issues
  const activeTrackRef = useRef('')

  const updateSteps = (msg) => {
    // Detect gender track switch from log message
    if (/Processing Male group|Starting run:.*Male|tmp_fastq_Male/.test(msg)) {
      activeTrackRef.current = 'Male'
      setActiveTrack('Male')
    } else if (/Processing Female group|Starting run:.*Female|tmp_fastq_Female/.test(msg)) {
      activeTrackRef.current = 'Female'
      setActiveTrack('Female')
    } else if (/Processing All group|Starting run:|tmp_fastq_All/.test(msg) && !activeTrackRef.current) {
      activeTrackRef.current = 'All'
      setActiveTrack('All')
    }

    const track = activeTrackRef.current

    const matched = ALL_STEPS.find(p => p.re.test(msg))
    if (!matched) return

    const isRealDone = matched.key === 'done'

    const updater = (prev) => {
      if (prev.find(s => s.key === matched.key)) return prev
      const lastOrder = prev.length ? Math.max(...prev.map(s => s.order)) : 0
      if (matched.order < lastOrder) return prev
      return [...prev.map(s => ({...s, active:false, done:true})), {...matched, active:!isRealDone, done:isRealDone}]
    }

    if (track === 'Male')        setMaleSteps(updater)
    else if (track === 'Female') setFemaleSteps(updater)
    else                         setAllSteps(updater)
    setSteps(updater)
  }

  // Reset tracks when new analysis starts
  const resetTracks = () => {
    activeTrackRef.current = ''
    setActiveTrack(''); setMaleSteps([]); setFemaleSteps([]); setAllSteps([])
  }

  // Paths loaded from config.json via backend /api/config
  const [appConfig, setAppConfig] = useState({})
  useEffect(() => {
    const API_HTTP = window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin
    fetch(API_HTTP + '/api/config')
      .then(r => r.json())
      .then(d => setAppConfig(d))
      .catch(() => {})
  }, [])

  const REF      = appConfig.ref      || ''
  const PIPELINE = appConfig.pipeline || ''
  const ANNO     = appConfig.anno     || ''
  const INST_BED = appConfig.instBed  || ''

  // Resolve which BED to use in pipeline
  const isInstitutional = !!(bedPath && bedPath.includes('targets_merged'))
  const isUploadedBed   = !!(bedPath && bedPath.startsWith('uploaded:'))
  const hasBedContent   = !!(bedText && bedText.length > 10)

  // For institutional: always send the fixed server-side path, no bedText needed
  // For uploaded/generated: bedText will be written to a tmp file by backend
  const realBed = isInstitutional
    ? INST_BED
    : ''  // backend will use bedText to create tmp file

  const missing  = [
    !fastqDir && (lang==='tr' ? 'FASTQ klasörü seçilmedi' : 'FASTQ folder not selected'),
    !hasBedContent && !isInstitutional && (lang==='tr' ? 'BED dosyası seçilmedi' : 'BED file not selected'),
  ].filter(Boolean)
  const ready = !!fastqDir && (hasBedContent || isInstitutional)

  const handleDrop = (setter, setDrag) => e => {
    e.preventDefault(); setDrag(false)
    const files = e.dataTransfer.files
    if (files?.length) {
      const f = files[0]
      const p = f.webkitRelativePath || f.name
      setter(p.includes('/') ? p.split('/').slice(0,-1).join('/') : '/'+p)
    }
  }

  const handleBrowse = (setter) => e => {
    const files = e.target.files
    if (files?.length) {
      const f = files[0]
      // webkitRelativePath: "FolderName/file.fastq" -> take the folder part
      const rel = f.webkitRelativePath
      if (rel && rel.includes('/')) {
        // Build WSL path from the relative path's top folder
        // We can't know the full path from browser security, so show folder name
        // and let user confirm/edit if needed
        const folderName = rel.split('/')[0]
        setter(folderName)
      } else {
        setter(f.name)
      }
    }
  }

  const startPipeline = () => {
    if (!ready) return
    setLogs([]); setSteps([]); setStatus('running'); setRunning(true); setShowLogs(true); resetTracks()

    const wsUrl = (window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin).replace(/^http/, 'ws') + '/ws/pipeline'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    // Expand output path if user typed just a folder name
    // fastqDir = full WSL path, outputDir = output folder name only
    // Build full output path: same parent as fastqDir + outputDir name
    const fastqParent = fastqDir.includes('/') ? fastqDir.substring(0, fastqDir.lastIndexOf('/')) : fastqDir
    const outputName  = outputDir.replace(/\/+/g, '').trim() || 'CNV_output'
    const fullOutputDir = fastqParent + '/' + outputName
    // Gender label for prefix: if all Male → _Male, all Female → _Female, mixed/none → ''
    // No gender label in prefix — pipeline handles Male/Female subfolders itself
    const prefixWithGender = outputName

    ws.onopen = () => ws.send(JSON.stringify({
      fastqDir, outputDir: fullOutputDir,
      prefix: prefixWithGender,
      ref: REF, bed: realBed, bedText: hasBedContent ? bedText : '',
      genders: (genderPath && !genderPath.startsWith('inline:')) ? genderPath : '',
      gendersText: useGender && sampleRows.filter(r=>r.id.trim()).length > 0
        ? ['Pool\tGender', ...sampleRows.filter(r=>r.id.trim()).map(r=>`${r.id}\t${r.gender}`)].join('\n')
        : '',
      pipelineScript: PIPELINE, doAnno, annoScript: ANNO, threads, keepBams,
    }))
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ping') return  // keepalive, ignore
        setLogs(p => [...p, msg])
        updateSteps(msg.msg)
        if (msg.type==='success'||msg.type==='done') {
          setStatus('success')
          setSteps(p => p.map(s => ({...s, active:false, done:true})))
          if (msg.outputDir) setDoneOutput(msg.outputDir)
        }
        if (msg.type==='error') setStatus('error')
      } catch {}
    }
    ws.onclose = () => { setRunning(false); wsRef.current = null; setStatus(prev => prev === 'success' ? 'success' : prev === null ? 'error' : prev) }
    ws.onerror = () => {
      setLogs(p => [...p,
        {type:'error', msg:'❌ WebSocket bağlantı hatası!'},
        {type:'info',  msg:'Backend servisinin çalıştığından emin olun (http://localhost:8765)'},
      ])
      setStatus('error'); setRunning(false)
    }
  }

  const stopPipeline = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setRunning(false); setStatus('error')
  }

  const logClass = type => type==='error'?rp.logError:type==='success'?rp.logSuccess:type==='info'?rp.logInfo:type==='cmd'?rp.logCmd:rp.logLine

  return (
    <WizardLayout step={3}
      title={lang==='tr'?'Analizi Başlat':'Run Analysis'}
      subtitle={lang==='tr'?'Örneklerin bulunduğu klasörü seçin ve analizi başlatın.':'Select the sample folder and start the analysis.'}
      back={<Btn variant="default" size="lg" onClick={()=>goTo(2)}><ArrowLeft size={16}/> {t.run.back}</Btn>}
      next={!running && status==='success' ? (
        <Btn variant="primary" size="lg" onClick={()=>goTo(4)}>
          {lang==='tr'?'Bulguları İncele':'View Results'} <ArrowRight size={16}/>
        </Btn>
      ) : null}
    >
      {/* ── SETUP ── */}
      {!running && status === null && (
        <div className={rp.setupLayout}>
          <div className={rp.folderRow}>
            {/* FASTQ zone — native folder picker, shows only folder name */}
            <label className={`${rp.folderZone} ${fastqDir?rp.folderLoaded:''}`}>
              <input type="file" webkitdirectory="true" style={{display:'none'}}
                onChange={async e => {
                  const files = e.target.files
                  if (!files?.length) return
                  const rel = files[0].webkitRelativePath  // "folderName/file.fastq"
                  if (!rel) return
                  const topFolder = rel.split('/')[0]
                  // Pass a filename inside the folder to help backend disambiguate
                  const fileHint = files[0].name
                  try {
                    const API_HTTP = window.location.origin === 'null' ? 'http://localhost:8765' : window.location.origin
                    const url = API_HTTP + '/api/find-folder?name=' + encodeURIComponent(topFolder) + '&file=' + encodeURIComponent(fileHint)
                    const r = await fetch(url)
                    const d = await r.json()
                    if (d.path) {
                      setFastqDir(d.path)
                      setOutputDir('CNV_output')
                      return
                    }
                  } catch(err) {}
                  setFastqDir(topFolder)
                  setOutputDir('CNV_output')
                }}
              />
              <div className={rp.folderZoneIcon}>{fastqDir ? '📂' : '📥'}</div>
              <div className={rp.folderZoneTitle}>{lang==='tr'?'FASTQ Klasörü':'FASTQ Folder'}</div>
              {fastqDir
                ? <div className={rp.folderZonePath}>
                    <span>{fastqDir.split('/').pop() || fastqDir}</span>
                    <button className={rp.folderZoneClear} onClick={e=>{e.preventDefault();setFastqDir('');setOutputDir('')}}>✕</button>
                  </div>
                : <div className={rp.folderZoneHint}>{lang==='tr'?'Tıkla → klasör seç':'Click → pick folder'}</div>
              }
            </label>

            <div className={rp.folderArrow}>
              <ArrowRight size={24} color="var(--muted2)"/>
            </div>

            {/* Output zone — just a name, path = fastqDir parent + name */}
            <div className={`${rp.folderZone} ${outputDir?rp.folderLoaded:''}`}
              onClick={()=>document.getElementById('out-input').focus()}>
              <div className={rp.folderZoneIcon}>{outputDir?'📤':'📤'}</div>
              <div className={rp.folderZoneTitle}>{lang==='tr'?'Çıktı Klasörü Adı':'Output Folder Name'}</div>
              {outputDir
                ? <div className={rp.folderZonePath}><span>{outputDir}</span></div>
                : <div className={rp.folderZoneHint}>{lang==='tr'?'Bir isim yazın':'Type a name'}</div>
              }
              <input
                id="out-input"
                className={rp.outTextInput}
                value={outputDir||''}
                onChange={e => setOutputDir(e.target.value.replace(/[/\\]/g,''))}
                onClick={e=>e.stopPropagation()}
                placeholder="CNV_output"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Options row */}
          <div className={rp.optionsRow}>
            <div className={rp.optionCard} onClick={()=>setDoAnno(v=>!v)}>
              <div className={`${rp.toggle} ${doAnno?rp.tOn:''}`}><div className={rp.tThumb}/></div>
              <div>
                <div className={rp.optionTitle}>{lang==='tr'?'Otomatik Sınıflandırma':'Auto Classification'}</div>
                <div className={rp.optionDesc}>{lang==='tr'?'ACMG kriterleri ile klinik sınıflandırma':'Clinical classification using ACMG criteria'}</div>
              </div>
            </div>

            {/* Thread seçici */}
            <div className={rp.optionCard} style={{gap:10}}>
              <div style={{fontSize:20}}>⚡</div>
              <div style={{flex:1}}>
                <div className={rp.optionTitle}>{lang==='tr'?'CPU Thread':'CPU Threads'}</div>
                <div className={rp.optionDesc}>{lang==='tr'?`${threads} thread kullanılacak`:`Using ${threads} threads`}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <button className={rp.threadBtn} onClick={()=>setThreads(t=>Math.max(1,t-1))}>−</button>
                <span style={{minWidth:24,textAlign:'center',fontWeight:700,fontSize:14}}>{threads}</span>
                <button className={rp.threadBtn} onClick={()=>setThreads(t=>Math.min(32,t+1))}>+</button>
              </div>
            </div>

            {/* Keep BAMs */}
            <div className={rp.optionCard} onClick={()=>setKeepBams(v=>!v)}>
              <div className={`${rp.toggle} ${keepBams?rp.tOn:''}`}><div className={rp.tThumb}/></div>
              <div>
                <div className={rp.optionTitle}>{lang==='tr'?'BAM Dosyalarını Sakla':'Keep BAM Files'}</div>
                <div className={rp.optionDesc}>{lang==='tr'?'Alignment dosyaları silinmez (disk alanı kullanır)':'Alignment files are kept (uses disk space)'}</div>
              </div>
            </div>
            <div className={rp.summaryMini}>
              {[
                ['🧬', lang==='tr'?'Referans':'Ref.', genome],
                ['🎯', lang==='tr'?'Panel':'Panel', (() => {
                  // 1. Gen listesi varsa önce onu göster
                  if (genes.length > 0) return `${genes.length} ${lang==='tr'?'gen':'genes'}`
                  // 2. Upload edilmiş BED
                  if (bedPath?.startsWith('uploaded:')) return bedPath.replace('uploaded:','')
                  // 3. Kurumsal panel
                  if (bedPath?.includes('targets_merged')) return lang==='tr'?'Kurumsal':'Institutional'
                  // 4. Generated panel
                  if (bedPath?.startsWith('generated:')) return lang==='tr'?'Özel Panel':'Custom Panel'
                  // 5. Herhangi bir bedText
                  if (bedText?.length > 10) return lang==='tr'?'Özel BED':'Custom BED'
                  return lang==='tr'?'Seçilmedi':'Not selected'
                })()],
                ['👥', lang==='tr'?'Örnekler':'Samples', useGender&&sampleRows.length?`${sampleRows.length}`:(lang==='tr'?'Tümü':'All')],
              ].map(([icon,label,val])=>(
                <div key={label} className={rp.sumMiniItem}>
                  <span>{icon}</span>
                  <div>
                    <div className={rp.sumMiniLabel}>{label}</div>
                    <div className={rp.sumMiniVal}>{val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Background pipeline banner */}
          {bgPipeline && !running && (
            <div className={rp.bgPipelineBanner}>
              <span>⚙️</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{lang==='tr'?'Arka planda analiz devam ediyor':'Analysis running in background'}</div>
                <div style={{fontSize:11,opacity:.8,marginTop:2}}>
                  {bgPipeline.prefix && <span>{bgPipeline.prefix} · </span>}
                  {bgPipeline.step && <span>{bgPipeline.step} · </span>}
                  {bgPipeline.last_log && <span style={{fontFamily:'monospace'}}>{bgPipeline.last_log.substring(0,80)}</span>}
                </div>
                {bgPipeline.output_files && bgPipeline.output_files.length > 0 && (
                  <div style={{fontSize:11,marginTop:4,opacity:.9}}>
                    ✓ {bgPipeline.output_files.length} {lang==='tr'?'çıktı dosyası hazır':'output files ready'}:
                    {bgPipeline.output_files.slice(0,3).map(f => <span key={f} style={{marginLeft:6,background:'rgba(255,255,255,.2)',padding:'1px 5px',borderRadius:4}}>{f.split('/').pop()}</span>)}
                  </div>
                )}
              </div>
              <button style={{background:'none',border:'1px solid rgba(255,255,255,.4)',borderRadius:6,color:'#fff',padding:'4px 10px',cursor:'pointer',fontSize:11}}
                onClick={()=>setBgPipeline(null)}>✕</button>
            </div>
          )}

          {/* Backend status indicator */}
          {backendOk === false && (
            <div className={rp.warnBox}>
              <div className={rp.warnItem}>
                ⚠ {lang==='tr'
                  ? `Backend servisi çalışmıyor! Lütfen uygulamayı yeniden başlatın veya backend'i çalıştırın (http://localhost:8765)`
                  : `Backend service is down! Please restart the app or run the backend (http://localhost:8765)`}
              </div>
            </div>
          )}

          {missing.length>0 && <div className={rp.warnBox}>{missing.map(m=><div key={m} className={rp.warnItem}>⚠ {m}</div>)}</div>}

          <button className={`${rp.bigRunBtn} ${(!ready || backendOk === false)?rp.bigRunDisabled:''}`} onClick={startPipeline} disabled={!ready || backendOk === false}>
            <Play size={24} strokeWidth={2.5}/>
            <span>{lang==='tr'?'Analizi Başlat':'Start Analysis'}</span>
          </button>
        </div>
      )}

      {/* ── RUNNING / DONE ── */}
      {(running || status !== null) && (
        <div className={rp.runningLayout}>
          <div className={`${rp.statusCard} ${status==='success'?rp.statusOk:status==='error'?rp.statusErr:rp.statusRunning}`}>
            <div className={rp.statusIcon}>
              {running ? <div className={rp.bigSpinner}/> : status==='success' ? '✓' : '✗'}
            </div>
            <div className={rp.statusBody}>
              <div className={rp.statusTitle}>
                {running?(lang==='tr'?'Analiz çalışıyor...':'Analysis running...'):
                 status==='success'?(lang==='tr'?'Analiz tamamlandı!':'Analysis complete!'):
                 (lang==='tr'?'Hata oluştu':'Error occurred')}
              </div>
              <div className={rp.statusSub}>
                {fastqDir.split('/').pop()} → {(doneOutput||outputDir).split('/').pop()}
              </div>
              {status==='success' && (
                <div className={rp.doneActions}>
                  <button className={rp.viewResultsBtn} onClick={()=>goTo(4)}>
                    {lang==='tr'?'📊 Bulguları İncele':'📊 View Results'}
                  </button>
                  <button className={rp.openFolderBtn}
                    onClick={()=>{
                      const p=(doneOutput||outputDir).replace('/mnt/c/','C:\\').replace(/\//g,'\\')
                      navigator.clipboard.writeText(p)
                      alert(lang==='tr'?`Klasör yolu kopyalandı:\n${p}\n\nWindows Explorer adres çubuğuna yapıştırın.`:`Folder path copied:\n${p}\n\nPaste in Windows Explorer address bar.`)
                    }}>
                    {lang==='tr'?'📂 Klasör Yolunu Kopyala':'📂 Copy Folder Path'}
                  </button>
                </div>
              )}
            </div>
            {running && (
              <button className={rp.stopBtn} onClick={stopPipeline}>
                <Square size={14}/> {lang==='tr'?'Durdur':'Stop'}
              </button>
            )}
          </div>

          {/* ── Pipeline Progress ───────────────────────────── */}
          {(() => {
            const hasMale   = maleSteps.length > 0
            const hasFemale = femaleSteps.length > 0
            const hasAll    = allSteps.length > 0
            const hasAny    = hasMale || hasFemale || hasAll || steps.length > 0

            const StepRow = ({ stepList, trackLabel, trackColor }) => {
              if (!stepList.length) return null
              const active = stepList.find(s => s.active)
              const doneCount = stepList.filter(s => s.done).length
              const total = stepList.length
              const pct = total ? Math.round((doneCount / Math.max(total, ALL_STEPS.length)) * 100) : 0
              return (
                <div className={rp.trackBlock}>
                  <div className={rp.trackHeader}>
                    <span className={rp.trackLabel} style={{color: trackColor}}>{trackLabel}</span>
                    {active && (
                      <span className={rp.trackActive}>
                        <span className={rp.dotSpin} style={{display:'inline-block',marginRight:5}}/>
                        {active.icon} {active.label}
                      </span>
                    )}
                    <span className={rp.trackPct}>{pct}%</span>
                  </div>
                  {/* Progress bar */}
                  <div className={rp.progressBar}>
                    <div className={rp.progressFill} style={{width: pct+'%', background: trackColor}}/>
                  </div>
                  {/* Step pills */}
                  <div className={rp.stepPills}>
                    {ALL_STEPS.map((def, i) => {
                      const s = stepList.find(x => x.key === def.key)
                      const state = !s ? 'pending' : s.done ? 'done' : s.active ? 'active' : 'pending'
                      return (
                        <div key={i} className={`${rp.pill} ${state==='done'?rp.pillDone:state==='active'?rp.pillActive:rp.pillPending}`}>
                          <span>{def.icon}</span>
                          <span className={rp.pillLabel}>{def.label}</span>
                          {state==='active' && <span className={rp.dotSpin} style={{display:'inline-block'}}/>}
                          {state==='done'   && <span className={rp.pillCheck}>✓</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }

            if (!hasAny) return null
            return (
              <div className={rp.tracksWrap}>
                {(hasMale || hasFemale) ? (
                  <div className={rp.tracksGrid}>
                    <StepRow stepList={maleSteps}   trackLabel={lang==='tr'?'🚹 Erkek Analizi':'🚹 Male Analysis'}   trackColor="var(--blue)" />
                    <StepRow stepList={femaleSteps} trackLabel={lang==='tr'?'🚺 Kadın Analizi':'🚺 Female Analysis'} trackColor="#db2777" />
                  </div>
                ) : (
                  <StepRow stepList={hasAll ? allSteps : steps} trackLabel={lang==='tr'?'⚙️ Pipeline':'⚙️ Pipeline'} trackColor="var(--blue)" />
                )}
              </div>
            )
          })()}

          {/* Log toggle */}
          <button className={rp.logToggle} onClick={()=>setShowLogs(v=>!v)}>
            <span>{showLogs?(lang==='tr'?'Teknik Detayları Gizle':'Hide Technical Details'):(lang==='tr'?'Teknik Detayları Göster':'Show Technical Details')}</span>
            {showLogs?<ChevronUp size={13}/>:<ChevronDown size={13}/>}
          </button>

          {showLogs && (
            <div className={rp.logPanel}>
              <div className={rp.logBody} ref={logsRef}>
                {logs.map((l,i)=>(
                  <div key={i} className={`${rp.logEntry} ${logClass(l.type)}`}>
                    {l.type==='cmd'&&<span className={rp.logPrefix}>$</span>}
                    {l.type==='info'&&<Info size={10} style={{flexShrink:0,marginTop:3}}/>}
                    {l.type==='success'&&<CheckCircle size={10} style={{flexShrink:0,marginTop:3}}/>}
                    {l.type==='error'&&<XCircle size={10} style={{flexShrink:0,marginTop:3}}/>}
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New analysis button */}
          {!running && (
            <button className={rp.newAnalysisBtn}
              onClick={()=>{setStatus(null);setLogs([]);setSteps([])}}>
              {lang==='tr'?'← Yeni Analiz Ayarla':'← Configure New Analysis'}
            </button>
          )}
        </div>
      )}
    </WizardLayout>
  )
}

function PathField({ label, value, onChange, placeholder }) {
  return (
    <div className={rp.browseField}>
      <label className={rp.browseLabel}>{label}</label>
      <div className={`${rp.browseRow} ${value?rp.browseHas:''}`}>
        <input className={rp.browseInput} value={value||''} onChange={e=>onChange(e.target.value)}
          placeholder={placeholder} spellCheck={false}/>
        {value && <button className={rp.browseClear} onClick={()=>onChange('')} type="button">✕</button>}
      </div>
    </div>
  )
}


// ─── RESULTS PAGE ────────────────────────────────────────────────────────────
const normType = v => { const u=String(v||'').toUpperCase(); return u.includes('DEL')?'DEL':u.includes('DUP')||u.includes('GAIN')?'DUP':u }
const normChr  = v => String(v||'').replace(/^chr/i,'')
const COLORS   = ['#2563eb','#0891b2','#7c3aed','#db2777','#ea580c','#16a34a','#ca8a04','#dc2626']

export function ResultsPage() {
  const { cnvRows, annoRows, merged, cnvFile, matchCount, busy, uploadCnv, uploadAnno, doMerge, resetResults } = useStore()
  const { t, lang } = useLang()
  const [tab,setTab]         = useState('table')
  const [search,setSearch]   = useState('')
  const [typeF,setTypeF]     = useState('all')
  const [colF,setColF]       = useState({})
  const [sort,setSort]       = useState({k:'',d:1})
  const [popup,setPopup]     = useState(null)
  const [notes,setNotes]     = useState(() => localStorage.getItem('cnvdetect_notes') || '')
  const [noteCopied,setNoteCopied] = useState(false)

  useEffect(() => { localStorage.setItem('cnvdetect_notes', notes) }, [notes])

  useEffect(()=>{ if(cnvRows.length) doMerge() },[cnvRows,annoRows])

  const filtered = useMemo(()=>{
    let rows = merged.filter(r=>{
      if(typeF!=='all'&&normType(r.type)!==typeF) return false
      if(search){const h=[r.sample,r.chromosome,r.genes,r.classification,r.type].join(' ').toLowerCase();if(!h.includes(search.toLowerCase()))return false}
      for(const[k,sel]of Object.entries(colF)){
        if(!sel?.size)continue
        const val=k==='type'?normType(r[k]):k==='chromosome'?normChr(r[k]):String(r[k]??'')
        if(!sel.has(val))return false
      }
      return true
    })
    if(sort.k) rows=[...rows].sort((a,b)=>{const av=a[sort.k],bv=b[sort.k],an=+av,bn=+bv;return(!isNaN(an)&&!isNaN(bn))?(an-bn)*sort.d:String(av??'').localeCompare(String(bv??''))*sort.d})
    return rows
  },[merged,typeF,search,colF,sort])

  const dynCols = useMemo(()=>{
    const labelMap = {
      sample:t.results.sample, chromosome:t.results.chrom,
      start:t.results.start, end:t.results.end,
      type:t.results.type, cn:t.results.cn,
      tool_a:t.results.tool, bintest_log2:t.results.log2, bintest_nbins:t.results.nbins,
      confidence:t.results.confidence,
      classification:t.results.classification, genes:t.results.genes, score:t.results.score
    }
    if (!merged.length) return Object.entries(labelMap)
    // Only show columns that are in labelMap — prevents stale/removed fields from appearing
    return Object.entries(labelMap).filter(([k]) => k in (merged[0]||{}))
  },[merged, t])

  const qs = useMemo(()=>({
    total:merged.length, del:filtered.filter(r=>normType(r.type)==='DEL').length,
    dup:filtered.filter(r=>normType(r.type)==='DUP').length,
    samples:new Set(filtered.map(r=>r.sample).filter(Boolean)).size,
    annotated:filtered.filter(r=>r.classification).length,
  }),[filtered,merged])

  const chrData = useMemo(()=>{
    const m={}; filtered.forEach(r=>{const c=normChr(r.chromosome);if(c)m[c]=(m[c]||0)+1})
    return Object.entries(m).sort((a,b)=>{const n1=parseInt(a[0]),n2=parseInt(b[0]);return isNaN(n1)||isNaN(n2)?a[0].localeCompare(b[0]):n1-n2}).slice(0,22)
      .map(([k,v])=>({name:'chr'+k,del:filtered.filter(r=>normChr(r.chromosome)===k&&normType(r.type)==='DEL').length,dup:filtered.filter(r=>normChr(r.chromosome)===k&&normType(r.type)==='DUP').length}))
  },[filtered])

  const classData = useMemo(()=>{
    const m={}; filtered.forEach(r=>{const c=r.classification?.trim();if(c)m[c]=(m[c]||0)+1})
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>({name:k,value:v}))
  },[filtered])

  const sampleData = useMemo(()=>{
    const m={}; filtered.forEach(r=>{const s=r.sample?.trim();if(s)m[s]=(m[s]||0)+1})
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>({name:k,value:v}))
  },[filtered])

  const download=()=>{
    const cols=['sample','chromosome','start','end','type','cn','confidence','classification','score','genes']
    const blob=new Blob([cols.join('\t')+'\n'+filtered.map(r=>cols.map(c=>r[c]??'').join('\t')).join('\n')],{type:'text/tab-separated-values'})
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cnv_bulgular.tsv';a.click()
  }

  const openPopup=(key,rect)=>{
    const vals=[...new Set(merged.map(r=>{if(key==='type')return normType(r[key]);if(key==='chromosome')return normChr(r[key]);return String(r[key]??'')}).filter(Boolean))].sort()
    setPopup({key,rect,vals,cur:colF[key]?new Set(colF[key]):new Set()})
  }

  const TT=({active,payload,label})=>active&&payload?.length?(<div style={{background:'#fff',border:'1px solid #dde2ec',borderRadius:8,padding:'8px 12px',fontSize:12,boxShadow:'0 4px 12px rgba(0,0,0,.1)'}}><div style={{fontWeight:600,marginBottom:3}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.fill}}>{p.name}: {p.value}</div>)}</div>):null

  return (
    <WizardLayout step={4} title={t.results.title} subtitle={t.results.subtitle}
      extra={merged.length>0&&<>
        <Btn variant="default" size="sm" onClick={download}><Download size={13}/> {t.results.download}</Btn>
        <Btn variant="danger"  size="sm" onClick={resetResults}><X size={13}/> {t.results.clear}</Btn>
      </>}
    >
      {/* Upload */}
      <div className={re.uploadRow}>
        <UploadZone id="r-cnv" label={t.results.loadFile} subtitle="consensus_cnvs.tsv / union_cnvs.tsv"
          loaded={cnvRows.length>0} filename={cnvFile} loading={busy.cnv}
          onChange={e=>e.target.files[0]&&uploadCnv(e.target.files[0])}/>
        <UploadZone id="r-anno" label={t.results.loadAnno} subtitle="CNV_Final_Summary_Report.tsv"
          loaded={annoRows.length>0} filename={null} loading={busy.anno}
          onChange={e=>e.target.files[0]&&uploadAnno(e.target.files[0])}/>
        {matchCount>0&&<div className={re.matchBadge}><Activity size={13}/><span><b>{matchCount}</b> {lang==='tr'?'eşleşme':'matches'}</span></div>}
      </div>

      {/* Stats */}
      <div className={re.statGrid}>
        <StatCard label={t.results.total}        value={qs.total||'—'} />
        <StatCard label={t.results.deletions}    value={qs.del||'—'}   variant="del"/>
        <StatCard label={t.results.duplications} value={qs.dup||'—'}   variant="dup"/>
        <StatCard label={t.results.samples}      value={qs.samples||'—'} variant="blue"/>
        <StatCard label={t.results.classified}   value={qs.annotated||'—'} variant="ok"
          sub={qs.total?`${Math.round(qs.annotated/qs.total*100)}%`:''}/>
      </div>

      {merged.length>0 ? <>
        {/* Tabs */}
        <div className={re.tabs}>
          {[[`table`,t.results.table,FileText],[`charts`,t.results.charts,BarChart3]].map(([id,lbl,Icon])=>(
            <button key={id} className={`${re.tab} ${tab===id?re.tabActive:''}`} onClick={()=>setTab(id)}>
              <Icon size={14}/> {lbl}
            </button>
          ))}
        </div>

        {tab==='table'&&(
          <div className={re.tableSection}>
            <div className={re.filterBar}>
              <div className={re.typeRow}>
                {['all','DEL','DUP'].map(tp=>(
                  <button key={tp} onClick={()=>setTypeF(tp)}
                    className={`${re.typeBtn} ${typeF===tp?re.typeBtnOn:''} ${tp==='DEL'?re.typeDel:tp==='DUP'?re.typeDup:''}`}>
                    {tp==='all'?t.results.allTypes:tp}
                    {tp!=='all'&&<span className={re.typeCnt}>{tp==='DEL'?qs.del:qs.dup}</span>}
                  </button>
                ))}
              </div>
              <input className={re.searchBox} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t.results.searchPlaceholder}/>
              {(search||Object.values(colF).some(s=>s?.size))&&
                <Btn variant="ghost" size="sm" onClick={()=>{setSearch('');setColF({})}}><X size={12}/> {t.results.reset}</Btn>}
              <span className={re.rowCount}>{filtered.length} {t.results.records}</span>
            </div>
            <div className={re.tableWrap}>
              <table className={re.table}>
                <thead><tr>
                  {dynCols.map(([k,l])=>(
                    <th key={k} className={re.th}>
                      <div className={re.thWrap}>
                        <button className={re.sortBtn} onClick={()=>setSort(p=>({k,d:p.k===k?p.d*-1:1}))}>
                          {l}{sort.k===k?(sort.d===1?<ChevronUp size={10}/>:<ChevronDown size={10}/>):null}
                        </button>
                        <button className={`${re.filterBtn} ${colF[k]?.size?re.filterOn:''}`}
                          onClick={e=>openPopup(k,e.currentTarget.getBoundingClientRect())}>
                          <Filter size={9}/>
                        </button>
                      </div>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.length===0
                    ?<tr><td colSpan={dynCols.length||15} className={re.emptyCell}>{merged.length?t.results.searchPlaceholder:'...'}</td></tr>
                    :filtered.map((r,i)=>(
                      <tr key={i} className={re.row}>
                        {dynCols.map(([k])=>(
                          <td key={k} className={
                            k==='sample'?re.tdSample:
                            k==='genes'?re.tdGenes:re.tdMono
                          }>
                            {k==='chromosome'?<span className={re.chrPill}>chr{normChr(r[k])}</span>:
                             k==='type'?<Badge type={normType(r[k])}/>:
                             k==='confidence'?<ConfBadge val={r[k]}/>:
                             k==='classification'?<ClassBadge val={r[k]}/>:
                             k==='start'||k==='end'?(r[k]?(+r[k]).toLocaleString():r[k]||'—'):
                             k==='bintest_log2'?(r[k]?parseFloat(r[k]).toFixed(3):'—'):
                             r[k]||'—'}
                          </td>
                        ))}
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='charts'&&(
          <div className={re.chartsGrid}>
            <div className={re.chartCard}>
              <div className={re.chartTitle}>{t.results.chromDist}</div>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={chrData} margin={{left:-15,right:10,bottom:38}}>
                  <XAxis dataKey="name" tick={{fontSize:9,fill:'#7a8ba8'}} angle={-40} textAnchor="end" interval={0}/>
                  <YAxis tick={{fontSize:10,fill:'#7a8ba8'}}/>
                  <Tooltip content={<TT/>}/>
                  <Bar dataKey="del" name="DEL" stackId="a" fill="#dc2626"/>
                  <Bar dataKey="dup" name="DUP" stackId="a" fill="#0369a1" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
              <div className={re.chartLegend}>
                <span><span className={re.dot} style={{background:'#dc2626'}}/>DEL</span>
                <span><span className={re.dot} style={{background:'#0369a1'}}/>DUP</span>
              </div>
            </div>
            <div className={re.chartCard}>
              <div className={re.chartTitle}>{t.results.classDist}</div>
              {classData.length?<ResponsiveContainer width="100%" height={210}><PieChart><Pie data={classData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} innerRadius={40} paddingAngle={2} label={({percent})=>`${Math.round(percent*100)}%`} labelLine={false} fontSize={10}>{classData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Legend iconType="circle" iconSize={7} formatter={v=><span style={{fontSize:11,color:'#3a4a62'}}>{v}</span>}/><Tooltip contentStyle={{fontSize:12,borderRadius:8,border:'1px solid #dde2ec'}}/></PieChart></ResponsiveContainer>
              :<div className={re.noData}>{t.results.loadAnno}</div>}
            </div>
            <div className={`${re.chartCard} ${re.chartWide}`}>
              <div className={re.chartTitle}>{t.results.perSample}</div>
              <ResponsiveContainer width="100%" height={200}><BarChart data={sampleData} margin={{left:-15,right:10,bottom:46}}><XAxis dataKey="name" tick={{fontSize:9,fill:'#7a8ba8'}} angle={-35} textAnchor="end" interval={0}/><YAxis tick={{fontSize:10,fill:'#7a8ba8'}}/><Tooltip content={<TT/>}/><Bar dataKey="value" name={t.results.total} radius={[3,3,0,0]}>{sampleData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer>
            </div>
          </div>
        )}
      </> : (
        <div className={re.emptyPage}>
          <div className={re.emptyIcon}>📊</div>
          <p className={re.emptyTitle}>{t.results.noData}</p>
          <p className={re.emptyHint}>{t.results.noDataHint}</p>
        </div>
      )}

      {popup&&<ColPopup {...popup} onApply={sel=>{setColF(f=>({...f,[popup.key]:sel}));setPopup(null)}} onClose={()=>setPopup(null)}/>}

      {/* Notes */}
      <div className={re.notesCard}>
        <div className={re.notesHead}>
          <div className={re.notesIconBadge}>
            <StickyNote size={15} color="#fff"/>
          </div>
          <div className={re.notesMeta}>
            <span className={re.notesTitleText}>{t.results.notesSectionTitle}</span>
            <span className={re.notesSubText}>{t.results.notesPlaceholder}</span>
          </div>
          {notes && (
            <span className={re.notesSavedPill}>
              <Check size={10}/> {t.results.notesAutoSave}
            </span>
          )}
        </div>
        <div className={re.notesBody}>
          <textarea
            className={re.notesArea}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={lang === 'tr'
              ? 'Buraya notlarınızı yazın...'
              : 'Start typing your notes here...'}
            rows={6}
            spellCheck={false}
          />
        </div>
        <div className={re.notesFoot}>
          <span className={re.notesCharCount}>
            {notes.length > 0 ? `${notes.length} ${lang === 'tr' ? 'karakter' : 'chars'}` : ''}
          </span>
          <div className={re.notesActions}>
            <button className={re.notesActionBtn} onClick={() => {
              navigator.clipboard.writeText(notes)
              setNoteCopied(true)
              setTimeout(() => setNoteCopied(false), 2000)
            }}>
              {noteCopied ? <><Check size={12}/> {t.results.notesCopied}</> : <><Copy size={12}/> {t.results.notesCopy}</>}
            </button>
            {notes && (
              <button className={`${re.notesActionBtn} ${re.notesActionDanger}`} onClick={() => setNotes('')}>
                <X size={12}/> {t.results.notesClear}
              </button>
            )}
          </div>
        </div>
      </div>
    </WizardLayout>
  )
}

function ColPopup({key,rect,vals,cur,onApply,onClose}){
  const [sel,setSel]=useState(new Set(cur))
  const [q,setQ]=useState('')
  const ref=useRef()
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose()};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)},[])
  const shown=vals.filter(v=>v.toLowerCase().includes(q.toLowerCase()))
  const left=Math.max(8,Math.min(window.innerWidth-290,rect.left-250+rect.width))
  const top=Math.max(8,Math.min(window.innerHeight-420,rect.bottom+6))
  const toggle=v=>setSel(s=>{const n=new Set(s);n.has(v)?n.delete(v):n.add(v);return n})
  return(
    <div className={re.popup} style={{left,top}} ref={ref}>
      <div className={re.popHead}><span>{key}</span><button className={re.popX} onClick={onClose}>×</button></div>
      <div className={re.popBody}>
        <input className={re.popSearch} placeholder="Ara / Search..." value={q} onChange={e=>setQ(e.target.value)} autoFocus/>
        <div className={re.popList}>{shown.map(v=><label key={v} className={re.popItem}><input type="checkbox" checked={sel.has(v)} onChange={()=>toggle(v)}/><span>{v||'—'}</span></label>)}</div>
        <div className={re.popFoot}>
          <button className={re.popBtn} onClick={()=>setSel(new Set(vals))}>Tümü</button>
          <button className={re.popBtn} onClick={()=>setSel(new Set())}>Temizle</button>
          <button className={re.popBtnP} onClick={()=>onApply(sel)}>Uygula</button>
        </div>
      </div>
    </div>
  )
}
