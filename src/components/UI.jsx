import s from './UI.module.css'

// ── Wizard page wrapper ───────────────────────────────────────────────────
export function WizardLayout({ children, title, subtitle, back, next, extra }) {
  return (
    <div className={s.wizardPage}>
      <div className={s.wizardInner}>
        {/* Page header */}
        <div className={s.wizardHeader}>
          <div>
            <h2 className={s.wizardTitle}>{title}</h2>
            {subtitle && <p className={s.wizardSub}>{subtitle}</p>}
          </div>
          {extra && <div className={s.wizardExtra}>{extra}</div>}
        </div>

        {/* Content */}
        <div className={s.wizardContent}>
          {children}
        </div>

        {/* Nav buttons */}
        {(back || next) && (
          <div className={s.wizardNav}>
            <div>{back}</div>
            <div>{next}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────
export function SectionCard({ title, hint, children, className = '' }) {
  return (
    <div className={`${s.scard} ${className}`}>
      {title && (
        <div className={s.scardHead}>
          <span className={s.scardTitle}>{title}</span>
          {hint && <span className={s.scardHint}>{hint}</span>}
        </div>
      )}
      <div className={s.scardBody}>{children}</div>
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────
export function Btn({ children, variant = 'default', size = 'md', onClick, disabled, className = '', type = 'button' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${s.btn} ${s[`btn-${variant}`]} ${s[`btn-${size}`]} ${className}`}>
      {children}
    </button>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
export function StatCard({ label, value, variant, sub }) {
  return (
    <div className={`${s.stat} ${variant ? s[`stat-${variant}`] : ''}`}>
      <div className={s.statLbl}>{label}</div>
      <div className={s.statNum}>{value ?? '—'}</div>
      {sub && <div className={s.statSub}>{sub}</div>}
    </div>
  )
}

// ── Upload zone ───────────────────────────────────────────────────────────
export function UploadZone({ id, label, subtitle, loaded, filename, loading, onChange, accept = '.tsv,.txt,.csv' }) {
  return (
    <label className={`${s.zone} ${loaded ? s.zoneOk : ''} ${loading ? s.zoneLoading : ''}`} htmlFor={id}>
      <input id={id} type="file" accept={accept} style={{ display: 'none' }} onChange={onChange} />
      <div className={s.zoneIcon}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div className={s.zoneText}>
        <span className={s.zoneLabel}>{loading ? '...' : loaded ? (filename || label) : label}</span>
        {subtitle && !loaded && <span className={s.zoneSub}>{subtitle}</span>}
        {loaded && <span className={`${s.zoneSub} ${s.zoneOkText}`}>✓ Yüklendi</span>}
      </div>
    </label>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────
export function Badge({ type }) {
  const cls = type === 'DEL' ? s.del : type === 'DUP' ? s.dup : s.na
  return <span className={`${s.badge} ${cls}`}>{type || '—'}</span>
}

export function ClassBadge({ val }) {
  if (!val) return <span className={s.empty}>—</span>
  const low = val.toLowerCase()
  if (low.includes('pathogenic') && low.includes('likely')) return <span className={`${s.badge} ${s.lpath}`}>{val}</span>
  if (low.includes('pathogenic'))   return <span className={`${s.badge} ${s.path}`}>{val}</span>
  if (low.includes('likely benign')) return <span className={`${s.badge} ${s.lbenign}`}>{val}</span>
  if (low.includes('benign'))       return <span className={`${s.badge} ${s.benign}`}>{val}</span>
  if (low.includes('uncertain') || low.includes('vus')) return <span className={`${s.badge} ${s.vus}`}>{val}</span>
  return <span className={`${s.badge} ${s.na}`}>{val}</span>
}

// ── Tag ───────────────────────────────────────────────────────────────────
export function Tag({ children, onRemove }) {
  return (
    <span className={s.tag}>
      {children}
      {onRemove && <button className={s.tagX} onClick={onRemove} type="button">×</button>}
    </span>
  )
}

export function ConfBadge({ val }) {
  if (!val) return <span className={s.empty}>—</span>
  const v = val.toUpperCase()
  if (v === 'HIGH')   return <span className={`${s.badge} ${s.confHigh}`}>HIGH</span>
  if (v === 'MEDIUM') return <span className={`${s.badge} ${s.confMed}`}>MED</span>
  if (v === 'LOW')    return <span className={`${s.badge} ${s.confLow}`}>LOW</span>
  return <span className={`${s.badge} ${s.na}`}>{val}</span>
}
