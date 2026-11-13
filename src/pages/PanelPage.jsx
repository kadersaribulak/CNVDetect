import { useState, useEffect, useRef } from 'react'
import { Search, CheckCheck, AlertCircle, Save, ArrowRight, Upload, Building2, FileUp, X } from 'lucide-react'
import axios from 'axios'
import { useStore } from '../hooks/useStore'
import { useLang } from '../hooks/useLang'
import { saveFilePath, writeToDisk } from '../hooks/useElectron'
import { PANEL_GENES } from '../i18n/translations'
import { WizardLayout, Btn, Tag, SectionCard } from '../components/UI'
import { API } from '../api'
import s from './PanelPage.module.css'

// Marker stored in bedPath when the server-side institutional BED is used
// (the backend resolves it to instBed from config.json; it is not a file name)
export const INSTITUTIONAL_BED_MARKER = 'institutional:panel'

export default function PanelPage() {
  const { genome, setGenome, genes, setGenes, padding, setPadding,
          bedText, setBedText, bedMissing, setBedMissing, setBedPath,
          extraBedLines, setExtraBedLines,
          busy, goTo } = useStore()
  const { t, lang } = useLang()

  const [allGenes,      setAllGenes]      = useState([])
  const [input,         setInput]         = useState('')
  const [suggest,       setSuggest]       = useState([])
  const [selPanel,      setSelPanel]      = useState('')
  const [saveMsg,       setSaveMsg]       = useState('')
  const [activeMode,    setActiveMode]    = useState('preset') // 'preset' | 'custom' | 'upload' | 'institutional'
  const [uploadedBed,   setUploadedBed]   = useState('')
  const [uploadedName,  setUploadedName]  = useState('')
  const [isDragging,    setIsDragging]    = useState(false)
  const [instLoading,   setInstLoading]   = useState(false)
  // In-house panel BED: only offered when the backend has one (it is not distributed)
  const [instInfo,      setInstInfo]      = useState(null)  // { regions, genes } or null
  const inputRef  = useRef()
  const dropRef   = useRef()
  const bedReqId  = useRef(0)  // ignore out-of-order BED generation responses

  const panels = PANEL_GENES[lang] || PANEL_GENES.tr

  useEffect(() => {
    axios.get(`${API}/api/genes?build=${genome}`).then(r => setAllGenes(r.data)).catch(() => {})
  }, [genome])

  useEffect(() => {
    axios.get(`${API}/api/institutional-bed`)
      .then(({ data }) => { if (data.available) setInstInfo({ regions: data.regions, genes: data.genes }) })
      .catch(() => {})
  }, [])

  // Gene input handlers
  const handleInput = val => {
    setInput(val)
    const q = val.trim().toUpperCase()
    setSuggest(q.length >= 2 ? allGenes.filter(g => g.startsWith(q) && !genes.includes(g)).slice(0, 7) : [])
  }
  const autoGenBed = async (geneList, pad = padding) => {
    const list = geneList || genes
    const reqId = ++bedReqId.current
    // If no genes but we have extraBedLines (institutional/upload), just use those
    if (!list || !list.length) {
      setBedText(extraBedLines || '')
      setBedMissing([])
      return
    }
    try {
      const { data } = await axios.post(`${API}/api/bed/generate`, { genes: list, build: genome, padding: pad })
      if (reqId !== bedReqId.current) return  // a newer request superseded this one
      // Merge: extra BED (institutional/upload) + generated gene BED, deduplicated by chr:start:end
      const existingLines = new Set((extraBedLines || '').split('\n').filter(Boolean))
      const newLines = data.bed.split('\n').filter(Boolean)
      const allLines = [...existingLines]
      newLines.forEach(l => { if (!existingLines.has(l)) allLines.push(l) })
      const merged = allLines.join('\n')
      setBedText(merged)
      setBedPath(`generated:${list.length}genes`)
      setBedMissing(data.missing || [])
    } catch(e) { console.error(e) }
  }

  // Called from Generate BED button — uses current genes state
  const handleGenerateBed = () => autoGenBed(genes)

  const addGene = g => {
    const gu = g.trim().toUpperCase()
    if (!gu || genes.includes(gu)) return
    const newGenes = [...genes, gu]
    setGenes(newGenes)
    setInput(''); setSuggest([])
    inputRef.current?.focus()
    autoGenBed(newGenes)
  }

  const addMany = raw => {
    const list = raw.split(/[\s,;]+/).map(g => g.trim().toUpperCase()).filter(Boolean)
    const newGenes = [...new Set([...genes, ...list.filter(g => !genes.includes(g))])]
    setGenes(newGenes)
    setInput(''); setSuggest([])
    autoGenBed(newGenes)
  }
  const applyPanel = async name => {
    const gl = panels[name] || []
    const newGenes = [...new Set([...genes, ...gl])]
    setGenes(newGenes)
    setSelPanel('')
    // Auto-generate BED (also updates bedPath so the run step uses this BED)
    await autoGenBed(newGenes)
  }

  // Reset every panel/BED source
  const clearPanel = () => {
    bedReqId.current++
    setGenes([]); setBedText(''); setBedMissing([]); setBedPath('')
    setExtraBedLines(''); setUploadedBed(''); setUploadedName('')
  }

  // Institutional panel
  const loadInstitutional = async () => {
    setInstLoading(true)
    try {
      const { data } = await axios.get(`${API}/api/institutional-bed`)
      setBedText(data.bed)
      setUploadedBed(data.bed)
      setExtraBedLines(data.bed)  // keep as base for merging
      setUploadedName(`Kurumsal Panel (${data.regions} bölge)`)
      setGenes([])  // institutional panel replaces any gene-based BED
      bedReqId.current++
      setBedPath(INSTITUTIONAL_BED_MARKER)
      setBedMissing([])
    } catch (e) {
      console.error(e)
    }
    setInstLoading(false)
  }

  // BED file upload via drag & drop or click
  const handleBedFile = file => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const bedContent = ev.target.result.trim()
      setGenes([])  // uploaded BED replaces any gene-based BED
      bedReqId.current++
      setUploadedBed(bedContent)
      setUploadedName(file.name)
      setBedText(bedContent)
      setExtraBedLines(bedContent)  // keep as base for merging
      setBedPath(`uploaded:${file.name}`)
      setBedMissing([])
    }
    reader.readAsText(file)
  }

  const handleDrop = e => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.bed') || file.name.endsWith('.txt'))) handleBedFile(file)
  }

  const handleSave = async () => {
    if (!bedText) return
    const fp = await saveFilePath(t.panel.saveLocal, `panel_${genome}.bed`, [{ name: 'BED', extensions: ['bed'] }])
    if (!fp) return
    const r = await writeToDisk(fp, bedText)
    if (r.ok) { setBedPath(fp); setSaveMsg(fp); setTimeout(() => setSaveMsg(''), 4000) }
  }

  const downloadBed = () => {
    const blob = new Blob([bedText], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = uploadedName || `panel_${genome}.bed`
    a.click()
  }

  const lineCount  = bedText ? bedText.trim().split('\n').filter(Boolean).length : 0
  const canNext    = bedText.length > 0 || genes.length > 0 || uploadedBed.length > 0

  const MODES = [
    ...(instInfo ? [{ id: 'institutional', icon: <Building2 size={15}/>, label: lang==='tr' ? 'Kurumsal Panel' : 'Institutional Panel' }] : []),
    { id: 'preset',       icon: '🧬',                   label: lang==='tr' ? 'Hazır Paneller' : 'Clinical Presets'     },
    { id: 'custom',        icon: <Search size={15}/>,    label: lang==='tr' ? 'Gen Ekle'       : 'Add Genes'            },
    { id: 'upload',        icon: <FileUp size={15}/>,    label: lang==='tr' ? 'BED Yükle'      : 'Upload BED'           },
  ]

  return (
    <WizardLayout
      step={1}
      title={t.panel.title}
      subtitle={t.panel.subtitle}
      next={<Btn variant="primary" size="lg" disabled={!canNext} onClick={() => goTo(2)}>
        {t.panel.next} <ArrowRight size={16}/>
      </Btn>}
    >
      <div className={s.grid}>
        {/* LEFT */}
        <div className={s.left}>

          {/* Genome build */}
          <SectionCard title={t.panel.genome} hint={t.panel.genomeHint}>
            <div className={s.genomeBtns}>
              {['hg19','hg38'].map(b => (
                <button key={b} className={`${s.gBtn} ${genome===b?s.gActive:''}`}
                  onClick={() => { setGenome(b); clearPanel() }}>
                  <span className={s.gName}>{b}</span>
                  <span className={s.gSub}>{b==='hg19'?'GRCh37':'GRCh38'}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Mode tabs */}
          <div className={s.modeTabs}>
            {MODES.map(m => (
              <button key={m.id}
                className={`${s.modeTab} ${activeMode===m.id?s.modeActive:''}`}
                onClick={() => setActiveMode(m.id)}>
                <span className={s.modeIcon}>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* INSTITUTIONAL */}
          {activeMode === 'institutional' && instInfo && (
            <SectionCard>
              <div className={s.instCard}>
                <div className={s.instIcon}>🏥</div>
                <div className={s.instInfo}>
                  <div className={s.instTitle}>
                    {lang==='tr' ? 'Kurumsal Panel' : 'Institutional Panel'}
                  </div>
                  <div className={s.instDesc}>
                    {lang==='tr'
                      ? `${instInfo.genes ? `${instInfo.genes} gen · ` : ''}${instInfo.regions} hedef bölge`
                      : `${instInfo.genes ? `${instInfo.genes} genes · ` : ''}${instInfo.regions} target regions`}
                  </div>
                </div>
                <Btn variant="primary" size="md" onClick={loadInstitutional} disabled={instLoading}>
                  {instLoading
                    ? (lang==='tr' ? 'Yükleniyor...' : 'Loading...')
                    : (uploadedName.includes('Kurumsal')
                        ? (lang==='tr' ? '✓ Yüklendi' : '✓ Loaded')
                        : (lang==='tr' ? 'Paneli Kullan' : 'Use Panel'))}
                </Btn>
              </div>
              {uploadedName.includes('Kurumsal') && (
                <div className={s.instLoaded}>
                  ✓ {uploadedName} {lang==='tr' ? 'yüklendi' : 'loaded'} — {lang==='tr' ? 'devam edebilirsiniz' : 'ready to continue'}
                </div>
              )}
            </SectionCard>
          )}

          {/* PRESET PANELS */}
          {activeMode === 'preset' && (
            <SectionCard title={t.panel.presets}>
              <div className={s.presetGrid}>
                {Object.keys(panels).map(p => (
                  <button key={p}
                    className={`${s.presetBtn} ${selPanel===p?s.presetActive:''}`}
                    onClick={() => setSelPanel(selPanel===p?'':p)}>
                    {p}
                    {selPanel===p && <CheckCheck size={12}/>}
                  </button>
                ))}
              </div>
              {selPanel && (
                <div className={s.presetApply}>
                  <div className={s.presetApplyInfo}>
                    <span className={s.presetSel}>{selPanel}</span>
                    <span className={s.presetCount}>{(panels[selPanel]||[]).length} {lang==='tr'?'gen':'genes'}</span>
                  </div>
                  <div className={s.presetApplyBtns}>
                    <Btn variant="default" size="sm" onClick={() => applyPanel(selPanel)}>
                      {lang==='tr' ? 'Genleri Listeye Ekle' : 'Add to List'}
                    </Btn>
                    <Btn variant="primary" size="sm" onClick={() => applyPanel(selPanel)} disabled={busy.bed}>
                      {busy.bed ? '...' : (lang==='tr' ? 'BED Oluştur →' : 'Generate BED →')}
                    </Btn>
                  </div>
                </div>
              )}
              {genes.length > 0 && (
                <div className={s.currentGenes}>
                  <span className={s.currentGenesLabel}>
                    {lang==='tr' ? `Mevcut liste: ${genes.length} gen` : `Current list: ${genes.length} genes`}
                  </span>
                  <button className={s.clearAll} onClick={clearPanel}>
                    {t.panel.clearAll}
                  </button>
                </div>
              )}
            </SectionCard>
          )}

          {/* CUSTOM GENE INPUT */}
          {activeMode === 'custom' && (
            <SectionCard title={genes.length > 0
              ? (lang==='tr' ? `Gen Ekle — Mevcut: ${genes.length} gen` : `Add Genes — Current: ${genes.length} genes`)
              : t.panel.custom}>
              {genes.length > 0 && (
                <div className={s.existingNote}>
                  {lang==='tr'
                    ? '↓ Mevcut listeye yeni gen ekleyebilirsiniz'
                    : '↓ You can add more genes to the existing list'}
                </div>
              )}
              <div className={s.inputRow}>
                <div className={s.acWrap}>
                  <Search size={13} className={s.ico}/>
                  <input ref={inputRef} className={s.geneIn}
                    placeholder={t.panel.searchGene}
                    value={input}
                    onChange={e => handleInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key==='Enter') { suggest.length ? addGene(suggest[0]) : input.trim() && addMany(input); e.preventDefault() }
                      if (e.key==='Escape') setSuggest([])
                    }}
                  />
                  {suggest.length > 0 && (
                    <div className={s.dropdown}>
                      {suggest.map(g => (
                        <button key={g} className={s.dropItem} onClick={() => addGene(g)}>
                          <span className={s.dropGene}>{g}</span>
                          <span className={s.dropBuild}>{genome}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Btn variant="primary" size="md" onClick={() => input.trim() && addMany(input)}>
                  {t.panel.addGene}
                </Btn>
              </div>

              {/* Gene pool - shows genes from ALL sources */}
              <div className={s.genePoolBanner}>
                <span className={s.genePoolCount}>
                  {genes.length > 0
                    ? `${genes.length} gen seçili`
                    : "Henüz gen eklenmedi — panel seç veya gen ekle"}
                </span>
                {genes.length > 0 && (
                  <button className={s.clearAll} onClick={clearPanel}>
                    {t.panel.clearAll}
                  </button>
                )}
              </div>
              {genes.length > 0 && (
                <div className={s.tags} style={{marginBottom:'10px'}}>
                  {genes.map(g => <Tag key={g} onRemove={() => {
                const newG = genes.filter(x=>x!==g)
                setGenes(newG)
                autoGenBed(newG)
              }}>{g}</Tag>)}
                </div>
              )}

              {genes.length > 0 && (
                <>
                  <div className={s.paddingRow}>
                    <span className={s.paddingLabel}>{t.panel.padding} — <b>{padding} bp</b></span>
                    <input type="range" min="0" max="500" step="10" value={padding}
                      onChange={e => { const p=+e.target.value; setPadding(p); if(genes.length) autoGenBed(genes, p) }}
                      className={s.sliderInline}/>
                  </div>
                  <Btn variant="primary" size="lg" className={s.genBtn}
                    disabled={!genes.length || busy.bed} onClick={handleGenerateBed}>
                    {busy.bed ? t.panel.generating : (bedText ? (lang==='tr' ? '🔄 BED Güncelle' : '🔄 Update BED') : t.panel.generate)}
                  </Btn>
                </>
              )}
            </SectionCard>
          )}

          {/* BED UPLOAD */}
          {activeMode === 'upload' && (
            <SectionCard title={lang==='tr' ? 'BED Dosyası Yükle' : 'Upload BED File'}>
              <div
                ref={dropRef}
                className={`${s.dropZone} ${isDragging?s.dropActive:''} ${uploadedBed?s.dropLoaded:''}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('bed-file-input').click()}
              >
                <input id="bed-file-input" type="file" accept=".bed,.txt"
                  style={{display:'none'}}
                  onChange={e => handleBedFile(e.target.files[0])}/>
                {uploadedBed ? (
                  <>
                    <div className={s.dropLoadedIcon}>✓</div>
                    <div className={s.dropLoadedName}>{uploadedName}</div>
                    <div className={s.dropLoadedCount}>{lineCount} {lang==='tr' ? 'bölge' : 'regions'}</div>
                    <button className={s.dropClear}
                      onClick={e => { e.stopPropagation(); clearPanel() }}>
                      <X size={12}/> {lang==='tr' ? 'Kaldır' : 'Remove'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className={s.dropIcon}><Upload size={28} strokeWidth={1.2}/></div>
                    <div className={s.dropLabel}>
                      {lang==='tr' ? 'BED dosyasını buraya sürükleyin' : 'Drag & drop BED file here'}
                    </div>
                    <div className={s.dropHint}>
                      {lang==='tr' ? 'veya tıklayıp seçin · .bed / .txt' : 'or click to browse · .bed / .txt'}
                    </div>
                  </>
                )}
              </div>

              {/* Also allow using BED from builder */}
              {uploadedBed && (
                <div className={s.uploadReady}>
                  {lang==='tr' ? '✓ BED hazır, bir sonraki adıma geçebilirsiniz.' : '✓ BED ready, you can proceed.'}
                </div>
              )}
            </SectionCard>
          )}
        </div>

        {/* RIGHT — BED preview */}
        <div className={s.right}>
          <div className={s.bedCard}>
            <div className={s.bedHead}>
              <div>
                <div className={s.bedTitle}>BED {lang==='tr' ? 'Önizleme' : 'Preview'}</div>
                {lineCount > 0 && (
                  <div className={s.bedMeta}>
                    {lineCount} {t.panel.regions}
                    {activeMode !== 'upload' && activeMode !== 'institutional' && ` · ${genome} · ±${padding}bp`}
                  </div>
                )}
              </div>
              {bedText && lineCount > 0 && (
                <div className={s.bedActions}>
                  <Btn variant="success" size="sm" onClick={downloadBed}>
                    <Save size={13}/> {lang==='tr' ? 'İndir' : 'Download'}
                  </Btn>
                </div>
              )}
            </div>

            {bedMissing.length > 0 && (
              <div className={s.missing}>
                <AlertCircle size={13}/>
                <span>{t.panel.notFound}: <b>{bedMissing.join(', ')}</b></span>
              </div>
            )}
            {saveMsg && <div className={s.savedMsg}>✓ {saveMsg}</div>}

            {bedText
              ? <pre className={s.bedPre}>{bedText}</pre>
              : (
                <div className={s.bedEmpty}>
                  <div className={s.bedEmptyIcon}>🧬</div>
                  <p>{lang==='tr'
                    ? 'Sol taraftan panel seçin veya BED yükleyin'
                    : 'Select a panel or upload a BED file'}</p>
                  <p className={s.bedEmptyHint}>
                    {instInfo
                      ? (lang==='tr'
                          ? 'Kurumsal panel, hazır klinik paneller veya kendi BED dosyanız'
                          : 'Institutional panel, clinical presets, or your own BED file')
                      : (lang==='tr'
                          ? 'Hazır klinik paneller, gen listesi veya kendi BED dosyanız'
                          : 'Clinical presets, a gene list, or your own BED file')}
                  </p>
                </div>
              )
            }
          </div>
        </div>
      </div>
    </WizardLayout>
  )
}
