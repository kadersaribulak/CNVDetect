import { createContext, useContext, useState, useCallback } from 'react'
import axios from 'axios'

const API = 'http://localhost:8765'
const Ctx = createContext(null)

export function StoreProvider({ children }) {
  // Wizard state
  const [step, setStep] = useState(0)  // 0=welcome, 1=panel, 2=samples, 3=run, 4=results

  // Step 1 — Panel
  const [genome,        setGenome]        = useState('hg19')
  const [genes,         setGenes]         = useState([])
  const [padding,       setPadding]       = useState(50)
  const [bedText,       setBedText]       = useState('')
  const [bedMissing,    setBedMissing]    = useState([])
  const [bedPath,       setBedPath]       = useState('')
  const [extraBedLines, setExtraBedLines] = useState('')

  // Step 2 — Samples
  const [sampleRows,    setSampleRows]    = useState([])
  const [useGender,     setUseGender]     = useState(true)
  const [genderPath,    setGenderPath]    = useState('')

  // Step 3 — Run
  const [fastqDir,   setFastqDir]   = useState('')
  const [outputDir,  setOutputDir]  = useState('')
  const [doAnno,     setDoAnno]     = useState(true)
  const [threads,    setThreads]    = useState(5)
  const [keepBams,   setKeepBams]   = useState(false)
  const [cmdCopied,  setCmdCopied]  = useState(false)

  // Step 4 — Results
  const [cnvRows,    setCnvRows]    = useState([])
  const [annoRows,   setAnnoRows]   = useState([])
  const [merged,     setMerged]     = useState([])
  const [cnvFile,    setCnvFile]    = useState('')
  const [matchCount, setMatchCount] = useState(0)

  // Shared
  const [busy,  setBusy]  = useState({})
  const [error, setError] = useState(null)

  // ── Actions ──────────────────────────────────────────────────────────────

  const generateBed = useCallback(async () => {
    if (!genes.length) return
    setBusy(b => ({ ...b, bed: true })); setBedText(''); setBedMissing([])
    try {
      const { data } = await axios.post(`${API}/api/bed/generate`, { genes, build: genome, padding })
      setBedText(data.bed); setBedMissing(data.missing || [])
    } catch (e) { setError(e.message) }
    finally { setBusy(b => ({ ...b, bed: false })) }
  }, [genes, genome, padding])

  const uploadCnv = useCallback(async (file) => {
    setBusy(b => ({ ...b, cnv: true })); setError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const { data } = await axios.post(`${API}/api/upload/cnv`, fd)
      setCnvRows(data.rows); setCnvFile(data.filename)
    } catch (e) { setError(e.message) }
    finally { setBusy(b => ({ ...b, cnv: false })) }
  }, [])

  const uploadAnno = useCallback(async (file) => {
    setBusy(b => ({ ...b, anno: true })); setError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const { data } = await axios.post(`${API}/api/upload/annotation`, fd)
      setAnnoRows(data.rows)
    } catch (e) {
      console.error('Anno upload error:', e)
      setError(e.message)
    } finally { setBusy(b => ({ ...b, anno: false })) }
  }, [])

  const doMerge = useCallback(async () => {
    if (!cnvRows.length) return
    setBusy(b => ({ ...b, merge: true }))
    try {
      const { data } = await axios.post(`${API}/api/merge`, {
        cnv: cnvRows, annotation: annoRows, cnv_filename: cnvFile
      })
      setMerged(data.merged); setMatchCount(data.matched)
    } catch (e) { setError(e.message) }
    finally { setBusy(b => ({ ...b, merge: false })) }
  }, [cnvRows, annoRows, cnvFile])

  const resetResults = useCallback(() => {
    setCnvRows([]); setAnnoRows([]); setMerged([])
    setCnvFile(''); setMatchCount(0); setError(null)
  }, [])

  const goTo = (s) => { setStep(s); setError(null) }

  return (
    <Ctx.Provider value={{
      step, goTo,
      genome, setGenome, genes, setGenes, padding, setPadding,
      bedText, setBedText, bedMissing, setBedMissing, bedPath, setBedPath,
      extraBedLines, setExtraBedLines,
      generateBed,
      sampleRows, setSampleRows, useGender, setUseGender,
      genderPath, setGenderPath,
      fastqDir, setFastqDir, outputDir, setOutputDir,
      doAnno, setDoAnno, threads, setThreads, keepBams, setKeepBams, cmdCopied, setCmdCopied,
      cnvRows, annoRows, merged, cnvFile, matchCount,
      uploadCnv, uploadAnno, doMerge, resetResults,
      busy, error, setError
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useStore = () => useContext(Ctx)
