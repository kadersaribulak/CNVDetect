import { useEffect, useState, useCallback } from 'react'
import { Folder, FileText, ArrowUp, X, Check, HardDrive } from 'lucide-react'
import { API } from '../api'
import s from './FolderBrowser.module.css'

/**
 * Folder picker that lists folders through the backend (which runs on the same machine).
 * Unlike the browser's upload dialog it shows the FASTQ files inside each folder
 * and returns the full path the pipeline needs.
 */
export default function FolderBrowser({ initialPath = '', lang = 'tr', onSelect, onClose }) {
  const tr = lang === 'tr'
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [typed,   setTyped]   = useState('')

  const load = useCallback(async (path) => {
    setLoading(true)
    try {
      const r = await fetch(API + '/api/browse?path=' + encodeURIComponent(path || ''))
      const d = await r.json()
      setData(d)
      setTyped(d.path || '')
    } catch {
      setData({ error: tr ? 'Backend\'e ulaşılamadı' : 'Backend unreachable', shortcuts: [] })
    } finally { setLoading(false) }
  }, [tr])

  useEffect(() => { load(initialPath && initialPath.startsWith('/') ? initialPath : '') }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const path     = data?.path || ''
  const fastqs   = data?.fastqs || []
  const samples  = data?.samples || []
  const canPick  = !!path && !data?.error && fastqs.length > 0
  const crumbs   = path.split('/').filter(Boolean)

  return (
    <div className={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.dialog} role="dialog" aria-modal="true">
        <div className={s.head}>
          <span className={s.title}>{tr ? 'FASTQ klasörünü seçin' : 'Select the FASTQ folder'}</span>
          <button className={s.iconBtn} onClick={onClose} aria-label="close"><X size={16}/></button>
        </div>

        {/* Path bar: breadcrumbs + editable path */}
        <div className={s.pathBar}>
          <button className={s.iconBtn} disabled={!data?.parent || loading} onClick={() => load(data.parent)}
            title={tr ? 'Üst klasör' : 'Parent folder'}><ArrowUp size={15}/></button>
          <div className={s.crumbs}>
            <button className={s.crumb} onClick={() => load('/')}>/</button>
            {crumbs.map((c, i) => (
              <span key={i} className={s.crumbWrap}>
                <button className={s.crumb} onClick={() => load('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                {i < crumbs.length - 1 && <span className={s.sep}>/</span>}
              </span>
            ))}
          </div>
        </div>
        <form className={s.typeRow} onSubmit={e => { e.preventDefault(); load(typed.trim()) }}>
          <input className={s.typeInput} value={typed} onChange={e => setTyped(e.target.value)}
            spellCheck={false} placeholder="/mnt/c/Users/.../FASTQ"/>
          <button className={s.goBtn} type="submit">{tr ? 'Git' : 'Go'}</button>
        </form>

        <div className={s.body}>
          {/* Shortcuts */}
          <div className={s.side}>
            {(data?.shortcuts || []).map(sc => (
              <button key={sc.path} className={`${s.shortcut} ${path === sc.path ? s.shortcutOn : ''}`}
                onClick={() => load(sc.path)} title={sc.path}>
                <HardDrive size={13}/> <span>{sc.label}</span>
              </button>
            ))}
          </div>

          {/* Listing */}
          <div className={s.list}>
            {loading && <div className={s.empty}>{tr ? 'Yükleniyor...' : 'Loading...'}</div>}
            {!loading && data?.error && <div className={s.error}>{data.error}</div>}
            {!loading && !data?.error && <>
              {(data?.dirs || []).map(d => (
                <button key={d} className={s.row} onClick={() => load(path.replace(/\/$/, '') + '/' + d)}>
                  <Folder size={15} className={s.folderIco}/> <span>{d}</span>
                </button>
              ))}
              {fastqs.map(f => (
                <div key={f} className={`${s.row} ${s.fileRow}`}>
                  <FileText size={15} className={s.fileIco}/> <span>{f}</span>
                </div>
              ))}
              {!(data?.dirs || []).length && !fastqs.length && (
                <div className={s.empty}>
                  {tr ? 'Bu klasörde alt klasör veya FASTQ dosyası yok' : 'No subfolders or FASTQ files here'}
                  {data?.otherFiles ? ` (${data.otherFiles} ${tr ? 'başka dosya' : 'other files'})` : ''}
                </div>
              )}
            </>}
          </div>
        </div>

        <div className={s.foot}>
          <div className={s.summary}>
            {fastqs.length > 0
              ? <><b>{fastqs.length}</b> FASTQ · <b>{samples.length}</b> {tr ? 'örnek' : 'samples'}
                  {samples.length > 0 && <span className={s.sampleNames}> — {samples.slice(0, 4).join(', ')}{samples.length > 4 ? '…' : ''}</span>}</>
              : <span className={s.muted}>{tr ? 'FASTQ dosyalarının bulunduğu klasöre girin' : 'Open the folder that contains the FASTQ files'}</span>}
          </div>
          <button className={s.cancelBtn} onClick={onClose}>{tr ? 'İptal' : 'Cancel'}</button>
          <button className={s.pickBtn} disabled={!canPick} onClick={() => onSelect(path)}>
            <Check size={14}/> {tr ? 'Bu klasörü seç' : 'Select this folder'}
          </button>
        </div>
      </div>
    </div>
  )
}
